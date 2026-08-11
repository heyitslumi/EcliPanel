import { AppDataSource } from '../config/typeorm';
import { AegisAttack } from '../models/aegisAttack.entity';
import { Node } from '../models/node.entity';
import { authenticate } from '../middleware/auth';
import { hasPermissionSync } from '../middleware/authorize';
import { t } from 'elysia';
import type { BaseHandlerContext, NodeApp } from '../types';

/** 
 * Welcome to hell!
 * This is home for Ecli Aegis (XDP Daemon) metrics that pushes its metrics here every N seconds
 * POST /api/v1/nodes/aegis/metrics (daemon to panel)
 * GET  /api/v1/nodes/aegis/metrics (aadmin get latest snapshot)
 * GET  /api/v1/nodes/aegis/history (admin get time series for graphs)
 * GET  /api/v1/nodes/aegis/attacks (admin get attack events log)
 */

const latestMetrics = new Map<number, { nodeName: string; receivedAt: number; data: any }>();
const MAX_AGE_MS = 10 * 60 * 1000;

interface Sample {
  ts: number;
  rps: number;
  bps: number;
  dropRps: number;
  dropBps: number;
  methods: Record<string, number>;
}
const HISTORY = new Map<number, Sample[]>();
const HISTORY_MAX = 8640; // 24 hours at 10s pushes

interface AttackEvent {
  nodeId: number;
  startTs: number;
  endTs: number | null;
  durationSec: number;
  method: string;
  peakDropPps: number;
  peakDropBps: number;
  avgDropPps: number;
  avgDropBps: number;
  peakNetPps: number;
  samples: number;
  type?: string;
  missed?: number;
}

function mergeClosedAttack(nodeId: number, type: string): AttackEvent | null {
  const list = ATTACKS.get(nodeId) ?? [];
  const idx = list.findIndex(
    (a) =>
      a.type === type &&
      a.endTs != null &&
      Date.now() - a.endTs < ATTACK_MERGE_GAP_MS,
  );
  if (idx < 0) return null;
  const [ev] = list.splice(idx, 1);
  ATTACKS.set(nodeId, list);
  return ev;
}
const ATTACKS = new Map<number, AttackEvent[]>();
const OPEN_ATTACK = new Map<string, AttackEvent>();
const ATTACKS_MAX = 200;

const ATTACK_THRESHOLD_PPS = 1000;
const ATTACK_COOLDOWN_SAMPLES = 2;
const ATTACK_MERGE_GAP_MS = 120_000;

const DAEMON_METHOD_LABELS: Record<string, string> = {
  syn_flood: 'SYN flood',
  udp_flood: 'UDP flood',
  icmp_flood: 'ICMP flood',
  tcp_conn_exhaustion: 'TCP connection exhaustion',
  bandwidth_saturation: 'Bandwidth saturation',
  http_flood: 'HTTP flood',
  egress_udp_flood: 'Egress UDP flood',
  egress_icmp_flood: 'Egress ICMP flood',
  egress_bandwidth: 'Egress bandwidth',
  dns_amplification: 'DNS amplification',
  ntp_amplification: 'NTP amplification',
  cldap_amplification: 'CLDAP amplification',
  ssdp_amplification: 'SSDP amplification',
  chargen_amplification: 'Chargen amplification',
  qotd_amplification: 'QOTD amplification',
  snmp_amplification: 'SNMP amplification',
  memcached_amplification: 'Memcached amplification',
  mssql_amplification: 'MSSQL amplification',
  ws_discovery_amplification: 'WS-Discovery amplification',
  coap_amplification: 'CoAP amplification',
  ipsec_nat_t_amplification: 'IPsec NAT-T amplification',
};

