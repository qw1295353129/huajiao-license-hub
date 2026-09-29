import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/animate-ui/components/buttons/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/animate-ui/components/radix/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/animate-ui/components/radix/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Receipt } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { Paginated, Plan, ProductRow } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatCard, StatusChip } from '@/components/common/ui';
import { formatDateTime, formatMoney } from '@/lib/format';

type Key = string | number;

interface OrderRow {
  id: string;
  orderNo: string;
  email: string;
  status: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  provider: string;
  paidAt: string | null;
  createdAt: string;
  itemCount: number;
  licenseCount: number;
}

interface OrderStats {
  total: number;
  pending: number;
  paid: number;
  refunded: number;
  revenueCents: number;
  revenue30DaysCents: number;
}

export function OrdersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<Key | null>(null);

  const stats = useQuery({ queryKey: ['order-stats'], queryFn: () => api.get<OrderStats>('/api/admin/orders/stats') });
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.get<Paginated<ProductRow>>('/api/admin/products' + qs({ pageSize: 100 })),
  });

  const list = useQuery({
    queryKey: ['orders', page, pageSize, status],
    queryFn: () => api.get<Paginated<OrderRow>>('/api/admin/orders' + qs({
      page, pageSize, status: status ? String(status) : undefined,
    })),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['order-stats'] });
  };

  const columns: Column<OrderRow>[] = [
    {
      id: 'no', label: '订单号', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="mono-code text-[12px]">{row.orderNo}</span>
          <span className="text-[11px] opacity-50">{formatDateTime(row.createdAt)} · {row.provider}</span>
        </div>
      ),
    },
    { id: 'email', label: '客户', render: (row) => <span className="text-[12px]">{row.email}</span> },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
    {
      id: 'amount', label: '金额', align: 'right',
      render: (row) => (
        <div className="flex flex-col items-end">
          <span className="tabular-nums text-[13px]">{formatMoney(row.totalCents, row.currency)}</span>
          {row.discountCents > 0 ? (
            <span className="text-[11px] opacity-45">优惠 {formatMoney(row.discountCents, row.currency)}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'items', label: '明细 / 已发码', align: 'right',
      render: (row) => <span className="tabular-nums text-[12px]">{row.itemCount} / {row.licenseCount}</span>,
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.status === 'pending' ? (
            <Button
              size="sm"
              variant="default"
              className="bg-primary text-primary-foreground"
              onClick={async () => {
                try {
                  const res = await api.post<{ licenses: string[]; alreadyPaid: boolean }>(
                    '/api/admin/orders/' + row.id + '/mark-paid', {});
                  toast.success(res.alreadyPaid ? '订单已是已支付状态' : '已标记支付并发码 ' + res.licenses.length + ' 条');
                  refresh();
                } catch (error) {
                  toast.error('操作失败', { description: error instanceof Error ? error.message : '' });
                }
              }}
            >
              标记已支付
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5" aria-label="更多操作">
                更多
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={async () => {
                  try {
                    const res = await api.post<{ issued: number }>('/api/admin/orders/' + row.id + '/issue-licenses', {});
                    toast.success(res.issued > 0 ? '补发 ' + res.issued + ' 条授权' : '没有待发码的条目');
                    refresh();
                  } catch (error) {
                    toast.error('补发失败', { description: error instanceof Error ? error.message : '' });
                  }
                }}
              >
                补发缺失授权
              </DropdownMenuItem>
              {row.status === 'paid' ? (
                <DropdownMenuItem
                  onSelect={async () => {
                    if (!window.confirm('确认退款？关联授权会被同时吊销。')) return;
                    try {
                      const res = await api.post<{ revokedLicenses: number }>(
                        '/api/admin/orders/' + row.id + '/refund', { reason: '后台手工退款' });
                      toast.success('已退款，吊销授权 ' + res.revokedLicenses + ' 条');
                      refresh();
                    } catch (error) {
                      toast.error('退款失败', { description: error instanceof Error ? error.message : '' });
                    }
                  }}
                >
                  退款并吊销授权
                </DropdownMenuItem>
              ) : null}
              {row.status === 'pending' ? (
                <DropdownMenuItem
                  onSelect={async () => {
                    try {
                      await api.post('/api/admin/orders/' + row.id + '/cancel', {});
                      toast.success('订单已取消');
                      refresh();
                    } catch (error) {
                      toast.error('取消失败', { description: error instanceof Error ? error.message : '' });
                    }
                  }}
                >
                  取消订单
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="订单管理"
        description="手工建单、标记支付自动发码、退款自动吊销"
        actions={<CreateOrderModal products={products.data?.items ?? []} onDone={refresh} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="订单总数" value={stats.data?.total ?? '—'} icon={<Receipt size={16} />} />
        <StatCard label="待支付" value={stats.data?.pending ?? '—'} tone="warning" />
        <StatCard label="累计收入" value={stats.data ? formatMoney(stats.data.revenueCents) : '—'} tone="success" />
        <StatCard label="近 30 天收入" value={stats.data ? formatMoney(stats.data.revenue30DaysCents) : '—'} tone="success" />
      </div>

      <div className="mb-3 w-44">
        <div className="flex flex-col gap-1.5 w-full">
          <Label>状态</Label>
          <Select name="status" value={status != null ? String(status) : ''}
            onValueChange={(key) => { setStatus(key); setPage(1); }}>
            <SelectTrigger className="w-full"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              {['pending', 'paid', 'refunded', 'cancelled'].map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        ariaLabel="订单列表"
        columns={columns}
        items={list.data?.items ?? []}
        isLoading={list.isLoading}
        emptyTitle="还没有订单"
        emptyDescription="可以手工建单（线下收款），或在门户下单后由支付回调自动处理。"
        footer={
          <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
        }
      />
    </div>
  );
}

function CreateOrderModal({ products, onDone }: { products: ProductRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [productId, setProductId] = useState<Key | null>(null);
  const [planId, setPlanId] = useState<Key | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [coupon, setCoupon] = useState('');
  const [markPaid, setMarkPaid] = useState(true);
  const [busy, setBusy] = useState(false);

  const plans = useQuery({
    queryKey: ['plans', productId],
    queryFn: () => api.get<Plan[]>('/api/admin/products/' + productId + '/plans'),
    enabled: Boolean(productId),
  });

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ orderNo: string; licenses?: string[] }>('/api/admin/orders', {
        email,
        items: [{ productId: String(productId), planId: String(planId), quantity: Number(quantity) }],
        ...(coupon ? { couponCode: coupon } : {}),
        markPaid,
      });
      if (markPaid && res.licenses && res.licenses.length > 0) {
        void navigator.clipboard.writeText(res.licenses.join('\n'));
        toast.success('订单已支付并发码 ' + res.licenses.length + ' 条（已复制）', { duration: Infinity });
      } else {
        toast.success('订单已创建：' + res.orderNo);
      }
      setOpen(false);
      setEmail(''); setCoupon(''); setQuantity('1');
      onDone();
    } catch (error) {
      toast.error('建单失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
          <Plus size={15} /> 手工建单
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>手工建单</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5 w-full">
            <Label>客户邮箱</Label>
            <Input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="buyer@example.com" />
          </div>

          <div className="flex flex-col gap-1.5 w-full">
            <Label>产品</Label>
            <Select name="product" required value={productId != null ? String(productId) : ''}
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
            <Label>授权策略</Label>
            <Select name="plan" required value={planId != null ? String(planId) : ''}
              onValueChange={setPlanId} disabled={!productId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={productId ? '选择策略' : '请先选择产品'} />
              </SelectTrigger>
              <SelectContent>
                {(plans.data ?? []).map((plan) => (
                  <SelectItem key={plan.id} value={String(plan.id)}>{plan.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 w-full">
              <Label>数量</Label>
              <Input name="quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" />
            </div>
            <div className="flex flex-col gap-1.5 w-full">
              <Label>优惠券代码（可选）</Label>
              <Input name="coupon" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="SAVE10" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs opacity-75">
            <input type="checkbox" checked={markPaid} onChange={(event) => setMarkPaid(event.target.checked)} />
            建单后立即标记为已支付并自动发码（线下收款场景）
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
          <Button variant="default" className="bg-primary text-primary-foreground" onClick={() => void submit()} disabled={busy || !email || !productId || !planId}>
            {busy ? '处理中…' : '创建订单'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
