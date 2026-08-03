import { AppDataSource } from '../config/typeorm';
import { SlackUserLink } from '../models/slackUserLink.entity';
import { SlackBot } from '../models/slackBot.entity';
import { User } from '../models/user.entity';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { randomHex } from '../utils/bunCrypto';
import { registerUserBot, stopUserBot, testBotCredentials, isUserBotRunning } from '../slack/manager';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const GITHUB_REDIRECT_URI = process.env.SLACK_GITHUB_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:3432'}/api/slack/github/callback`;

export const slackGithubStates = new Map<string, { userId: number; expiresAt: number }>();

export async function handleSlackGithubCallback(code: string, state: string): Promise<{
  success: boolean;
  githubLogin?: string;
  message?: string;
  error?: string;
}> {
  const pending = slackGithubStates.get(state);
  if (!pending || pending.expiresAt < Date.now()) {
    slackGithubStates.delete(state);
    return { success: false, error: 'Invalid or expired Slack auth state' };
  }
  slackGithubStates.delete(state);

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code, redirect_uri: GITHUB_REDIRECT_URI }),
  });

  const tokenData = await tokenRes.json() as any;
  if (tokenData.error) {
    return { success: false, error: tokenData.error_description || tokenData.error };
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const ghUser = await userRes.json() as any;

  const repo = AppDataSource.getRepository(SlackUserLink);
  let link = await repo.findOne({ where: { user: { id: pending.userId } } });

  if (link) {
    link.githubToken = tokenData.access_token;
    link.githubLogin = ghUser.login;
    await repo.save(link);
  } else {
    link = repo.create({
      user: { id: pending.userId } as User,
      githubToken: tokenData.access_token,
      githubLogin: ghUser.login,
    });
    await repo.save(link);
  }

  return { success: true, githubLogin: ghUser.login, message: 'GitHub linked successfully.' };
}

