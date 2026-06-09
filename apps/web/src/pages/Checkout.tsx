import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { ShippingAddressSchema } from '@app/shared';

import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { useAuthStore } from '../stores/authStore.js';
import { useCart } from '../features/cart/useCart.js';
import { formatMoney } from '../features/products/format.js';
import { useCheckout } from '../features/checkout/useCheckout.js';

interface FormErrors {
  name?: string;
  phone?: string;
  city?: string;
  addr?: string;
  form?: string;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

function apiErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const body = err.response?.data as ApiErrorBody | undefined;
    const code = body?.error?.code;
    if (code === 'CART_EMPTY') return '購物車是空的，請先加入商品再結帳';
    if (code === 'OUT_OF_STOCK') return '部分商品庫存不足，請調整後再試';
    if (code === 'UNAUTHENTICATED') return '請先登入再結帳';
  }
  return '結帳失敗，請稍後再試';
}

export function CheckoutPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { data: cart, isLoading: cartLoading } = useCart();
  const checkout = useCheckout();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [addr, setAddr] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  // Guard: must be logged in
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="mb-4 text-ink-soft">請先登入才能結帳</p>
        <Link
          to="/login"
          className="inline-flex h-11 items-center rounded-full bg-ink px-6 font-semibold text-white hover:opacity-90"
        >
          前往登入
        </Link>
      </main>
    );
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErrors({});

    const parsed = ShippingAddressSchema.safeParse({ name, phone, city, addr });
    if (!parsed.success) {
      const fe: FormErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof FormErrors;
        if (!fe[field]) fe[field] = issue.message;
      }
      setErrors(fe);
      return;
    }

    try {
      const result = await checkout.mutateAsync({
        shippingAddress: parsed.data,
        paymentMethod: 'mock_card',
      });
      navigate(`/orders/success/${result.orderId}`);
    } catch (err) {
      setErrors({ form: apiErrorMessage(err) });
    }
  }

  const isEmpty = !cartLoading && (!cart || cart.items.length === 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-8 font-display text-2xl font-bold">結帳</h1>

      {isEmpty ? (
        <div className="rounded-xl border border-line bg-surface p-10 text-center">
          <p className="mb-4 text-ink-soft">購物車是空的</p>
          <Link to="/products" className="text-primary hover:text-primary-press">
            去逛逛 →
          </Link>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          {/* Shipping address form */}
          <section>
            <h2 className="mb-4 font-display font-semibold">收件資訊</h2>
            <form id="checkout-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <Field
                label="收件人姓名"
                type="text"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                error={errors.name}
              />
              <Field
                label="手機號碼"
                type="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={errors.phone}
              />
              <Field
                label="縣市"
                type="text"
                autoComplete="address-level2"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                error={errors.city}
              />
              <Field
                label="詳細地址"
                type="text"
                autoComplete="street-address"
                required
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                error={errors.addr}
              />

              {errors.form && (
                <div
                  role="alert"
                  className="rounded-md bg-danger-tint px-3 py-2 text-sm font-semibold text-danger"
                >
                  {errors.form}
                </div>
              )}
            </form>
          </section>

          {/* Order summary + submit */}
          <aside className="flex flex-col gap-4">
            <div className="rounded-xl border border-line bg-surface p-5">
              <h2 className="mb-3 font-display font-semibold">訂單明細</h2>

              {cartLoading ? (
                <p className="text-sm text-ink-soft">載入中…</p>
              ) : (
                <>
                  <ul className="mb-3 divide-y divide-line text-sm">
                    {cart?.items.map((item) => (
                      <li key={item.id} className="flex justify-between gap-2 py-2">
                        <span className="line-clamp-1 text-ink">
                          {item.product.name}
                          <span className="ml-1 text-ink-soft">×{item.qty}</span>
                        </span>
                        <span className="tabular-nums">{formatMoney(item.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-baseline justify-between border-t border-line pt-3">
                    <span className="text-sm text-ink-soft">小計</span>
                    <span className="font-display text-lg font-bold tabular-nums">
                      {formatMoney(cart?.subtotal ?? '0')}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="rounded-xl border border-line bg-surface p-5 text-sm text-ink-soft">
              <p className="mb-1 font-semibold text-ink">付款方式</p>
              <p>模擬信用卡（mock_card）</p>
            </div>

            <Button
              type="submit"
              form="checkout-form"
              size="lg"
              block
              disabled={checkout.isPending || cartLoading || isEmpty}
            >
              {checkout.isPending ? '處理中…' : '確認送出'}
            </Button>
          </aside>
        </div>
      )}
    </main>
  );
}
