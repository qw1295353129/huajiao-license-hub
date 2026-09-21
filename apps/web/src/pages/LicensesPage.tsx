import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Chip, Dropdown, Input, Label, ListBox, Modal, Select, Switch, TextArea, TextField, toast,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import { Copy, Download, Eye, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { LicenseDetail, LicenseRow, LicenseStats, Paginated, Plan, ProductRow } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatCard, StatusChip, Tag } from '@/components/common/ui';
import { daysLeft, formatDateTime, fromNow } from '@/lib/format';
import { EVENT_LABEL, LICENSE_TYPE_LABEL, SOURCE_LABEL } from '@/lib/labels';

function copy(text: string, label = '已复制') {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.danger('复制失败，请手动选择'),
  );
}

export function LicensesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [productId, setProductId] = useState<Key | null>(null);
  const [status, setStatus] = useState<Key | null>(null);
  const [search, setSearch] = useState('');
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.get<Paginated<ProductRow>>('/api/admin/products' + qs({ pageSize: 100 })),
  });

  const stats = useQuery({
    queryKey: ['license-stats'],
    queryFn: () => api.get<LicenseStats>('/api/admin/licenses/stats'),
  });

  const list = useQuery({
    queryKey: ['licenses', page, pageSize, productId, status, search, onlyExpiring],
    queryFn: () => api.get<Paginated<LicenseRow>>('/api/admin/licenses' + qs({
      page, pageSize,
      productId: productId ? String(productId) : undefined,
      status: status ? String(status) : undefined,
      q: search || undefined,
      expiringInDays: onlyExpiring ? 7 : undefined,
    })),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['licenses'] });
    void queryClient.invalidateQueries({ queryKey: ['license-stats'] });
  };

  const productOptions = products.data?.items ?? [];

  const columns: Column<LicenseRow>[] = useMemo(() => [
    {
      id: 'key', label: '授权码', isRowHeader: true,
      render: (row) => (
        <button
          type="button"
          className="mono-code text-left text-[13px] hover:text-brand-500"
          title="点击查看明文（会记审计）"
          onClick={async () => {
            try {
              const res = await api.get<{ keyFormatted: string }>('/api/admin/licenses/' + row.id + '/reveal');
              copy(''.concat(res.keyFormatted), '授权码已复制到剪贴板');
            } catch (error) {
              toast.danger('无法查看', { description: error instanceof Error ? error.message : '' });
            }
          }}
        >
          {row.keyMasked}
        </button>
      ),
    },
    {
      id: 'product', label: '产品 / 策略',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[13px]">{row.productName}</span>
          <span className="text-[11px] opacity-50">
            {row.planName} · {LICENSE_TYPE_LABEL[row.licenseType]}
          </span>
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
    {
      id: 'owner', label: '归属',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[12px]">{row.customerEmail ?? '未绑定'}</span>
          <span className="text-[11px] opacity-45">{SOURCE_LABEL[row.source] ?? row.source}</span>
        </div>
      ),
    },
    {
      id: 'devices', label: '设备', align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {row.activationCount}
          <span className="opacity-45"> / {row.maxDevices || '∞'}</span>
        </span>
      ),
    },
    {
      id: 'expires', label: '到期', align: 'right',
      render: (row) => {
        if (!row.expiresAt) return <Tag color="accent">永久</Tag>;
        const days = daysLeft(row.expiresAt);
        const tone = days === null ? 'default' : days < 0 ? 'danger' : days <= 7 ? 'warning' : 'success';
        return (
          <div className="flex flex-col items-end">
            <span className="text-[12px] tabular-nums">{formatDateTime(row.expiresAt)}</span>
            <Chip color={tone} size="sm" variant="soft">
              <Chip.Label>{days === null ? '—' : days < 0 ? '已过期' : '剩 ' + days + ' 天'}</Chip.Label>
            </Chip>
          </div>
        );
      },
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onPress={() => setDetailId(row.id)}>详情</Button>
          <Dropdown>
            <Dropdown.Trigger
              className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5"
              aria-label="更多操作"
            >
              更多
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu>
                <Dropdown.Item id="extend" onAction={() => void extendLicense(row.id, 30, refresh)}>
                  <RefreshCw size={13} /> 延长 30 天
                </Dropdown.Item>
                <Dropdown.Item id="reset" onAction={() => void resetDevices(row.id, refresh)}>
                  <Trash2 size={13} /> 清空设备绑定
                </Dropdown.Item>
                <Dropdown.Item id="reissue" onAction={() => void reissue(row.id, refresh)}>
                  <KeyRound size={13} /> 换发新授权码
                </Dropdown.Item>
                <Dropdown.Item
                  id="suspend"
                  onAction={() => void transition(row.id, row.status === 'suspended' ? 'resume' : 'suspend', refresh)}
                >
                  {row.status === 'suspended' ? '恢复授权' : '暂停授权'}
                </Dropdown.Item>
                <Dropdown.Item id="revoke" onAction={() => void revokeWithConfirm(row.id, refresh)}>
                  <Trash2 size={13} /> 吊销授权
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      ),
    },
  ], []);

  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="授权管理"
        description="发码、状态流转、设备额度与到期管理"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                const url = '/api/admin/licenses/export' + qs({
                  productId: productId ? String(productId) : undefined,
                  status: status ? String(status) : undefined,
                  q: search || undefined,
                });
                window.open(url, '_blank');
                toast.info('导出已开始', { description: '默认不含明文授权码；需要明文请用「导出明文」' });
              }}
            >
              <Download size={14} /> 导出 CSV
            </Button>
            <BatchCreateModal products={productOptions} onDone={refresh} />
            <CreateLicenseModal products={productOptions} onDone={refresh} />
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="授权总数" value={stats.data?.total ?? '—'} />
        <StatCard label="有效授权" value={stats.data?.active ?? '—'} tone="success" />
        <StatCard label="7 天内到期" value={stats.data?.expiring7d ?? '—'} tone="warning" />
        <StatCard label="已吊销 / 封禁" value={stats.data?.revoked ?? '—'} tone="danger" />
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select
            name="product"
            placeholder="全部产品"
            selectedKey={productId}
            onSelectionChange={(key) => { setProductId(key); setPage(1); }}
            fullWidth
          >
            <Label>产品</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {productOptions.map((product) => (
                  <ListBox.Item key={product.id} id={product.id} textValue={product.name}>
                    {product.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className="w-40">
          <Select
            name="status"
            placeholder="全部状态"
            selectedKey={status}
            onSelectionChange={(key) => { setStatus(key); setPage(1); }}
            fullWidth
          >
            <Label>状态</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {['issued', 'active', 'expired', 'suspended', 'revoked', 'banned'].map((value) => (
                  <ListBox.Item key={value} id={value} textValue={value}>{value}</ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className="w-64">
          <TextField name="search" value={search} onChange={(value) => { setSearch(value); setPage(1); }} fullWidth>
            <Label>搜索</Label>
            <Input placeholder="邮箱 / 备注 / 粘贴完整授权码" />
          </TextField>
        </div>

        <div className="pb-2">
          <Switch isSelected={onlyExpiring} onChange={(value) => { setOnlyExpiring(value); setPage(1); }}>
            <Switch.Content>仅看 7 天内到期</Switch.Content>
          </Switch>
        </div>
      </div>

      <DataTable
        ariaLabel="授权列表"
        columns={columns}
        items={list.data?.items ?? []}
        isLoading={list.isLoading}
        emptyTitle="没有匹配的授权"
        emptyDescription="调整筛选条件，或点击右上角「新建授权 / 批量发码」。"
        footer={
          <Pagination
            page={page}
            pageSize={pageSize}
            total={list.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }}
          />
        }
      />

      <LicenseDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={refresh} />
    </div>
  );
}

/* ------------------------------------------------------------------ 行操作 */

async function transition(id: string, action: 'revoke' | 'suspend' | 'resume' | 'ban', refresh: () => void, reason?: string) {
  try {
    await api.post('/api/admin/licenses/' + id + '/' + action, reason ? { reason } : {});
    toast.success('状态已更新');
    refresh();
  } catch (error) {
    toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
  }
}

async function revokeWithConfirm(id: string, refresh: () => void) {
  if (!window.confirm('确认吊销这条授权？客户端将立即失效。')) return;
  await transition(id, 'revoke', refresh, '后台手工吊销');
}

async function extendLicense(id: string, days: number, refresh: () => void) {
  try {
    await api.post('/api/admin/licenses/' + id + '/extend', { days, reason: '后台延期' });
    toast.success('已延长 ' + days + ' 天');
    refresh();
  } catch (error) {
    toast.danger('延期失败', { description: error instanceof Error ? error.message : '' });
  }
}

async function resetDevices(id: string, refresh: () => void) {
  if (!window.confirm('清空该授权的全部设备绑定？用户需要在客户端重新激活。')) return;
  try {
    const res = await api.post<{ released: number }>('/api/admin/licenses/' + id + '/reset-devices', {});
    toast.success('已释放 ' + res.released + ' 台设备');
    refresh();
  } catch (error) {
    toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
  }
}

async function reissue(id: string, refresh: () => void) {
  if (!window.confirm('换发新授权码？旧码立即失效，已激活设备会被解绑。')) return;
  try {
    const res = await api.post<{ keyFormatted: string }>('/api/admin/licenses/' + id + '/reissue', {});
    copy(''.concat(res.keyFormatted), '新授权码已复制：' + res.keyFormatted);
    refresh();
  } catch (error) {
    toast.danger('换发失败', { description: error instanceof Error ? error.message : '' });
  }
}

/* ------------------------------------------------------------------ 新建授权 */

function useProductPlans(productId: string | null) {
  return useQuery({
    queryKey: ['plans', productId],
    queryFn: () => api.get<Plan[]>('/api/admin/products/' + productId + '/plans'),
    enabled: Boolean(productId),
  });
}

function CreateLicenseModal({ products, onDone }: { products: ProductRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<Key | null>(null);
  const [planId, setPlanId] = useState<Key | null>(null);
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [busy, setBusy] = useState(false);
  const plans = useProductPlans(productId ? String(productId) : null);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ keyFormatted: string }>('/api/admin/licenses', {
        productId: String(productId),
        planId: String(planId),
        ...(email ? { customerEmail: email } : {}),
        ...(notes ? { notes } : {}),
        ...(durationDays ? { durationDays: Number(durationDays) } : {}),
      });
      copy(''.concat(res.keyFormatted), '授权已创建，已复制：' + res.keyFormatted);
      setOpen(false);
      setEmail(''); setNotes(''); setDurationDays('');
      onDone();
    } catch (error) {
      toast.danger('创建失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
        <Plus size={15} /> 新建授权
      </Modal.Trigger>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="md" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>新建单个授权</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <Select name="product" placeholder="选择产品" selectedKey={productId}
                onSelectionChange={(key) => { setProductId(key); setPlanId(null); }} isRequired fullWidth>
                <Label>产品</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {products.map((product) => (
                      <ListBox.Item key={product.id} id={product.id} textValue={product.name}>{product.name}</ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <Select name="plan" placeholder={productId ? '选择策略' : '请先选择产品'} selectedKey={planId}
                onSelectionChange={setPlanId} isRequired fullWidth isDisabled={!productId}>
                <Label>授权策略</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {(plans.data ?? []).map((plan) => (
                      <ListBox.Item key={plan.id} id={plan.id} textValue={plan.name}>
                        {plan.name} · {LICENSE_TYPE_LABEL[plan.licenseType]}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <TextField name="email" value={email} onChange={setEmail} fullWidth>
                <Label>归属客户邮箱（可选）</Label>
                <Input placeholder="buyer@example.com" />
              </TextField>

              <TextField name="durationDays" value={durationDays} onChange={setDurationDays} fullWidth>
                <Label>覆盖有效期天数（可选）</Label>
                <Input placeholder="留空则使用策略默认值" inputMode="numeric" />
              </TextField>

              <TextField name="notes" value={notes} onChange={setNotes} fullWidth>
                <Label>备注</Label>
                <TextArea rows={2} placeholder="订单号 / 渠道 / 特殊说明" />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
              <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !productId || !planId}>
                {busy ? '创建中…' : '创建并复制授权码'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function BatchCreateModal({ products, onDone }: { products: ProductRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<Key | null>(null);
  const [planId, setPlanId] = useState<Key | null>(null);
  const [count, setCount] = useState('100');
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<{ keys: string[]; batchLabel: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const plans = useProductPlans(productId ? String(productId) : null);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ created: number; keys: string[]; batchLabel: string | null }>(
        '/api/admin/licenses/batch',
        {
          productId: String(productId),
          planId: String(planId),
          count: Number(count),
          ...(label ? { batchLabel: label } : {}),
        },
      );
      setResult({ keys: res.keys, batchLabel: res.batchLabel });
      toast.success('已生成 ' + res.created + ' 条授权');
      onDone();
    } catch (error) {
      toast.danger('批量生成失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setResult(null); }}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5">
        <KeyRound size={15} /> 批量发码
      </Modal.Trigger>
      <Modal.Backdrop isDismissable={!result} variant="blur">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{result ? '批量发码结果' : '批量发码'}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              {result ? (
                <>
                  <p className="text-sm">
                    已生成 <strong>{result.keys.length}</strong> 条授权，批次 <code>{result.batchLabel}</code>。
                    明文仅此一次展示，请立即导出保存。
                  </p>
                  <TextArea readOnly rows={10} value={result.keys.join('\n')} className="mono-code text-xs" />
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onPress={() => copy(result.keys.join('\n'), '已复制全部授权码')}>
                      <Copy size={14} /> 复制全部
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        const blob = new Blob([result.keys.join('\n')], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'licenses-' + (result.batchLabel ?? 'batch') + '.txt';
                        link.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download size={14} /> 下载 TXT
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Select name="product" placeholder="选择产品" selectedKey={productId}
                    onSelectionChange={(key) => { setProductId(key); setPlanId(null); }} fullWidth>
                    <Label>产品</Label>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {products.map((product) => (
                          <ListBox.Item key={product.id} id={product.id} textValue={product.name}>{product.name}</ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  <Select name="plan" placeholder="选择策略" selectedKey={planId} onSelectionChange={setPlanId}
                    fullWidth isDisabled={!productId}>
                    <Label>授权策略</Label>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {(plans.data ?? []).map((plan) => (
                          <ListBox.Item key={plan.id} id={plan.id} textValue={plan.name}>{plan.name}</ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  <div className="grid grid-cols-2 gap-3">
                    <TextField name="count" value={count} onChange={setCount} isRequired fullWidth>
                      <Label>数量（最多 5000）</Label>
                      <Input inputMode="numeric" />
                    </TextField>
                    <TextField name="label" value={label} onChange={setLabel} fullWidth>
                      <Label>批次名（可选）</Label>
                      <Input placeholder="taobao-2026-09" />
                    </TextField>
                  </div>
                </>
              )}
            </Modal.Body>
            {result ? null : (
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
                <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !productId || !planId}>
                  {busy ? '生成中…' : '生成'}
                </Button>
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 详情 */

function LicenseDetailModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useQuery({
    queryKey: ['license', id],
    queryFn: () => api.get<LicenseDetail>('/api/admin/licenses/' + id),
    enabled: Boolean(id),
  });

  return (
    <Modal isOpen={Boolean(id)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>授权详情</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              {detail.isLoading ? <p className="text-sm opacity-60">加载中…</p> : null}
              {detail.data ? (
                <>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <Field label="授权码" value={<span className="mono-code">{detail.data.keyMasked}</span>} />
                    <Field label="状态" value={<StatusChip status={detail.data.status} />} />
                    <Field label="产品" value={detail.data.productName} />
                    <Field label="策略" value={detail.data.planName + '（' + detail.data.planCode + '）'} />
                    <Field label="归属" value={detail.data.customerEmail ?? '未绑定'} />
                    <Field label="来源" value={SOURCE_LABEL[detail.data.source] ?? detail.data.source} />
                    <Field label="设备" value={detail.data.activationCount + ' / ' + (detail.data.maxDevices || '不限')} />
                    <Field label="到期" value={detail.data.expiresAt ? formatDateTime(detail.data.expiresAt) : '永久'} />
                    <Field label="最近心跳" value={fromNow(detail.data.lastVerifiedAt)} />
                    <Field label="备注" value={detail.data.notes ?? '—'} />
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {detail.data.featureKeys.length === 0
                      ? <span className="text-xs opacity-50">无功能点</span>
                      : detail.data.featureKeys.map((key) => <Tag key={key} color="accent">{key}</Tag>)}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={async () => {
                        try {
                          const res = await api.get<{ keyFormatted: string }>('/api/admin/licenses/' + id + '/reveal');
                          copy(''.concat(res.keyFormatted), '授权码已复制');
                        } catch (error) {
                          toast.danger('无法查看', { description: error instanceof Error ? error.message : '' });
                        }
                      }}
                    >
                      <Eye size={14} /> 查看并复制明文
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => void extendLicense(String(id), 30, () => { void detail.refetch(); onChanged(); })}>
                      <RefreshCw size={14} /> 延长 30 天
                    </Button>
                  </div>

                  <section>
                    <h3 className="mb-2 text-sm font-medium">生命周期事件</h3>
                    <ul className="flex flex-col gap-1.5">
                      {detail.data.events.map((event) => (
                        <li key={event.id} className="flex items-start justify-between gap-3 text-xs">
                          <span>
                            <Tag color="default">{EVENT_LABEL[event.type] ?? event.type}</Tag>
                            {event.message ? <span className="ml-2 opacity-70">{event.message}</span> : null}
                          </span>
                          <span className="shrink-0 opacity-45">
                            {event.actorLabel ?? event.actorType} · {formatDateTime(event.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
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

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs opacity-50">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
}