import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Label, ListBox, Select, toast } from '@heroui/react';
import type { Key } from '@heroui/react';
import { ShieldOff } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { ActivationRow, Paginated } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatusChip, Tag } from '@/components/common/ui';
import { formatDateTime, fromNow } from '@/lib/format';

interface DeviceRow {
  id: string;
  fingerprintHash: string;
  productId: string | null;
  os: string | null;
  appVersion: string | null;
  name: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastIp: string | null;
  blacklisted: boolean;
  blacklistReason: string | null;
}

export function DevicesPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'activations' | 'devices'>('activations');
  const [status, setStatus] = useState<Key | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const activations = useQuery({
    queryKey: ['activations', status, page, pageSize],
    queryFn: () => api.get<Paginated<ActivationRow>>('/api/admin/activations' + qs({
      status: status ? String(status) : undefined, page, pageSize,
    })),
    enabled: tab === 'activations',
  });

  const devices = useQuery({
    queryKey: ['devices', page, pageSize],
    queryFn: () => api.get<Paginated<DeviceRow>>('/api/admin/devices' + qs({ page, pageSize })),
    enabled: tab === 'devices',
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['activations'] });
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
  };

  const activationColumns: Column<ActivationRow>[] = [
    {
      id: 'key', label: '授权码', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="mono-code text-[12px]">{row.keyMasked}</span>
          <span className="text-[11px] opacity-50">{row.productName}</span>
        </div>
      ),
    },
    {
      id: 'device', label: '设备',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[12px]">{row.os ?? '未知系统'} · {row.appVersion ?? '—'}</span>
          <span className="text-[11px] opacity-45">{row.ip ?? '—'}</span>
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
    { id: 'lastSeen', label: '最近活跃', render: (row) => <span className="text-[11px] opacity-60">{fromNow(row.lastSeenAt)}</span> },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.status === 'pending' ? (
            <Button
              size="sm"
              variant="primary"
              onPress={async () => {
                try {
                  await api.post('/api/admin/activations/' + row.id + '/approve', {});
                  toast.success('已批准该设备');
                  refresh();
                } catch (error) {
                  toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
                }
              }}
            >
              批准
            </Button>
          ) : null}
          {row.status === 'active' ? (
            <Button
              size="sm"
              variant="danger-soft"
              onPress={async () => {
                if (!window.confirm('强制解绑该设备？')) return;
                try {
                  await api.delete('/api/admin/activations/' + row.id);
                  toast.success('已解绑');
                  refresh();
                } catch (error) {
                  toast.danger('解绑失败', { description: error instanceof Error ? error.message : '' });
                }
              }}
            >
              解绑
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const deviceColumns: Column<DeviceRow>[] = [
    {
      id: 'hash', label: '设备指纹（哈希）', isRowHeader: true,
      render: (row) => <span className="mono-code text-[11px]">{row.fingerprintHash.slice(0, 24)}…</span>,
    },
    {
      id: 'info', label: '信息',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[12px]">{row.name ?? row.os ?? '未知设备'}</span>
          <span className="text-[11px] opacity-45">{row.lastIp ?? '—'} · 首次 {formatDateTime(row.firstSeenAt)}</span>
        </div>
      ),
    },
    { id: 'lastSeen', label: '最近活跃', render: (row) => <span className="text-[11px] opacity-60">{fromNow(row.lastSeenAt)}</span> },
    {
      id: 'blacklist', label: '黑名单',
      render: (row) => (row.blacklisted ? <Tag color="danger">{row.blacklistReason ?? '已封禁'}</Tag> : <Tag color="default">正常</Tag>),
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant={row.blacklisted ? 'ghost' : 'danger-soft'}
          onPress={async () => {
            if (!row.blacklisted && !window.confirm('封禁该设备？其所有授权会被立即解绑。')) return;
            try {
              await api.post('/api/admin/devices/' + row.id + '/blacklist', {
                blacklisted: !row.blacklisted,
                reason: row.blacklisted ? undefined : '人工封禁',
              });
              toast.success(row.blacklisted ? '已解封' : '已封禁');
              refresh();
            } catch (error) {
              toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
            }
          }}
        >
          <ShieldOff size={13} /> {row.blacklisted ? '解封' : '封禁'}
        </Button>
      ),
    },
  ];

  const active = tab === 'activations' ? activations : devices;

  if (active.error) return <ErrorNotice error={active.error} onRetry={() => void active.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader title="设备管理" description="设备绑定、人工审批、强制解绑与硬件黑名单" />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-black/5 p-1 text-xs dark:bg-white/5">
          {([['activations', '绑定记录'], ['devices', '设备注册表']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setTab(value); setPage(1); }}
              className={
                'rounded-md px-3 py-1.5 transition-colors ' +
                (tab === value ? 'bg-white shadow-sm dark:bg-neutral-800' : 'opacity-60 hover:opacity-100')
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'activations' ? (
          <div className="w-40">
            <Select name="status" placeholder="全部状态" selectedKey={status}
              onSelectionChange={(key) => { setStatus(key); setPage(1); }} fullWidth>
              <Label>状态</Label>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {['pending', 'active', 'deactivated', 'blocked'].map((value) => (
                    <ListBox.Item key={value} id={value} textValue={value}>{value}</ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        ) : null}
      </div>

      {tab === 'activations' ? (
        <DataTable
          ariaLabel="设备绑定记录"
          columns={activationColumns}
          items={activations.data?.items ?? []}
          isLoading={activations.isLoading}
          emptyTitle="还没有设备激活记录"
          emptyDescription="客户端调用 /api/v1/activate 后会出现在这里。"
          footer={
            <Pagination page={page} pageSize={pageSize} total={activations.data?.total ?? 0}
              onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
          }
        />
      ) : (
        <DataTable
          ariaLabel="设备注册表"
          columns={deviceColumns}
          items={devices.data?.items ?? []}
          isLoading={devices.isLoading}
          emptyTitle="还没有设备"
          footer={
            <Pagination page={page} pageSize={pageSize} total={devices.data?.total ?? 0}
              onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
          }
        />
      )}

      <Card className="mt-4">
        <Card.Content>
          <p className="text-xs opacity-60">
            设备指纹只以 HMAC 哈希形式存储，无法反推原始硬件信息；封禁设备会同时解绑它在所有授权上的绑定。
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}