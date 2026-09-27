import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Chip, Input, Label, Separator, Switch, TextField, toast,
} from '@/lib/heroui-compat';
import { Copy, KeyRound, RefreshCw, ShieldCheck, ShieldOff, KeyRoundIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    {form.allowRegistration ? '允许' : '关闭'}
                  </Switch.Content>
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

        {/* 账户安全：双因素 + 修改密码 */}
        <Card>
          <Card.Header>
            <Card.Title>账户安全</Card.Title>
            <Card.Description>登录双因素验证与密码管理</Card.Description>
          </Card.Header>
          <Card.Content>
            <TwoFactorSection />
            <Separator className="my-4" />
            <PasswordSection />
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}

/* ---------- 双因素 TOTP ---------- */
function TwoFactorSection() {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState<'idle' | 'setup' | 'enable' | 'disable'>('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const enabled = user?.totpEnabled ?? false;

  const setup = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ secret: string; otpauthUri: string }>('/api/admin/auth/2fa/setup', {});
      setSecret(res.secret);
      setOtpauthUri(res.otpauthUri);
      setStep('enable');
      setCode('');
    } catch (error) {
      toast.danger('生成密钥失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    if (code.length !== 6) { toast.danger('请输入 6 位动态码'); return; }
    setBusy(true);
    try {
      await api.post('/api/admin/auth/2fa/enable', { code });
      toast.success('双因素已开启');
      setStep('idle');
      setCode('');
      await refreshUser();
    } catch (error) {
      toast.danger('启用失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!password) { toast.danger('请输入当前密码'); return; }
    if (code.length !== 6) { toast.danger('请输入 6 位动态码'); return; }
    setBusy(true);
    try {
      await api.post('/api/admin/auth/2fa/disable', { password, code });
      toast.success('双因素已关闭');
      setStep('idle');
      setPassword('');
      setCode('');
      await refreshUser();
    } catch (error) {
      toast.danger('关闭失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">双因素验证（TOTP）</p>
          <p className="text-[11px] opacity-55">登录时需输入认证器动态码，防盗号</p>
        </div>
        <Chip size="sm" variant="soft" color={enabled ? 'success' : 'default'}>
          <Chip.Label>{enabled ? '已开启' : '未开启'}</Chip.Label>
        </Chip>
      </div>

      {/* 未开启 → 开启流程 */}
      {!enabled && step === 'idle' && (
        <Button size="sm" variant="primary" onPress={() => void setup()} isDisabled={busy}>
          <ShieldCheck size={14} /> 开启双因素
        </Button>
      )}

      {step === 'setup' && <p className="text-xs opacity-60">生成密钥中…</p>}

      {step === 'enable' && (
        <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
          <p className="text-xs opacity-70">用 Google Authenticator / 1Password 等扫描或手动输入密钥：</p>
          <div className="flex items-center gap-2">
            <code className="mono-code flex-1 rounded bg-black/5 px-2 py-1 text-[11px] break-all dark:bg-white/5">{secret}</code>
            <Button size="sm" variant="ghost" onPress={() => { void navigator.clipboard.writeText(secret); toast.success('密钥已复制'); }}>
              <Copy size={13} />
            </Button>
          </div>
          {otpauthUri ? (
            <p className="text-[11px] opacity-50 break-all">otpauth URI：{otpauthUri}</p>
          ) : null}
          <TextField name="totpCode" value={code} onChange={setCode} fullWidth>
            <Label>输入认证器显示的 6 位动态码</Label>
            <Input inputMode="numeric" maxLength={6} placeholder="123456" />
          </TextField>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onPress={() => void enable()} isDisabled={busy}>
              确认开启
            </Button>
            <Button size="sm" variant="ghost" onPress={() => { setStep('idle'); setCode(''); }}>取消</Button>
          </div>
        </div>
      )}

      {/* 已开启 → 关闭流程 */}
      {enabled && step === 'idle' && (
        <Button size="sm" variant="danger-soft" onPress={() => { setStep('disable'); setPassword(''); setCode(''); }}>
          <ShieldOff size={14} /> 关闭双因素
        </Button>
      )}

      {enabled && step === 'disable' && (
        <div className="flex flex-col gap-2 rounded-lg border border-rose-500/30 p-3">
          <p className="text-xs text-rose-500">关闭后登录只需密码，请确认</p>
          <TextField name="disablePw" type="password" value={password} onChange={setPassword} fullWidth>
            <Label>当前密码</Label>
            <Input autoComplete="current-password" />
          </TextField>
          <TextField name="disableCode" value={code} onChange={setCode} fullWidth>
            <Label>认证器 6 位动态码</Label>
            <Input inputMode="numeric" maxLength={6} placeholder="123456" />
          </TextField>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onPress={() => void disable()} isDisabled={busy}>
              确认关闭
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setStep('idle')}>取消</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 修改密码 ---------- */
function PasswordSection() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const change = async () => {
    if (!oldPassword || !newPassword) { toast.danger('请填写完整'); return; }
    if (newPassword !== confirmPassword) { toast.danger('两次输入的新密码不一致'); return; }
    if (newPassword.length < 8) { toast.danger('新密码至少 8 位'); return; }
    setBusy(true);
    try {
      await api.post('/api/admin/auth/password', { currentPassword: oldPassword, newPassword });
      toast.success('密码已修改，其它会话已下线');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      toast.danger('修改失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">修改密码</p>
      <TextField name="oldPw" type="password" value={oldPassword} onChange={setOldPassword} fullWidth>
        <Label>当前密码</Label>
        <Input autoComplete="current-password" />
      </TextField>
      <TextField name="newPw" type="password" value={newPassword} onChange={setNewPassword} fullWidth>
        <Label>新密码（至少 8 位）</Label>
        <Input autoComplete="new-password" />
      </TextField>
      <TextField name="confirmPw" type="password" value={confirmPassword} onChange={setConfirmPassword} fullWidth>
        <Label>确认新密码</Label>
        <Input autoComplete="new-password" />
      </TextField>
      <Button size="sm" variant="primary" onPress={() => void change()} isDisabled={busy}>
        <KeyRoundIcon size={14} /> 修改密码
      </Button>
    </div>
  );
}
