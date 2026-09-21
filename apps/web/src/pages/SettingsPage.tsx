import { PageHeader, EmptyHint } from '@/components/common/ui';

export function SettingsPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader title="系统设置" />
      <EmptyHint title="该模块即将接入" description="站点设置、SMTP、安全策略与签名密钥轮换将在 M6 里程碑接入。" />
    </div>
  );
}
