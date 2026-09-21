import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Chip, Input, Label, ListBox, Modal, Select, TextField, toast,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import { Plus, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Loading, PageHeader, StatusChip } from '@/components/common/ui';
import { fromNow } from '@/lib/format';
import { useAuth } from '@/lib/auth';

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
          <Chip color={row.role === 'owner' ? 'accent' : row.role === 'admin' ? 'success' : 'default'} size="sm" variant="soft">
            <Chip.Label>{ROLE_LABEL[row.role]}</Chip.Label>
          </Chip>
          <span className="text-[11px] opacity-45">{ROLE_DESC[row.role]}</span>
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status === 'active' ? 'active' : 'archived'} /> },
    {
      id: 'security', label: '双因素',
      render: (row) => (row.totpEnabled
        ? <Chip color="success" size="sm" variant="soft"><Chip.Label>已开启</Chip.Label></Chip>
        : <Chip color="warning" size="sm" variant="soft"><Chip.Label>未开启</Chip.Label></Chip>),
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
          <Select
            name={'role-' + row.id}
            placeholder="角色"
            selectedKey={row.role}
            onSelectionChange={async (key) => {
              if (!key || key === row.role) return;
              try {
                await api.patch('/api/admin/auth/team/' + row.id, { role: String(key) });
                toast.success('角色已更新（对方需重新登录生效）');
                refresh();
              } catch (error) {
                toast.danger('更新失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
            isDisabled={row.id === user?.id}
            className="w-28"
          >
            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {(['owner', 'admin', 'support', 'readonly'] as const).map((role) => (
                  <ListBox.Item key={role} id={role} textValue={ROLE_LABEL[role]}>{ROLE_LABEL[role]}</ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Button
            size="sm"
            variant="ghost"
            onPress={async () => {
              if (!window.confirm('为该成员生成新的随机密码？其所有会话会被立即注销。')) return;
              try {
                const res = await api.post<{ password: string }>('/api/admin/auth/team/' + row.id + '/reset-password', {});
                void navigator.clipboard.writeText(res.password);
                toast.success('新密码已复制到剪贴板', { description: res.password, timeout: 0 });
              } catch (error) {
                toast.danger('重置失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            重置密码
          </Button>

          <Button
            size="sm"
            variant={row.status === 'active' ? 'danger-soft' : 'ghost'}
            isDisabled={row.id === user?.id}
            onPress={async () => {
              const next = row.status === 'active' ? 'disabled' : 'active';
              if (next === 'disabled' && !window.confirm('停用该成员？其会话会立即失效。')) return;
              try {
                await api.patch('/api/admin/auth/team/' + row.id, { status: next });
                toast.success(next === 'disabled' ? '已停用' : '已启用');
                refresh();
              } catch (error) {
                toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
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
        <Card><Card.Content>
          <p className="text-sm text-rose-500">无法访问：{message}</p>
          <p className="mt-2 text-xs opacity-60">团队管理仅限 owner 角色。</p>
        </Card.Content></Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="团队与角色"
        description="给协作者分配最小必要权限；客服只能查、不能改"
        actions={<InviteMemberModal onDone={refresh} />}
      />

      <DataTable
        ariaLabel="团队成员"
        columns={columns}
        items={team.data ?? []}
        emptyTitle="还没有成员"
      />

      <Card className="mt-4">
        <Card.Content>
          <div className="flex items-start gap-2 text-xs opacity-70">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            <div className="flex flex-col gap-1">
              <p>· 修改角色后，对方需要使用新令牌重新登录才会生效（旧令牌保留旧角色直到过期）。</p>
              <p>· 重置密码或停用账号会立即注销该成员的所有会话，access token 也立即失效。</p>
              <p>· 系统始终保留至少一个 owner；owner 不能停用或降级自己。</p>
              <p>· 建议所有成员开启双因素（设置 → 安全）。</p>
            </div>
          </div>
        </Card.Content>
      </Card>
    </div>
  );
}

function InviteMemberModal({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Key | null>('admin');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/auth/team', { email, name, password, role: String(role) });
      toast.success('成员已添加', { description: '请把初始密码线下告知对方，并提醒其立即修改' });
      setOpen(false);
      setEmail(''); setName(''); setPassword('');
      onDone();
    } catch (error) {
      toast.danger('添加失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
        <Plus size={15} /> 添加成员
      </Modal.Trigger>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="md" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>添加团队成员</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <TextField name="email" type="email" value={email} onChange={setEmail} isRequired fullWidth>
                <Label>邮箱</Label>
                <Input placeholder="teammate@example.com" />
              </TextField>
              <TextField name="name" value={name} onChange={setName} fullWidth>
                <Label>姓名</Label>
                <Input placeholder="小张" />
              </TextField>
              <TextField name="password" value={password} onChange={setPassword} isRequired fullWidth>
                <Label>初始密码</Label>
                <Input placeholder="至少 8 位，含字母与数字" />
              </TextField>
              <Select name="role" placeholder="选择角色" selectedKey={role} onSelectionChange={setRole} fullWidth>
                <Label>角色</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {(['admin', 'support', 'readonly', 'owner'] as const).map((item) => (
                      <ListBox.Item key={item} id={item} textValue={ROLE_LABEL[item]}>
                        {ROLE_LABEL[item]} · {ROLE_DESC[item]}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
              <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !email || password.length < 8}>
                {busy ? '添加中…' : '添加'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}