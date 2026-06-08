import { Link, NavLink, Outlet } from 'react-router-dom';

import { useCategories } from '../features/products/useProducts.js';
import { useLogout } from '../features/auth/useAuth.js';
import { CartIconButton } from '../features/cart/CartIconButton.js';
import { useAuthStore } from '../stores/authStore.js';
import { cn } from '../lib/cn.js';

/**
 * Top-nav + category strip + auth controls. Hosts the page outlet so
 * route children (Home, ProductList, ProductDetail, …) render in-shell.
 */
export function AppShell(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();
  const { data: categories } = useCategories();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="font-display text-xl font-bold tracking-tight">
            VELLA
          </Link>
          {/* md+ shows categories inline; below md they collapse — see the
              horizontal-scroll strip below for mobile access (review I4). */}
          <nav className="hidden md:flex gap-1 text-sm">
            <NavLink to="/products" className={navLinkClass}>
              全部
            </NavLink>
            {categories?.map((c) => (
              <NavLink key={c.id} to={`/products?category=${c.slug}`} className={navLinkClass}>
                {c.name}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <CartIconButton />
            {user ? (
              <>
                <span className="hidden sm:inline text-ink-soft">{user.email}</span>
                <button
                  type="button"
                  onClick={() => logout.mutate()}
                  disabled={logout.isPending}
                  className="rounded-full border border-line px-4 py-1.5 hover:bg-paper-2 disabled:opacity-50"
                >
                  {logout.isPending ? '登出中…' : '登出'}
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="rounded-full px-4 py-1.5 hover:bg-paper-2">
                  登入
                </Link>
                <Link
                  to="/register"
                  className="rounded-full bg-ink px-4 py-1.5 font-semibold text-white hover:opacity-90"
                >
                  註冊
                </Link>
              </>
            )}
          </div>
        </div>
        {/* Mobile category strip: horizontal scroll under the header so phone
            users can still filter (review I4). Hidden at md+ where the inline
            nav above takes over. */}
        <nav className="md:hidden flex gap-1 overflow-x-auto px-6 pb-3 text-sm">
          <NavLink to="/products" className={navLinkClass}>
            全部
          </NavLink>
          {categories?.map((c) => (
            <NavLink key={c.id} to={`/products?category=${c.slug}`} className={navLinkClass}>
              {c.name}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
      <footer className="border-t border-line py-8 text-center text-xs text-ink-soft">
        VELLA · A portfolio storefront
      </footer>
    </div>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'rounded-full px-3 py-1.5 transition-colors',
    isActive ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper-2 hover:text-ink',
  );
}
