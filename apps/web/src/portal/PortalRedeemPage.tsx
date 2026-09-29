import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/animate-ui/components/buttons/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Ticket } from 'lucide-react';
import { ApiError, portalApi } from '@/lib/api';
import { PageHeader } from '@/components/common/ui';
import { formatLicenseKey } from '@license-hub/shared';

export function PortalRedeemPage() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ licenseKey: string; batchName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await portalApi.post<{ licenseKey: string; batchName: string }>('/api/portal/redeem', {
        code: formatLicenseKey(code),
      });
      setResult({ licenseKey: res.licenseKey, batchName: res.batchName });
      setCode('');
      toast.success('兑换成功');
      void queryClient.invalidateQueries({ queryKey: ['portal-licenses'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="卡密兑换" description="把购买的卡密兑换为正式授权" />
      <Card className="max-w-lg">
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5 w-full">
              <Label>卡密</Label>
              <Input
                name="code" value={code} onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX" autoFocus required
                aria-invalid={Boolean(error) || undefined}
                className={error ? 'mono-code border-destructive' : 'mono-code'}
              />
            </div>
            {error ? <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{error}</p> : null}
            {result ? (
              <div className="rounded-lg bg-emerald-500/10 px-3 py-3 text-xs">
                <p className="font-medium text-emerald-600">兑换成功（批次：{result.batchName}）</p>
                <p className="mono-code mt-1 select-all text-sm">{result.licenseKey}</p>
                <p className="mt-1 opacity-60">授权已出现在「我的授权」中，可直接填入软件激活窗口。</p>
              </div>
            ) : null}
            <Button type="submit" variant="default" className="bg-primary text-primary-foreground" disabled={busy || code.trim().length < 6}>
              <Ticket size={15} /> {busy ? '兑换中…' : '立即兑换'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
