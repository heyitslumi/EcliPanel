import { AppDataSource } from "../../config/typeorm";
import { SlackUserLink } from "../../models/slackUserLink.entity";
import { User } from "../../models/user.entity";
import { UserRole } from "../../models/userRole.entity";
import { Permission } from "../../models/permission.entity";
import { resolveUserAiConfig, type ResolvedAiConfig } from "../../services/aiModelService";

export interface UserContext {
  userId: number;
  email: string;
  firstName: string;
  role: string;
  isAdmin: boolean;
  githubToken: string | null;
  githubLogin: string | null;
  aiConfig: ResolvedAiConfig | null;
  mcpTools: Array<{
    name: string;
    description: string;
    endpoint: string;
    apiKey?: string;
  }>;
}

const cache = new Map<string, { data: UserContext; expiresAt: number }>();
const CACHE_TTL = 60_000;

async function checkIsAdmin(user: any): Promise<boolean> {
  if (user.role === '*' || user.role === 'rootAdmin') return true;

  try {
    const userRoleRepo = AppDataSource.getRepository(UserRole);
    const userRoles = await userRoleRepo.find({
      where: { user: { id: user.id } },
      relations: { role: { permissions: true } },
    });

    for (const ur of userRoles) {
      if (!ur.role?.permissions) continue;
      for (const perm of ur.role.permissions) {
        if (perm.value === '*' || perm.value === 'admin:access') return true;
      }
    }
  } catch {}

  return false;
}

export async function resolveUser(slackUserId: string): Promise<UserContext | null> {
  const cached = cache.get(slackUserId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const repo = AppDataSource.getRepository(SlackUserLink);
  const link = await repo.findOne({
    where: { slackUserId },
    relations: { user: true },
  });

  if (!link) return null;

  const data = await buildUserContext(link.user, link);
  cache.set(slackUserId, { data, expiresAt: Date.now() + CACHE_TTL });
  return data;
}

export async function resolveUserById(userId: number): Promise<UserContext | null> {
  const cached = cache.get(`byid:${userId}`);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user) return null;

  const linkRepo = AppDataSource.getRepository(SlackUserLink);
  const link = await linkRepo.findOne({ where: { user: { id: userId } } });

  const data = await buildUserContext(user, link);
  cache.set(`byid:${userId}`, { data, expiresAt: Date.now() + CACHE_TTL });
  return data;
}

async function buildUserContext(user: any, link?: any): Promise<UserContext> {
  const isAdmin = await checkIsAdmin(user);
  const aiConfig = await resolveUserAiConfig(user);

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    role: user.role || "user",
    isAdmin,
    githubToken: link?.githubToken || null,
    githubLogin: link?.githubLogin || null,
    aiConfig,
    mcpTools: link?.mcpTools || [],
  };
}

export function invalidateCache(slackUserId?: string): void {
  if (slackUserId) {
    const userId = cache.get(slackUserId)?.data.userId;
    cache.delete(slackUserId);
    if (userId) cache.delete(`byid:${userId}`);
  } else {
    cache.clear();
  }
}
