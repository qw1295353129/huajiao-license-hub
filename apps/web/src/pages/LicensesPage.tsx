import { PageHeader, EmptyHint } from '@/components/common/ui';

export function LicensesPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="授权管理" />
      <EmptyHint title="该模块即将接入" description="授权列表、批量发码、CSV 导入导出、状态流转将在 M3 里程碑接入。" />
    </div>
  );
}
