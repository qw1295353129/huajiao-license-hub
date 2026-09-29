import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/animate-ui/components/buttons/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/animate-ui/components/radix/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip, TooltipTrigger, TooltipContent,
} from '@/components/animate-ui/components/animate/tooltip';
import {
  BarChart3, Boxes, FileClock, Globe, KeyRound, KeySquare, LayoutDashboard, LogOut, Menu, Receipt, Settings,
  ShieldCheck, Ticket, Users, Webhook, X,
} from 'lucide-react';
import { ROLE_RANK, type AdminRole } from '@license-hub/shared';
import { useAuth } from '@/lib/auth';
import { useSiteName } from '@/lib/useSiteInfo';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** 仅 owner 可见 */
  ownerOnly?: boolean;
  /** 最低可见角色，默认 support（与后端 @Roles 对齐） */
  minRole?: AdminRole;
}

const NAV: NavItem[] = [
  { to: '/admin', label: '概览', icon: LayoutDashboard },
  { to: '/admin/products', label: '产品与策略', icon: Boxes },
  { to: '/admin/licenses', label: '授权管理', icon: KeyRound },
  { to: '/admin/customers', label: '客户', icon: Users },
  { to: '/admin/orders', label: '订单', icon: Receipt },
  { to: '/admin/redeem', label: '卡密', icon: Ticket },
  { to: '/admin/domains', label: '域名授权', icon: Globe },
  { to: '/admin/devices', label: '设备', icon: BarChart3 },
  { to: '/admin/api-keys', label: '接口密钥', icon: KeySquare },
  { to: '/admin/webhooks', label: 'Webhook', icon: Webhook },
  { to: '/admin/audit', label: '审计日志', icon: FileClock, minRole: 'admin' },
  { to: '/admin/settings', label: '设置', icon: Settings },
  { to: '/admin/team', label: '团队', icon: ShieldCheck, ownerOnly: true },
];

/** 按角色过滤导航：role 缺失时不过滤；与后端 RolesGuard 的 ROLE_RANK 规则一致。 */
function canAccessNav(item: NavItem, role?: AdminRole): boolean {
  if (!role) return true;
  if (item.ownerOnly) return role === 'owner';
  const min = item.minRole ?? 'support';
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const siteName = useSiteName();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const navItems = NAV.filter((item) => canAccessNav(item, user?.role));

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center gap-2 px-2 py-1">
        <div className="grid size-8 place-items-center rounded-lg bg-brand-500 font-bold text-white">L</div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">{siteName}</p>
          <p className="text-[11px] opacity-50">授权管理系统</p>
        </div>
      </div>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/admin'}
          onClick={() => setMobileOpen(false)}
          className={({ isActive }) =>
            'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ' +
            (isActive
              ? 'bg-violet-500/10 font-medium text-violet-600'
              : 'text-neutral-600 hover:bg-neutral-900/5 hover:text-neutral-900')
          }
        >
          <item.icon size={16} className="shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="relative flex h-full min-h-dvh bg-[#f4f4f6]">
      {/* 浅色柔光背景 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 45% at 85% 12%, rgba(255,255,255,0.9), transparent 60%),' +
            'radial-gradient(ellipse 50% 55% at 92% 92%, rgba(255,255,255,0.75), transparent 58%),' +
            'linear-gradient(135deg, #ebebf0 0%, #f2f2f5 45%, #f8f8fa 100%)',
        }}
      />

      {/* 桌面侧栏 */}
      <aside className="relative z-10 hidden w-56 shrink-0 border-r border-neutral-200/70 bg-white/70 backdrop-blur lg:block">
        {sidebar}
      </aside>

      {/* 移动端抽屉 */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60 bg-white shadow-xl">
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

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200/70 bg-white/70 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="打开菜单"
              className="px-0 lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={16} />
            </Button>
            <span className="text-sm opacity-50">个人运营控制台</span>
          </div>
          <DropdownMenu>
            {/* DropdownMenuTrigger 自身就是 <button>，再套 <Button> 会产生非法嵌套（浏览器会警告 + 行为异常） */}
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/8">
                <div className="relative flex size-6 shrink-0 overflow-hidden rounded-full">
                  <div className="flex size-full items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {(user?.name ?? 'A').slice(0, 1)}
                  </div>
                </div>
                <span className="hidden sm:inline">{user?.name ?? '未登录'}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled>
                {user?.email} · {user?.role}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate('/admin/settings')}>
                <Settings size={14} /> 安全设置
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleLogout()}>
                <LogOut size={14} /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
        <Separator />
        <footer className="px-4 py-2 text-[11px] opacity-40">
          {siteName} · 数据完全自持 · 建议开启双因素与每日备份
        </footer>
      </div>
    </div>
  );
}

export function TooltipHint({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}