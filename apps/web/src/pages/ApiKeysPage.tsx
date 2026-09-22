import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Chip, Input, Label, ListBox, Modal, Select, TextArea, TextField, toast,
} from '@heroui/react';
import type { Key } from '@heroui/react';
import { API_KEY_SCOPES, type ApiKeyScope } from '@license-hub/shared';
import { Copy, Eye, KeySquare, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '@/lib/api';
import type { ApiKeyRow, Paginated, ProductRow } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, StatCard, StatusChip, Tag } from '@/components/common/ui';
import { fromNow } from '@/lib/format';

const SCOPE_LABEL: Record<ApiKeyScope, string> = {
  'license:read': '查询权益',
  'license:activate': '激活授权',
  'license:verify': '心跳校验',
  'license:deactivate': '解绑设备',
  'license:trial': '发放试用',
  'license:create': '创建授权',
  'license:revoke': '吊销授权',
  'device:read': '查询设备',
};

/** 接口密钥：给你的软件（客户端）调用授权接口用的。明文只在创建时显示一次。 */
export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => api.get<Paginated<ProductRow>>('/api/admin/products' + qs({ pageSize: 100 })),
  });

  const list = useQuery({
    queryKey: ['api-keys', page, pageSize],
    queryFn: () => api.get<Paginated<ApiKeyRow>>('/api/admin/api-keys' + qs({ page, pageSize })),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['api-keys'] });

  const columns: Column<ApiKeyRow>[] = [
    {
      id: 'name', label: '名称 / 密钥', isRowHeader: true,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[13px] font-medium">{row.name}</span>
          <span className="mono-code text-[11px] opacity-60">{row.keyMasked}</span>
        </div>
      ),
    },
    {
      id: 'scopes', label: '作用域',
      render: (row) => (
        <div className="flex max-w-[280px] flex-wrap gap-1">
          {row.scopes.slice(0, 3).map((scope) => <Tag key={scope} color="accent">{SCOPE_LABEL[scope] ?? scope}</Tag>)}
          {row.scopes.length > 3 ? <Tag color="default">+{row.scopes.length - 3}</Tag> : null}
        </div>
      ),
    },
    { id: 'status', label: '状态', render: (row) => <StatusChip status={row.status === 'active' ? 'active' : 'archived'} /> },
    {
      id: 'used', label: '最近使用',
      render: (row) => <span className="text-[11px] opacity-60">{row.lastUsedAt ? fromNow(row.lastUsedAt) : '从未使用'}</span>,
    },
    {
      id: 'actions', label: '操作', align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onPress={async () => {
              try {
                const res = await api.get<{ key: string }>('/api/admin/api-keys/' + row.id + '/reveal');
                void navigator.clipboard.writeText(res.key);
                toast.success('密钥已复制到剪贴板', { description: res.key, timeout: 0 });
              } catch (error) {
                toast.danger('无法查看', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            <Eye size={13} /> 查看
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={async () => {
              const next = row.status === 'active' ? true : false;
              if (next && !window.confirm('吊销该密钥？使用它的客户端会立即失效。')) return;
              try {
                await api.patch('/api/admin/api-keys/' + row.id, { revoked: next });
                toast.success(next ? '已吊销' : '已恢复');
                refresh();
              } catch (error) {
                toast.danger('操作失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            {row.status === 'active' ? '吊销' : '恢复'}
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            onPress={async () => {
              if (!window.confirm('删除密钥「' + row.name + '」？删除后无法恢复，使用它的客户端会立即失效。')) return;
              try {
                await api.delete('/api/admin/api-keys/' + row.id);
                toast.success('已删除');
                refresh();
              } catch (error) {
                toast.danger('删除失败', { description: error instanceof Error ? error.message : '' });
              }
            }}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  const items = list.data?.items ?? [];
  const activeCount = items.filter((row) => row.status === 'active').length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="接口密钥"
        description="给你的软件调用授权接口用的密钥；明文只在创建时显示一次，之后只能在此查看"
        actions={<CreateApiKeyModal products={products.data?.items ?? []} onDone={refresh} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="密钥总数" value={list.data?.total ?? '—'} icon={<KeySquare size={16} />} />
        <StatCard label="本页启用中" value={activeCount} tone="success" />
        <StatCard
          label="本页已吊销"
          value={items.filter((row) => row.status !== 'active').length}
          tone="danger"
        />
        <StatCard
          label="从未使用"
          value={items.filter((row) => !row.lastUsedAt).length}
          tone="warning"
        />
      </div>

      <DataTable
        ariaLabel="接口密钥列表"
        columns={columns}
        items={items}
        isLoading={list.isLoading}
        emptyTitle="还没有接口密钥"
        emptyDescription="点右上角「新建密钥」，给你的软件分配一个（按需勾选作用域）。"
        footer={
          <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
        }
      />

      <Card className="mt-4">
        <Card.Content>
          <p className="text-xs opacity-60">
            用法：客户端在请求头带上 <code className="mono-code">X-Api-Key: lh_live_xxx</code> 调用
            <code className="mono-code"> /api/v1/activate</code> 等接口。作用域遵循最小权限，例如只发码不校验时不要勾「心跳校验」。
          </p>
        </Card.Content>
      </Card>
    </div>
  );
}

function CreateApiKeyModal({ products, onDone }: { products: ProductRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['license:activate', 'license:verify', 'license:read']);
  const [productId, setProductId] = useState<Key | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ key: string }>('/api/admin/api-keys', {
        name,
        scopes,
        ...(productId ? { productId: String(productId) } : {}),
      });
      setCreated(res.key);
      void navigator.clipboard.writeText(res.key).catch(() => undefined);
      toast.success('密钥已创建并复制到剪贴板');
      onDone();
    } catch (error) {
      toast.danger('创建失败', { description: error instanceof Error ? error.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next) setCreated(null); }}>
      <Modal.Trigger className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
        <Plus size={15} /> 新建密钥
      </Modal.Trigger>
      <Modal.Backdrop isDismissable={!created} variant="blur">
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{created ? '密钥已创建' : '新建接口密钥'}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4">
              {created ? (
                <>
                  <p className="text-sm">
                    请立即保存：<span className="text-rose-500">明文只显示这一次</span>（已复制到剪贴板），
                    之后只能在本页点「查看」重新复制。
                  </p>
                  <TextArea readOnly rows={2} value={created} className="mono-code text-xs" />
                </>
              ) : (
                <>
                  <TextField name="name" value={name} onChange={setName} isRequired fullWidth>
                    <Label>名称</Label>
                    <Input placeholder="例如：桌面客户端 v1" />
                  </TextField>

                  <div>
                    <p className="mb-1.5 text-xs opacity-60">作用域（点击切换，建议按最小权限勾选）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {API_KEY_SCOPES.map((scope) => {
                        const active = scopes.includes(scope);
                        return (
                          <button
                            key={scope}
                            type="button"
                            onClick={() => setScopes(active ? scopes.filter((item) => item !== scope) : [...scopes, scope])}
                            className={
                              'rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                              (active
                                ? 'border-brand-500 bg-brand-500/12 text-brand-500'
                                : 'border-black/10 opacity-60 hover:opacity-100 dark:border-white/15')
                            }
                          >
                            {SCOPE_LABEL[scope] ?? scope}
                            <span className="ml-1 opacity-50">{scope}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Select name="product" placeholder="不限制产品" selectedKey={productId}
                    onSelectionChange={setProductId} fullWidth>
                    <Label>绑定产品（可选）</Label>
                    <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {products.map((product) => (
                          <ListBox.Item key={product.id} id={product.id} textValue={product.name}>{product.name}</ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </>
              )}
            </Modal.Body>
            {created ? (
              <Modal.Footer>
                <Chip color="success" size="sm" variant="soft"><Chip.Label>已复制</Chip.Label></Chip>
                <Button variant="ghost" onPress={() => { void navigator.clipboard.writeText(created); toast.success('已再次复制'); }}>
                  <Copy size={14} /> 再复制一次
                </Button>
              </Modal.Footer>
            ) : (
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setOpen(false)}>取消</Button>
                <Button variant="primary" onPress={() => void submit()} isDisabled={busy || !name || scopes.length === 0}>
                  {busy ? '创建中…' : '创建并复制'}
                </Button>
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