function daemonMethodLabel(type: string): string {
  return (
    DAEMON_METHOD_LABELS[type] ??
    type.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function closeAttack(key: string) {
  const open = OPEN_ATTACK.get(key);
  if (!open) return;
  open.endTs = Date.now();
  open.durationSec = Math.round((open.endTs - open.startTs) / 1000);
  const list = ATTACKS.get(open.nodeId) ?? [];
  list.unshift(open);
  if (list.length > ATTACKS_MAX) list.pop();
  ATTACKS.set(open.nodeId, list);
  OPEN_ATTACK.delete(key);
  void AppDataSource.getRepository(AegisAttack)
    .insert({
      nodeId: open.nodeId,
      type: open.type ?? '',
      method: open.method,
      startTs: open.startTs,
      endTs: open.endTs,
      durationSec: open.durationSec,
      peakDropPps: open.peakDropPps,
      peakDropBps: open.peakDropBps,
      avgDropPps: open.avgDropPps,
      avgDropBps: open.avgDropBps,
      peakNetPps: open.peakNetPps,
      samples: open.samples,
    })
    .then(() =>
      AppDataSource.getRepository(AegisAttack)
        .createQueryBuilder()
        .delete()
        .where('"startTs" < :cut', { cut: Date.now() - 30 * 86400_000 })
        .execute(),
    )
    .catch(() => {});
}

const METHOD_KEYS = [
  'drop_tcp_syn',
  'drop_udp_pps',
  'drop_icmp_pps',
  'drop_global_pps',
  'drop_mc_invalid',
  'drop_ssh_invalid',
  'drop_blocklist',
  'drop_other',
] as const;

const METHOD_LABELS: Record<string, string> = {
  drop_tcp_syn: 'SYN flood',
  drop_udp_pps: 'UDP flood',
  drop_icmp_pps: 'ICMP flood',
  drop_global_pps: 'PPS flood',
  drop_mc_invalid: 'Minecraft invalid',
  drop_ssh_invalid: 'SSH invalid',
  drop_blocklist: 'Blocklist',
  drop_other: 'Other',
};

function dominantMethod(prev: any, cur: any): { key: string; label: string } {
  let bestKey = 'drop_other';
  let bestDelta = -1;
  for (const k of METHOD_KEYS) {
    const a = Number(prev?.packets?.[k] ?? 0);
    const b = Number(cur?.packets?.[k] ?? 0);
    const delta = Math.max(0, b - a);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestKey = k;
    }
  }
  return { key: bestKey, label: METHOD_LABELS[bestKey] ?? bestKey };
}

function processPush(nodeId: number, data: any) {
  const now = Date.now();
  const prev = latestMetrics.get(nodeId)?.data;

  const methods: Record<string, number> = {};
  let dominant = 'drop_other';
  let bestDelta = -1;
  for (const k of METHOD_KEYS) {
    const a = Number(prev?.packets?.[k] ?? 0);
    const b = Number(data?.packets?.[k] ?? 0);
    const delta = Math.max(0, b - a);
    methods[k] = delta;
    if (delta > bestDelta) {
      bestDelta = delta;
      dominant = k;
    }
  }

  const sample: Sample = {
    ts: now,
    rps: Number(data?.traffic?.rps ?? 0),
    bps: Number(data?.traffic?.bps ?? 0),
    dropRps: Number(data?.traffic?.drop_rps ?? 0),
    dropBps: Number(data?.traffic?.drop_bps ?? 0),
    methods,
  };

  const hist = HISTORY.get(nodeId) ?? [];
  hist.push(sample);
  if (hist.length > HISTORY_MAX) hist.shift();
  HISTORY.set(nodeId, hist);

  const daemonAttacks = Array.isArray(data?.attacks) ? data.attacks : [];

  if (Array.isArray(data?.attacks)) {
    const reported = new Set<string>();
    for (const at of daemonAttacks) {
      const type = typeof at?.type === 'string' ? at.type : '';
      if (!type) continue;
      const key = `${nodeId}:${type}`;
      reported.add(key);
      if (at.active !== 1) {
        closeAttack(key);
        continue;
      }

      const isBps = type === 'bandwidth_saturation';
      const ratePps = Math.max(0, Number(at.rate ?? 0));
      const rateBps = Math.max(0, Number(at.rate_bps ?? 0));
      let open = OPEN_ATTACK.get(key);

      if (!open) {
        open = mergeClosedAttack(nodeId, type);
        if (!open) {
          open = {
            nodeId,
            startTs: now,
            endTs: null,
            durationSec: 0,
            method: daemonMethodLabel(type),
            type,
            peakDropPps: 0,
            peakDropBps: 0,
            avgDropPps: 0,
            avgDropBps: 0,
            peakNetPps: sample.rps,
            samples: 0,
          };
        }
        OPEN_ATTACK.set(key, open);
      }
      open.samples += 1;
      open.durationSec = Math.round((now - open.startTs) / 1000);
      open.peakNetPps = Math.max(open.peakNetPps, sample.rps);
      if (isBps) {
        open.peakDropBps = Math.max(open.peakDropBps, rateBps);
        open.avgDropBps += (rateBps - open.avgDropBps) / open.samples;
      } else {
        open.peakDropPps = Math.max(open.peakDropPps, ratePps);
        open.avgDropPps += (ratePps - open.avgDropPps) / open.samples;
        if (rateBps > 0) {
          open.peakDropBps = Math.max(open.peakDropBps, rateBps);
          open.avgDropBps += (rateBps - open.avgDropBps) / open.samples;
        }
      }
    }

    for (const [key, open] of [...OPEN_ATTACK]) {
      if (open.nodeId !== nodeId || reported.has(key)) continue;
      open.missed = (open.missed ?? 0) + 1;
      if (open.missed >= ATTACK_COOLDOWN_SAMPLES) closeAttack(key);
    }
    return;
  }

  const open = OPEN_ATTACK.get(`${nodeId}:legacy`);
  const underAttack = sample.dropRps >= ATTACK_THRESHOLD_PPS;

  if (underAttack) {
    if (!open) {
      OPEN_ATTACK.set(`${nodeId}:legacy`, {
        nodeId,
        startTs: now,
        endTs: null,
        durationSec: 0,
        method: METHOD_LABELS[dominant] ?? dominant,
        peakDropPps: sample.dropRps,
        peakDropBps: sample.dropBps,
        avgDropPps: sample.dropRps,
        avgDropBps: sample.dropBps,
        peakNetPps: sample.rps,
        samples: 1,
      });
    } else {
      open.peakDropPps = Math.max(open.peakDropPps, sample.dropRps);
      open.peakDropBps = Math.max(open.peakDropBps, sample.dropBps);
      open.peakNetPps = Math.max(open.peakNetPps, sample.rps);
      open.samples += 1;
      open.durationSec = Math.round((now - open.startTs) / 1000);
      open.avgDropPps =
        open.avgDropPps + (sample.dropRps - open.avgDropPps) / open.samples;
      open.avgDropBps =
        open.avgDropBps + (sample.dropBps - open.avgDropBps) / open.samples;
    }
  } else if (open) {
    closeAttack(`${nodeId}:legacy`);
  }
}

function adminOk(ctx: BaseHandlerContext): boolean {
  const ctxAny = ctx as unknown as Record<string, unknown>;
  const apiKey = ctxAny.apiKey as { type: string } | undefined;
  const user = ctxAny.user as { id: number } | undefined;
  if (apiKey?.type !== 'admin' && !user) return false;
  if (!apiKey && !hasPermissionSync(ctx, 'nodes:read')) return false;
  return true;
}

export async function aegisRoutes(app: NodeApp, prefix = '') {
  const nodeRepo = () => AppDataSource.getRepository(Node);

  app.post(
    prefix + '/nodes/aegis/metrics',
    async (ctx) => {
      const auth = ctx.request.headers.get('authorization') || '';
      const nodeName = ctx.request.headers.get('x-node-name') || '';
      const match = /^Bearer (.+)$/i.exec(auth);
      if (!match) {
        ctx.set.status = 401;
        return { error: 'unauthorized' };
      }

      const node = await nodeRepo().findOneBy({ token: match[1] });
      if (!node) {
        ctx.set.status = 401;
        return { error: 'unauthorized' };
      }

      const data = ctx.body as any;
      latestMetrics.set(node.id, {
        nodeName: nodeName || node.name,
        receivedAt: Date.now(),
        data,
      });
      processPush(node.id, data);

      return { success: true };
    },
    {
      body: t.Any(),
      response: {
        200: t.Object({ success: t.Boolean() }),
        401: t.Object({ error: t.String() }),
      },
      detail: { summary: 'Node agent pushes EcliAegis DDoS metrics', tags: ['Nodes'] },
    },
  );

  app.get(
    prefix + '/nodes/aegis/metrics',
    async (ctx: BaseHandlerContext) => {
      if (!adminOk(ctx)) {
        ctx.set.status = 403;
        return { error: 'forbidden' };
      }
      const now = Date.now();
      const out: Record<number, { nodeName: string; receivedAt: number; data: unknown }> = {};
      for (const [id, m] of latestMetrics) {
        if (now - m.receivedAt < MAX_AGE_MS) out[id] = m;
      }
      return out;
    },
    {
      beforeHandle: authenticate,
      response: { 200: t.Any(), 403: t.Object({ error: t.String() }) },
      detail: { summary: 'Get latest EcliAegis metrics for all nodes', tags: ['Nodes'] },
    },
  );

  app.get(
    prefix + '/nodes/aegis/history',
    async (ctx: BaseHandlerContext) => {
      if (!adminOk(ctx)) {
        ctx.set.status = 403;
        return { error: 'forbidden' };
      }
      const q = ctx.query as Record<string, string>;
      const nodeId = q.nodeId ? Number(q.nodeId) : undefined;
      const out: Record<number, Sample[]> = {};
      for (const [id, hist] of HISTORY) {
        if (nodeId !== undefined && id !== nodeId) continue;
        out[id] = hist;
      }
      return out;
    },
    {
      beforeHandle: authenticate,
      response: { 200: t.Any(), 403: t.Object({ error: t.String() }) },
      detail: { summary: 'Get EcliAegis time-series history', tags: ['Nodes'] },
    },
  );

  app.get(
    prefix + '/nodes/aegis/attacks',
    async (ctx: BaseHandlerContext) => {
      if (!adminOk(ctx)) {
        ctx.set.status = 403;
        return { error: 'forbidden' };
      }
      const q = ctx.query as Record<string, string>;
      const nodeId = q.nodeId ? Number(q.nodeId) : undefined;
      const out: Record<number, AttackEvent[]> = {};
      for (const [id, list] of ATTACKS) {
        if (nodeId !== undefined && id !== nodeId) continue;
        out[id] = list;
      }
      for (const [key, open] of OPEN_ATTACK) {
        if (nodeId !== undefined && open.nodeId !== nodeId) continue;
        const list = out[open.nodeId] ?? [];
        out[open.nodeId] = [{ ...open, endTs: Date.now() }, ...list];
      }
      return out;
    },
    {
      beforeHandle: authenticate,
      response: { 200: t.Any(), 403: t.Object({ error: t.String() }) },
      detail: { summary: 'Get EcliAegis attack event log', tags: ['Nodes'] },
    },
  );

  app.get(prefix + '/public/aegis/attacks', async () => {
    const data = await publicAttackSummary();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }, {
    response: { 200: t.Any() },
    detail: { summary: 'Public EcliAegis attack log', tags: ['Nodes'] },
  });
}

async function publicAttackSummary() {
  const now = Date.now();
  const dbRows: AegisAttack[] = [];
  try {
    dbRows.push(...(await AppDataSource.getRepository(AegisAttack).find({
      order: { startTs: 'DESC' },
      take: 500,
    })));
  } catch {
    /* idk */
  }
  const norm = (v: unknown): number => Number(v) || 0;
  const log = dbRows.map((r) => ({
    type: r.type,
    method: r.method,
    startTs: norm(r.startTs),
    endTs: r.endTs == null ? null : norm(r.endTs),
    durationSec: norm(r.durationSec),
    peakDropPps: norm(r.peakDropPps),
    peakDropBps: norm(r.peakDropBps),
    avgDropPps: norm(r.avgDropPps),
    avgDropBps: norm(r.avgDropBps),
    peakNetPps: norm(r.peakNetPps),
    samples: norm(r.samples),
  }));
  const active: AttackEvent[] = [];
  for (const [, open] of OPEN_ATTACK) {
    const { nodeId: _nodeId, ...rest } = open;
    active.push({ ...rest, endTs: null });
  }
  const all = [...active, ...log];
  all.sort((a, b) => b.startTs - a.startTs);
  let peakPps = 0;
  let peakBps = 0;
  for (const a of all) {
    if (a.peakDropPps > peakPps) peakPps = a.peakDropPps;
    if (a.peakDropBps > peakBps) peakBps = a.peakDropBps;
  }

  let passed = 0;
  let dropped = 0;
  let dropRps = 0;
  let rps = 0;
  let bps = 0;
  let learnedPorts = 0;
  let verified = 0;
  let banned = 0;
  for (const [, m] of latestMetrics) {
    if (now - m.receivedAt >= MAX_AGE_MS) continue;
    const d = m.data ?? {};
    passed += Number(d?.packets?.pass ?? 0);
    for (const [k, v] of Object.entries(d?.packets ?? {})) {
      if (k.startsWith("drop_")) dropped += Number(v ?? 0);
    }
    dropRps += Number(d?.traffic?.drop_rps ?? 0);
    rps += Number(d?.traffic?.rps ?? 0);
    bps += Number(d?.traffic?.bps ?? 0);
    learnedPorts = Math.max(
      learnedPorts,
      Array.isArray(d?.learned_ports) ? d.learned_ports.length : 0,
    );
    verified += Number(d?.verified_count ?? 0);
    banned += Number(d?.blocklist_count ?? 0);
  }

  return {
    up: true,
    attacks: all.slice(0, 50),
    totals: {
      attacks: log.length,
      active: active.length,
      peakDropPps: peakPps,
      peakDropBps: peakBps,
    },
    live: { passed, dropped, dropRps, rps, bps, learnedPorts, verified, banned },
    generatedAt: now,
  };
}
