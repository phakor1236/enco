import { type FormEvent, useState } from 'react';
import { AxiosError } from 'axios';
import { ErrorCodes } from '@app/shared';

import { formatMoney } from '../products/format.js';

import { useCouponValidate } from './useCheckout.js';

interface ApiErrorBody {
  error?: { code?: string };
}

function couponErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const code = (err.response?.data as ApiErrorBody | undefined)?.error?.code;
    if (code === ErrorCodes.COUPON_NOT_FOUND) return '找不到此優惠碼';
    if (code === ErrorCodes.COUPON_NOT_STARTED) return '優惠碼尚未開始使用';
    if (code === ErrorCodes.COUPON_EXPIRED) return '優惠碼已過期';
    if (code === ErrorCodes.COUPON_BELOW_MIN) return '訂單金額不足以使用此優惠碼';
    if (code === ErrorCodes.COUPON_LIMIT_REACHED) return '優惠碼已達使用上限';
    if (code === ErrorCodes.COUPON_ALREADY_USED) return '您已使用過此優惠碼';
    if (code === ErrorCodes.RATE_LIMITED) return '請求過於頻繁，請稍後再試';
  }
  return '驗證失敗，請稍後再試';
}

interface CouponInputProps {
  subtotal: string;
  onApply: (code: string, discountAmount: string) => void;
  onRemove: () => void;
  appliedCode: string | null;
  discountAmount: string;
}

export function CouponInput({
  subtotal,
  onApply,
  onRemove,
  appliedCode,
  discountAmount,
}: CouponInputProps): JSX.Element {
  const [inputCode, setInputCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const validate = useCouponValidate();

  async function handleApply(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErrorMsg('');
    const trimmed = inputCode.trim();
    if (!trimmed) {
      setErrorMsg('請輸入優惠碼');
      return;
    }
    try {
      const result = await validate.mutateAsync({ code: trimmed, subtotal });
      onApply(result.code, result.discountAmount);
      setInputCode('');
    } catch (err) {
      setErrorMsg(couponErrorMessage(err));
    }
  }

  function handleRemove(): void {
    setInputCode('');
    setErrorMsg('');
    validate.reset();
    onRemove();
  }

  if (appliedCode) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-success bg-success-tint px-3 py-2 text-sm">
        <span className="font-medium text-success">
          {appliedCode}
          <span className="ml-2 text-ink-soft font-normal">(-{formatMoney(discountAmount)})</span>
        </span>
        <button
          type="button"
          onClick={handleRemove}
          className="ml-3 text-ink-soft hover:text-ink"
          aria-label="移除優惠碼"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleApply} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          type="text"
          value={inputCode}
          onChange={(e) => {
            setInputCode(e.target.value);
            if (errorMsg) setErrorMsg('');
          }}
          placeholder="輸入優惠碼"
          autoComplete="off"
          spellCheck={false}
          className="h-10 flex-1 rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-ink-soft focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={validate.isPending}
          className="h-10 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-paper-2 disabled:opacity-50"
        >
          {validate.isPending ? '驗證中…' : '套用'}
        </button>
      </div>
      {errorMsg && <p className="text-xs text-danger">{errorMsg}</p>}
    </form>
  );
}
