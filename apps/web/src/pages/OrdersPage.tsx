import { PageHeader, EmptyHint } from '@/components/common/ui';

export function OrdersPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="订单管理" />
      <EmptyHint title="该模块即将接入" description="订单、支付回调幂等、自动发码与退款吊销将在 M5 里程碑接入。" />
    </div>
  );
}
