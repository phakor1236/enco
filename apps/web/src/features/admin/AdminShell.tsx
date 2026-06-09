import { NavLink, Outlet } from 'react-router-dom';

import { cn } from '../../lib/cn.js';

const links = [
  { to: '/admin/orders', label: '訂單管理' },
  { to: '/admin/products', label: '商品管理' },
  { to: '/admin/coupons', label: '優惠券管理' },
  { to: '/admin/reports', label: '銷售報表' },
];

export function AdminShell(): JSX.Element {
  return (
    <div className="flex min-h-screen bg-paper">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 border-r border-line bg-surface pt-8">
        <p className="mb-6 px-6 text-xs font-semibold uppercase tracking-widest text-ink-soft">
          後台管理
        </p>
        <nav className="flex flex-col gap-1 px-3">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper-2 hover:text-ink',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
