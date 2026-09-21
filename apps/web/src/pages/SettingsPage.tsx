import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Chip, Input, Label, Separator, Switch, TextField, toast,
} from '@heroui/react';
import { Copy, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorNotice, Loading, PageHeader, Tag } from '@/components/common/ui';
import { formatDateTime } from '@/lib/format';

interface SiteSettings {
  siteName: string;
  allowRegistration: boolean;
  defaultCurrency: string;
  trialDays: number;
  selfUnbindPer30d: number;
  expireReminderDays: number[];
}

interface SigningKey {
  kid: string;
  algo: string;
  publicKey: string;
  status: 'active' | 'retired';
  createdAt: string;
  rotatedAt: string | null;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SiteSettings>('/api/admin/settings') });
  const keys = useQuery({ queryKey: ['signing-keys'], queryFn: () => api.get<SigningKey[]>('/api/admin/signing-keys') });

  const [form, setForm] = useState<SiteSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  if (settings.isLoading || !form) return <Loading />;
  if (settings.error) return <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />;

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/api/admin/settings', form);
      toast.success('设置已保存');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    } catch (error) {
      toast.danger('保存失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const activeKey = keys.data?.find((key) => key.status === 'active');

  return (
    <div className="animate-fade-in">
      <PageHeader title="系统设置" description="站点信息、注册策略与授权签名密钥" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Card.Header>
            <Card.Title>站点设置</Card.Title>
            <Card.Description>影响门户展示与默认策略</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="flex flex-col gap-4">
              <TextField name="siteName" value={form.siteName} onChange={(value) => setForm({ ...form, siteName: value })} fullWidth>
                <Label>站点名称</Label>
                <Input placeholder="LicenseHub" />
              </TextField>

              <div className="grid grid-cols-2 gap-3">
                <TextField name="trialDays" value={String(form.trialDays)}
                  onChange={(value) => setForm({ ...form, trialDays: Number(value) || 0 })} fullWidth>
                  <Label>默认试用天数</Label>
                  <Input inputMode="numeric" />
                </TextField>
                <TextField name="selfUnbind" value={String(form.selfUnbindPer30d)}
                  onChange={(value) => setForm({ ...form, selfUnbindPer30d: Number(value) || 0 })} fullWidth>
                  <Label>自助解绑次数 / 30 天</Label>
                  <Input inputMode="numeric" />
                </TextField>
              </div>

              <TextField name="reminder" value={form.expireReminderDays.join(',')}
                onChange={(value) => setForm({
                  ...form,
                  expireReminderDays: value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item > 0),
                })} fullWidth>
                <Label>到期提醒（提前天数，逗号分隔）</Label>
                <Input placeholder="7,3,1" />
              </TextField>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">开放自助注册</p>
                  <p className="text-[11px] opacity-55">关闭后只能由管理员创建客户账号</p>
                </div>
                <Switch isSelected={form.allowRegistration} onChange={(value) => setForm({ ...form, allowRegistration: value })}>
                  <Switch.Content>{form.allowRegistration ? '允许' : '关闭'}</Switch.Content>
                </Switch>
              </div>

              <Button variant="primary" size="sm" onPress={() => void save()} isDisabled={busy}>
                {busy ? '保存中…' : '保存设置'}
              </Button>
            </div>
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>授权签名密钥（Ed25519）</Card.Title>
            <Card.Description>客户端内置公钥即可离线验签；轮换后旧公钥仍能验证历史授权文件</Card.Description>
          </Card.Header>
          <Card.Content>
            {keys.isLoading ? <p className="text-sm opacity-60">加载中…</p> : null}
            {activeKey ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Chip color="success" size="sm" variant="soft"><Chip.Label>当前签发密钥</Chip.Label></Chip>
                  <span className="mono-code text-xs">{activeKey.kid}</span>
                </div>
                <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
                  <p className="mb-1 text-[11px] opacity-60">公钥（内置到客户端）</p>
                  <p className="mono-code break-all text-[11px]">{activeKey.publicKey}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2"
                    onPress={() => {
                      void navigator.clipboard.writeText(activeKey.publicKey);
                      toast.success('公钥已复制');
                    }}
                  >
                    <Copy size={13} /> 复制公钥
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm opacity-60">尚未生成签名密钥。</p>
            )}

            <Separator className="my-4" />

            <div className="flex flex-wrap gap-2">
              {!activeKey ? (
                <Button
                  size="sm"
                  variant="primary"
                  onPress={async () => {
                    try {
                      const res = await api.post<{ kid: string; publicKey?: string }>('/api/admin/signing-keys/create', {});
                      toast.success('已生成签名密钥 ' + res.kid, { description: res.publicKey, timeout: 0 });
                      void queryClient.invalidateQueries({ queryKey: ['signing-keys'] });
                    } catch (error) {
                      toast.danger('生成失败', { description: error instanceof Error ? error.message : '' });
                    }
                  }}
                >
                  <KeyRound size={14} /> 生成密钥
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="danger-soft"
                  onPress={async () => {
                    if (!window.confirm('轮换签名密钥？新签发的授权文件将使用新密钥；旧授权文件仍可用旧公钥验签。')) return;
                    try {
                      const res = await api.post<{ current: { kid: string; publicKey: string } }>('/api/admin/signing-keys/rotate', {});
                      toast.success('已轮换到 ' + res.current.kid, { description: res.current.publicKey, timeout: 0 });
                      void queryClient.invalidateQueries({ queryKey: ['signing-keys'] });
                    } catch (error) {
                      toast.danger('轮换失败', { description: error instanceof Error ? error.message : '' });
                    }
                  }}
                >
                  <RefreshCw size={14} /> 轮换密钥
                </Button>
              )}
            </div>

            {(keys.data ?? []).length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1.5 text-[11px]">
                {(keys.data ?? []).map((key) => (
                  <li key={key.kid} className="flex items-center justify-between gap-2">
                    <span className="mono-code">{key.kid}</span>
                    <span className="flex items-center gap-2 opacity-60">
                      <Tag color={key.status === 'active' ? 'success' : 'default'}>{key.status}</Tag>
                      {formatDateTime(key.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
