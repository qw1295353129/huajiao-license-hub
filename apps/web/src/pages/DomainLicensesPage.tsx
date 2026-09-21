import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Dropdown, Input, Label, ListBox, Modal, Select, TextArea, TextField, toast,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import { Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { Paginated, Plan, ProductRow } from '@/lib/types';
import type { DomainLicenseDetail, DomainLicenseRow, DomainStats } from '@/lib/domain-types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatCard, StatusChip, Tag } from '@/components/common/ui';
import { daysLeft, formatDateTime, fromNow } from '@/lib/format';

/**
 * 域名授权：与授权码完全分开的一条线。
 * 运营者直接给「域名 + 套餐 + 到期」发授权，客户在网站后台填域名即可激活，不需要授权码。
 */
export function DomainLicensesPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.get<Paginated<ProductRow>>('/api/admin/products' + qs({ pageSize: 100 })),
  });

  const stats = useQuery({
    queryKey: ['domain-stats'],
    queryFn: () => api.get<DomainStats>('/api/admin/domain-licenses/stats'),
  });

  const list = useQuery({
    queryKey: ['domain-licenses', page, pageSize, search],
    queryFn: () => api.get<Paginated<DomainLicenseRow>>('/api/admin/domain-licenses' + qs({
      page, pageSize, q: search || undefined,
    })),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['domain-licenses'] });
    void queryClient.invalidateQueries({ queryKey: ['domain-license'] });
    void queryClient.invalidateQueries({ queryKey: ['domain-stats'] });
  };

  const columns: Column<DomainLicenseRow>[] = [
    {
      id: 'owner', label: '归属 / 套餐', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[13px]">{row.customerEmail ?? '未绑定客户'}</span>
          <span className="text-[11px] opacity-50">{row.productName} · {row.planName}</span>
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
    {
      id: 'quota', label: '域名额度', align: 'right',
      render: (row) => (
        <span className="tabular-nums text-[12px]">
          {row.domainCount}
          <span className="opacity-45"> / {row.maxDomains}</span>
        </span>
      ),
    },
    {
      id: 'expires', label: '到期', align: 'right',
      render: (row) => {
        if (!row.expiresAt) return <Tag color="accent">长期</Tag>;
        const days = daysLeft(row.expiresAt);
        return (
          <div className="flex flex-col items-end">
            <span className="text-[12px] tabular-nums">{formatDateTime(row.expiresAt)}</span>
            <span className={days !== null && days <= 7 ? 'text-[11px] text-amber-500' : 'text-[11px] opacity-50'}>
              {days !== null && days < 0 ? '已过期' : '剩 ' + days + ' 天'}
            </span>
          </div>
        );
      },
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onPress={() => setDetailId(row.id)}>域名管理</Button>
          <Dropdown>
            <Dropdown.Trigger className="rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5" aria-label="更多操作">
              更多
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu>
                <Dropdown.Item id="extend" onAction={() => void extend(row.id, 365, refresh)}>
                  <RefreshCw size={13} /> 延长 1 年
                </Dropdown.Item>
                <Dropdown.Item id="toggle" onAction={() => void transition(row.id, row.status === 'suspended' ? 'resume' : 'suspend', refresh)}>
                  {row.status === 'suspended' ? '恢复授权' : '暂停授权'}
                </Dropdown.Item>
                <Dropdown.Item id="revoke" onAction={() => void revoke(row.id, refresh)}>
                  <Trash2 size={13} /> 吊销授权
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      ),
    },
  ];

  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="域名授权"
        description="直接给域名发授权：客户在网站后台填域名即可激活，不需要授权码"
        actions={<CreateDomainLicenseModal products={products.data?.items ?? []} onDone={refresh} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="域名授权数" value={stats.data?.total ?? '—'} icon={<Globe size={16} />} />
        <StatCard label="生效中" value={stats.data?.active ?? '—'} tone="success" />
        <StatCard label="已授权域名" value={stats.data?.activeDomains ?? '—'} tone="accent" />
        <StatCard label="7 天内到期" value={stats.data?.expiring7d ?? '—'} tone="warning" />
      </div>

      <div className="mb-3 w-72">
        <TextField name="search" value={search} onChange={(value) => { setSearch(value); setPage(1); }} fullWidth>
          <Label>搜索</Label>
          <Input placeholder="域名 / 客户邮箱 / 备注" />
        </TextField>
      </div>

      <DataTable
        ariaLabel="域名授权列表"
        columns={columns}
        items={list.data?.items ?? []}
        isLoading={list.isLoading}
        emptyTitle="还没有域名授权"
        emptyDescription="点右上角「开通域名授权」，选套餐并填入要授权的域名即可。"
        footer={
          <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
        }
      />

      <DomainDetailModal id={detailId} onClose={() => setDetailId(null)} onChanged={refresh} />
    </div>
  );
}

