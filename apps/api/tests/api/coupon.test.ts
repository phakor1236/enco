import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';
import { issueAccessToken } from '../../src/services/authService.js';

/**
 * T5.2 — POST /api/coupons/validate acceptance matrix.
 *
 * Each coupon type and all five failure codes are exercised independently
 * so regressions surface at the exact code that breaks.
 */

const app = createApp();

const EMAIL_DOMAIN = 'e2e-coupon.test';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const CODE_PREFIX = `CPT-${Date.now()}`;

let userId: string;
let otherUserId: string;
let token: string;
let otherToken: string;

// Coupon ids created in beforeAll
let fixedCouponCode: string;
let percentCouponCode: string;
let notStartedCode: string;
let expiredCode: string;
let belowMinCode: string;
let limitReachedCode: string;
let alreadyUsedCode: string;

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: `buyer@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `buyer@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  userId = user.id;
  token = issueAccessToken({ id: user.id, role: user.role });

  const other = await prisma.user.upsert({
    where: { email: `other@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `other@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  otherUserId = other.id;
  otherToken = issueAccessToken({ id: other.id, role: other.role });

  const past = new Date(Date.now() - 86_400_000);
  const future = new Date(Date.now() + 86_400_000);

  // FIXED $50 off, no constraints
  const fixed = await prisma.coupon.create({
    data: { code: `${CODE_PREFIX}-FIXED`, type: 'FIXED', value: '50.00' },
  });
  fixedCouponCode = fixed.code;

  // PERCENT 10% off, no constraints
  const pct = await prisma.coupon.create({
    data: { code: `${CODE_PREFIX}-PCT`, type: 'PERCENT', value: '10.00' },
  });
  percentCouponCode = pct.code;

  // NOT_STARTED: starts tomorrow
  const ns = await prisma.coupon.create({
    data: { code: `${CODE_PREFIX}-NS`, type: 'FIXED', value: '10.00', startsAt: future },
  });
  notStartedCode = ns.code;

  // EXPIRED: ended yesterday
  const exp = await prisma.coupon.create({
    data: { code: `${CODE_PREFIX}-EXP`, type: 'FIXED', value: '10.00', endsAt: past },
  });
  expiredCode = exp.code;

  // BELOW_MIN: minAmount $500
  const bm = await prisma.coupon.create({
    data: { code: `${CODE_PREFIX}-BM`, type: 'FIXED', value: '20.00', minAmount: '500.00' },
  });
  belowMinCode = bm.code;

  // LIMIT_REACHED: usageLimit 1, already used by otherUserId
  const lr = await prisma.coupon.create({
    data: { code: `${CODE_PREFIX}-LR`, type: 'FIXED', value: '5.00', usageLimit: 1 },
  });
  limitReachedCode = lr.code;
  // Create an order stub so we can attach a usage row
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();
  const stubOrder = await prisma.order.create({
    data: {
      userId: otherUserId,
      subtotal: '100.00',
      discount: '5.00',
      total: '95.00',
      shippingAddress: {},
      paymentMethod: 'mock_card',
    },
  });
  await prisma.couponUsage.create({
    data: { couponId: lr.id, userId: otherUserId, orderId: stubOrder.id },
  });

  // ALREADY_USED: create another stub order for our userId
  const au = await prisma.coupon.create({
    data: { code: `${CODE_PREFIX}-AU`, type: 'FIXED', value: '5.00' },
  });
  alreadyUsedCode = au.code;
  const stubOrder2 = await prisma.order.create({
    data: {
      userId,
      subtotal: '100.00',
      discount: '5.00',
      total: '95.00',
      shippingAddress: {},
      paymentMethod: 'mock_card',
    },
  });
  await prisma.couponUsage.create({
    data: { couponId: au.id, userId, orderId: stubOrder2.id },
  });
});

afterAll(async () => {
  await prisma.couponUsage.deleteMany({ where: { coupon: { code: { startsWith: CODE_PREFIX } } } });
  await prisma.order.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

describe('POST /api/coupons/validate', () => {
  it('200 — FIXED coupon: discountAmount = min(value, subtotal)', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: fixedCouponCode, subtotal: '200.00' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(fixedCouponCode);
    expect(res.body.type).toBe('FIXED');
    expect(res.body.discountAmount).toBe('50.00');
  });

  it('200 — FIXED coupon: discountAmount capped at subtotal when coupon > order', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: fixedCouponCode, subtotal: '30.00' });

    expect(res.status).toBe(200);
    // $50 coupon on $30 order → discount is capped at $30
    expect(res.body.discountAmount).toBe('30.00');
  });

  it('200 — PERCENT coupon: discountAmount = subtotal * value/100', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: percentCouponCode, subtotal: '300.00' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('PERCENT');
    // 10% of 300 = 30.00
    expect(res.body.discountAmount).toBe('30.00');
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .send({ code: fixedCouponCode, subtotal: '100.00' });
    expect(res.status).toBe(401);
  });

  it('400 VALIDATION_ERROR — missing code', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ subtotal: '100.00' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR — bad subtotal format', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: fixedCouponCode, subtotal: 'not-a-number' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 COUPON_NOT_FOUND — unknown code', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'DOES-NOT-EXIST', subtotal: '100.00' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUPON_NOT_FOUND');
  });

  it('422 COUPON_NOT_STARTED — coupon starts in the future', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: notStartedCode, subtotal: '100.00' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_NOT_STARTED');
  });

  it('422 COUPON_EXPIRED — coupon ended in the past', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: expiredCode, subtotal: '100.00' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_EXPIRED');
  });

  it('422 COUPON_BELOW_MIN — subtotal below minimum', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: belowMinCode, subtotal: '100.00' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_BELOW_MIN');
  });

  it('422 COUPON_LIMIT_REACHED — global usage cap exhausted', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: limitReachedCode, subtotal: '100.00' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_LIMIT_REACHED');
  });

  it('422 COUPON_ALREADY_USED — this user already used the coupon', async () => {
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: alreadyUsedCode, subtotal: '100.00' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_ALREADY_USED');
  });

  it('422 COUPON_LIMIT_REACHED before COUPON_ALREADY_USED — global cap checked first', async () => {
    // otherToken tries the limit-reached coupon: same 422 cap error even
    // though otherUser consumed the only usage slot (is the one who used it).
    // This verifies the check ORDER: limit → already_used, not vice-versa.
    const res = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ code: limitReachedCode, subtotal: '100.00' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COUPON_LIMIT_REACHED');
  });
});
