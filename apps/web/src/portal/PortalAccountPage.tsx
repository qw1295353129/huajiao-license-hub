import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/animate-ui/components/buttons/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { portalApi } from '@/lib/api';
import { Loading, PageHeader } from '@/components/common/ui';
import { formatDateTime } from '@/lib/format';

export function PortalAccountPage() {
  const me = useQuery({
    queryKey: ['portal-me'],
    queryFn: () => portalApi.get<{ id: string; email: string; name: string; createdAt: string; licenseCount: number; orderCount: number }>('/api/portal/me'),
  });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);

  if (me.isLoading) return <Loading />;

  const saveName = async () => {
    setBusy(true);
    try {
      await portalApi.patch('/api/portal/me', { name });
      toast.success('已保存');
      await me.refetch();
    } catch (error) {
      toast.error('保存失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    setPwdBusy(true);
    try {
      const res = await portalApi.post<{ revokedSessions: number }>('/api/portal/me/password', {
        currentPassword,
        newPassword,
      });
      toast.success('密码已修改', { description: '已注销其它设备上的 ' + res.revokedSessions + ' 个会话' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (error) {
      toast.error('修改失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="账号" description="修改昵称与密码" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>账号信息</CardTitle>
            <CardDescription>
              注册于 {me.data ? formatDateTime(me.data.createdAt) : '—'} · 授权 {me.data?.licenseCount ?? 0} 个 · 订单 {me.data?.orderCount ?? 0} 笔
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 w-full">
                <Label>登录邮箱</Label>
                <Input name="email" value={me.data?.email ?? ''} readOnly />
              </div>
              <div className="flex flex-col gap-1.5 w-full">
                <Label>昵称</Label>
                <Input
                  name="name" value={name || me.data?.name || ''} onChange={(e) => setName(e.target.value)}
                  placeholder="怎么称呼你"
                />
              </div>
              <Button variant="default" size="sm" className="bg-primary text-primary-foreground" onClick={() => void saveName()} disabled={busy}>
                {busy ? '保存中…' : '保存昵称'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>修改密码</CardTitle>
            <CardDescription>修改后其它设备的登录会被注销</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 w-full">
                <Label>当前密码</Label>
                <Input
                  name="current" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="flex flex-col gap-1.5 w-full">
                <Label>新密码</Label>
                <Input
                  name="next" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 8 位，含字母与数字" autoComplete="new-password"
                />
              </div>
              <Button variant="secondary" size="sm" onClick={() => void savePassword()} disabled={pwdBusy}>
                修改密码
              </Button>
              <p className="text-[11px] opacity-50">
                忘记当前密码时：退出登录 → 登录页「忘记密码」→ 邮箱收取重置链接。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
