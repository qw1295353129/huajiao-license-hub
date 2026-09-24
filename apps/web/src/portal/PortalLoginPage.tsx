import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, FieldError, Input, Label, TextField, toast } from '@heroui/react';
import { ShieldCheck } from 'lucide-react';
import { ApiError, portalApi } from '@/lib/api';
import { usePortalAuth } from '@/lib/auth';

export function PortalLoginPage() {
  const { user, login, register, refreshUser } = usePortalAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  if (user) return <Navigate to="/portal/licenses" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
        toast.success('登录成功');
        navigate('/portal/licenses', { replace: true });
      } else if (mode === 'register') {
        await register(email, password, name || undefined);
        toast.success('注册成功，已自动登录');
        navigate('/portal/licenses', { replace: true });
      } else {
        const res = await portalApi.post<{ ok: boolean; devToken?: string }>('/api/portal/auth/forgot-password', { email });
        if (res.devToken) {
          setDevResetUrl('/portal/reset-password?token=' + res.devToken);
          toast.info('本站未配置邮件服务，已直接给出重置链接');
        } else {
          toast.success('重置链接已发送到邮箱', { description: '30 分钟内有效，请检查收件箱与垃圾邮件' });
        }
        await refreshUser();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lh-auth-fields grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-500 text-white shadow-lg">
            <ShieldCheck size={22} />
          </div>
          <h1 className="text-lg font-semibold">用户中心</h1>
        </div>

        <Card>
          <Card.Content>
            <div className="mb-4 flex gap-1 rounded-lg bg-black/5 p-1 text-xs dark:bg-white/5">
              {(['login', 'register'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => { setMode(item); setError(null); }}
                  className={
                    'flex-1 rounded-md px-3 py-1.5 transition-colors ' +
                    (mode === item ? 'bg-white shadow-sm dark:bg-neutral-800' : 'opacity-60 hover:opacity-100')
                  }
                >
                  {item === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <TextField name="email" type="email" value={email} onChange={setEmail} isRequired fullWidth>
                <Label>邮箱</Label>
                <Input autoComplete="username" autoFocus />
              </TextField>

              {mode === 'register' ? (
                <TextField name="name" value={name} onChange={setName} fullWidth>
                  <Label>昵称（可选）</Label>
                  <Input placeholder="怎么称呼你" />
                </TextField>
              ) : null}

              {mode !== 'forgot' ? (
                <TextField name="password" type="password" value={password} onChange={setPassword} isRequired fullWidth isInvalid={Boolean(error)}>
                  <Label>密码</Label>
                  <Input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                  <FieldError>{error ?? ''}</FieldError>
                </TextField>
              ) : null}

              {error && mode === 'forgot' ? (
                <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p>
              ) : null}

              {devResetUrl ? (
                <a className="break-all rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 underline" href={devResetUrl}>
                  {devResetUrl}
                </a>
              ) : null}

              <Button type="submit" variant="primary" fullWidth isDisabled={busy}>
                {busy ? '处理中…' : mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '发送重置链接'}
              </Button>

              <button
                type="button"
                className="text-[11px] opacity-55 underline hover:opacity-80"
                onClick={() => { setMode(mode === 'forgot' ? 'login' : 'forgot'); setError(null); }}
              >
                {mode === 'forgot' ? '返回登录' : '忘记密码？'}
              </button>
            </form>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
