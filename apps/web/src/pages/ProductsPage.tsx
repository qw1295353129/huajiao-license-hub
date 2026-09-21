import { PageHeader, EmptyHint } from '@/components/common/ui';

export function ProductsPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="产品与策略" />
      <EmptyHint title="该模块即将接入" description="产品 CRUD、功能点、版本发布与授权策略（plan）将在 M3 里程碑接入。" />
    </div>
  );
}
