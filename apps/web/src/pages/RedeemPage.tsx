import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Dropdown, Input, Label, ListBox, Modal, Select, TextArea, TextField, toast,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import { Copy, Download, Plus, Ticket } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { Paginated, Plan, ProductRow } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatusChip, StatCard } from '@/components/common/ui';
import { formatDateTime } from '@/lib/format';

interface BatchRow {
  id: string;
  name: string;
  productId: string;
  productName: string;
  planId: string;
  planCode: string;
  quantity: number;
  usedCount: number;
  channel: string | null;
  notes: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface CodeRow {
  id: string;
  batchId: string;
  codeMasked: string;
  status: string;
  usedAt: string | null;
  usedByCustomerId: string | null;
  licenseId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function RedeemPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [codesPage, setCodesPage] = useState(1);

  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.get<Paginated<ProductRow>>('/api/admin/products' + qs({ pageSize: 100 })),
  });

  const batches = useQuery({
    queryKey: ['redeem-batches', page, pageSize],
    queryFn: () => api.get<Paginated<BatchRow>>('/api/admin/redeem/batches' + qs({ page, pageSize })),
  });

  const codes = useQuery({
    queryKey: ['redeem-codes', selectedBatch, codesPage],
    queryFn: () => api.get<Paginated<CodeRow>>('/api/admin/redeem/codes' + qs({ batchId: selectedBatch, page: codesPage, pageSize: 20 })),
    enabled: Boolean(selectedBatch),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['redeem-batches'] });
    void queryClient.invalidateQueries({ queryKey: ['redeem-codes'] });
  };

  const totalIssued = (batches.data?.items ?? []).reduce((sum, batch) => sum + batch.quantity, 0);
  const totalUsed = (batches.data?.items ?? []).reduce((sum, batch) => sum + batch.usedCount, 0);

  const batchColumns: Column<BatchRow>[] = [
    {
      id: 'name', label: '批次', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">{row.name}</span>
          <span className="text-[11px] opacity-50">
            {row.productName} · {row.planCode}
            {row.channel ? ' · ' + row.channel : ''}
          </span>
        </div>
      ),
    },
    {
      id: 'used', label: '已用 / 总数', align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {row.usedCount}
          <span className="opacity-45"> / {row.quantity}</span>
        </span>
      ),
    },
    { id: 'created', label: '创建时间', render: (row) => <span className="text-[11px] opacity-60">{formatDateTime(row.createdAt)}</span> },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onPress={() => { setSelectedBatch(row.id); setCodesPage(1); }}>查看卡密</Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              // 导出走浏览器下载，带上 Authorization 头需要用 fetch + blob
              void (async () => {
                try {
                  const accessToken = api.getTokens()?.accessToken ?? '';
                  const res = await fetch('/api/admin/redeem/batches/' + row.id + '/export', {
                    headers: { Authorization: 'Bearer ' + accessToken },
                  });
                  if (!res.ok) throw new Error('导出失败：' + res.status);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'redeem-' + row.name + '.csv';
                  link.click();
                  URL.revokeObjectURL(url);
                  toast.success('导出已开始（含明文卡密，请妥善保管）');
                } catch (error) {
                  toast.danger('导出失败', { description: error instanceof Error ? error.message : '' });
                }
              })();
            }}
          >
            <Download size={13} /> 导出
          </Button>
          <Dropdown>
            <Dropdown.Trigger className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5" aria-label="更多操作">
              更多
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu>
                <Dropdown.Item
                  id="void"
                  onAction={async () => {
                    if (!window.confirm('作废该批次中所有未使用的卡密？')) return;
                    try {
                      const res = await api.delete<{ voided: number }>('/api/admin/redeem/batches/' + row.id);
                      toast.success('已作废 ' + res.voided + ' 张未使用卡密');
                      refresh();
                    } catch (error) {
                      toast.danger('作废失败', { description: error instanceof Error ? error.message : '' });
                    }
                  }}
                >
                  作废未使用卡密
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      ),
    },
  ];

  const codeColumns: Column<CodeRow>[] = [
    { id: 'code', label: '卡密', isRowHeader: true, render: (row) => <span className="mono-code text-[12px]">{row.codeMasked}</span> },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
    { id: 'used', label: '使用时间', render: (row) => <span className="text-[11px] opacity-60">{row.usedAt ? formatDateTime(row.usedAt) : '—'}</span> },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => row.status === 'unused' ? (
        <Button
          size="sm"
          variant="danger-soft"
          onPress={async () => {
            if (!window.confirm('作废这张卡密？')) return;
            try {
              await api.post('/api/admin/redeem/codes/' + row.id + '/void', {});
              toast.success('已作废');
              refresh();
            } catch (error) {
              toast.danger('作废失败', { description: error instanceof Error ? error.message : '' });
            }
          }}
        >
          作废
        </Button>
      ) : null,
    },
  ];

  if (batches.error) return <ErrorNotice error={batches.error} onRetry={() => void batches.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="卡密管理"
        description="批量生成卡密用于淘宝/闲鱼/发卡网渠道，用户到门户自助兑换"
        actions={<CreateBatchModal products={products.data?.items ?? []} onDone={refresh} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="批次数" value={batches.data?.total ?? '—'} icon={<Ticket size={16} />} />
        <StatCard label="本页卡密总数" value={totalIssued} />
        <StatCard label="本页已兑换" value={totalUsed} tone="success" />
        <StatCard label="本页剩余" value={Math.max(0, totalIssued - totalUsed)} tone="warning" />
      </div>

      <DataTable
        ariaLabel="卡密批次"
        columns={batchColumns}
        items={batches.data?.items ?? []}
        isLoading={batches.isLoading}
        emptyTitle="还没有卡密批次"
        emptyDescription="点右上角「生成卡密」选择产品与策略，一次最多生成 5000 张。"
        footer={
          <Pagination page={page} pageSize={pageSize} total={batches.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
        }
      />

      <Modal isOpen={Boolean(selectedBatch)} onOpenChange={(open) => { if (!open) setSelectedBatch(null); }}>
        <Modal.Backdrop isDismissable variant="blur">
          <Modal.Container size="lg" placement="center" scroll="inside">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>批次卡密</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <DataTable
                  ariaLabel="卡密列表"
                  columns={codeColumns}
                  items={codes.data?.items ?? []}
                  isLoading={codes.isLoading}
                  emptyTitle="暂无卡密"
                  footer={
                    <Pagination page={codesPage} pageSize={20} total={codes.data?.total ?? 0}
                      onChange={(nextPage) => setCodesPage(nextPage)} />
                  }
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function CreateBatchModal({ products, onDone }: { products: ProductRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [productId, setProductId] = useState<Key | null>(null);
  const [planId, setPlanId] = useState<Key | null>(null);
  const [quantity, setQuantity] = useState('100');
  const [channel, setChannel] = useState('taobao');
  const [result, setResult] = useState<{ codes: string[]; batchName: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const plans = useQuery({
    queryKey: ['plans', productId],
    queryFn: () => api.get<Plan[]>('/api/admin/products/' + productId + '/plans'),
    enabled: Boolean(productId),
  });

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ codes: string[]; batch: { name: string } }>('/api/admin/redeem/batches', {
        name: name || 'batch-' + new Date().toISOString().slice(0, 10),
        productId: String(productId),
        planId: String(planId),
        quantity: Number(quantity),
        channel: channel || undefined,
      });
      setResult({ codes: res.codes, batchName: res.batch.name });
      toast.success('已生成 ' + res.codes.length + ' 张卡密');
      onDone();
    } catch (error) {
      toast.danger('生成失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setResult(null); }}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
        <Plus size={15} /> 生成卡密
      </Modal.Trigger>
      <Modal.Backdrop isDismissable={!result} variant="blur">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{result ? '卡密已生成' : '生成卡密批次'}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              {result ? (
                <>
                  <p className="text-sm">
                    批次 <strong>{result.batchName}</strong> 共 <strong>{result.codes.length}</strong> 张。
                    <span className="text-rose-500">明文仅此一次展示</span>，关闭后只能导出 CSV 获取。
                  </p>
                  <TextArea readOnly rows={10} value={result.codes.join('\n')} className="mono-code text-xs" />
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      onPress={() => {
                        void navigator.clipboard.writeText(result.codes.join('\n'));
                        toast.success('已复制全部卡密');
                      }}
                    >
                      <Copy size={14} /> 复制全部
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        const blob = new Blob([result.codes.join('\n')], { type: 'text/plain;charset=utf-8' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'redeem-' + result.batchName + '.txt';
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
                  <TextField name="name" value={name} onChange={setName} fullWidth>
                    <Label>批次名称</Label>
                    <Input placeholder="taobao-2026-09" />
                  </TextField>

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
                    <Label>兑换后发放的策略</Label>
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
                    <TextField name="quantity" value={quantity} onChange={setQuantity} isRequired fullWidth>
                      <Label>数量（最多 5000）</Label>
                      <Input inputMode="numeric" />
                    </TextField>
                    <TextField name="channel" value={channel} onChange={setChannel} fullWidth>
                      <Label>渠道（便于对账）</Label>
                      <Input placeholder="taobao / xianyu / faka" />
                    </TextField>
                  </div>
                </>
              )}
            </Modal.Body>
            {result ? null : (
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
                <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !productId || !planId}>
                  {busy ? '生成中…' : '生成卡密'}
                </Button>
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}