import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, toast } from '@heroui/react';
import { ApiError, portalApi } from '@/lib/api';

/** 邮箱验证落地页：邮件链接 /portal/verify-email?token=… */
export function PortalVerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token || attempt < 0) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    portalApi
      .post<{ ok: true; claimedLicenses: number }>('/api/portal/auth/verify-email', { token })
      .then((res) => {
        if (cancelled) return;
        toast.success('邮箱已验证', {
          description: res.claimedLicenses > 0 ? '已认领 ' + res.claimedLicenses + ' 条历史授权' : undefined,
        });
        navigate('/portal/licenses', { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : '验证失败，请重新打开邮件链接');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt, navigate]);

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <Card.Header>
          <Card.Title>验证邮箱</Card.Title>
          <Card.Description>验证通过后可认领与该邮箱关联的订单与授权</Card.Description>
        </Card.Header>
        <Card.Content>
          {!token ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
              链接缺少令牌，请从邮件中重新打开
            </p>
          ) : error ? (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p>
          ) : (
            <p className="text-sm opacity-70">{busy ? '正在验证…' : '请稍候'}</p>
          )}
          <Button
            type="button"
            variant="primary"
            fullWidth
            className="mt-4"
            isDisabled={!token || busy}
            onPress={() => setAttempt((n) => n + 1)}
          >
            重试验证
          </Button>
        </Card.Content>
      </Card>
    </div>
  );
}
