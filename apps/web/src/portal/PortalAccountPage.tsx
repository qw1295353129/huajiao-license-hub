import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Input, Label, TextField, toast } from '@heroui/react';
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
      toast.danger('保存失败', { description: error instanceof Error ? error.message : '' });
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
      toast.danger('修改失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setPwdBusy(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="账号" description="修改昵称与密码" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>账号信息</Card.Title>
            <Card.Description>
              注册于 {me.data ? formatDateTime(me.data.createdAt) : '—'} · 授权 {me.data?.licenseCount ?? 0} 个 · 订单 {me.data?.orderCount ?? 0} 笔
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-4">
              <TextField name="email" value={me.data?.email ?? ''} isReadOnly fullWidth>
                <Label>登录邮箱</Label>
                <Input />
              </TextField>
              <TextField name="name" value={name || me.data?.name || ''} onChange={setName} fullWidth>
                <Label>昵称</Label>
                <Input placeholder="怎么称呼你" />
              </TextField>
              <Button variant="primary" size="sm" onPress={() => void saveName()} isDisabled={busy}>
                {busy ? '保存中…' : '保存昵称'}
              </Button>
            </div>
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>修改密码</Card.Title>
            <Card.Description>修改后其它设备的登录会被注销</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-4">
              <TextField name="current" type="password" value={currentPassword} onChange={setCurrentPassword} fullWidth>
                <Label>当前密码</Label>
                <Input autoComplete="current-password" />
              </TextField>
              <TextField name="next" type="password" value={newPassword} onChange={setNewPassword} fullWidth>
                <Label>新密码</Label>
                <Input placeholder="至少 8 位，含字母与数字" autoComplete="new-password" />
              </TextField>
              <Button variant="secondary" size="sm" onPress={() => void savePassword()} isDisabled={pwdBusy}>
                修改密码
              </Button>
              <p className="text-[11px] opacity-50">
                忘记当前密码时：退出登录 → 登录页「忘记密码」→ 邮箱收取重置链接。
              </p>
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}