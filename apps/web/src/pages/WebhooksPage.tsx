import { PageHeader, EmptyHint } from '@/components/common/ui';

export function WebhooksPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="Webhook" />
      <EmptyHint title="该模块即将接入" description="事件订阅、HMAC 签名投递、重试与投递日志将在 M6 里程碑接入。" />
    </div>
  );
}
