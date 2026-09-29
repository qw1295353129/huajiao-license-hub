import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
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
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#f4f4f6] p-4">
      {/* 浅色柔光斜切背景：右上 + 右下微光 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 78% 18%, rgba(255,255,255,0.95), transparent 62%),' +
            'radial-gradient(ellipse 55% 60% at 88% 88%, rgba(255,255,255,0.85), transparent 60%),' +
            'radial-gradient(ellipse 50% 45% at 30% 70%, rgba(228,228,235,0.7), transparent 70%),' +
            'linear-gradient(135deg, #e8e8ed 0%, #f0f0f4 40%, #f7f7f9 68%, #ffffff 100%)',
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
          <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-600/25">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{siteName} 控制台</h1>
        </motion.div>

        {/* 表单卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.45 }}
          className="w-full rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-xl shadow-neutral-200/60"
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5 w-full">
              <Label className="text-sm text-neutral-700">邮箱</Label>
              <Input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder=""
                autoComplete="username"
                autoFocus
                className="h-11 rounded-xl border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-400"
              />
            </div>

            <div className="flex flex-col gap-1.5 w-full">
              <Label className="text-sm text-neutral-700">密码</Label>
              <Input
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder=""
                autoComplete="current-password"
                className="h-11 rounded-xl border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-400"
              />
              {error && !needsTotp ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>

            {needsTotp ? (
              <div className="flex flex-col gap-1.5 w-full">
                <Label className="text-sm text-neutral-700">动态验证码</Label>
                <Input
                  name="totp"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  required
                  placeholder="6 位数字"
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  className="h-11 rounded-xl border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-400"
                />
                {error && needsTotp ? <p className="text-xs text-destructive">{error}</p> : null}
              </div>
            ) : null}

            {error && !needsTotp ? (
              <motion.p
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-500"
              >
                {error}
              </motion.p>
            ) : null}

            <Button
              type="submit"
              variant="default"
              size="lg"
              className="mt-1 h-11 w-full rounded-xl bg-neutral-900 font-medium text-white shadow-sm hover:bg-neutral-800"
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
