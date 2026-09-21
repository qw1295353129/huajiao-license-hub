import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label, Modal, TextField, toast } from '@heroui/react';
import { api, qs } from '@/lib/api';
import type { Paginated } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatusChip } from '@/components/common/ui';
import { formatDateTime, formatMoney, fromNow } from '@/lib/format';

interface CustomerRow {
  id: string;
  email: string;
  name: string;
  status: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  notes: string | null;
  createdAt: string;
  licenseCount: number;
  orderCount: number;
  paidCents: number;
}

interface CustomerDetail extends CustomerRow {
  licenses: { id: string; keyMasked: string; status: string; expiresAt: string | null; activationCount: number; maxDevices: number }[];
  orders: { id: string; orderNo: string; status: string; totalCents: number; currency: string; createdAt: string; paidAt: string | null }[];
}

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['customers', page, pageSize, search],
    queryFn: () => api.get<Paginated<CustomerRow>>('/api/admin/customers' + qs({ page, pageSize, q: search || undefined })),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['customer'] });
  };

  const columns: Column<CustomerRow>[] = [
    {
      id: 'email', label: '客户', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">{row.email}</span>
          <span className="text-[11px] opacity-50">{row.name}</span>
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
    { id: 'licenses', label: '授权', align: 'right', render: (row) => row.licenseCount },
    { id: 'orders', label: '订单', align: 'right', render: (row) => row.orderCount },
    { id: 'paid', label: '累计消费', align: 'right', render: (row) => <span className="tabular-nums">{formatMoney(row.paidCents)}</span> },
    {
      id: 'active', label: '最近登录',
      render: (row) => <span className="text-[11px] opacity-60">{row.lastLoginAt ? fromNow(row.lastLoginAt) : '从未登录'}</span>,
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onPress={() => setDetailId(row.id)}>详情</Button>
          <ResetPasswordButton customer={row} onDone={refresh} />
          <Button
            size="sm"
            variant={row.status === 'active' ? 'danger-soft' : 'ghost'}
            onPress={async () => {
              const action = row.status === 'active' ? 'block' : 'unblock';
              if (action === 'block' && !window.confirm('封禁该客户？其门户登录会被拒绝。')) return;
              try {
                await api.post('/api/admin/customers/' + row.id + '/' + action, {});
                toast.success(action === 'block' ? '已封禁' : '已解封');
                refresh();
              } catch (error) {
                toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            {row.status === 'active' ? '封禁' : '解封'}
          </Button>
        </div>
      ),
    },
  ];

  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader title="客户管理" description="买家账号、授权归属与消费记录" />
      <div className="mb-3 w-72">
        <TextField name="search" value={search} onChange={(value) => { setSearch(value); setPage(1); }} fullWidth>
          <Label>搜索</Label>
          <Input placeholder="邮箱 / 昵称" />
        </TextField>
      </div>

      <DataTable
        ariaLabel="客户列表"
        columns={columns}
        items={list.data?.items ?? []}
        isLoading={list.isLoading}
        emptyTitle="还没有客户"
        emptyDescription="客户会在注册门户账号、下单或兑换卡密时自动创建。"
        footer={
          <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
        }
      />

      <CustomerDetailModal id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function ResetPasswordButton({ customer, onDone }: { customer: CustomerRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      isDisabled={busy}
      onPress={async () => {
        if (!window.confirm('为该客户生成一个新的随机密码？')) return;
        setBusy(true);
        try {
          const res = await api.post<{ password?: string }>('/api/admin/customers/' + customer.id + '/reset-password', {});
          if (res.password) {
            void navigator.clipboard.writeText(res.password);
            toast.success('新密码已复制到剪贴板', { description: res.password, timeout: 0 });
          } else {
            toast.success('密码已重置');
          }
          onDone();
        } catch (error) {
          toast.danger('重置失败', { description: error instanceof Error ? error.message : '' });
        } finally {
          setBusy(false);
        }
      }}
    >
      重置密码
    </Button>
  );
}

function CustomerDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api.get<CustomerDetail>('/api/admin/customers/' + id),
    enabled: Boolean(id),
  });

  return (
    <Modal isOpen={Boolean(id)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>客户详情</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              {detail.isLoading ? <p className="text-sm opacity-60">加载中…</p> : null}
              {detail.data ? (
                <>
                  <div className="text-sm">
                    <p className="font-medium">{detail.data.email}</p>
                    <p className="text-xs opacity-55">
                      {detail.data.name} · 注册于 {formatDateTime(detail.data.createdAt)}
                      {detail.data.lastLoginAt ? ' · 最近登录 ' + fromNow(detail.data.lastLoginAt) : ''}
                    </p>
                  </div>

                  <section>
                    <h3 className="mb-2 text-sm font-medium">授权（{detail.data.licenses.length}）</h3>
                    {detail.data.licenses.length === 0 ? <p className="text-xs opacity-50">暂无授权</p> : (
                      <ul className="flex flex-col gap-1.5 text-xs">
                        {detail.data.licenses.map((license) => (
                          <li key={license.id} className="flex items-center justify-between gap-2">
                            <span className="mono-code">{license.keyMasked}</span>
                            <span className="opacity-55">
                              {license.expiresAt ? formatDateTime(license.expiresAt) : '永久'} · 设备 {license.activationCount}/{license.maxDevices || '∞'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-medium">订单（{detail.data.orders.length}）</h3>
                    {detail.data.orders.length === 0 ? <p className="text-xs opacity-50">暂无订单</p> : (
                      <ul className="flex flex-col gap-1.5 text-xs">
                        {detail.data.orders.map((order) => (
                          <li key={order.id} className="flex items-center justify-between gap-2">
                            <span className="mono-code">{order.orderNo}</span>
                            <span className="opacity-55">{formatMoney(order.totalCents, order.currency)} · {order.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
