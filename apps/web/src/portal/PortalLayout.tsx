import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/animate-ui/components/buttons/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Globe, KeyRound, LogOut, Receipt, Ticket, User } from 'lucide-react';
import { usePortalAuth } from '@/lib/auth';
import { useSiteName } from '@/lib/useSiteInfo';

const NAV = [
  { to: '/portal/licenses', label: '我的授权', icon: KeyRound },
  { to: '/portal/domains', label: '我的域名授权', icon: Globe },
  { to: '/portal/orders', label: '我的订单', icon: Receipt },
  { to: '/portal/redeem', label: '卡密兑换', icon: Ticket },
  { to: '/portal/account', label: '账号', icon: User },
];

export function PortalLayout() {
  const { user, logout } = usePortalAuth();
  const navigate = useNavigate();
  const siteName = useSiteName();

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f4f4f6]">
      {/* 浅色柔光背景 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 45% at 80% 15%, rgba(255,255,255,0.9), transparent 60%),' +
            'radial-gradient(ellipse 50% 55% at 90% 90%, rgba(255,255,255,0.75), transparent 58%),' +
            'linear-gradient(135deg, #ebebf0 0%, #f2f2f5 45%, #f8f8fa 100%)',
        }}
      />
      <div className="relative z-10">
      <header className="border-b border-neutral-200/70 bg-white/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">L</div>
            <span className="text-sm font-semibold">{siteName} 用户中心</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs opacity-60 sm:inline">{user?.email}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
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
                  ? 'bg-violet-500/10 font-medium text-violet-600'
                  : 'text-neutral-600 hover:bg-neutral-900/5 hover:text-neutral-900')
              }
            >
              <item.icon size={15} /> {item.label}
            </NavLink>
          ))}
        </nav>

        <Outlet />

        <Card className="text-center">
          <CardContent>
            <p className="text-xs opacity-55">
              遇到问题？把授权码前 4 位与问题描述发给客服，通常几分钟内可解决。
            </p>
          </CardContent>
        </Card>
        <Separator />
        <p className="pb-4 text-center text-[11px] opacity-40">
          {siteName} · 你的授权与订单数据由软件作者自行保管
        </p>
      </div>
      </div>
    </div>
  );
}