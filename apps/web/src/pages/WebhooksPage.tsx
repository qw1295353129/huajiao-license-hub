import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Input, Label, ListBox, Modal, Select, TextArea, TextField, toast,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import { Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { Paginated } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatusChip, Tag } from '@/components/common/ui';
import { formatDateTime } from '@/lib/format';

interface EndpointRow {
  id: string;
  url: string;
  description: string;
  secretMasked: string;
  events: string[];
  status: 'active' | 'disabled';
  createdAt: string;
  stats: { total: number; failed: number; pending: number };
}

interface DeliveryRow {
  id: string;
  endpointId: string;
  event: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  responseCode: number | null;
  error: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export function WebhooksPage() {
  const queryClient = useQueryClient();
  const [deliveriesPage, setDeliveriesPage] = useState(1);
  const [deliveryStatus, setDeliveryStatus] = useState<Key | null>(null);

  const endpoints = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get<EndpointRow[]>('/api/admin/webhooks'),
  });

  const catalog = useQuery({
    queryKey: ['webhook-events'],
    queryFn: () => api.get<{ events: string[] }>('/api/admin/webhooks/events'),
  });

  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', deliveriesPage, deliveryStatus],
    queryFn: () => api.get<Paginated<DeliveryRow>>('/api/admin/webhooks/deliveries' + qs({
      page: deliveriesPage, pageSize: 20, status: deliveryStatus ? String(deliveryStatus) : undefined,
    })),
  });

  const backlog = useQuery({
    queryKey: ['task-backlog'],
    queryFn: () => api.get<{ pendingWebhookDeliveries: number; licensesExpiringIn7Days: number }>('/api/admin/tasks/backlog'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    void queryClient.invalidateQueries({ queryKey: ['webhook-deliveries'] });
    void queryClient.invalidateQueries({ queryKey: ['task-backlog'] });
  };

  const endpointColumns: Column<EndpointRow>[] = [
    {
      id: 'url', label: '端点', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[12px] break-all">{row.url}</span>
          <span className="text-[11px] opacity-50">{row.description || '—'} · 密钥 {row.secretMasked}</span>
        </div>
      ),
    },
    {
      id: 'events', label: '订阅事件',
      render: (row) => (
        <div className="flex max-w-[260px] flex-wrap gap-1">
          {row.events.slice(0, 3).map((event) => <Tag key={event} color="accent">{event}</Tag>)}
          {row.events.length > 3 ? <Tag color="default">+{row.events.length - 3}</Tag> : null}
        </div>
      ),
    },
    {
      id: 'stats', label: '投递（成功/失败/待发）', align: 'right',
      render: (row) => (
        <span className="tabular-nums text-[12px]">
          {row.stats.total - row.stats.failed - row.stats.pending}
          <span className="text-rose-500"> / {row.stats.failed}</span>
          <span className="opacity-45"> / {row.stats.pending}</span>
        </span>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status === 'active' ? 'active' : 'archived'} /> },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onPress={async () => {
              try {
                const res = await api.post<{ ok: boolean; status: number | null; error?: string }>(
                  '/api/admin/webhooks/' + row.id + '/test', {});
                if (res.ok) toast.success('测试投递成功（HTTP ' + res.status + '）');
                else toast.danger('测试投递失败', { description: res.error ?? ('HTTP ' + res.status) });
                refresh();
              } catch (error) {
                toast.danger('测试失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            <Send size={13} /> 测试
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={async () => {
              try {
                await api.patch('/api/admin/webhooks/' + row.id, { status: row.status === 'active' ? 'disabled' : 'active' });
                toast.success(row.status === 'active' ? '已停用' : '已启用');
                refresh();
              } catch (error) {
                toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            {row.status === 'active' ? '停用' : '启用'}
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            onPress={async () => {
              if (!window.confirm('删除该 Webhook？投递记录会一并删除。')) return;
              try {
                await api.delete('/api/admin/webhooks/' + row.id);
                toast.success('已删除');
                refresh();
              } catch (error) {
                toast.danger('删除失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  const deliveryColumns: Column<DeliveryRow>[] = [
    { id: 'event', label: '事件', isRowHeader: true, render: (row) => <Tag color="accent">{row.event}</Tag> },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status === 'success' ? 'paid' : row.status === 'failed' ? 'revoked' : 'pending'} /> },
    {
      id: 'response', label: '响应',
      render: (row) => (
        <span className="text-[11px] opacity-60">
          {row.responseCode ? 'HTTP ' + row.responseCode : '—'}
          {row.error ? ' · ' + row.error.slice(0, 60) : ''}
        </span>
      ),
    },
    { id: 'attempts', label: '尝试', align: 'right', render: (row) => row.attempts },
    {
      id: 'time', label: '时间', align: 'right',
      render: (row) => (
        <span className="text-[11px] opacity-55">
          {formatDateTime(row.createdAt)}
          {row.status === 'pending' && row.nextRetryAt ? ' · 重试 ' + formatDateTime(row.nextRetryAt) : ''}
        </span>
      ),
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          onPress={async () => {
            try {
              const res = await api.post<{ ok: boolean }>('/api/admin/webhooks/deliveries/' + row.id + '/replay', {});
              if (res.ok) toast.success('重放成功');
              else toast.danger('重放失败');
              refresh();
            } catch (error) {
              toast.danger('重放失败', { description: error instanceof Error ? error.message : '' });
            }
          }}
        >
          <RefreshCw size={13} /> 重放
        </Button>
      ),
    },
  ];

  if (endpoints.error) return <ErrorNotice error={endpoints.error} onRetry={() => void endpoints.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Webhook"
        description="把授权与订单事件实时推送到你的飞书/钉钉/自建服务，HMAC 签名 + 失败退避重试"
        actions={<CreateWebhookModal events={catalog.data?.events ?? []} onDone={refresh} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><Card.Content>
          <p className="text-xs opacity-55">待投递</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{backlog.data?.pendingWebhookDeliveries ?? '—'}</p>
        </Card.Content></Card>
        <Card><Card.Content>
          <p className="text-xs opacity-55">7 天内到期授权</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{backlog.data?.licensesExpiringIn7Days ?? '—'}</p>
        </Card.Content></Card>
        <Card><Card.Content>
          <p className="text-xs opacity-55">端点数量</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{endpoints.data?.length ?? '—'}</p>
        </Card.Content></Card>
        <Card><Card.Content>
          <p className="text-xs opacity-55">失败投递</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-rose-500">
            {endpoints.data ? endpoints.data.reduce((sum, row) => sum + row.stats.failed, 0) : '—'}
          </p>
        </Card.Content></Card>
      </div>

      <DataTable
        ariaLabel="Webhook 端点"
        columns={endpointColumns}
        items={endpoints.data ?? []}
        isLoading={endpoints.isLoading}
        emptyTitle="还没有 Webhook"
        emptyDescription="添加一个接收地址，选择你关心的事件即可。"
      />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">投递日志</h2>
        <div className="flex items-center gap-2">
          <div className="w-36">
            <Select name="deliveryStatus" placeholder="全部状态" selectedKey={deliveryStatus}
              onSelectionChange={(key) => { setDeliveryStatus(key); setDeliveriesPage(1); }} fullWidth>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {['pending', 'success', 'failed'].map((value) => (
                    <ListBox.Item key={value} id={value} textValue={value}>{value}</ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onPress={async () => {
              try {
                const res = await api.post<{ requeued: number }>(
                  '/api/admin/webhooks/deliveries/replay-failed' + qs({}), {});
                toast.success('已重新入队 ' + res.requeued + ' 条失败投递');
                refresh();
              } catch (error) {
                toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            重放全部失败
          </Button>
        </div>
      </div>

      <DataTable
        ariaLabel="投递日志"
        columns={deliveryColumns}
        items={deliveries.data?.items ?? []}
        isLoading={deliveries.isLoading}
        emptyTitle="还没有投递记录"
        footer={
          <Pagination page={deliveriesPage} pageSize={20} total={deliveries.data?.total ?? 0}
            onChange={(nextPage) => setDeliveriesPage(nextPage)} />
        }
      />
    </div>
  );
}

function CreateWebhookModal({ events, onDone }: { events: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>(['license.created', 'license.activated', 'order.paid']);
  const [created, setCreated] = useState<{ secret: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ secret: string; endpoint: { url: string } }>('/api/admin/webhooks', {
        url, description, events: selected,
      });
      setCreated({ secret: res.secret, url: res.endpoint.url });
      toast.success('Webhook 已创建');
      onDone();
    } catch (error) {
      toast.danger('创建失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setCreated(null); }}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
        <Plus size={15} /> 添加 Webhook
      </Modal.Trigger>
      <Modal.Backdrop isDismissable={!created} variant="blur">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{created ? 'Webhook 已创建' : '添加 Webhook'}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              {created ? (
                <>
                  <p className="text-sm">
                    请把下面的签名密钥保存到你的接收端，用于校验 <code>X-LH-Signature</code>。
                    <span className="text-rose-500">密钥仅此一次展示。</span>
                  </p>
                  <TextArea readOnly rows={2} value={created.secret} className="mono-code text-xs" />
                  <div className="rounded-lg bg-black/5 p-3 text-[11px] leading-relaxed dark:bg-white/5">
                    <p className="font-medium">验签方法</p>
                    <p className="mono-code mt-1">signature = 'sha256=' + HMAC_SHA256(secret, timestamp + '.' + rawBody)</p>
                    <p className="mt-1 opacity-70">请求头：X-LH-Event / X-LH-Delivery / X-LH-Timestamp / X-LH-Signature</p>
                  </div>
                </>
              ) : (
                <>
                  <TextField name="url" value={url} onChange={setUrl} isRequired fullWidth>
                    <Label>接收地址</Label>
                    <Input placeholder="https://example.com/licensehub/webhook" />
                  </TextField>
                  <TextField name="description" value={description} onChange={setDescription} fullWidth>
                    <Label>备注</Label>
                    <Input placeholder="例如：飞书机器人" />
                  </TextField>
                  <div>
                    <p className="mb-1.5 text-xs opacity-60">订阅事件（点击切换）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {events.map((event) => {
                        const active = selected.includes(event);
                        return (
                          <button
                            key={event}
                            type="button"
                            onClick={() => setSelected(active ? selected.filter((item) => item !== event) : [...selected, event])}
                            className={
                              'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                              (active
                                ? 'border-brand-500 bg-brand-500/12 text-brand-500'
                                : 'border-black/10 opacity-60 hover:opacity-100 dark:border-white/15')
                            }
                          >
                            {event}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </Modal.Body>
            {created ? null : (
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
                <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !url || selected.length === 0}>
                  {busy ? '创建中…' : '创建'}
                </Button>
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}