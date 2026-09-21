import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, Label, FieldError, TextField, toast } from '@heroui/react';
import { ShieldCheck } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    navigate('/admin', { replace: true });
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password, needsTotp ? totp : undefined);
      toast.success('登录成功');
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TWO_FACTOR_REQUIRED') {
        setNeedsTotp(true);
        setError('该账号已启用双因素，请输入认证器中的 6 位动态码');
      } else if (err instanceof ApiError && err.code === 'TWO_FACTOR_INVALID') {
        setNeedsTotp(true);
        setError('动态码不正确，请检查手机时间是否准确');
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('网络异常，请检查后端服务是否已启动');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-4 dark:from-neutral-950 dark:via-neutral-950 dark:to-brand-950">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-500 text-white shadow-lg">
            <ShieldCheck size={22} />
          </div>
          <h1 className="text-lg font-semibold">LicenseHub 控制台</h1>
          <p className="text-xs opacity-55">软件授权管理 · 个人运营</p>
        </div>

        <Card>
          <Card.Content>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <TextField
                name="email"
                type="email"
                value={email}
                onChange={setEmail}
                isRequired
                fullWidth
                isInvalid={Boolean(error) && !needsTotp}
              >
                <Label>邮箱</Label>
                <Input placeholder="admin@example.com" autoComplete="username" autoFocus />
              </TextField>

              <TextField
                name="password"
                type="password"
                value={password}
                onChange={setPassword}
                isRequired
                fullWidth
                isInvalid={Boolean(error) && !needsTotp}
              >
                <Label>密码</Label>
                <Input placeholder="••••••••" autoComplete="current-password" />
                <FieldError>{error ?? ''}</FieldError>
              </TextField>

              {needsTotp ? (
                <TextField
                  name="totp"
                  value={totp}
                  onChange={setTotp}
                  isRequired
                  fullWidth
                  isInvalid={Boolean(error)}
                >
                  <Label>动态验证码</Label>
                  <Input placeholder="6 位数字" inputMode="numeric" maxLength={6} autoFocus />
                  <FieldError>{error ?? ''}</FieldError>
                </TextField>
              ) : null}

              {error && !needsTotp ? (
                <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p>
              ) : null}
              {error && needsTotp ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">{error}</p>
              ) : null}

              <Button type="submit" variant="primary" fullWidth isDisabled={submitting}>
                {submitting ? '登录中…' : '登录'}
              </Button>
            </form>
          </Card.Content>
        </Card>

        <p className="mt-4 text-center text-[11px] opacity-40">
          首次部署使用 .env 中的 BOOTSTRAP_ADMIN_EMAIL / PASSWORD 登录，登录后请立即改密并开启双因素
        </p>
      </div>
    </div>
  );
}
