import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Input, Label, FieldError, TextField, toast } from '@/lib/heroui-compat';
import { Button } from '@/components/animate-ui/components/buttons/button';
import { ShieldCheck } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSiteName } from '@/lib/useSiteInfo';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const siteName = useSiteName();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/admin" replace />;

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
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-neutral-950 p-4">
      {/* 柔光斜切背景：右上 + 右下两道微光 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 78% 18%, rgba(180,185,195,0.18), transparent 62%),' +
            'radial-gradient(ellipse 55% 60% at 88% 88%, rgba(160,168,180,0.14), transparent 60%),' +
            'radial-gradient(ellipse 45% 40% at 55% 55%, rgba(90,95,110,0.10), transparent 70%),' +
            'linear-gradient(135deg, #0a0a0c 0%, #111116 42%, #1a1b21 68%, #25262d 100%)',
        }}
      />

      {/* 入场动画 */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.21, 0.47, 0.32, 0.98] }}
        className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-6"
      >
        {/* 图标 + 标题 */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 20, delay: 0.1 }}
          className="flex flex-col items-center gap-3"
        >
          <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-600/30">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{siteName} 控制台</h1>
        </motion.div>

        {/* 表单卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.45 }}
          className="w-full rounded-2xl border border-white/[0.06] bg-[#141418]/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-sm"
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <TextField name="email" type="email" value={email} onChange={setEmail} isRequired fullWidth>
              <Label className="text-sm text-neutral-200">邮箱</Label>
              <Input
                placeholder=""
                autoComplete="username"
                autoFocus
                className="h-11 rounded-xl border-white/[0.08] bg-[#1c1c22] text-white placeholder:text-neutral-500"
              />
            </TextField>

            <TextField name="password" type="password" value={password} onChange={setPassword} isRequired fullWidth>
              <Label className="text-sm text-neutral-200">密码</Label>
              <Input
                placeholder=""
                autoComplete="current-password"
                className="h-11 rounded-xl border-white/[0.08] bg-[#1c1c22] text-white placeholder:text-neutral-500"
              />
              <FieldError>{error && !needsTotp ? error : ''}</FieldError>
            </TextField>

            {needsTotp ? (
              <TextField name="totp" value={totp} onChange={setTotp} isRequired fullWidth>
                <Label className="text-sm text-neutral-200">动态验证码</Label>
                <Input
                  placeholder="6 位数字"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  className="h-11 rounded-xl border-white/[0.08] bg-[#1c1c22] text-white placeholder:text-neutral-500"
                />
                <FieldError>{error && needsTotp ? error : ''}</FieldError>
              </TextField>
            ) : null}

            {error && !needsTotp ? (
              <motion.p
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-400"
              >
                {error}
              </motion.p>
            ) : null}

            <Button
              type="submit"
              variant="secondary"
              size="lg"
              className="mt-1 h-11 w-full rounded-xl bg-white text-neutral-900 font-medium shadow-sm hover:bg-neutral-100"
              disabled={submitting}
            >
              {submitting ? '登录中…' : '登录'}
            </Button>
          </form>
        </motion.div>
      </motion.div>
    </div>
  );
}
