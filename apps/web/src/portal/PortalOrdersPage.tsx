import { useQuery } from '@tanstack/react-query';
import { Card, Separator } from '@heroui/react';
import { portalApi } from '@/lib/api';
import { ErrorNotice, Loading, PageHeader, StatusChip } from '@/components/common/ui';
import { formatDateTime, formatMoney } from '@/lib/format';

interface MyOrder {
  id: string;
  orderNo: string;
  status: string;
  currency: string;
  totalCents: number;
  discountCents: number;
  paidAt: string | null;
  createdAt: string;
  itemCount: number;
}

export function PortalOrdersPage() {
  const orders = useQuery({
    queryKey: ['portal-orders'],
    queryFn: () => portalApi.get<{ items: MyOrder[]; total: number }>('/api/portal/orders'),
  });

  if (orders.isLoading) return <Loading label="正在加载订单…" />;
  if (orders.error) return <ErrorNotice error={orders.error} onRetry={() => void orders.refetch()} />;

  const items = orders.data?.items ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader title="我的订单" description="订单支付后系统会自动发码" />
      {items.length === 0 ? (
        <Card><Card.Content><p className="py-8 text-center text-sm opacity-60">还没有订单</p></Card.Content></Card>
      ) : (
        <Card>
          <Card.Content>
            <ul className="flex flex-col">
              {items.map((order, index) => (
                <li key={order.id}>
                  {index > 0 ? <Separator className="my-3" /> : null}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="mono-code text-sm">{order.orderNo}</p>
                      <p className="mt-0.5 text-[11px] opacity-50">
                        {formatDateTime(order.createdAt)} · {order.itemCount} 件商品
                        {order.discountCents > 0 ? ' · 已优惠 ' + formatMoney(order.discountCents, order.currency) : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium tabular-nums">{formatMoney(order.totalCents, order.currency)}</span>
                      <StatusChip status={order.status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      )}
    </div>
  );
}
