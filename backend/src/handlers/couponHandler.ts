import { AppDataSource } from '../config/typeorm';
import { Coupon } from '../models/coupon.entity';
import { CouponUse } from '../models/couponUse.entity';
import { Order } from '../models/order.entity';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { requireFeature } from '../middleware/featureToggle';
import { t } from 'elysia';
import crypto from 'crypto';

function generateCouponCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

export async function couponRoutes(app: any, prefix = '') {
  const couponRepo = AppDataSource.getRepository(Coupon);
  const couponUseRepo = AppDataSource.getRepository(CouponUse);
  const orderRepo = AppDataSource.getRepository(Order);

  app.get(
    prefix + '/admin/coupons',
    async (ctx: any) => {
      const coupons = await couponRepo.find({ order: { createdAt: 'DESC' } });
      return { coupons };
    },
    {
      beforeHandle: [authenticate, authorize('admin:access')],
      detail: { summary: 'List all coupons (admin)', tags: ['Coupons'] },
    }
  );

  app.get(
    prefix + '/admin/coupons/:id',
    async (ctx: any) => {
      const coupon = await couponRepo.findOneBy({ id: Number(ctx.params['id']) });
      if (!coupon) {
        ctx.set.status = 404;
        return { error: ctx.t('coupon.coupon_not_found') };
      }
      const uses = await couponUseRepo.find({
        where: { couponId: coupon.id },
        order: { usedAt: 'DESC' },
        take: 500,
      });
      return { coupon, uses };
    },
    {
      beforeHandle: [authenticate, authorize('admin:access')],
      detail: { summary: 'Get coupon detail with uses (admin)', tags: ['Coupons'] },
    }
  );

  app.post(
    prefix + '/admin/coupons',
    async (ctx: any) => {
      const body = ctx.body as any;
      const code = body.code || generateCouponCode();

      const existing = await couponRepo.findOneBy({ code });
      if (existing) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.a_coupon_with_this_code_already_exists') };
      }

      if (!['percentage', 'fixed'].includes(body.discountType)) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.discounttype_must_be_percentage_or_fixed') };
      }

      if (body.discountType === 'percentage' && (body.discountValue < 0 || body.discountValue > 100)) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.percentage_discount_must_be_between_0_and_100') };
      }

      if (body.discountType === 'fixed' && body.discountValue <= 0) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.fixed_discount_must_be_greater_than_0') };
      }

      const coupon = couponRepo.create({
        code,
        discountType: body.discountType,
        discountValue: Number(body.discountValue),
        minOrderAmount: body.minOrderAmount != null ? Number(body.minOrderAmount) : undefined,
        maxDiscountAmount: body.maxDiscountAmount != null ? Number(body.maxDiscountAmount) : undefined,
        maxUsesTotal: body.maxUsesTotal != null ? Number(body.maxUsesTotal) : undefined,
        maxUsesPerUser: body.maxUsesPerUser != null ? Number(body.maxUsesPerUser) : undefined,
        currentUsesTotal: 0,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        isActive: body.isActive !== false,
        createdBy: ctx.user?.id,
        createdAt: new Date(),
      });

      await couponRepo.save(coupon);
      return { success: true, coupon };
    },
    {
      beforeHandle: [authenticate, authorize('admin:access')],
      detail: { summary: 'Create coupon (admin)', tags: ['Coupons'] },
    }
  );

  app.post(
    prefix + '/admin/coupons/generate-random',
    async (ctx: any) => {
      const body = ctx.body as any;
      const count = Math.min(Math.max(Number(body.count || 1), 1), 50);

      if (!['percentage', 'fixed'].includes(body.discountType)) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.discounttype_must_be_percentage_or_fixed') };
      }

      if (body.discountType === 'percentage' && (body.discountValue < 0 || body.discountValue > 100)) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.percentage_discount_must_be_between_0_and_100') };
      }

      if (body.discountType === 'fixed' && body.discountValue <= 0) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.fixed_discount_must_be_greater_than_0') };
      }

      const coupons: Coupon[] = [];
      const usedCodes = new Set<string>();
      const existingAll = await couponRepo.find();
      for (const e of existingAll) usedCodes.add(e.code);

      for (let i = 0; i < count; i++) {
        let code: string;
        do {
          code = generateCouponCode();
        } while (usedCodes.has(code));
        usedCodes.add(code);

        const coupon = couponRepo.create({
          code,
          discountType: body.discountType,
          discountValue: Number(body.discountValue),
          minOrderAmount: body.minOrderAmount != null ? Number(body.minOrderAmount) : undefined,
          maxDiscountAmount: body.maxDiscountAmount != null ? Number(body.maxDiscountAmount) : undefined,
          maxUsesTotal: body.maxUsesTotal != null ? Number(body.maxUsesTotal) : undefined,
          maxUsesPerUser: body.maxUsesPerUser != null ? Number(body.maxUsesPerUser) : undefined,
          currentUsesTotal: 0,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
          isActive: body.isActive !== false,
          createdBy: ctx.user?.id,
          createdAt: new Date(),
        });
        coupons.push(coupon);
      }

      await couponRepo.save(coupons);
      return { success: true, coupons, count: coupons.length };
    },
    {
      beforeHandle: [authenticate, authorize('admin:access')],
      detail: { summary: 'Generate random coupons (admin)', tags: ['Coupons'] },
    }
  );

  app.put(
    prefix + '/admin/coupons/:id',
    async (ctx: any) => {
      const coupon = await couponRepo.findOneBy({ id: Number(ctx.params['id']) });
      if (!coupon) {
        ctx.set.status = 404;
        return { error: ctx.t('coupon.coupon_not_found') };
      }

      const body = ctx.body as any;

      if (body.code !== undefined) {
        if (body.code !== coupon.code) {
          const existing = await couponRepo.findOneBy({ code: body.code });
          if (existing && existing.id !== coupon.id) {
            ctx.set.status = 400;
            return { error: ctx.t('coupon.a_coupon_with_this_code_already_exists') };
          }
        }
        coupon.code = body.code;
      }

      if (body.discountType !== undefined) {
        if (!['percentage', 'fixed'].includes(body.discountType)) {
          ctx.set.status = 400;
          return { error: ctx.t('coupon.discounttype_must_be_percentage_or_fixed') };
        }
        coupon.discountType = body.discountType;
      }

      if (body.discountValue !== undefined) {
        if ((body.discountType || coupon.discountType) === 'percentage' && (body.discountValue < 0 || body.discountValue > 100)) {
          ctx.set.status = 400;
          return { error: ctx.t('coupon.percentage_discount_must_be_between_0_and_100') };
        }
        if ((body.discountType || coupon.discountType) === 'fixed' && body.discountValue <= 0) {
          ctx.set.status = 400;
          return { error: ctx.t('coupon.fixed_discount_must_be_greater_than_0') };
        }
        coupon.discountValue = Number(body.discountValue);
      }

      if (body.minOrderAmount !== undefined) coupon.minOrderAmount = body.minOrderAmount != null ? Number(body.minOrderAmount) : undefined;
      if (body.maxDiscountAmount !== undefined) coupon.maxDiscountAmount = body.maxDiscountAmount != null ? Number(body.maxDiscountAmount) : undefined;
      if (body.maxUsesTotal !== undefined) coupon.maxUsesTotal = body.maxUsesTotal != null ? Number(body.maxUsesTotal) : undefined;
      if (body.maxUsesPerUser !== undefined) coupon.maxUsesPerUser = body.maxUsesPerUser != null ? Number(body.maxUsesPerUser) : undefined;
      if (body.expiresAt !== undefined) coupon.expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
      if (body.isActive !== undefined) coupon.isActive = Boolean(body.isActive);

      await couponRepo.save(coupon);
      return { success: true, coupon };
    },
    {
      beforeHandle: [authenticate, authorize('admin:access')],
      detail: { summary: 'Update coupon (admin)', tags: ['Coupons'] },
    }
  );

  app.delete(
    prefix + '/admin/coupons/:id',
    async (ctx: any) => {
      const coupon = await couponRepo.findOneBy({ id: Number(ctx.params['id']) });
      if (!coupon) {
        ctx.set.status = 404;
        return { error: ctx.t('coupon.coupon_not_found') };
      }

      await couponUseRepo.delete({ couponId: coupon.id });
      await couponRepo.remove(coupon);
      return { success: true };
    },
    {
      beforeHandle: [authenticate, authorize('admin:access')],
      detail: { summary: 'Delete coupon (admin)', tags: ['Coupons'] },
    }
  );

  app.post(
    prefix + '/coupons/validate',
    async (ctx: any) => {
      const f = await requireFeature(ctx, 'billing');
      if (f !== true) return f;

      const user = ctx.user as any;

      try {
        const ip = (ctx.ip || ctx.request?.ip || '').toString().slice(0, 200);
        const rl = await require('../config/redis').consumeRateLimit(
          `rate:coupon:validate:user:${user?.id}:ip:${ip}`,
          Number(process.env.COUPON_VALIDATE_RATE || 30),
          Number(process.env.COUPON_VALIDATE_WINDOW || 3600)
        );
        if (!rl.allowed) {
          ctx.set.status = 429;
          ctx.set.headers = {
            ...(ctx.set.headers || {}),
            'Retry-After': String(rl.retryAfterSeconds),
          };
          return { error: 'rate_limited', retryAfter: rl.retryAfterSeconds };
        }
      } catch {}

      const body = ctx.body as any;
      const { code, orderAmount } = body;

      if (!code) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.coupon_code_is_required') };
      }

      const coupon = await couponRepo.findOneBy({ code: String(code).trim().toUpperCase() });
      if (!coupon) {
        ctx.set.status = 404;
        return { error: ctx.t('coupon.invalid_or_expired_coupon') };
      }

      if (!coupon.isActive) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.this_coupon_is_no_longer_active') };
      }

      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.this_coupon_has_expired') };
      }

      if (coupon.maxUsesTotal != null && coupon.currentUsesTotal >= coupon.maxUsesTotal) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.this_coupon_has_reached_its_global_usage_limit') };
      }

      if (coupon.maxUsesPerUser != null) {
        const userUseCount = await couponUseRepo.count({
          where: { couponId: coupon.id, userId: user.id },
        });
        if (userUseCount >= coupon.maxUsesPerUser) {
          ctx.set.status = 400;
          return { error: ctx.t('coupon.you_have_already_used_this_coupon_the_maximum_number_of_time') };
        }
      }

      let discountAmount = 0;
      if (coupon.discountType === 'percentage') {
        discountAmount = (Number(orderAmount || 0) * coupon.discountValue) / 100;
        if (coupon.maxDiscountAmount != null && discountAmount > coupon.maxDiscountAmount) {
          discountAmount = coupon.maxDiscountAmount;
        }
      } else if (coupon.discountType === 'fixed') {
        discountAmount = Math.min(coupon.discountValue, Number(orderAmount || 0));
      }

      if (coupon.minOrderAmount != null && Number(orderAmount || 0) < coupon.minOrderAmount) {
        ctx.set.status = 400;
        return { error: `Minimum order amount of $${coupon.minOrderAmount.toFixed(2)} required for this coupon` };
      }

      return {
        valid: true,
        coupon: {
          id: coupon.id,
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          discountAmount: Math.round(discountAmount * 100) / 100,
          newAmount: Math.max(0, Math.round((Number(orderAmount || 0) - discountAmount) * 100) / 100),
        },
      };
    },
    {
      beforeHandle: authenticate,
      body: t.Object({
        code: t.String(),
        orderAmount: t.Optional(t.Number()),
      }),
      detail: { summary: 'Validate a coupon code', tags: ['Coupons'] },
    }
  );

  app.post(
    prefix + '/coupons/redeem',
    async (ctx: any) => {
      const f = await requireFeature(ctx, 'billing');
      if (f !== true) return f;

      const user = ctx.user as any;
      const body = ctx.body as any;
      const { code, orderId } = body;

      if (!code || !orderId) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.coupon_code_and_order_id_are_required') };
      }

      const order = await orderRepo.findOneBy({ id: Number(orderId) });
      if (!order) {
        ctx.set.status = 404;
        return { error: ctx.t('coupon.order_not_found') };
      }
      if (order.userId !== user.id) {
        ctx.set.status = 403;
        return { error: ctx.t('coupon.forbidden') };
      }
      if (order.status !== 'pending') {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.coupon_can_only_be_applied_to_pending_orders') };
      }
      if (order.couponId) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.a_coupon_has_already_been_applied_to_this_order') };
      }

      const normalizedCode = String(code).trim().toUpperCase();
      const coupon = await couponRepo.findOneBy({ code: normalizedCode });
      if (!coupon) {
        ctx.set.status = 404;
        return { error: ctx.t('coupon.invalid_or_expired_coupon') };
      }

      if (!coupon.isActive) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.this_coupon_is_no_longer_active') };
      }

      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.this_coupon_has_expired') };
      }

      const reserveGlobal = await couponRepo
        .createQueryBuilder()
        .update()
        .set({ currentUsesTotal: () => 'currentUsesTotal + 1' })
        .where('id = :id', { id: coupon.id })
        .andWhere('(maxUsesTotal IS NULL OR currentUsesTotal < maxUsesTotal)')
        .execute();
      if ((reserveGlobal.affected ?? 0) === 0) {
        ctx.set.status = 400;
        return { error: ctx.t('coupon.this_coupon_has_reached_its_global_usage_limit') };
      }
      let reserved = true;
      let reservedUseId: number | undefined;
      const rollbackReservation = async () => {
        if (!reserved) return;
        reserved = false;
        await couponRepo
          .createQueryBuilder()
          .update()
          .set({ currentUsesTotal: () => 'GREATEST(currentUsesTotal - 1, 0)' })
          .where('id = :id', { id: coupon.id })
          .execute()
          .catch(() => {});
        if (reservedUseId != null) {
          await couponUseRepo.delete({ id: reservedUseId }).catch(() => {});
        }
      };

      if (coupon.maxUsesPerUser != null) {
        const res = await couponUseRepo.query(
          `INSERT INTO coupon_use (couponId, userId, usedAt)
           SELECT ?, ?, ?
           WHERE (SELECT COUNT(*) FROM coupon_use WHERE couponId = ? AND userId = ?) < ?`,
          [coupon.id, user.id, new Date(), coupon.id, user.id, coupon.maxUsesPerUser]
        );
        if ((res?.affectedRows ?? 0) === 0) {
          await rollbackReservation();
          ctx.set.status = 400;
          return { error: ctx.t('coupon.you_have_already_used_this_coupon_the_maximum_number_of_time') };
        }
        reservedUseId = Number(res?.insertId);
      } else {
        const ins = await couponUseRepo.insert({
          couponId: coupon.id,
          userId: user.id,
          usedAt: new Date(),
        });
        reservedUseId = (ins.identifiers?.[0] as any)?.id as number | undefined;
      }

      let discountAmount = 0;
      if (coupon.discountType === 'percentage') {
        discountAmount = (Number(order.amount) * coupon.discountValue) / 100;
        if (coupon.maxDiscountAmount != null && discountAmount > coupon.maxDiscountAmount) {
          discountAmount = coupon.maxDiscountAmount;
        }
      } else if (coupon.discountType === 'fixed') {
        discountAmount = Math.min(coupon.discountValue, Number(order.amount));
      }

      if (coupon.minOrderAmount != null && Number(order.amount) < coupon.minOrderAmount) {
        ctx.set.status = 400;
        return { error: `Minimum order amount of $${coupon.minOrderAmount.toFixed(2)} required for this coupon` };
      }

      discountAmount = Math.min(discountAmount, Number(order.amount));

      try {
        order.couponId = coupon.id;
        order.couponCode = coupon.code;
        order.discountAmount = Math.round(discountAmount * 100) / 100;
        order.amount = Math.max(0, Math.round((Number(order.amount) - discountAmount) * 100) / 100);

        if (order.amount === 0) {
          order.status = 'active';
          order.notes = order.notes
            ? `${order.notes}; Auto-paid by coupon ${coupon.code}`
            : `Auto-paid by coupon ${coupon.code}`;
          const isQueuedForRenewal = (order.notes || '').includes('queue_for_renewal');
          if (!isQueuedForRenewal) {
            const prevActive = (await orderRepo.find({
              where: { userId: user.id, status: 'active' },
            })).filter(o => !(o.notes || '').includes('dns_addon') && !(o.notes || '').includes('org_order') && !o.orgId);

            for (const prev of prevActive) {
              prev.status = 'cancelled';
              prev.notes = prev.notes
                ? `${prev.notes}; Replaced by order #${order.id} on ${new Date().toISOString()}`
                : `Replaced by order #${order.id} on ${new Date().toISOString()}`;
              if (prev.couponId) {
                const prevCoupon = await couponRepo.findOneBy({ id: Number(prev.couponId) });
                if (prevCoupon) {
                  prevCoupon.currentUsesTotal = Math.max(0, prevCoupon.currentUsesTotal - 1);
                  await couponRepo.save(prevCoupon);
                }
                await couponUseRepo.delete({ couponId: prev.couponId, userId: prev.userId });
              }
            }
            if (prevActive.length > 0) await orderRepo.save(prevActive);

            if (order.planId != null) {
              try {
                const planRepo = AppDataSource.getRepository(require('../models/plan.entity').Plan);
                const plan = await planRepo.findOneBy({ id: Number(order.planId) });
                if (plan) {
                  const { activateOrderPlan } = require('./orderHandler');
                  await activateOrderPlan(order, plan);
                }
              } catch (_e) {}
            }
          }
        }

        await orderRepo.save(order);
      } catch (e) {
        await rollbackReservation();
        throw e;
      }

      return {
        success: true,
        order: {
          id: order.id,
          amount: order.amount,
          discountAmount: order.discountAmount,
          couponCode: order.couponCode,
          status: order.status,
          autoActivated: order.amount === 0,
        },
      };
    },
    {
      beforeHandle: authenticate,
      body: t.Object({
        code: t.String(),
        orderId: t.Number(),
      }),
      detail: { summary: 'Redeem a coupon on an order', tags: ['Coupons'] },
    }
  );
}
