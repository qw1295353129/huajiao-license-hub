import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Input, Label, TextField, toast } from '@heroui/react';
import { ApiError, portalApi } from '@/lib/api';

export function PortalResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await portalApi.post('/api/portal/auth/reset-password', { token, password });
      toast.success('密码已重置，请重新登录');
      navigate('/portal', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重置失败，请重新发起找回密码');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <Card.Header>
          <Card.Title>重置密码</Card.Title>
          <Card.Description>链接 30 分钟内有效，且只能使用一次</Card.Description>
        </Card.Header>
        <Card.Content>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <TextField name="password" type="password" value={password} onChange={setPassword} isRequired fullWidth isInvalid={Boolean(error)}>
              <Label>新密码</Label>
              <Input placeholder="至少 8 位，含字母与数字" autoFocus autoComplete="new-password" />
            </TextField>
            {error ? <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p> : null}
            {!token ? <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">链接缺少令牌，请重新发起找回密码</p> : null}
            <Button type="submit" variant="primary" fullWidth isDisabled={busy || !token || password.length < 8}>
              {busy ? '提交中…' : '确认重置'}
            </Button>
          </form>
        </Card.Content>
      </Card>
    </div>
  );
}