export async function slackRoutes(app: any, prefix = '') {
  app.get(
    prefix + '/slack/github/start',
    async (ctx: any) => {
      const userId = ctx.user.id;
      const state = randomHex(16);
      slackGithubStates.set(state, { userId, expiresAt: Date.now() + 600_000 });

      const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: GITHUB_REDIRECT_URI,
        scope: 'repo read:org',
        state,
      });

      return ctx.redirect
        ? ctx.redirect(`https://github.com/login/oauth/authorize?${params}`)
        : { url: `https://github.com/login/oauth/authorize?${params}` };
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'Start GitHub OAuth flow for Slack bot linking' },
    }
  );

  app.get(
    prefix + '/slack/github/callback',
    async (ctx: any) => {
      const { code, state } = ctx.query as { code?: string; state?: string };
      if (!code || !state) { ctx.set.status = 400; return { error: ctx.t('slack.missing_code_or_state') }; }
      const result = await handleSlackGithubCallback(code, state);
      if (!result.success) { ctx.set.status = 400; return { error: result.error }; }
      return result;
    },
    {
      detail: { tags: ['Slack'], summary: 'GitHub OAuth callback for Slack bot linking' },
    }
  );

  app.get(
    prefix + '/slack/config',
    async (ctx: any) => {
      const repo = AppDataSource.getRepository(SlackUserLink);
      const link = await repo.findOne({ where: { user: { id: ctx.user.id } } });

      const byoai = (ctx.user.settings as any)?.byoai;

      if (!link) {
        return {
          linked: false,
          githubLogin: null,
          mcpTools: [],
        };
      }

      return {
        linked: true,
        slackUserId: link.slackUserId,
        githubLogin: link.githubLogin,
        hasGithubToken: !!link.githubToken,
        mcpTools: link.mcpTools || [],
      };
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'Get current user Slack bot config' },
    }
  );

  app.put(
    prefix + '/slack/config',
    async (ctx: any) => {
      const body = ctx.body as any;
      const { mcpTools, slackUserId } = body;

      const repo = AppDataSource.getRepository(SlackUserLink);
      let link = await repo.findOne({ where: { user: { id: ctx.user.id } } });

      if (!link) {
        link = repo.create({ user: { id: ctx.user.id } as User });
      }

      if (mcpTools !== undefined) link.mcpTools = mcpTools;
      if (slackUserId !== undefined) link.slackUserId = slackUserId;

      await repo.save(link);

      return {
        success: true,
        githubLogin: link.githubLogin,
        mcpTools: link.mcpTools,
        slackUserId: link.slackUserId,
      };
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'Update user Slack bot config (AI provider, MCP tools)' },
    }
  );

  app.delete(
    prefix + '/slack/github',
    async (ctx: any) => {
      const repo = AppDataSource.getRepository(SlackUserLink);
      const link = await repo.findOne({ where: { user: { id: ctx.user.id } } });

      if (link) {
        link.githubToken = undefined;
        link.githubLogin = undefined;
        await repo.save(link);
      }

      return { success: true };
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'Unlink GitHub from Slack bot' },
    }
  );

  app.get(
    prefix + '/slack/bot/resolve/:slackUserId',
    async (ctx: any) => {
      const slackUserId = ctx.params?.slackUserId;
      if (!slackUserId) {
        ctx.set.status = 400;
        return { error: ctx.t('slack.missing_slackuserid') };
      }

      const repo = AppDataSource.getRepository(SlackUserLink);
      const link = await repo.findOne({
        where: { slackUserId },
        relations: { user: true },
      });

      if (!link) {
        ctx.set.status = 404;
        return { error: ctx.t('slack.no_eclipanel_account_linked_to_this_slack_user') };
      }

      const user = link.user;

      return {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        githubToken: link.githubToken || null,
        githubLogin: link.githubLogin || null,
        aiConfig: link.aiConfig || user.settings?.byoai || null,
        mcpTools: link.mcpTools || [],
      };
    },
    {
      beforeHandle: [authenticate, authorize('admin:access')],
      detail: { tags: ['Slack'], summary: 'Bot-facing: resolve Slack user to EcliPanel config' },
    }
  );

  function toBotDto(b: SlackBot) {
    return {
      id: b.id,
      name: b.name,
      workspaceId: b.workspaceId || null,
      workspaceName: b.workspaceName || null,
      botUserId: b.botUserId || null,
      enabled: b.enabled,
      running: isUserBotRunning(b.id),
      lastError: b.lastError || null,
      hasBotToken: !!b.botToken,
      hasAppToken: !!b.appToken,
      hasSigningSecret: !!b.signingSecret,
      createdAt: b.createdAt,
    };
  }

  app.get(
    prefix + '/slack/bots',
    async (ctx: any) => {
      const repo = AppDataSource.getRepository(SlackBot);
      const bots = await repo.find({ where: { user: { id: ctx.user.id } }, order: { createdAt: 'DESC' } });
      return { bots: bots.map(toBotDto) };
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'List my user owned Slack bots' },
    }
  );

  app.post(
    prefix + '/slack/bots',
    async (ctx: any) => {
      try {
        const { name, botToken, appToken, signingSecret } = (ctx.body || {}) as Record<string, unknown>;
        if (!name || !botToken || !appToken) {
          ctx.set.status = 400;
          return { error: 'name, botToken and appToken are required' };
        }

        const test = await testBotCredentials({
          botToken: String(botToken),
          appToken: String(appToken),
          signingSecret: signingSecret ? String(signingSecret) : undefined,
        });
        if (!test.ok) {
          ctx.set.status = 400;
          return { error: `Invalid Slack credentials: ${test.error}` };
        }

        const repo = AppDataSource.getRepository(SlackBot);
        const bot = repo.create({
          user: { id: ctx.user.id } as User,
          name: String(name).slice(0, 64),
          botToken: String(botToken),
          appToken: String(appToken),
          signingSecret: signingSecret ? String(signingSecret) : undefined,
          workspaceId: test.workspaceId,
          workspaceName: test.workspaceName,
          botUserId: test.botUserId,
          enabled: true,
        });
        const saved = await repo.save(bot);

        const result = await registerUserBot(saved);
        if (!result.ok) {
          saved.enabled = false;
          saved.lastError = result.error || 'Failed to start';
          await repo.save(saved);
        }

        return { success: true, bot: toBotDto(saved) };
      } catch (err: any) {
        ctx.set.status = 500;
        return { error: err?.message || 'Failed to register Slack bot' };
      }
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'Register a new user-owned Slack bot' },
    }
  );

  app.put(
    prefix + '/slack/bots/:id',
    async (ctx: any) => {
      try {
        const id = Number(ctx.params?.id);
        if (!Number.isFinite(id)) { ctx.set.status = 400; return { error: 'Invalid bot id' }; }

        const repo = AppDataSource.getRepository(SlackBot);
        const bot = await repo.findOne({ where: { id, user: { id: ctx.user.id } }, relations: { user: true } });
        if (!bot) { ctx.set.status = 404; return { error: 'Slack bot not found' }; }

        const body = (ctx.body || {}) as Record<string, unknown>;
        const originalEnabled = bot.enabled;
        let credentialsChanged = false;

        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) { ctx.set.status = 400; return { error: 'name is required' }; }
          bot.name = name.slice(0, 64);
        }
        if (body.enabled !== undefined) bot.enabled = !!body.enabled;
        if (body.botToken) { bot.botToken = String(body.botToken); credentialsChanged = true; }
        if (body.appToken) { bot.appToken = String(body.appToken); credentialsChanged = true; }
        if (body.signingSecret !== undefined) {
          bot.signingSecret = body.signingSecret ? String(body.signingSecret) : undefined;
          credentialsChanged = true;
        }

        if (credentialsChanged) {
          const test = await testBotCredentials({
            botToken: bot.botToken,
            appToken: bot.appToken,
            signingSecret: bot.signingSecret,
          });
          if (!test.ok) {
            ctx.set.status = 400;
            return { error: `Invalid Slack credentials: ${test.error}` };
          }
          bot.workspaceId = test.workspaceId;
          bot.workspaceName = test.workspaceName;
          bot.botUserId = test.botUserId;
        }

        bot.lastError = undefined;
        const saved = await repo.save(bot);

        const enabledChanged = body.enabled !== undefined && bot.enabled !== originalEnabled;
        if (credentialsChanged || enabledChanged) {
          await stopUserBot(saved.id);
          if (saved.enabled) {
            const result = await registerUserBot(saved);
            if (!result.ok) {
              saved.enabled = false;
              saved.lastError = result.error || 'Failed to start';
              await repo.save(saved);
            }
          }
        }

        return { success: true, bot: toBotDto(saved) };
      } catch (err: any) {
        ctx.set.status = 500;
        return { error: err?.message || 'Failed to update Slack bot' };
      }
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'Update a user-owned Slack bot' },
    }
  );

  app.delete(
    prefix + '/slack/bots/:id',
    async (ctx: any) => {
      try {
        const id = Number(ctx.params?.id);
        if (!Number.isFinite(id)) { ctx.set.status = 400; return { error: 'Invalid bot id' }; }

        const repo = AppDataSource.getRepository(SlackBot);
        const bot = await repo.findOne({ where: { id, user: { id: ctx.user.id } } });
        if (!bot) { ctx.set.status = 404; return { error: 'Slack bot not found' }; }

        await stopUserBot(id);
        await repo.remove(bot);
        return { success: true };
      } catch (err: any) {
        ctx.set.status = 500;
        return { error: err?.message || 'Failed to delete Slack bot' };
      }
    },
    {
      beforeHandle: [authenticate],
      detail: { tags: ['Slack'], summary: 'Delete a user-owned Slack bot' },
    }
  );
}