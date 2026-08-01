import Imap from 'imap';
import path from 'path';
import { simpleParser } from 'mailparser';
import { AppDataSource } from '../config/typeorm';
import { MailboxAccount } from '../models/mailboxAccount.entity';
import { MailMessage } from '../models/mailMessage.entity';
import { detectMailboxSecurityFlags, extractMailboxAuthMetadata } from '../utils/mailboxMessage';

const DOVECOT_MASTER_USER = String(process.env.DOVECOT_MASTER_USER || '').trim();
const DOVECOT_MASTER_PASS = String(process.env.DOVECOT_MASTER_PASS || '').trim();
const DOVECOT_MASTER_DOMAIN = String(process.env.DOVECOT_MASTER_DOMAIN || 'mailcow.local').trim();
const IMAP_FETCH_INTERVAL_CRON =
  typeof process.env.IMAP_FETCH_CRON === 'string'
    ? process.env.IMAP_FETCH_CRON.trim()
    : '*/1 * * * *';

const MAX_TEXT_BYTES = 50_000_000;

function buildMasterLogin(realEmail: string): string {
  return `${realEmail}*${DOVECOT_MASTER_USER}@${DOVECOT_MASTER_DOMAIN}`;
}

function buildImapConfig(account: MailboxAccount): Imap.Config {
  return {
    user: buildMasterLogin(account.email),
    password: DOVECOT_MASTER_PASS,
    host: account.imapHost || `mail.${account.domain}`,
    port: Number(account.imapPort ?? 993),
    tls: account.imapSecure !== false,
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 15_000,
    authTimeout: 15_000,
  } as Imap.Config;
}

function openInbox(imap: Imap): Promise<Imap.Box> {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) return reject(err);
      resolve(box);
    });
  });
}

function imapSearch(imap: Imap, criteria: any[]): Promise<number[]> {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) return reject(err);
      resolve(
        Array.isArray(results)
          ? results.map((v: any) => Number(v)).filter(v => Number.isFinite(v) && v > 0)
          : []
      );
    });
  });
}

