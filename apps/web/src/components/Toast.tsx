import { useEffect } from 'react';

import { useCartUiStore, type ToastItem } from '../stores/cartUiStore.js';
import { cn } from '../lib/cn.js';

/**
 * Minimal toast stack rendered once at the App root. Reads from cartUiStore;
 * any feature can call `useCartUiStore.getState().pushToast(...)`. Auto-
 * dismiss after 5s; manual dismiss on click.
 */

const TOAST_TTL_MS = 5_000;

export function ToastStack(): JSX.Element {
  const toasts = useCartUiStore((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}

function Toast({ toast }: { toast: ToastItem }): JSX.Element {
  const dismiss = useCartUiStore((s) => s.dismissToast);
  useEffect(() => {
    const id = window.setTimeout(() => dismiss(toast.id), TOAST_TTL_MS);
    return () => window.clearTimeout(id);
  }, [toast.id, dismiss]);

  return (
    <button
      type="button"
      onClick={() => dismiss(toast.id)}
      className={cn(
        'pointer-events-auto max-w-md rounded-lg border px-4 py-3 text-sm shadow-md transition',
        'bg-surface text-ink',
        toast.kind === 'error' && 'border-danger text-danger',
        toast.kind === 'warn' && 'border-line text-ink',
        toast.kind === 'info' && 'border-line text-ink',
      )}
    >
      {toast.message}
    </button>
  );
}
