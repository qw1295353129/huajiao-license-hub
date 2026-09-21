import { PageHeader, EmptyHint } from '@/components/common/ui';

export function DevicesPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="设备管理" />
      <EmptyHint title="该模块即将接入" description="设备注册表、黑名单与异常检测将在 M4 里程碑接入。" />
    </div>
  );
}
