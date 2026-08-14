import { connectRedis } from './redis';
import { AppDataSource } from './typeorm';
import { IsNull } from 'typeorm';
import { initMail } from '../services/mailService';
import { startRetentionJobs } from '../services/retentionService';
import { WingsSocketService } from '../services/wingsSocketService';
import { WingsApiService } from '../services/wingsApiService';
import { restoreDesiredPowerStatesForNode } from '../services/serverDesiredStateService';
import { NodeHeartbeatService } from '../services/nodeHeartbeatService';
import { startAllSftpProxies } from '../services/sftpProxyService';
import fs from 'fs';
import path from 'path';
import { ServerConfig } from '../models/serverConfig.entity';
import { ServerScheduleStep } from '../models/serverScheduleStep.entity';
import { PanelSetting } from '../models/panelSetting.entity';
import { User } from '../models/user.entity';
import { OrganisationMember } from '../models/organisationMember.entity';
import { createActivityLog } from '../handlers/logHandler';
import type { Node } from '../models/node.entity';
import type { Organisation } from '../models/organisation.entity';

type ConfigApp = {
  log: {
    info: (msg: unknown, ...args: unknown[]) => void;
    warn: (msg: unknown, ...args: unknown[]) => void;
    error: (msg: unknown, ...args: unknown[]) => void;
  };
};

type NodeWithBackendUrl = Node & {
  backendWingsUrl?: string | null;
};

type ServerStub = {
  uuid?: string | null;
  id?: string | number | null;
};

type UserWithLegacyOrg = User & {
  org?: Organisation | null;
  orgRole?: string | null;
};

type LegacyOrgMember = {
  uuid: string;
  createdAt: Date;
};

