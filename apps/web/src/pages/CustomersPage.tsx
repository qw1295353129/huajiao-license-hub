import { PageHeader, EmptyHint } from '@/components/common/ui';

export function CustomersPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="客户管理" />
      <EmptyHint title="该模块即将接入" description="客户资料、封禁、重置密码与授权归属将在 M5 里程碑接入。" />
    </div>
  );
}
