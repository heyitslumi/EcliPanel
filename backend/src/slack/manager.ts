import { App } from "@slack/bolt";
import { AppDataSource } from "../config/typeorm";
import { SlackBot } from "../models/slackBot.entity";
import { registerBotHandlers } from "./index";

interface RunningBot {
  app: App;
  bot: SlackBot;
}

const runningBots = new Map<number, RunningBot>();

export interface RegisterResult {
  ok: boolean;
  workspaceId?: string;
  workspaceName?: string;
  botUserId?: string;
  error?: string;
}

interface SlackAuthResult {
  team_id?: string;
  team?: string;
  user_id?: string;
}

function createAppInstance(token: string, appToken: string, signingSecret?: string): App {
  return new App({
    token,
    appToken,
    socketMode: true,
    signingSecret,
  });
}

function createAppForBot(bot: SlackBot): App {
  return createAppInstance(bot.botToken, bot.appToken, bot.signingSecret);
}

export async function testBotCredentials(input: {
  botToken: string;
  appToken: string;
  signingSecret?: string;
}): Promise<{ ok: boolean; workspaceId?: string; workspaceName?: string; botUserId?: string; error?: string }> {
  try {
    const app = createAppInstance(input.botToken, input.appToken, input.signingSecret);
    const auth = (await app.client.auth.test()) as SlackAuthResult;
    return {
      ok: true,
      workspaceId: auth.team_id || undefined,
      workspaceName: auth.team || undefined,
      botUserId: auth.user_id || undefined,
    };
  } catch (err: any) {
    return { ok: false, error: err?.data?.error || err?.message || String(err) };
  }
}

export async function registerUserBot(bot: SlackBot): Promise<RegisterResult> {
  if (!bot.user) return { ok: false, error: 'User relation missing' };

  let app: App | undefined;
  try {
    app = createAppForBot(bot);
    registerBotHandlers(app, { ownerUserId: bot.user.id });
    await app.start();

    const existing = runningBots.get(bot.id);
    if (existing && existing.app !== app) {
      await existing.app.stop().catch(() => {});
    }
    runningBots.set(bot.id, { app, bot });

    const auth = (await app.client.auth.test().catch(() => null)) as SlackAuthResult | null;
    return {
      ok: true,
      workspaceId: auth?.team_id,
      workspaceName: auth?.team,
      botUserId: auth?.user_id,
    };
  } catch (err: any) {
    if (app) {
      try { await app.stop(); } catch {}
    }
    return { ok: false, error: err?.data?.error || err?.message || String(err) };
  }
}

export async function stopUserBot(id: number): Promise<void> {
  const entry = runningBots.get(id);
  if (entry) {
    await entry.app.stop().catch(() => {});
    runningBots.delete(id);
  }
}

export async function stopAllUserBots(): Promise<void> {
  for (const id of Array.from(runningBots.keys())) {
    await stopUserBot(id);
  }
}

export function isUserBotRunning(id: number): boolean {
  return runningBots.has(id);
}

const INIT_CONCURRENCY = 5;

export async function initUserSlackBots(): Promise<void> {
  try {
    const repo = AppDataSource.getRepository(SlackBot);
    const bots = await repo.find({ where: { enabled: true }, relations: { user: true } });
    let started = 0;
    let index = 0;
    const workers = Array.from({ length: Math.min(INIT_CONCURRENCY, bots.length) }, async () => {
      while (index < bots.length) {
        const bot = bots[index++];
        const result = await registerUserBot(bot);
        if (result.ok) {
          started++;
          if (bot.workspaceId !== result.workspaceId || bot.workspaceName !== result.workspaceName || bot.botUserId !== result.botUserId) {
            bot.workspaceId = result.workspaceId;
            bot.workspaceName = result.workspaceName;
            bot.botUserId = result.botUserId;
            bot.lastError = undefined;
            await repo.save(bot).catch((e) => {
              console.error(`[slacks] Failed to persist bot metadata #${bot.id} (${bot.name}):`, e);
            });
          }
        } else {
          bot.lastError = result.error || "Failed to start";
          await repo.save(bot).catch((e) => {
            console.error(`[slacks] Failed to persist lastError for bot #${bot.id} (${bot.name}):`, e);
          });
          console.error(`[slacks] Failed to start user bot #${bot.id} (${bot.name}):`, result.error);
        }
      }
    });
    await Promise.all(workers);

    if (bots.length > 0) {
      console.log(`[slacks] User owned slack bots: ${started}/${bots.length} connected`);
    }
  } catch (err) {
    console.error("[slacks] init failed:", err);
  }
}