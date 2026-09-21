import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button, Card, Separator, toast } from '@heroui/react';
import { KeyRound, LogOut, Receipt, Ticket, User } from 'lucide-react';
import { usePortalAuth } from '@/lib/auth';

const NAV = [
  { to: '/portal/licenses', label: '我的授权', icon: KeyRound },
  { to: '/portal/orders', label: '我的订单', icon: Receipt },
  { to: '/portal/redeem', label: '卡密兑换', icon: Ticket },
  { to: '/portal/account', label: '账号', icon: User },
];

export function PortalLayout() {
  const { user, logout } = usePortalAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50/60 to-white dark:from-neutral-950 dark:to-neutral-950">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur dark:border-white/8 dark:bg-white/3">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">L</div>
            <span className="text-sm font-semibold">LicenseHub 用户中心</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs opacity-60 sm:inline">{user?.email}</span>
            <Button
              size="sm"
              variant="ghost"
              onPress={async () => {
                await logout();
                toast.success('已退出登录');
                navigate('/portal', { replace: true });
              }}
            >
              <LogOut size={14} /> 退出
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
        <nav className="flex flex-wrap gap-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ' +
                (isActive
                  ? 'bg-brand-500/12 font-medium text-brand-500'
                  : 'opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5')
              }
            >
              <item.icon size={15} /> {item.label}
            </NavLink>
          ))}
        </nav>

        <Outlet />

        <Card className="text-center">
          <Card.Content>
            <p className="text-xs opacity-55">
              遇到问题？把授权码前 4 位与问题描述发给客服，通常几分钟内可解决。
            </p>
          </Card.Content>
        </Card>
        <Separator />
        <p className="pb-4 text-center text-[11px] opacity-40">
          LicenseHub · 你的授权与订单数据由软件作者自行保管
        </p>
      </div>
    </div>
  );
}
