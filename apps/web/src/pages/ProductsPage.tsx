import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Chip, Input, Label, ListBox, Modal, Select, TextArea, TextField, toast,
} from '@heroui/react';
import { Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { Paginated, ProductDetail, ProductRow } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatusChip, Tag } from '@/components/common/ui';
import { formatMoney } from '@/lib/format';
import { LICENSE_TYPE_LABEL } from '@/lib/labels';

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState<string | null>(null);

  const products = useQuery({
    queryKey: ['products', page, pageSize],
    queryFn: () => api.get<Paginated<ProductRow>>('/api/admin/products' + qs({ page, pageSize })),
  });

  const detail = useQuery({
    queryKey: ['product', detailId],
    queryFn: () => api.get<ProductDetail>('/api/admin/products/' + detailId),
    enabled: Boolean(detailId),
  });

  const columns: Column<ProductRow>[] = [
    {
      id: 'name', label: '产品', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-[11px] opacity-50">{row.slug}</span>
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
    { id: 'plans', label: '策略', align: 'right', render: (row) => row.planCount },
    {
      id: 'licenses', label: '授权 / 有效', align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {row.licenseCount}
          <span className="opacity-45"> / {row.activeLicenseCount}</span>
        </span>
      ),
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <Button size="sm" variant="ghost" onPress={() => setDetailId(row.id)}>
          策略与功能
        </Button>
      ),
    },
  ];

  if (products.error) return <ErrorNotice error={products.error} onRetry={() => void products.refetch()} />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="产品与策略"
        description="一个产品对应一套授权体系：功能点决定能力，策略决定有效期与设备数"
        actions={<CreateProductModal onDone={() => void queryClient.invalidateQueries({ queryKey: ['products'] })} />}
      />

      <DataTable
        ariaLabel="产品列表"
        columns={columns}
        items={products.data?.items ?? []}
        isLoading={products.isLoading}
        emptyTitle="还没有产品"
        emptyDescription="先创建一个产品，再为它配置授权策略（如「专业版年付」）。"
        footer={
          <Pagination
            page={page}
            pageSize={pageSize}
            total={products.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }}
          />
        }
      />

      <Modal isOpen={Boolean(detailId)} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <Modal.Backdrop isDismissable variant="blur">
          <Modal.Container size="lg" placement="center" scroll="inside">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{detail.data?.name ?? '产品详情'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                {detail.isLoading ? <p className="text-sm opacity-60">加载中…</p> : null}
                {detail.data ? (
                  <>
                    <section>
                      <h3 className="mb-2 text-sm font-medium">授权策略</h3>
                      <div className="flex flex-col gap-2">
                        {detail.data.plans.length === 0 ? (
                          <p className="text-xs opacity-50">尚未配置策略</p>
                        ) : detail.data.plans.map((plan) => (
                          <div key={plan.id} className="rounded-lg border border-black/8 p-3 dark:border-white/10">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{plan.name}</span>
                              <Tag color={plan.status === 'active' ? 'success' : 'default'}>{plan.code}</Tag>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-60">
                              <span>{LICENSE_TYPE_LABEL[plan.licenseType] ?? plan.licenseType}</span>
                              <span>{plan.durationDays ? plan.durationDays + ' 天' : '永久'}</span>
                              <span>{plan.maxDevices === 0 ? '设备不限' : plan.maxDevices + ' 台设备'}</span>
                              <span>
                                {plan.maxDomains > 0
                                  ? plan.maxDomains + ' 个域名' + (plan.allowSubdomains ? '（含子域）' : '')
                                  : '不支持域名授权'}
                              </span>
                              <span>离线宽限 {plan.offlineGraceDays} 天</span>
                              <span>{formatMoney(plan.priceCents, plan.currency)}</span>
                            </div>
                            {plan.featureKeys.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {plan.featureKeys.map((key) => <Tag key={key} color="accent">{key}</Tag>)}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {detailId ? (
                        <CreatePlanModal
                          productId={detailId}
                          existingKeys={detail.data.features.map((feature) => feature.key)}
                          onDone={() => void queryClient.invalidateQueries({ queryKey: ['product', detailId] })}
                        />
                      ) : null}
                    </section>

                    <section>
                      <h3 className="mb-2 text-sm font-medium">功能点</h3>
                      <div className="flex flex-wrap gap-1">
                        {detail.data.features.length === 0
                          ? <p className="text-xs opacity-50">尚未定义功能点</p>
                          : detail.data.features.map((feature) => (
                            <Tag key={feature.id} color="default">{feature.key} · {feature.name}</Tag>
                          ))}
                      </div>
                    </section>

                    <section>
                      <h3 className="mb-2 text-sm font-medium">版本发布</h3>
                      {detail.data.releases.length === 0
                        ? <p className="text-xs opacity-50">尚未登记版本</p>
                        : (
                          <ul className="flex flex-col gap-1 text-xs">
                            {detail.data.releases.map((release) => (
                              <li key={release.id} className="flex items-center justify-between">
                                <span>{release.version} <Chip size="sm" variant="soft"><Chip.Label>{release.channel}</Chip.Label></Chip></span>
                                <span className="opacity-50">{release.publishedAt.slice(0, 10)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                    </section>
                  </>
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function CreateProductModal({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/products', {
        slug, name, description,
        ...(prefix ? { keyPrefix: prefix } : {}),
        status: 'active',
      });
      toast.success('产品已创建');
      setOpen(false);
      setSlug(''); setName(''); setDescription(''); setPrefix('');
      onDone();
    } catch (error) {
      toast.danger('创建失败', { description: error instanceof Error ? error.message : '未知错误' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
        <Plus size={15} /> 新建产品
      </Modal.Trigger>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="md" placement="center">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>新建产品</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <TextField name="slug" value={slug} onChange={setSlug} isRequired fullWidth>
                <Label>产品标识（slug）</Label>
                <Input placeholder="my-app" />
              </TextField>
              <TextField name="name" value={name} onChange={setName} isRequired fullWidth>
                <Label>产品名称</Label>
                <Input placeholder="我的软件" />
              </TextField>
              <TextField name="prefix" value={prefix} onChange={setPrefix} fullWidth>
                <Label>授权码展示前缀（可选）</Label>
                <Input placeholder="MYAPP" />
              </TextField>
              <TextField name="description" value={description} onChange={setDescription} fullWidth>
                <Label>描述</Label>
                <TextArea rows={2} placeholder="用于后台展示" />
              </TextField>
              <p className="text-[11px] opacity-50">
                提示：前缀仅用于展示与批次标记，不参与授权码本身（授权码为 16 位、去除易混字符）。
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
              <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !slug || !name}>
                {busy ? '创建中…' : '创建'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function CreatePlanModal({ productId, existingKeys, onDone }: {
  productId: string;
  existingKeys: string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [licenseType, setLicenseType] = useState<'trial' | 'subscription' | 'perpetual' | 'duration' | 'consumable'>('subscription');
  const [durationDays, setDurationDays] = useState('365');
  const [maxDevices, setMaxDevices] = useState('1');
  const [maxDomains, setMaxDomains] = useState('0');
  const [allowSubdomains, setAllowSubdomains] = useState(true);
  const [price, setPrice] = useState('0');
  const [features, setFeatures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/products/' + productId + '/plans', {
        code,
        name,
        licenseType,
        ...(licenseType === 'perpetual' ? {} : { durationDays: Number(durationDays) }),
        maxDevices: Number(maxDevices),
        maxDomains: Number(maxDomains),
        allowSubdomains,
        priceCents: Math.round(Number(price) * 100),
        featureKeys: features,
      });
      toast.success('策略已创建');
      setOpen(false);
      setCode(''); setName(''); setFeatures([]);
      onDone();
    } catch (error) {
      toast.danger('创建失败', { description: error instanceof Error ? error.message : '未知错误' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={setOpen}>
      <Modal.Trigger className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5">
        <Plus size={13} /> 新增策略
      </Modal.Trigger>
      <Modal.Backdrop isDismissable variant="blur">
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>新增授权策略</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <TextField name="code" value={code} onChange={setCode} isRequired fullWidth>
                  <Label>策略代码</Label>
                  <Input placeholder="pro-yearly" />
                </TextField>
                <TextField name="name" value={name} onChange={setName} isRequired fullWidth>
                  <Label>名称</Label>
                  <Input placeholder="专业版 · 年付" />
                </TextField>
              </div>

              <Select
                name="licenseType"
                placeholder="授权类型"
                selectedKey={licenseType}
                onSelectionChange={(key) => { if (key) setLicenseType(String(key) as typeof licenseType); }}
                fullWidth
              >
                <Label>授权类型</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="trial" textValue="试用">试用</ListBox.Item>
                    <ListBox.Item id="subscription" textValue="订阅">订阅（到期需续费）</ListBox.Item>
                    <ListBox.Item id="perpetual" textValue="永久">永久买断</ListBox.Item>
                    <ListBox.Item id="duration" textValue="时长卡">时长卡</ListBox.Item>
                    <ListBox.Item id="consumable" textValue="次数卡">次数卡</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>

              <div className="grid grid-cols-3 gap-3">
                <TextField name="durationDays" value={durationDays} onChange={setDurationDays} fullWidth isDisabled={licenseType === 'perpetual'}>
                  <Label>有效天数</Label>
                  <Input inputMode="numeric" />
                </TextField>
                <TextField name="maxDevices" value={maxDevices} onChange={setMaxDevices} fullWidth>
                  <Label>设备数（0=不限）</Label>
                  <Input inputMode="numeric" />
                </TextField>
                <TextField name="price" value={price} onChange={setPrice} fullWidth>
                  <Label>价格（元）</Label>
                  <Input inputMode="decimal" />
                </TextField>
              </div>

              {/* 域名授权是与「授权码」完全独立的一条线：这里单独成块配置 */}
              <div className="rounded-xl border border-black/8 p-3 dark:border-white/10">
                <p className="mb-2 text-xs font-medium opacity-70">域名授权（独立于授权码）</p>
                <div className="grid grid-cols-2 gap-3">
                <TextField name="maxDomains" value={maxDomains} onChange={setMaxDomains} fullWidth>
                  <Label>可授权域名数（0 = 不用于域名授权）</Label>
                  <Input inputMode="numeric" />
                </TextField>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs opacity-75">
                    <input
                      type="checkbox"
                      checked={allowSubdomains}
                      onChange={(event) => setAllowSubdomains(event.target.checked)}
                    />
                    允许子域名（授权 example.com 覆盖 *.example.com）
                  </label>
                </div>
                </div>
              </div>

              {existingKeys.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs opacity-60">包含的功能点（点击切换）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {existingKeys.map((key) => {
                      const active = features.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFeatures(active ? features.filter((item) => item !== key) : [...features, key])}
                          className={
                            'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                            (active
                              ? 'border-brand-500 bg-brand-500/12 text-brand-500'
                              : 'border-black/10 opacity-60 hover:opacity-100 dark:border-white/15')
                          }
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
              <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !code || !name}>
                {busy ? '创建中…' : '创建'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}