/* ------------------------------------------------------------------ 行操作 */

async function transition(id: string, action: 'revoke' | 'suspend' | 'resume', refresh: () => void) {
  try {
    await api.post('/api/admin/domain-licenses/' + id + '/' + action, {});
    toast.success('状态已更新');
    refresh();
  } catch (error) {
    toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
  }
}

async function revoke(id: string, refresh: () => void) {
  if (!window.confirm('吊销该域名授权？相关网站会立即失效。')) return;
  await transition(id, 'revoke', refresh);
}

async function extend(id: string, days: number, refresh: () => void) {
  try {
    await api.post('/api/admin/domain-licenses/' + id + '/extend', { days, reason: '后台延期' });
    toast.success('已延长 ' + days + ' 天');
    refresh();
  } catch (error) {
    toast.danger('延期失败', { description: error instanceof Error ? error.message : '' });
  }
}

/* ------------------------------------------------------------------ 新建 */

function CreateDomainLicenseModal({ products, onDone }: { products: ProductRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<Key | null>(null);
  const [planId, setPlanId] = useState<Key | null>(null);
  const [email, setEmail] = useState('');
  const [domains, setDomains] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const plans = useQuery({
    queryKey: ['plans', productId],
    queryFn: () => api.get<Plan[]>('/api/admin/products/' + productId + '/plans'),
    enabled: Boolean(productId),
  });

  const domainPlans = (plans.data ?? []).filter((plan) => plan.maxDomains > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ license: DomainLicenseDetail; addedDomains: string[]; failedDomains: { domain: string; message: string }[] }>(
        '/api/admin/domain-licenses',
        {
          productId: String(productId),
          planId: String(planId),
          ...(email ? { customerEmail: email } : {}),
          domains: domains.split(/[\n,;\s]+/).map((item) => item.trim()).filter(Boolean),
          ...(notes ? { notes } : {}),
        },
      );
      if (res.failedDomains.length > 0) {
        toast.warning('部分域名未绑定', {
          description: res.failedDomains.map((item) => item.domain + '：' + item.message).join('；'),
          timeout: 0,
        });
      } else {
        toast.success('已开通域名授权并绑定 ' + res.addedDomains.length + ' 个域名');
      }
      setOpen(false);
      setEmail(''); setDomains(''); setNotes('');
      onDone();
    } catch (error) {
      toast.danger('开通失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
        <Plus size={15} /> 开通域名授权
      </Modal.Trigger>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>开通域名授权</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <Select name="product" placeholder="选择产品" selectedKey={productId}
                onSelectionChange={(key) => { setProductId(key); setPlanId(null); }} isRequired fullWidth>
                <Label>产品</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {products.map((product) => (
                      <ListBox.Item key={product.id} id={product.id} textValue={product.name}>{product.name}</ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>

              <Select name="plan" placeholder={productId ? '选择套餐' : '请先选择产品'} selectedKey={planId}
                onSelectionChange={setPlanId} isRequired fullWidth isDisabled={!productId}>
                <Label>套餐（决定到期时间与域名额度）</Label>
                <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {domainPlans.map((plan) => (
                      <ListBox.Item key={plan.id} id={plan.id} textValue={plan.name}>
                        {plan.name} · {plan.maxDomains} 个域名 · {plan.durationDays ? plan.durationDays + ' 天' : '长期'}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              {productId && domainPlans.length === 0 ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
                  该产品下没有开启域名授权的套餐。请先到「产品与策略」里给套餐填写「域名授权」额度。
                </p>
              ) : null}

              <TextField name="email" type="email" value={email} onChange={setEmail} fullWidth>
                <Label>归属客户邮箱（可选）</Label>
                <Input placeholder="buyer@example.com —— 填了客户可在门户自助增删域名" />
              </TextField>

              <TextField name="domains" value={domains} onChange={setDomains} fullWidth>
                <Label>要授权的域名（可选，多个用换行或逗号分隔）</Label>
                <TextArea rows={3} placeholder="shop.example.com, blog.example.com" className="mono-code" />
              </TextField>

              <TextField name="notes" value={notes} onChange={setNotes} fullWidth>
                <Label>备注</Label>
                <Input placeholder="订单号 / 渠道" />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
              <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !productId || !planId}>
                {busy ? '开通中…' : '开通'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 详情 */

function DomainDetailModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [newDomain, setNewDomain] = useState('');
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ['domain-license', id],
    queryFn: () => api.get<DomainLicenseDetail>('/api/admin/domain-licenses/' + id),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['domain-license', id] });
    onChanged();
  };

  const addDomain = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/domain-licenses/' + id + '/domains', { domain: newDomain });
      toast.success('已绑定 ' + newDomain);
      setNewDomain('');
      refresh();
    } catch (error) {
      toast.danger('绑定失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  const data = detail.data;

  return (
    <Modal isOpen={Boolean(id)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>域名管理</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              {detail.isLoading ? <p className="text-sm opacity-60">加载中…</p> : null}
              {data ? (
                <>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <Field label="产品" value={data.productName} />
                    <Field label="套餐" value={data.planName + '（' + data.planCode + '）'} />
                    <Field label="归属" value={data.customerEmail ?? '未绑定客户'} />
                    <Field label="状态" value={<StatusChip status={data.status} />} />
                    <Field label="到期" value={data.expiresAt ? formatDateTime(data.expiresAt) : '长期有效'} />
                    <Field label="子域名" value={data.allowSubdomains ? '允许（含 *.域名）' : '不允许'} />
                    <Field label="最近校验" value={fromNow(data.lastVerifiedAt)} />
                    <Field label="备注" value={data.notes ?? '—'} />
                  </div>

                  <section>
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                      <Globe size={14} /> 已授权域名
                      <span className="text-xs font-normal opacity-50">{data.domainCount} / {data.maxDomains}</span>
                    </h3>

                    <div className="mb-3 flex gap-2">
                      <Input
                        placeholder="example.com 或 https://www.example.com"
                        value={newDomain}
                        onChange={(event) => setNewDomain(event.target.value)}
                        className="mono-code"
                      />
                      <Button variant="primary" size="sm" isDisabled={busy || newDomain.trim().length < 3} onPress={() => void addDomain()}>
                        绑定
                      </Button>
                    </div>

                    {data.domains.filter((row) => row.status === 'active').length === 0 ? (
                      <p className="text-xs opacity-50">还没有已授权域名。客户也可以在自己的门户里自助添加。</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {data.domains.filter((row) => row.status === 'active').map((row) => (
                          <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/8 p-2.5 text-xs dark:border-white/10">
                            <div className="min-w-0">
                              <p className="mono-code truncate">{row.domain}</p>
                              <p className="opacity-45">
                                {row.source === 'customer' ? '客户自助添加' : '后台添加'} · 校验 {row.verifyCount} 次 · {fromNow(row.lastSeenAt)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="danger-soft"
                              onPress={async () => {
                                if (!window.confirm('解绑域名 ' + row.domain + '？该站点会立即失效。')) return;
                                try {
                                  await api.delete('/api/admin/domain-licenses/domains/' + row.id);
                                  toast.success('已解绑 ' + row.domain);
                                  refresh();
                                } catch (error) {
                                  toast.danger('解绑失败', { description: error instanceof Error ? error.message : '' });
                                }
                              }}
                            >
                              解绑
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section>
                    <h3 className="mb-2 text-sm font-medium">事件记录</h3>
                    <ul className="flex flex-col gap-1.5">
                      {data.events.map((event) => (
                        <li key={event.id} className="flex items-start justify-between gap-3 text-xs">
                          <span>
                            <Tag color="default">{event.type}</Tag>
                            {event.domain ? <span className="mono-code ml-2 opacity-80">{event.domain}</span> : null}
                            {event.message ? <span className="ml-2 opacity-60">{event.message}</span> : null}
                          </span>
                          <span className="shrink-0 opacity-45">{formatDateTime(event.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs opacity-50">{label}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
}