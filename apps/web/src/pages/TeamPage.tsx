import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/animate-ui/components/buttons/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/animate-ui/components/radix/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Loading, PageHeader, StatusChip } from '@/components/common/ui';
import { fromNow } from '@/lib/format';
import { useAuth } from '@/lib/auth';

type Key = string | number;

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'support' | 'readonly';
  status: 'active' | 'disabled';
  totpEnabled: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
}

const ROLE_LABEL: Record<TeamMember['role'], string> = {
  owner: '所有者',
  admin: '管理员',
  support: '客服',
  readonly: '只读',
};

const ROLE_DESC: Record<TeamMember['role'], string> = {
  owner: '全部权限，含团队管理与密钥轮换',
  admin: '业务全权：产品、授权、订单、卡密、客户',
  support: '只读 + 日常查询',
  readonly: '仅只读',
};

export function TeamPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.get<TeamMember[]>('/api/admin/auth/team') });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['team'] });

  const columns: Column<TeamMember>[] = [
    {
      id: 'member', label: '成员', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">{row.name}</span>
          <span className="text-[11px] opacity-50">{row.email}</span>
        </div>
      ),
    },
    {
      id: 'role', label: '角色',
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <Badge
            variant="outline"
            className={
              (row.role === 'owner'
                ? 'bg-primary/15 text-primary'
                : row.role === 'admin'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-foreground') + ' text-[11px] px-2 py-0.5'
            }
          >
            {ROLE_LABEL[row.role]}
          </Badge>
          <span className="text-[11px] opacity-45">{ROLE_DESC[row.role]}</span>
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status === 'active' ? 'active' : 'archived'} /> },
    {
      id: 'security', label: '双因素',
      render: (row) => (row.totpEnabled
        ? <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] px-2 py-0.5">已开启</Badge>
        : <Badge variant="outline" className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[11px] px-2 py-0.5">未开启</Badge>),
    },
    {
      id: 'login', label: '最近登录',
      render: (row) => (
        <span className="text-[11px] opacity-60">
          {row.lastLoginAt ? fromNow(row.lastLoginAt) : '从未登录'}
          {row.lastLoginIp ? ' · ' + row.lastLoginIp : ''}
        </span>
      ),
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <div className="flex flex-col gap-1.5 w-28">
            <Select
              name={'role-' + row.id}
              value={row.role}
              disabled={row.id === user?.id}
              onValueChange={async (key) => {
                if (!key || key === row.role) return;
                try {
                  await api.patch('/api/admin/auth/team/' + row.id, { role: String(key) });
                  toast.success('角色已更新（对方需重新登录生效）');
                  refresh();
                } catch (error) {
                  toast.error('更新失败', { description: error instanceof Error ? error.message : '' });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="角色" />
              </SelectTrigger>
              <SelectContent>
                {(['owner', 'admin', 'support', 'readonly'] as const).map((role) => (
                  <SelectItem key={role} value={role}>{ROLE_LABEL[role]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!window.confirm('为该成员生成新的随机密码？其所有会话会被立即注销。')) return;
              try {
                const res = await api.post<{ password: string }>('/api/admin/auth/team/' + row.id + '/reset-password', {});
                void navigator.clipboard.writeText(res.password);
                toast.success('新密码已复制到剪贴板', { description: res.password, duration: Infinity });
              } catch (error) {
                toast.error('重置失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            重置密码
          </Button>

          <Button
            size="sm"
            variant={row.status === 'active' ? 'destructive' : 'ghost'}
            className={row.status === 'active' ? 'bg-destructive text-white' : undefined}
            disabled={row.id === user?.id}
            onClick={async () => {
              const next = row.status === 'active' ? 'disabled' : 'active';
              if (next === 'disabled' && !window.confirm('停用该成员？其会话会立即失效。')) return;
              try {
                await api.patch('/api/admin/auth/team/' + row.id, { status: next });
                toast.success(next === 'disabled' ? '已停用' : '已启用');
                refresh();
              } catch (error) {
                toast.error('操作失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            {row.status === 'active' ? '停用' : '启用'}
          </Button>
        </div>
      ),
    },
  ];

  if (team.isLoading) return <Loading label="正在加载团队成员…" />;
  if (team.error) {
    const message = team.error instanceof Error ? team.error.message : '';
    return (
      <div className="animate-fade-in">
        <PageHeader title="团队与角色" />
        <Card><CardContent>
          <p className="text-sm text-rose-500">无法访问：{message}</p>
          <p className="mt-2 text-xs opacity-60">团队管理仅限 owner 角色。</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="团队与角色"
        description="给协作者分配最小必要权限；客服只能查、不能改"
        actions={user?.role === 'owner' ? <InviteMemberModal onDone={refresh} /> : null}
      />

      <DataTable
        ariaLabel="团队成员"
        columns={columns}
        items={team.data ?? []}
        emptyTitle="还没有成员"
      />

      <Card className="mt-4">
        <CardContent>
          <div className="flex items-start gap-2 text-xs opacity-70">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
              <p>· 修改角色后，对方需要使用新令牌重新登录才会生效（旧令牌保留旧角色直到过期）。</p>
              <p>· 重置密码或停用账号会立即注销该成员的所有会话，access token 也立即失效。</p>
              <p>· 系统始终保留至少一个 owner；owner 不能停用或降级自己。</p>
              <p>· 建议所有成员开启双因素（设置 → 安全）。</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InviteMemberModal({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Key | null>('admin');
  const [busy, setBusy] = useState(false);

  // 邀请与角色分配仅限 owner（后端 @Roles('owner') 的前端对齐）
  if (user?.role !== 'owner') return null;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/auth/team', { email, name, password, role: String(role) });
      toast.success('成员已添加', { description: '请把初始密码线下告知对方，并提醒其立即修改' });
      setOpen(false);
      setEmail(''); setName(''); setPassword('');
      onDone();
    } catch (error) {
      toast.error('添加失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
          <Plus size={15} /> 添加成员
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加团队成员</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5 w-full">
            <Label>邮箱</Label>
            <Input
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 w-full">
            <Label>姓名</Label>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="小张"
            />
          </div>
          <div className="flex flex-col gap-1.5 w-full">
            <Label>初始密码</Label>
            <Input
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位，含字母与数字"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 w-full">
            <Label>角色</Label>
            <Select
              name="role"
              value={role != null ? String(role) : ''}
              onValueChange={(v) => setRole(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                {(['admin', 'support', 'readonly', 'owner'] as const).map((item) => (
                  <SelectItem key={item} value={item}>{ROLE_LABEL[item]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
          <Button
            variant="default"
            className="bg-primary text-primary-foreground"
            onClick={() => void submit()}
            disabled={busy || !email || password.length < 8}
          >
            {busy ? '添加中…' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
