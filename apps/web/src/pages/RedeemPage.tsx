import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/animate-ui/components/buttons/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/animate-ui/components/radix/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Copy, Download, Plus, Ticket, Trash2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { Paginated, Plan, ProductRow } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatusChip, StatCard } from '@/components/common/ui';
import { formatDateTime } from '@/lib/format';

type Key = string | number;

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
          <Button size="sm" variant="ghost" onClick={() => { setSelectedBatch(row.id); setCodesPage(1); }}>查看卡密</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
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
                  toast.error('导出失败', { description: error instanceof Error ? error.message : '' });
                }
              })();
            }}
          >
            <Download size={13} /> 导出
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="bg-destructive text-white"
            onClick={async () => {
              if (!window.confirm('作废批次「' + row.name + '」中所有未使用的卡密？已兑换的不受影响。')) return;
              try {
                const res = await api.delete<{ voided: number }>('/api/admin/redeem/batches/' + row.id);
                toast.success('已作废 ' + res.voided + ' 张未使用卡密');
                refresh();
              } catch (error) {
                toast.error('作废失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            <Trash2 size={13} /> 作废
          </Button>
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
          variant="destructive"
          className="bg-destructive text-white"
          onClick={async () => {
            if (!window.confirm('作废这张卡密？')) return;
            try {
              await api.post('/api/admin/redeem/codes/' + row.id + '/void', {});
              toast.success('已作废');
              refresh();
            } catch (error) {
              toast.error('作废失败', { description: error instanceof Error ? error.message : '' });
            }
          }}
        >
          <Trash2 size={13} /> 作废
        </Button>
      ) : (
        <span className="text-[11px] opacity-40">—</span>
      ),
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

      <Dialog open={Boolean(selectedBatch)} onOpenChange={(open) => { if (!open) setSelectedBatch(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>批次卡密</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
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
          </div>
        </DialogContent>
      </Dialog>
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
      toast.error('生成失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setResult(null); }}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
          <Plus size={15} /> 生成卡密
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{result ? '卡密已生成' : '生成卡密批次'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          {result ? (
            <>
              <p className="text-sm">
                批次 <strong>{result.batchName}</strong> 共 <strong>{result.codes.length}</strong> 张。
                <span className="text-rose-500">明文仅此一次展示</span>，关闭后只能导出 CSV 获取。
              </p>
              <Textarea readOnly rows={10} value={result.codes.join('\n')} className="mono-code text-xs" />
              <div className="flex gap-2">
                <Button
                  variant="default"
                  className="bg-primary text-primary-foreground"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.codes.join('\n'));
                    toast.success('已复制全部卡密');
                  }}
                >
                  <Copy size={14} /> 复制全部
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
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
              <div className="flex flex-col gap-1.5 w-full">
                <Label>批次名称</Label>
                <Input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="taobao-2026-09" />
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <Label>产品</Label>
                <Select name="product" value={productId != null ? String(productId) : ''}
                  onValueChange={(key) => { setProductId(key); setPlanId(null); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择产品" /></SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={String(product.id)}>{product.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <Label>兑换后发放的策略</Label>
                <Select name="plan" value={planId != null ? String(planId) : ''}
                  onValueChange={setPlanId} disabled={!productId}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择策略" /></SelectTrigger>
                  <SelectContent>
                    {(plans.data ?? []).map((plan) => (
                      <SelectItem key={plan.id} value={String(plan.id)}>{plan.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5 w-full">
                  <Label>数量（最多 5000）</Label>
                  <Input name="quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} required inputMode="numeric" />
                </div>
                <div className="flex flex-col gap-1.5 w-full">
                  <Label>渠道（便于对账）</Label>
                  <Input name="channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="taobao / xianyu / faka" />
                </div>
              </div>
            </>
          )}
        </div>
        {result ? null : (
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="default" className="bg-primary text-primary-foreground" onClick={() => void submit()} disabled={busy || !productId || !planId}>
              {busy ? '生成中…' : '生成卡密'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