type QueryRow = {
  cnt?: string | number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const WINGS_RETRY_INITIAL = 30_000;
const WINGS_RETRY_MAX = 10 * 60_000;

function connectNodeWithRetry(app: ConfigApp, node: NodeWithBackendUrl, delay = WINGS_RETRY_INITIAL) {
  const base = node.backendWingsUrl || node.url;
  const sock = new WingsSocketService(base, node.token, node.id);
  const api = new WingsApiService(base, node.token);
  sock
    .listenToAll()
    .then(async () => {
      try {
        const res = await api.getServers();
        const servers = Array.isArray(res.data)
          ? (res.data as ServerStub[])
          : ((res.data as { servers?: ServerStub[] } | undefined)?.servers ?? []);
        for (const s of servers) {
          const id = String(s.uuid || s.id || '');
          if (!id) continue;
          try {
            await api.syncServer(id, {});
            app.log.info({ node: node.name, server: id }, 'auto-sync initiated on node connect');
          } catch (e: unknown) {
            app.log.warn(
              { err: e, node: node.name, server: id },
              'auto-sync failed on node connect'
            );
          }
        }
        try {
          await restoreDesiredPowerStatesForNode(node.id);
        } catch (e: unknown) {
          app.log.warn(
            { err: e, node: node.name },
            'failed to restore desired power state on node connect'
          );
        }
      } catch (e: unknown) {
        app.log.warn(
          { err: e, node: node.name },
          'failed to list servers for auto-sync on node connect'
        );
      }
    })
    .catch((e: unknown) => {
      const isTransient = [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ECONNABORTED',
        'ENOTFOUND',
        'ECONNRESET',
      ].includes((isRecord(e) ? (e.code as string | undefined) : undefined) || '');
      if (isTransient) {
        app.log.warn(
          { node: node.name, code: isRecord(e) ? e.code : undefined, url: node.url },
          `wings node unreachable — retrying in ${Math.round(delay / 1000)}s`
        );
      } else {
        app.log.error({ e, node: node.name }, 'wings socket error');
      }
      const next = Math.min(delay * 2, WINGS_RETRY_MAX);
      setTimeout(() => connectNodeWithRetry(app, node, next), delay);
    });
}

export async function setupConfig(app: ConfigApp) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable must be set in production');
    }
    (app.log ?? console).warn(
      'JWT_SECRET is not set — using insecure default. DO NOT deploy to production without setting this.'
    );
  } else if (jwtSecret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be at least 32 characters long');
    }
    (app.log ?? console).warn(
      'JWT_SECRET is too short (less than 32 characters). Use a long random string in production.'
    );
  }

  await AppDataSource.initialize().catch(err => {
    (app.log ?? console).error({ err }, 'Error during Data Source initialization');
    throw err;
  });

  try {
    const userRepo = AppDataSource.getRepository(User);
    const orgMemberRepo = AppDataSource.getRepository(OrganisationMember);
    const users = (await userRepo.find({ relations: { org: true } })) as UserWithLegacyOrg[];
    for (const user of users) {
      const org = user.org;
      if (!org?.id) continue;
      const existing = await orgMemberRepo.findOne({
        where: { userId: user.id, organisationId: org.id },
      });
      if (existing) continue;
      const inferredRole = user.id === org.ownerId ? 'owner' : user.orgRole || 'member';
      const link = orgMemberRepo.create({
        userId: user.id,
        organisationId: org.id,
        user,
        organisation: org,
        orgRole: inferredRole,
        createdAt: new Date(),
      });
      await orgMemberRepo.save(link);
    }

    const nullCreatedAtCount = await userRepo.count({ where: { createdAt: IsNull() } });
    if (nullCreatedAtCount > 0) {
      app.log?.info({ count: nullCreatedAtCount }, 'Backfilling missing user createdAt values');
      await userRepo
        .createQueryBuilder()
        .update(User)
        .set({ createdAt: new Date() })
        .where('createdAt IS NULL')
        .execute();
    }
  } catch (err: unknown) {
    app.log?.warn(
      { err },
      'Failed to backfill organisation memberships from legacy user.org relation or createdAt values'
    );
  }

  try {
    const dbType = String(AppDataSource.options.type || '');
    if (dbType === 'mysql' || dbType === 'mariadb') {
      const rows = await AppDataSource.query(
        `SELECT COUNT(1) AS cnt
           FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = 'soc_data'
            AND index_name = 'IDX_soc_data_server_timestamp'`
      );
      const count = Number((rows?.[0] as QueryRow | undefined)?.cnt ?? 0);
      if (count === 0) {
        await AppDataSource.query(
          'CREATE INDEX IDX_soc_data_server_timestamp ON soc_data (serverId, timestamp)'
        );
      }
    } else if (dbType === 'postgres') {
      await AppDataSource.query(
        'CREATE INDEX IF NOT EXISTS "IDX_soc_data_server_timestamp" ON "soc_data" ("serverId", "timestamp")'
      );
    }
  } catch (err: unknown) {
    app.log?.warn({ err }, 'Failed to ensure soc_data(serverId,timestamp) index');
  }

  try {
    const dbType = String(AppDataSource.options.type || '');
    if (dbType === 'mysql' || dbType === 'mariadb') {
      await AppDataSource.query(
        `DELETE p1 FROM passkey p1 INNER JOIN passkey p2
          ON p1.credentialID = p2.credentialID AND p1.id < p2.id`
      );
      const rows = await AppDataSource.query(
        `SELECT COUNT(1) AS cnt
           FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = 'passkey'
            AND index_name = 'IDX_passkey_credentialID_unique'`
      );
      if (Number((rows?.[0] as QueryRow | undefined)?.cnt ?? 0) === 0) {
        await AppDataSource.query(
          'CREATE UNIQUE INDEX IDX_passkey_credentialID_unique ON passkey (credentialID)'
        );
      }
    } else if (dbType === 'postgres') {
      await AppDataSource.query(
        `DELETE FROM passkey WHERE id NOT IN (
           SELECT MAX(id) FROM passkey GROUP BY "credentialID"
         )`
      );
      await AppDataSource.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_passkey_credentialID_unique" ON "passkey" ("credentialID")'
      );
    }
  } catch (err: unknown) {
    app.log?.warn({ err }, 'Failed to ensure unique passkey credentialID index');
  }

  try {
    const dbType = String(AppDataSource.options.type || '');
    if (dbType === 'mysql' || dbType === 'mariadb') {
      const rows = await AppDataSource.query(
        `SELECT COUNT(1) AS cnt
           FROM information_schema.statistics
          WHERE table_schema = DATABASE()
            AND table_name = 'api_key'
            AND index_name = 'IDX_api_key_expiresAt'`
      );
      if (Number((rows?.[0] as QueryRow | undefined)?.cnt ?? 0) === 0) {
        await AppDataSource.query('CREATE INDEX IDX_api_key_expiresAt ON api_key (expiresAt)');
      }
    } else if (dbType === 'postgres') {
      await AppDataSource.query('CREATE INDEX IF NOT EXISTS "IDX_api_key_expiresAt" ON "api_key" ("expiresAt")');
    }
  } catch (err: unknown) {
    app.log?.warn({ err }, 'Failed to ensure api_key(expiresAt) index');
  }

  try {
    const panelSettingRepo = AppDataSource.getRepository(PanelSetting);
    const doneFlag = await panelSettingRepo.findOneBy({ key: 'migrationFormatDoubleBraceV1' });
    if (!doneFlag) {
      const stepRepo = AppDataSource.getRepository(ServerScheduleStep);
      const steps = await stepRepo.find();
      const rewrite = (format: string): string => {
        let rewritten = '';
        let idx = 0;
        const total = format.length;
        while (idx < total) {
          const ch = format[idx];
          const next = idx < total - 1 ? format[idx + 1] : undefined;
          if (ch === '{' && next === '{') {
            rewritten += '{';
            idx += 2;
          } else if (ch === '{') {
            const closing = format.indexOf('}', idx + 1);
            if (closing > -1) {
              const variable = format.substring(idx + 1, closing);
              if (/^[ \t\n\r]*[A-Za-z0-9_][A-Za-z0-9_. -]*[ \t\n\r]*$/.test(variable)) {
                rewritten += '{{' + variable + '}}';
              } else {
                rewritten += '{' + variable + '}';
              }
              idx = closing + 1;
            } else {
              rewritten += format.substring(idx);
              idx = total;
            }
          } else if (ch === '}' && next === '}') {
            rewritten += '}';
            idx += 2;
          } else {
            rewritten += ch;
            idx += 1;
          }
        }
        return rewritten;
      };
      let rewritten = 0;
      for (const st of steps) {
        const action = st.action as any;
        if (action && action.type === 'format' && typeof action.format === 'string') {
          const next = rewrite(action.format);
          if (next !== action.format) {
            st.action = { ...action, format: next };
            await stepRepo.save(st);
            rewritten++;
          }
        }
      }
      await panelSettingRepo.save({ key: 'migrationFormatDoubleBraceV1', value: 'done' });
      if (rewritten > 0) {
        app.log?.info?.({ rewritten }, 'Rewrote format schedule steps to double-brace syntax');
      }
    }
  } catch (err: unknown) {
    app.log?.warn({ err }, 'Failed to rewrite format schedule steps');
  }

  try {
    const { ensureAutoPartitions } = require('../utils/autoPartition');
    await ensureAutoPartitions(app.log ?? console);
  } catch (err: unknown) {
    app.log?.warn({ err }, 'Failed to ensure auto-partitioning');
  }

  try {
    await connectRedis();
    (app.log ?? console).info('Redis connected');
  } catch (err: unknown) {
    (app.log ?? console).error({ err }, 'Redis connection error');
  }

  try {
    await initMail();
    app.log.info('Mail transport ready');
  } catch (err: unknown) {
    app.log.error({ err }, 'Mail initialization failed');
  }

  startRetentionJobs();

  const heartbeatSvc = new NodeHeartbeatService();
  heartbeatSvc.start();

  try {
    await startAllSftpProxies();
  } catch (e: unknown) {
    app.log.error({ err: e }, 'Failed to start SFTP proxies');
  }

  const uploadDir = path.join(process.cwd(), 'uploads');
  if (Bun.file(uploadDir).size === 0) fs.mkdirSync(uploadDir, { recursive: true });

  try {
    const nodeRepo = AppDataSource.getRepository(require('../models/node.entity').Node);
    const nodes = (await nodeRepo.find()) as NodeWithBackendUrl[];
    try {
      const cfgRepo = AppDataSource.getRepository(ServerConfig);
      const duplicates = await cfgRepo
        .createQueryBuilder('c')
        .select('c.uuid', 'uuid')
        .addSelect('COUNT(*)', 'cnt')
        .groupBy('c.uuid')
        .having('COUNT(*) > 1')
        .getRawMany();
      if (duplicates && duplicates.length > 0) {
        app.log.info(
          { count: duplicates.length },
          'startup: found duplicate server configs — merging'
        );
        for (const d of duplicates) {
          const uuid = d.uuid;
          try {
            const rows = await cfgRepo.find({ where: { uuid }, order: { createdAt: 'ASC' } });
            if (!rows || rows.length <= 1) continue;
            const keep = rows[0];
            const others = rows.slice(1);
            for (const o of others) {
              keep.nodeId = keep.nodeId ?? o.nodeId;
              keep.userId = keep.userId ?? o.userId;
              keep.name = keep.name || o.name;
              keep.description = keep.description || o.description;
              keep.dockerImage = keep.dockerImage || o.dockerImage;
              keep.startup = keep.startup || o.startup;
              keep.environment =
                keep.environment && Object.keys(keep.environment || {}).length > 0
                  ? keep.environment
                  : o.environment;
              keep.memory = keep.memory ?? o.memory;
              keep.disk = keep.disk ?? o.disk;
              keep.cpu = keep.cpu ?? o.cpu;
              keep.swap = keep.swap ?? o.swap;
              keep.ioWeight = keep.ioWeight ?? o.ioWeight;
              keep.hibernated = keep.hibernated ?? o.hibernated;
              keep.eggId = keep.eggId ?? o.eggId;
              keep.skipEggScripts = keep.skipEggScripts ?? o.skipEggScripts;
              keep.allocations =
                keep.allocations && Object.keys(keep.allocations || {}).length > 0
                  ? keep.allocations
                  : o.allocations;
              keep.processConfig =
                keep.processConfig && Object.keys(keep.processConfig || {}).length > 0
                  ? keep.processConfig
                  : o.processConfig;
            }
            await cfgRepo.save(keep);
            const toDelete: LegacyOrgMember[] = others.map(r => ({ uuid: r.uuid, createdAt: r.createdAt }));
            await Promise.all(
              toDelete.map(item => cfgRepo.delete({ uuid: item.uuid, createdAt: item.createdAt }))
            ).catch(() => {});
            app.log.info(
              { uuid, kept: { uuid: keep.uuid, createdAt: keep.createdAt }, removed: toDelete },
              'startup: merged duplicate server configs'
            );
            try {
              await createActivityLog({
                userId: 0,
                action: 'servers:merge-duplicates-startup',
                targetId: uuid,
                targetType: 'server',
                metadata: {
                  kept: { uuid: keep.uuid, createdAt: keep.createdAt },
                  removed: toDelete,
                },
                ipAddress: '',
              });
            } catch (e: unknown) {}
          } catch (e) {
            app.log.warn(
              { err: e, uuid },
              'startup: failed to merge duplicate server configs for uuid'
            );
          }
        }
      }
    } catch (e) {
      app.log.warn({ err: e }, 'startup: duplicate server config merge check failed');
    }
    const wingsNodes = nodes.filter(n => !n.provider || n.provider === 'wings') as NodeWithBackendUrl[];
    const proxmoxNodes = nodes.filter(n => n.provider === 'proxmox');
    if (proxmoxNodes.length > 0) {
      app.log.info({ count: proxmoxNodes.length }, 'proxmox nodes configured, skipping wings socket for them');
    }
    if (wingsNodes.length > 0) {
      for (const n of wingsNodes) {
        connectNodeWithRetry(app, n);
      }
    } else {
      app.log.info('no wings nodes configured, skipping socket listeners');
    }
  } catch (e) {
    app.log.error({ e }, 'error checking nodes for wings socket startup');
  }
}
