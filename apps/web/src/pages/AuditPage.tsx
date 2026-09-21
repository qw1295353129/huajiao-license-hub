import { PageHeader, EmptyHint } from '@/components/common/ui';

export function AuditPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="审计日志" />
      <EmptyHint title="该模块即将接入" description="审计日志查询（按操作者、动作、目标、时间过滤）将在 M2 收尾时接入。" />
    </div>
  );
}
