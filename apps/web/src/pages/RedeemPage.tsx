import { PageHeader, EmptyHint } from '@/components/common/ui';

export function RedeemPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="卡密管理" />
      <EmptyHint title="该模块即将接入" description="卡密批次生成、导出、作废与兑换记录将在 M5 里程碑接入。" />
    </div>
  );
}
