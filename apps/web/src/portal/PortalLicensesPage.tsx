import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, Separator, toast } from '@heroui/react';
import { Laptop, Smartphone } from 'lucide-react';
import { portalApi } from '@/lib/api';
import { ErrorNotice, Loading, PageHeader, StatusChip, Tag } from '@/components/common/ui';
import { daysLeft, formatDateTime, fromNow } from '@/lib/format';
import { LICENSE_TYPE_LABEL } from '@/lib/labels';

interface MyLicense {
  id: string;
  keyMasked: string;
  status: string;
  productName: string;
  productSlug: string;
  planName: string;
  licenseType: string;
  maxDevices: number;
  activationCount: number;
  expiresAt: string | null;
  featureKeys: string[];
}

interface DeviceRow {
  id: string;
  status: string;
  activatedAt: string;
  lastSeenAt: string;
  os: string | null;
  appVersion: string | null;
  ip: string | null;
  deviceName: string | null;
}

interface LicenseDetail extends MyLicense {
  devices: DeviceRow[];
}

/** 我的授权：授权码维度（设备）。域名授权在「我的域名授权」页单独管理。 */
export function PortalLicensesPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['portal-licenses'],
    queryFn: () => portalApi.get<{ items: MyLicense[]; total: number }>('/api/portal/licenses'),
  });

  if (list.isLoading) return <Loading label="正在加载你的授权…" />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  const items = list.data?.items ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader title="我的授权" description="点击卡片查看已绑定设备并自助解绑（换电脑时使用）" />

      {items.length === 0 ? (
        <Card>
          <Card.Content>
            <p className="py-8 text-center text-sm opacity-60">
              还没有授权。购买后授权会自动出现在这里；如果你拿到的是卡密，请到「卡密兑换」页兑换。
            </p>
          </Card.Content>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((license) => (
            <LicenseCard
              key={license.id}
              license={license}
              expanded={expanded === license.id}
              onToggle={() => setExpanded(expanded === license.id ? null : license.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LicenseCard({ license, expanded, onToggle }: { license: MyLicense; expanded: boolean; onToggle: () => void }) {
  const queryClient = useQueryClient();
  const days = daysLeft(license.expiresAt);

  const detail = useQuery({
    queryKey: ['portal-license', license.id],
    queryFn: () => portalApi.get<LicenseDetail>('/api/portal/licenses/' + license.id),
    enabled: expanded,
  });

  const unbind = useMutation({
    mutationFn: (activationId: string) => portalApi.delete<{ activeDevices: number; remainingUnbinds: number | null }>(
      '/api/portal/licenses/' + license.id + '/devices/' + activationId,
    ),
    onSuccess: (res) => {
      toast.success('设备已解绑', {
        description: res.remainingUnbinds === null ? undefined : '本周期还可自助解绑 ' + res.remainingUnbinds + ' 次',
      });
      void queryClient.invalidateQueries({ queryKey: ['portal-license', license.id] });
      void queryClient.invalidateQueries({ queryKey: ['portal-licenses'] });
    },
    onError: (error: Error) => toast.danger('解绑失败', { description: error.message }),
  });

  return (
    <Card>
      <Card.Content>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{license.productName}</span>
              <StatusChip status={license.status} />
            </div>
            <p className="mono-code mt-1 text-sm opacity-80">{license.keyMasked}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-60">
              <span>{license.planName} · {LICENSE_TYPE_LABEL[license.licenseType as 'trial'] ?? license.licenseType}</span>
              <span>设备 {license.activationCount}/{license.maxDevices || '不限'}</span>
              <span>{license.expiresAt ? '到期 ' + formatDateTime(license.expiresAt) : '永久有效'}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {license.expiresAt ? (
              <Chip color={days !== null && days < 0 ? 'danger' : days !== null && days <= 14 ? 'warning' : 'success'} size="sm" variant="soft">
                <Chip.Label>{days !== null && days < 0 ? '已过期' : '剩 ' + days + ' 天'}</Chip.Label>
              </Chip>
            ) : (
              <Chip color="accent" size="sm" variant="soft"><Chip.Label>永久</Chip.Label></Chip>
            )}
            <Button size="sm" variant="ghost" onPress={onToggle}>{expanded ? '收起' : '管理设备'}</Button>
          </div>
        </div>

        {license.featureKeys.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {license.featureKeys.map((key) => <Tag key={key} color="accent">{key}</Tag>)}
          </div>
        ) : null}

        {expanded ? (
          <>
            <Separator className="my-4" />
            <p className="mb-2 text-xs font-medium opacity-70">已绑定设备</p>
            {detail.isLoading ? <p className="text-xs opacity-50">加载中…</p> : null}
            {detail.data && detail.data.devices.length === 0 ? (
              <p className="text-xs opacity-50">还没有设备激活此授权</p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {(detail.data?.devices ?? []).map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 rounded-lg border border-black/8 p-2.5 text-xs dark:border-white/10">
                  <div className="flex min-w-0 items-center gap-2">
                    {device.os?.toLowerCase().includes('win') ? <Laptop size={14} /> : <Smartphone size={14} />}
                    <div className="min-w-0">
                      <p className="truncate">
                        {device.deviceName ?? device.os ?? '未知设备'}
                        {device.status === 'active' ? null : <span className="ml-2 opacity-50">（已解绑）</span>}
                      </p>
                      <p className="opacity-45">最近活跃 {fromNow(device.lastSeenAt)}</p>
                    </div>
                  </div>
                  {device.status === 'active' ? (
                    <Button
                      size="sm"
                      variant="danger-soft"
                      isDisabled={unbind.isPending}
                      onPress={() => {
                        if (window.confirm('确认解绑该设备？解绑后该设备需要重新激活。')) unbind.mutate(device.id);
                      }}
                    >
                      解绑
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card.Content>
    </Card>
  );
}
