import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Avatar, Button, Dropdown, Separator, Tooltip,
} from '@heroui/react';
import {
  BarChart3, Boxes, FileClock, KeyRound, LayoutDashboard, LogOut, Menu, Receipt, Settings,
  Ticket, Users, Webhook, X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  ownerOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/admin', label: '概览', icon: LayoutDashboard },
  { to: '/admin/products', label: '产品与策略', icon: Boxes },
  { to: '/admin/licenses', label: '授权管理', icon: KeyRound },
  { to: '/admin/customers', label: '客户', icon: Users },
  { to: '/admin/orders', label: '订单', icon: Receipt },
  { to: '/admin/redeem', label: '卡密', icon: Ticket },
  { to: '/admin/devices', label: '设备', icon: BarChart3 },
  { to: '/admin/webhooks', label: 'Webhook', icon: Webhook },
  { to: '/admin/audit', label: '审计日志', icon: FileClock },
  { to: '/admin/settings', label: '设置', icon: Settings },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center gap-2 px-2 py-1">
        <div className="grid size-8 place-items-center rounded-lg bg-brand-500 font-bold text-white">L</div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">LicenseHub</p>
          <p className="text-[11px] opacity-50">授权管理系统</p>
        </div>
      </div>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/admin'}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ' +
            (isActive
              ? 'bg-brand-500/12 font-medium text-brand-500'
              : 'opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5')
          }
        >
          <item.icon size={16} className="shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full min-h-dvh">
      {/* 桌面侧栏 */}
      <aside className="hidden w-56 shrink-0 border-r border-black/5 bg-white/60 lg:block dark:border-white/8 dark:bg-white/2">
        {sidebar}
      </aside>

      {/* 移动端抽屉 */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60 bg-white shadow-xl dark:bg-neutral-900">
            <button
              type="button"
              aria-label="关闭菜单"
              className="absolute right-2 top-3 rounded-md p-1 opacity-60 hover:opacity-100"
              onClick={() => setMobileOpen(false)}
            >
              <X size={16} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/5 bg-white/60 px-4 backdrop-blur dark:border-white/8 dark:bg-white/2">
          <div className="flex items-center gap-2">
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              aria-label="打开菜单"
              className="lg:hidden"
              onPress={() => setMobileOpen(true)}
            >
              <Menu size={16} />
            </Button>
            <span className="text-sm opacity-50">个人运营控制台</span>
          </div>
          <Dropdown>
            <Dropdown.Trigger>
              <Button variant="ghost" size="sm" className="gap-2">
                <Avatar className="size-6">
                  <Avatar.Fallback>{(user?.name ?? 'A').slice(0, 1)}</Avatar.Fallback>
                </Avatar>
                <span className="hidden text-sm sm:inline">{user?.name ?? '未登录'}</span>
              </Button>
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu>
                <Dropdown.Item id="role" isDisabled>
                  {user?.email} · {user?.role}
                </Dropdown.Item>
                <Dropdown.Section>
                  <Dropdown.Item id="security" onAction={() => navigate('/admin/settings')}>
                    <Settings size={14} /> 安全设置
                  </Dropdown.Item>
                  <Dropdown.Item id="logout" onAction={() => void handleLogout()}>
                    <LogOut size={14} /> 退出登录
                  </Dropdown.Item>
                </Dropdown.Section>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
        <Separator />
        <footer className="px-4 py-2 text-[11px] opacity-40">
          LicenseHub · 数据完全自持 · 建议开启双因素与每日备份
        </footer>
      </div>
    </div>
  );
}

export function TooltipHint({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Tooltip>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
