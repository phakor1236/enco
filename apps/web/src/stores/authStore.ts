import { create } from 'zustand';

export type Role = 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthState {
  user: AuthUser | null;
  /** Access token kept in memory ONLY — never persisted (SPEC §9). */
  accessToken: string | null;
  /** True after boot-time restoreSession() finishes (success or failure). */
  initialized: boolean;
  setSession: (user: AuthUser, accessToken: string) => void;
  clearSession: () => void;
  setInitialized: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  initialized: false,
  setSession: (user, accessToken) => set({ user, accessToken }),
  clearSession: () => set({ user: null, accessToken: null }),
  setInitialized: (initialized) => set({ initialized }),
}));
