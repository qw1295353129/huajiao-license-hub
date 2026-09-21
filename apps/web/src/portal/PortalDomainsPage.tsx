import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Chip, Input, Separator, toast } from '@heroui/react';
import { Globe, Plus } from 'lucide-react';
import { portalApi } from '@/lib/api';
import type { AuthorizedDomain, DomainLicenseRow } from '@/lib/domain-types';
import { ErrorNotice, Loading, PageHeader, StatusChip } from '@/components/common/ui';
import { daysLeft, formatDateTime, fromNow } from '@/lib/format';

interface MyDomainLicense extends DomainLicenseRow {
  domains: AuthorizedDomain[];
}

/** 我的域名授权：客户在额度内自助添加/解绑域名（不需要授权码）。 */
export function PortalDomainsPage() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['portal-domain-licenses'],
    queryFn: () => portalApi.get<MyDomainLicense[]>('/api/portal/domain-licenses'),
  });

  if (list.isLoading) return <Loading label="正在加载域名授权…" />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  const items = list.data ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="我的域名授权"
        description="把网站域名添加到这里，即可在你的网站后台一键激活（无需授权码）"
      />

      {items.length === 0 ? (
        <Card>
          <Card.Content>
            <p className="py-8 text-center text-sm opacity-60">
              还没有域名授权。如果你购买的是「按域名」的授权，它会在付款后出现在这里；
              没有的话请联系作者开通。
            </p>
          </Card.Content>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((license) => (
            <Card key={license.id}>
              <Card.Content>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{license.productName}</span>
                      <StatusChip status={license.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-60">
                      <span>{license.planName}</span>
                      <span>域名 {license.domainCount}/{license.maxDomains}</span>
                      <span>{license.allowSubdomains ? '含子域名' : '不含子域名'}</span>
                      <span>{license.expiresAt ? '到期 ' + formatDateTime(license.expiresAt) : '长期有效'}</span>
                    </div>
                  </div>
                  {license.expiresAt ? (
                    <Chip color={(daysLeft(license.expiresAt) ?? 0) <= 14 ? 'warning' : 'success'} size="sm" variant="soft">
                      <Chip.Label>剩 {daysLeft(license.expiresAt)} 天</Chip.Label>
                    </Chip>
                  ) : (
                    <Chip color="accent" size="sm" variant="soft"><Chip.Label>长期</Chip.Label></Chip>
                  )}
                </div>

                <Separator className="my-3" />
                <DomainEditor license={license} onChanged={() => {
                  void queryClient.invalidateQueries({ queryKey: ['portal-domain-licenses'] });
                }} />
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DomainEditor({ license, onChanged }: { license: MyDomainLicense; onChanged: () => void }) {
  const [value, setValue] = useState('');
  const active = license.domains.filter((row) => row.status === 'active');

  const add = useMutation({
    mutationFn: (domain: string) => portalApi.post<{ domain: string; domainCount: number }>(
      '/api/portal/domain-licenses/' + license.id + '/domains', { domain },
    ),
    onSuccess: (res) => {
      toast.success('已添加 ' + res.domain, { description: '现在可以在网站后台激活了' });
      setValue('');
      onChanged();
    },
    onError: (error: Error) => toast.danger('添加失败', { description: error.message }),
  });

  const remove = useMutation({
    mutationFn: (domainId: string) => portalApi.delete<{ domainCount: number }>(
      '/api/portal/domain-licenses/domains/' + domainId,
    ),
    onSuccess: () => {
      toast.success('已解绑');
      onChanged();
    },
    onError: (error: Error) => toast.danger('解绑失败', { description: error.message }),
  });

  return (
    <div className="flex flex-col gap-2">
      {active.length === 0 ? (
        <p className="text-xs opacity-50">还没有添加域名</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/8 p-2.5 text-xs dark:border-white/10">
              <div className="flex min-w-0 items-center gap-2">
                <Globe size={14} />
                <div className="min-w-0">
                  <p className="mono-code truncate">{row.domain}</p>
                  <p className="opacity-45">最近校验 {fromNow(row.lastSeenAt)} · 共 {row.verifyCount} 次</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="danger-soft"
                isDisabled={remove.isPending}
                onPress={() => {
                  if (window.confirm('解绑域名 ' + row.domain + '？该网站会立即失效。')) remove.mutate(row.id);
                }}
              >
                解绑
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 flex gap-2">
        <Input
          placeholder="example.com 或 https://www.example.com"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mono-code"
        />
        <Button
          variant="primary"
          size="sm"
          isDisabled={add.isPending || value.trim().length < 3 || active.length >= license.maxDomains}
          onPress={() => add.mutate(value)}
        >
          <Plus size={14} /> 添加
        </Button>
      </div>
      {active.length >= license.maxDomains ? (
        <p className="text-[11px] text-amber-600">
          额度已用满（{license.maxDomains} 个）。需要更多域名请先解绑不用的，或联系作者升级套餐。
        </p>
      ) : (
        <p className="text-[11px] opacity-45">
          提示：填 <code>example.com</code> 即可{license.allowSubdomains ? '，子域名（如 a.example.com）自动覆盖' : ''}。
        </p>
      )}
    </div>
  );
}