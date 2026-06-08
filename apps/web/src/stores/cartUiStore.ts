import { create } from 'zustand';

/**
 * UI-only state for the cart slice:
 *   - Drawer open/close (any component can toggle: header icon, AddToCart success)
 *   - Toast queue (auto-dismiss; component renders from this store)
 *
 * Server-side cart data lives in React Query (see useCart). Two stores so a
 * cart refetch never has to round-trip through this UI state.
 */

export type ToastKind = 'info' | 'warn' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface CartUiState {
  drawerOpen: boolean;
  toasts: ToastItem[];
  openDrawer: () => void;
  closeDrawer: () => void;
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: number) => void;
}

let toastIdSeq = 1;

export const useCartUiStore = create<CartUiState>((set) => ({
  drawerOpen: false,
  toasts: [],
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  pushToast: (kind, message) =>
    set((s) => ({
      toasts: [...s.toasts, { id: toastIdSeq++, kind, message }],
    })),
  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}));
