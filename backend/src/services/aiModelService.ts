import { AppDataSource } from '../config/typeorm';
import { AIModel } from '../models/aiModel.entity';
import { AIModelUser } from '../models/aiModelUser.entity';
import { AIModelOrg } from '../models/aiModelOrg.entity';
import { AIModelPlan } from '../models/aiModelPlan.entity';
import { Order } from '../models/order.entity';
import { OrganisationMember } from '../models/organisationMember.entity';
import { In } from 'typeorm';
import { extractEndpoints, resolveProviderModelId } from '../utils/aiProvider';
import { isPrivateIp, assertSafeUrl } from '../utils/ssrf';

export interface ResolvedAiConfig {
  provider?: string;
  endpoint: string;
  apiKey: string;
  modelId: string;
}

export async function getUserOrgIds(userId: number): Promise<number[]> {
  const orgMemberRepo = AppDataSource.getRepository(OrganisationMember);
  const memberships = await orgMemberRepo.find({ where: { userId } });
  return memberships
    .filter((m: { organisationId?: number | string | null }) => m.organisationId !== null && m.organisationId !== undefined)
    .map((m: { organisationId?: number | string }) => Number(m.organisationId))
    .filter((v: number) => Number.isFinite(v) && v > 0);
}

export async function getUserPlanIds(userId: number): Promise<number[]> {
  const orderRepo = AppDataSource.getRepository(Order);
  const orders = await orderRepo.find({
    where: { userId, status: 'active' },
    order: { createdAt: 'DESC' },
  });
  return orders
    .filter(o => o.planId !== null && o.planId !== undefined)
    .map(o => o.planId as number);
}

export async function resolveUserAiModel(userId: number): Promise<AIModel | null> {
  const modelRepo = AppDataSource.getRepository(AIModel);
  const modelUserRepo = AppDataSource.getRepository(AIModelUser);
  const modelOrgRepo = AppDataSource.getRepository(AIModelOrg);
  const modelPlanRepo = AppDataSource.getRepository(AIModelPlan);

  const userLink = await modelUserRepo.findOne({ where: { user: { id: userId } }, relations: { model: true } });
  if (userLink?.model) return userLink.model;

  const orgIds = await getUserOrgIds(userId);
  if (orgIds.length > 0) {
    const orgLink = await modelOrgRepo.findOne({
      where: { organisation: { id: In(orgIds) } },
      relations: { model: true },
      order: { id: 'ASC' },
    });
    if (orgLink?.model) return orgLink.model;
  }

  const planIds = await getUserPlanIds(userId);
  if (planIds.length > 0) {
    const planLinks = await modelPlanRepo.find({
      where: { plan: { id: In(planIds) } },
      relations: { model: true },
      order: { id: 'ASC' },
    });
    for (const planLink of planLinks) {
      if (planLink.model) return planLink.model;
    }
  }

  return null;
}

export function getModelAiConfig(model: AIModel): ResolvedAiConfig | null {
  try {
    const endpoints = extractEndpoints(model);
    if (endpoints.length === 0) return null;
    const ep = endpoints[0];
    return {
      endpoint: ep.base,
      apiKey: ep.apiKey || '',
      modelId: resolveProviderModelId(model),
    };
  } catch (err) {
    console.warn(`[aiModelService] Failed to build AI config for model ${model?.id}:`, err);
    return null;
  }
}

function isSafeByoaiEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host === 'localhost.localdomain' || host === '0.0.0.0' || host === '::1') return false;
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
    if (isPrivateIp(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export function getByoaiConfig(user: { settings?: any }): ResolvedAiConfig | null {
  const byoai = user.settings?.byoai as Record<string, unknown> | undefined;
  if (!byoai || !byoai.enabled) return null;
  const endpoint = String(byoai.endpoint || '').replace(/\/+$/, '');
  const apiKey = String(byoai.apiKey || '');
  const modelId = String(byoai.modelId || '');
  if (!endpoint || !apiKey || !modelId) return null;
  if (!isSafeByoaiEndpoint(endpoint)) return null;
  return { provider: String(byoai.provider || 'byoai'), endpoint, apiKey, modelId };
}

export async function resolveUserAiConfig(user: { id: number; settings?: any }): Promise<ResolvedAiConfig | null> {
  const byoai = getByoaiConfig(user);
  if (byoai) {
    if (!(await assertSafeUrl(byoai.endpoint))) {
      console.warn(`[aiModelService] Rejected unsafe BYOAI endpoint for user ${user.id}`);
      return null;
    }
    return byoai;
  }

  const model = await resolveUserAiModel(user.id);
  if (model) return getModelAiConfig(model);

  return null;
}