function imapAddFlags(imap: Imap, uids: number[], flags: string): Promise<void> {
  return new Promise((resolve, reject) => {
    imap.addFlags(uids as any, flags, err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function imapExpunge(imap: Imap): Promise<void> {
  return new Promise((resolve, reject) => {
    imap.expunge(err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function imapMove(imap: Imap, uids: number[], box: string): Promise<void> {
  return new Promise((resolve, reject) => {
    imap.move(uids as any, box, err => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function openBox(imap: Imap, box: string): Promise<Imap.Box> {
  return new Promise((resolve, reject) => {
    imap.openBox(box, false, (err, b) => {
      if (err) return reject(err);
      resolve(b);
    });
  });
}

function normalizeUids(uids: number[]): number[] {
  return Array.from(new Set(uids.filter(v => Number.isFinite(v) && v > 0)));
}

function normalizeMessageId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/^<|>$/g, '')
    .trim();
}

function buildMessageIdVariants(raw: string): string[] {
  const base = String(raw ?? '').trim();
  const noQuotes = base.replace(/^"+|"+$/g, '');
  const noAngles = noQuotes.replace(/^<|>$/g, '');
  return Array.from(new Set([base, noQuotes, noAngles, `<${noAngles}>`])).filter(Boolean);
}

function getRemoteMessageId(message: MailMessage): string | null {
  if (message.messageId) {
    return String(message.messageId).trim();
  }

  if (!message.headers) return null;

  try {
    const parsed =
      typeof message.headers === 'string' ? JSON.parse(message.headers) : message.headers;

    if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(parsed)) {
        if (key.toLowerCase() === 'message-id') {
          const val = parsed[key];
          return String(Array.isArray(val) ? val[0] : val).trim();
        }
      }
    }
  } catch {
    // skip
  }

  const match = String(message.headers).match(/message-id:\s*(<[^>\r\n]+>)/i);
  return match ? match[1].trim() : null;
}

function collectBody(
  msg: Imap.ImapMessage
): Promise<{ buffer: Buffer; attributes: Imap.ImapMessageAttributes }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let attributes: Imap.ImapMessageAttributes | undefined;

    msg.on('body', stream => {
      stream.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.once('error', reject);
    });

    msg.once('attributes', attr => {
      attributes = attr;
    });

    msg.once('end', () => {
      if (!attributes) {
        return reject(new Error('imap message ended without attributes'));
      }
      resolve({ buffer: Buffer.concat(chunks), attributes });
    });

    msg.once('error', reject);
  });
}

interface AttachmentMeta {
  filename: string;
  url: string;
  contentType: string;
  size: number;
  cid?: string;
}

function attachmentToBuffer(att: any, index: number): Buffer {
  if (Buffer.isBuffer(att.content)) {
    return att.content;
  }

  if (att.content instanceof Uint8Array) {
    return Buffer.from(att.content);
  }

  if (typeof att.content === 'string') {
    const encoding = typeof att.encoding === 'string' ? att.encoding.toLowerCase() : '';
    return Buffer.from(att.content, encoding === 'base64' ? 'base64' : 'utf8');
  }

  console.warn(
    `[imapFetcher] attachment[${index}] has unexpected content type:`,
    typeof att.content
  );
  return Buffer.alloc(0);
}

async function saveAttachments(
  parsedAttachments: any[],
  userId: string | number,
  savedMessageId: string | number
): Promise<AttachmentMeta[]> {
  if (!parsedAttachments.length) return [];

  const results: AttachmentMeta[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < parsedAttachments.length; i += 1) {
    const att = parsedAttachments[i];
    const content = attachmentToBuffer(att, i);
    if (content.length === 0) {
      console.warn(`[imapFetcher] attachment[${i}] has empty content, skipping`);
      continue;
    }

    const rawName = String(att.filename || att.name || '').trim();
    const safeName = (rawName || `attachment-${i + 1}`).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_');
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext) || `attachment-${i + 1}`;
    let filename = safeName;
    let counter = 2;
    while (usedNames.has(filename.toLowerCase())) {
      filename = `${base}-${counter++}${ext}`;
    }
    usedNames.add(filename.toLowerCase());

    const rawCid = typeof att.cid === 'string' ? att.cid.trim() : undefined;
    const cid = rawCid ? rawCid.replace(/^<|>$/g, '') : undefined;

    results.push({
      filename,
      url: `/uploads/mailbox/${userId}/${savedMessageId}/${encodeURIComponent(filename)}`,
      contentType:
        typeof att.contentType === 'string' && att.contentType
          ? att.contentType
          : 'application/octet-stream',
      size: content.length,
      cid,
    });
  }

  return results;
}

function replaceCidReferences(html: string, attachments: AttachmentMeta[]): string {
  let result = html;

  for (const att of attachments) {
    if (!att.cid) continue;
    const pattern = new RegExp(`cid:${att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
    result = result.replace(pattern, att.url);
  }

  return result;
}

interface ImapSession {
  imap: Imap;
  finish(err?: unknown, result?: boolean): void;
}

function createImapSession(
  account: MailboxAccount,
  resolve: (v: boolean) => void,
  reject: (e: unknown) => void
): ImapSession {
  const imap = new Imap(buildImapConfig(account));
  let settled = false;

  const finish = (err?: unknown, result = false) => {
    if (settled) return;
    settled = true;
    try {
      imap.end();
    } catch (_) {
      /* skipyyy */
    }
    if (err) reject(err);
    else resolve(result);
  };

  imap.once('error', (err: Error) => finish(err, false));

  return { imap, finish };
}

export async function deleteMessageFromMailbox(
  account: MailboxAccount,
  message: MailMessage,
  folder: string = 'INBOX'
): Promise<boolean> {
  if (!DOVECOT_MASTER_USER || !DOVECOT_MASTER_PASS) {
    console.warn('[imapFetcher] deleteMessage: master credentials not set');
    return false;
  }

  const isTrash = String(folder).toUpperCase() === 'TRASH';

  return new Promise<boolean>((resolve, reject) => {
    const { imap, finish } = createImapSession(account, resolve, reject);

    imap.once('ready', async () => {
      try {
        await openBox(imap, isTrash ? 'Trash' : 'INBOX');

        const messageId = getRemoteMessageId(message);
        const tryUid =
          typeof message.imapUid === 'number' && message.imapUid > 0 ? message.imapUid : null;

        const searchByMessageIdDirect = async (id: string): Promise<number[]> => {
          for (const variant of buildMessageIdVariants(id)) {
            try {
              const hits = await imapSearch(imap, [['HEADER', 'MESSAGE-ID', variant]]);
              if (hits.length > 0) {
                console.info(
                  '[imapFetcher] located by Message-ID variant',
                  variant,
                  'hits=',
                  hits.length
                );
                return hits;
              }
            } catch (e: any) {
              console.warn(
                '[imapFetcher] MESSAGE-ID search failed for variant',
                variant,
                e?.message
              );
            }
          }
          return [];
        };

        const searchByMessageIdFetch = (rawId: string): Promise<number[]> =>
          new Promise((res, rej) => {
            const target = normalizeMessageId(rawId);

            imap.search(['ALL'], (err, all) => {
              if (err) return rej(err);
              const allUids = (all ?? []).map(Number).filter(v => Number.isFinite(v) && v > 0);
              if (allUids.length === 0) return res([]);

              const matched: number[] = [];
              const f = imap.fetch(allUids, {
                bodies: ['HEADER.FIELDS (MESSAGE-ID)'],
                struct: false,
              });

              f.on('message', msg => {
                let headerChunk = '';
                let uid: number | undefined;

                msg.on('body', stream => {
                  stream.on('data', (chunk: Buffer) => {
                    headerChunk += chunk.toString('utf8');
                  });
                });
                msg.once('attributes', attr => {
                  uid = typeof attr?.uid === 'number' ? attr.uid : undefined;
                });
                msg.once('end', () => {
                  const m = headerChunk.match(/message-id:\s*([^\r\n]+)/i);
                  if (m?.[1] && normalizeMessageId(m[1]) === target && uid) {
                    matched.push(uid);
                  }
                });
              });

              f.once('error', rej);
              f.once('end', () => res(Array.from(new Set(matched))));
            });
          });

        const findUids = async (): Promise<number[]> => {
          const sets = await Promise.all([
            messageId ? searchByMessageIdDirect(messageId) : Promise.resolve([]),
            tryUid
              ? imapSearch(imap, [['UID', String(tryUid)]]).catch(() => [])
              : Promise.resolve([]),
          ]);

          let uids = normalizeUids(sets.flat());

          if (uids.length === 0 && messageId) {
            console.info('[imapFetcher] falling back to header-fetch search for', messageId);
            uids = normalizeUids(await searchByMessageIdFetch(messageId).catch(() => []));
          }

          return uids;
        };

        const uids = await findUids();

        if (uids.length === 0) {
          console.info('[imapFetcher] message not found on server (already deleted?)', {
            messageId,
            uid: tryUid,
          });
          return finish(undefined, true);
        }

        if (isTrash) {
          await imapAddFlags(imap, uids, '\\Deleted');
          await imapExpunge(imap);
        } else {
          await imapMove(imap, uids, 'Trash');
          message.folder = 'Trash';
          await AppDataSource.getRepository(MailMessage).save(message).catch(() => null);
        }

        const remaining = normalizeUids(await findUids());
        if (remaining.length === 0) {
          return finish(undefined, true);
        }

        console.warn(
          isTrash
            ? '[imapFetcher] message still present in Trash after expunge'
            : '[imapFetcher] message still present in INBOX after move to Trash',
          {
            messageId,
            uid: tryUid,
            remaining: remaining.length,
          }
        );
        return finish(undefined, false);
      } catch (err) {
        finish(err, false);
      }
    });

    try {
      imap.connect();
    } catch (err) {
      finish(err, false);
    }
  });
}

async function processMessageHeader(
  account: MailboxAccount,
  imap: Imap,
  msg: Imap.ImapMessage,
  folder: string,
  markSeen: boolean,
  toFetch: number[]
): Promise<void> {
  return new Promise<void>(resolve => {
    const chunks: Buffer[] = [];
    let attributes: Imap.ImapMessageAttributes | undefined;

    msg.on('body', stream => {
      stream.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
    });
    msg.once('attributes', attr => {
      attributes = attr;
    });
    msg.once('error', () => resolve());
    msg.once('end', async () => {
      try {
        const header = Buffer.concat(chunks).toString('utf8');
        const m = header.match(/message-id:\s*([^\r\n]+)/i);
        const messageId = m?.[1]?.trim() || null;
        const replied =
          Array.isArray(attributes?.flags) &&
          attributes.flags.some(f => String(f).toLowerCase() === '\\answered');
        const uid = attributes?.uid;
        const repo = AppDataSource.getRepository(MailMessage);

        const existing = messageId
          ? await repo
              .findOne({ where: { userId: account.userId, messageId } as any })
              .catch(() => null)
          : null;
        const existingByUid =
          existing || !uid
            ? null
            : await repo
                .findOne({
                  where: { userId: account.userId, folder, imapUid: uid } as any,
                })
                .catch(() => null);

        if (existing || existingByUid) {
          const row = existing || existingByUid;
          let changed = false;
          if (row.folder !== folder) { row.folder = folder; changed = true; }
          if (row.replied !== replied) { row.replied = replied; changed = true; }
          if (changed) { await repo.save(row).catch(() => null); }
          if (uid && folder.toUpperCase() === 'INBOX' && markSeen) {
            imap.addFlags(uid, '\\Seen', () => {});
          }
          return resolve();
        }

        if (uid) toFetch.push(uid);
        resolve();
      } catch {
        resolve();
      }
    });
  });
}

async function processMessage(
  account: MailboxAccount,
  imap: Imap,
  msg: Imap.ImapMessage,
  folderName?: string,
  markSeen?: boolean
): Promise<void> {
  let buffer: Buffer;
  let attributes: Imap.ImapMessageAttributes;

  try {
    ({ buffer, attributes } = await collectBody(msg));
  } catch (err: any) {
    console.warn('[imapFetcher] failed to collect body for', account.email, err?.message);
    return;
  }

  try {
    const parsed = await simpleParser(buffer);
    const messageRepo = AppDataSource.getRepository(MailMessage);

    const folder = String(folderName || 'INBOX').toUpperCase();
    const replied =
      Array.isArray(attributes?.flags) &&
      attributes.flags.some(f => String(f).toLowerCase() === '\\answered');

    const messageId: string | null =
      parsed.messageId || (parsed.headers?.get?.('message-id') as string | undefined) || null;


    const security = detectMailboxSecurityFlags(parsed.headers, parsed.subject ?? undefined);
    const rawHeaders = buffer.toString('utf8').split(/\r?\n\r?\n/)[0];
    const authMetadata = await extractMailboxAuthMetadata(parsed.headers, rawHeaders);

    const clamp = (v: string | undefined | null, what: string): string | undefined => {
      if (!v) return undefined;
      const s = String(v);
      if (s.length <= MAX_TEXT_BYTES) return s;
      console.warn(`[imapFetcher] truncating ${what} (${s.length} → ${MAX_TEXT_BYTES} bytes) for`, account.email);
      return s.slice(0, MAX_TEXT_BYTES);
    };

    const entity = messageRepo.create({
      userId: account.userId,
      fromAddress: parsed.from?.text ?? String(parsed.from) ?? 'unknown',
      toAddress: String(parsed.to?.text || account.email),
      messageId: messageId ?? undefined,
      imapUid: attributes?.uid ?? undefined,
      subject: parsed.subject ?? 'No subject',
      body: clamp(parsed.text ?? parsed.html ?? '', 'body') ?? '',
      html: clamp(parsed.html, 'html'),
      headers: clamp(
        parsed.headers ? JSON.stringify(Object.fromEntries(parsed.headers)) : undefined,
        'headers'
      ),
      rawHeaders: clamp(rawHeaders, 'rawHeaders') || undefined,
      senderIp: authMetadata.senderIp || undefined,
      senderRdns: authMetadata.senderRdns || undefined,
      spfResult: authMetadata.spfResult || undefined,
      dkimResult: authMetadata.dkimResult || undefined,
      dmarcResult: authMetadata.dmarcResult || undefined,
      authResults: authMetadata.authResults || undefined,
      encryptionType: authMetadata.encryptionType || undefined,
      receivedChain: authMetadata.receivedChain.length > 0 ? authMetadata.receivedChain : undefined,
      isSpam: security.isSpam,
      spamScore: security.spamScore,
      isVirus: security.isVirus,
      virusName: security.virusName,
      read: folder !== 'INBOX',
      folder,
      replied,
      receivedAt: parsed.date ?? new Date(),
    });

    let savedEntity: MailMessage | null;
    try {
      savedEntity = await messageRepo.save(entity);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      if (/duplicate|ER_DUP_ENTRY/i.test(msg)) {
        const winner = messageId
          ? await messageRepo
              .findOne({ where: { userId: account.userId, messageId } as any })
              .catch(() => null)
          : null;
        if (winner) {
          let changed = false;
          if (winner.folder !== folder) { winner.folder = folder; changed = true; }
          if (winner.replied !== replied) { winner.replied = replied; changed = true; }
          if (changed) { await messageRepo.save(winner).catch(() => null); }
        }
        savedEntity = null;
      } else {
        console.error('[imapFetcher] failed to store message for', account.email, msg);
        throw err;
      }
    }
    if (!savedEntity) {
      if (attributes?.uid && folder === 'INBOX' && markSeen) {
        imap.addFlags(attributes.uid, '\\Seen', () => {});
      }
      return;
    }

    const parsedAttachments: any[] = Array.isArray(parsed.attachments) ? parsed.attachments : [];

    if (parsedAttachments.length > 0) {
      const metas = await saveAttachments(parsedAttachments, account.userId, savedEntity.id);

      if (metas.length > 0) {
        savedEntity.attachments = metas;

        if (savedEntity.html) {
          const updatedHtml = replaceCidReferences(savedEntity.html, metas);
          if (updatedHtml !== savedEntity.html) {
            savedEntity.html = updatedHtml;
          }
        }

        await messageRepo.save(savedEntity);
      }
    }

    if (attributes?.uid && markSeen) {
      imap.addFlags(attributes.uid, '\\Seen', e => {
        if (e) {
          console.warn('[imapFetcher] addFlags \\Seen failed', e?.message);
        }
      });
    }
  } catch (e: any) {
    console.warn('[imapFetcher] failed to parse/store message for', account.email, e?.message);
  }
}

async function fetchAndStoreForAccount(
  account: MailboxAccount,
  folders: string[] = ['INBOX']
): Promise<void> {
  if (!DOVECOT_MASTER_USER || !DOVECOT_MASTER_PASS) return;

  const imap = new Imap(buildImapConfig(account));

  return new Promise<void>(resolve => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      try {
        imap.end();
      } catch (_) {
        /* skip */
      }
      resolve();
    };

    imap.once('error', (err: Error) => {
      console.warn('[imapFetcher] IMAP error for', account.email, err?.message);
      done();
    });

    imap.once('end', done);

    imap.once('ready', async () => {
      try {
        const markSeen = account.userId >= 0;
        for (const folderName of folders) {
          const folder = String(folderName || 'INBOX');
          const folderKey = folder.toUpperCase();
          try {
            await openBox(imap, folder);
          } catch (err: any) {
            console.warn('[imapFetcher] openBox failed for', account.email, folder, err?.message);
            continue;
          }

          const results = await imapSearch(
            imap,
            folderKey === 'INBOX' && markSeen ? ['UNSEEN'] : ['ALL']
          ).catch((err: any) => {
            console.warn('[imapFetcher] SEARCH failed for', account.email, folder, err?.message);
            return [];
          });

          if (!results?.length) continue;
          const toFetch: number[] = [];
          await new Promise<void>(res => {
            const fetcher = imap.fetch(results, {
              bodies: 'HEADER.FIELDS (MESSAGE-ID)',
              struct: true,
            });
            const pending: Promise<void>[] = [];

            fetcher.on('message', msg => {
              pending.push(processMessageHeader(account, imap, msg, folder, markSeen, toFetch));
            });

            fetcher.once('error', (e: Error) => {
              console.warn('[imapFetcher] header fetch error for', account.email, folder, e?.message);
              res();
            });

            fetcher.once('end', async () => {
              await Promise.allSettled(pending);
              res();
            });
          });

          if (!toFetch.length) continue;

          console.info('[imapFetcher]', toFetch.length, 'new message(s) in', folder, 'for', account.email);

          await new Promise<void>(res => {
            const fetcher = imap.fetch(toFetch, { bodies: '', struct: true });
            const pending: Promise<void>[] = [];

            fetcher.on('message', msg => {
              pending.push(processMessage(account, imap, msg, folder, markSeen));
            });

            fetcher.once('error', (e: Error) => {
              console.warn('[imapFetcher] fetch error for', account.email, folder, e?.message);
              res();
            });

            fetcher.once('end', async () => {
              await Promise.allSettled(pending);
              res();
            });
          });
        }
      } catch (err: any) {
        console.warn('[imapFetcher] fetch loop failed for', account.email, err?.message);
      }
      done();
    });

    try {
      imap.connect();
    } catch (e: any) {
      console.warn('[imapFetcher] connect failed for', account.email, e?.message);
      done();
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchMailForAllMailboxes(): Promise<void> {
  if (!DOVECOT_MASTER_USER || !DOVECOT_MASTER_PASS) {
    console.warn('[imapFetcher] master credentials not configured, skipping');
    return;
  }

  if (!AppDataSource.isInitialized) {
    console.warn('[imapFetcher] DataSource not initialised, skipping');
    return;
  }

  const repo = AppDataSource.getRepository(MailboxAccount);
  const accounts = await repo.find({ where: { enabled: true } });
  console.info('[imapFetcher] found', accounts.length, 'enabled account(s)');

  const CONCURRENCY = Number(process.env.IMAP_FETCH_CONCURRENCY ?? 5);
  const TIMEOUT_MS = Number(process.env.IMAP_FETCH_ACCOUNT_TIMEOUT_MS ?? 60_000);

  const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
    const capped = Math.min(ms, 300_000);
    let t: NodeJS.Timeout;
    return Promise.race([
      p,
      new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(new Error('IMAP fetch timeout')), capped);
      }),
    ]).finally(() => clearTimeout(t));
  };

  const queue = [...accounts];

  const worker = async () => {
    while (queue.length > 0) {
      const account = queue.shift();
      if (!account) break;
      try {
        console.info('[imapFetcher] fetching for', account.email);
        const folders = account.userId < 0 ? ['INBOX', 'Sent', 'Trash', 'Junk'] : ['INBOX'];
        await withTimeout(fetchAndStoreForAccount(account, folders), TIMEOUT_MS);
        console.info('[imapFetcher] done for', account.email);
      } catch (e: any) {
        console.warn('[imapFetcher] failed for', account.email, e?.message);
      }
    }
  };

  await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, accounts.length) }, worker));
}

export async function fetchMailboxNow(
  account: MailboxAccount,
  folders?: string[]
): Promise<void> {
  await fetchAndStoreForAccount(account, folders);
}

export function scheduleImapFetchJob(cronExpr: string = IMAP_FETCH_INTERVAL_CRON): void {
  if (!cronExpr?.trim()) {
    console.info('[imapFetcher] IMAP fetch scheduler disabled (empty cron)');
    return;
  }

  const { schedule, validate } = require('../utils/cron');

  if (!validate(cronExpr)) {
    console.error('[imapFetcher] Invalid cron expression:', cronExpr);
    return;
  }

  console.info('[imapFetcher] scheduling IMAP fetch job:', cronExpr);

  fetchMailForAllMailboxes().catch(e => console.error('[imapFetcher] initial fetch failed', e));

  schedule(cronExpr, () => {
    console.info('[imapFetcher] cron tick');
    fetchMailForAllMailboxes().catch(e => console.error('[imapFetcher] scheduled fetch failed', e));
  });
}

const ATTACHMENT_CACHE_TTL_MS = Math.min(
  600_000,
  Math.max(1000, Number(process.env.ATTACHMENT_CACHE_TTL_MS || 60_000))
);
const attachmentCache = new Map<
  string,
  { buffer: Buffer; contentType: string; expires: number }
>();

export function getCachedAttachment(key: string) {
  const hit = attachmentCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    attachmentCache.delete(key);
    return null;
  }
  return hit;
}

export function setCachedAttachment(
  key: string,
  value: { buffer: Buffer; contentType: string }
) {
  attachmentCache.set(key, { ...value, expires: Date.now() + ATTACHMENT_CACHE_TTL_MS });
}

function findAttachmentInParsed(parsed: any, filename: string): any | null {
  const wanted = decodeURIComponent(String(filename || ''));
  const attachments: any[] = Array.isArray(parsed.attachments) ? parsed.attachments : [];
  const exact = attachments.find((a) => String(a.filename || a.name || '') === wanted);
  if (exact) return exact;

  const ext = path.extname(wanted);
  const base = path.basename(wanted, ext);
  const baseMatch = base.replace(/-\d+$/, '');
  return (
    attachments.find((a) => {
      const name = String(a.filename || a.name || '');
      return path.basename(name, path.extname(name)) === baseMatch;
    }) || null
  );
}

export async function fetchAttachmentFromMailbox(
  account: MailboxAccount,
  messageId: string,
  filename: string,
  folder: string = 'INBOX'
): Promise<{ buffer: Buffer; contentType: string; filename: string } | null> {
  if (!DOVECOT_MASTER_USER || !DOVECOT_MASTER_PASS || !messageId) return null;

  const searchUids = async (imap: Imap, variants: string[]): Promise<number[]> => {
    for (const variant of variants) {
      try {
        const hits = await imapSearch(imap, [['HEADER', 'MESSAGE-ID', variant]]);
        if (hits.length > 0) return hits;
      } catch { /* yep */ }
    }
    return [];
  };

  const fetchInBox = (imap: Imap, box: string): Promise<{ buffer: Buffer } | null> =>
    new Promise((resolve, reject) => {
      openBox(imap, box).then(
        async () => {
          const variants = buildMessageIdVariants(messageId);
          const uids = normalizeUids(await searchUids(imap, variants).catch(() => []));
          if (uids.length === 0) return resolve(null);

          const fetcher = imap.fetch(uids[0], { bodies: '', struct: true });
          const chunks: Buffer[] = [];
          fetcher.on('message', msg => {
            msg.on('body', stream => {
              stream.on('data', (chunk: Buffer) =>
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
              );
            });
          });
          fetcher.once('error', reject);
          fetcher.once('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        },
        reject
      );
    });

  try {
    const boxes = [String(folder).toUpperCase(), 'INBOX', 'Sent', 'Trash'].filter(
      (b, i, arr) => arr.indexOf(b) === i
    );
    for (const box of boxes) {
      try {
        const imap = new Imap(buildImapConfig(account));
        const fetched = await fetchInBox(imap, box);
        try { imap.end(); } catch { /* skippy clippy! */ }
        if (!fetched || fetched.buffer.length === 0) continue;
        const parsed = await simpleParser(fetched.buffer);
        const att = findAttachmentInParsed(parsed, filename);
        if (!att) continue;
        const content = attachmentToBuffer(att, 0);
        if (content.length === 0) continue;
        return {
          buffer: content,
          contentType: String(att.contentType || 'application/octet-stream'),
          filename: String(att.filename || att.name || filename),
        };
      } catch { /* uhh ok */ }
    }
    return null;
  } catch (err: any) {
    console.warn('[imapFetcher] on-demand attachment fetch failed for', account.email, err?.message);
    return null;
  }
}
