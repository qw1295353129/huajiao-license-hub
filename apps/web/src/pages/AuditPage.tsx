import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input, Label, TextField } from '@heroui/react';
import { api, qs } from '@/lib/api';
import type { Paginated } from '@/lib/types';
import { DataTable, Pagination, type Column } from '@/components/common/DataTable';
import { ErrorNotice, PageHeader, Tag } from '@/components/common/ui';
import { formatDateTime } from '@/lib/format';

interface AuditRow {
  id: string;
  actorType: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  diff: { request?: unknown; after?: unknown } | null;
  createdAt: string;
}

const ACTION_TONE = (action: string): 'default' | 'danger' | 'warning' | 'success' | 'accent' => {
  if (/revoke|delete|ban|blacklist|void|refund/.test(action)) return 'danger';
  if (/create|paid|approve/.test(action)) return 'success';
  if (/login_failed|lock/.test(action)) return 'warning';
  if (/login|reveal/.test(action)) return 'accent';
  return 'default';
};

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [targetId, setTargetId] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['audit', page, pageSize, action, actor, targetId],
    queryFn: () => api.get<Paginated<AuditRow>>('/api/admin/audit-logs' + qs({
      page, pageSize,
      action: action || undefined,
      actorEmail: actor || undefined,
      targetId: targetId || undefined,
    })),
  });

  const columns: Column<AuditRow>[] = [
    {
      id: 'action', label: '动作', isRowHeader: true,
      render: (row) => (
        <button type="button" className="text-left" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
          <Tag color={ACTION_TONE(row.action)}>{row.action}</Tag>
        </button>
      ),
    },
    {
      id: 'actor', label: '操作者',
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-[12px]">{row.actorEmail ?? row.actorId ?? row.actorType}</span>
          <span className="text-[11px] opacity-45">{row.actorType}</span>
        </div>
      ),
    },
    {
      id: 'target', label: '目标',
      render: (row) => (
        <span className="mono-code text-[11px] opacity-70">
          {row.targetType ? row.targetType + ' · ' + (row.targetId ?? '').slice(0, 8) : '—'}
        </span>
      ),
    },
    { id: 'ip', label: 'IP', render: (row) => <span className="text-[11px] opacity-55">{row.ip ?? '—'}</span> },
    { id: 'time', label: '时间', align: 'right', render: (row) => <span className="text-[11px] opacity-60">{formatDateTime(row.createdAt)}</span> },
  ];

  if (list.error) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />;

  const expandedRow = (list.data?.items ?? []).find((item) => item.id === expanded);

  return (
    <div className="animate-fade-in">
      <PageHeader title="审计日志" description="所有管理端写操作、登录与敏感信息查看都会留痕（只读）" />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <TextField name="action" value={action} onChange={(value) => { setAction(value); setPage(1); }} fullWidth>
            <Label>动作包含</Label>
            <Input placeholder="license / webhook …" />
          </TextField>
        </div>
        <div className="w-56">
          <TextField name="actor" value={actor} onChange={(value) => { setActor(value); setPage(1); }} fullWidth>
            <Label>操作者邮箱</Label>
            <Input placeholder="admin@example.com" />
          </TextField>
        </div>
        <div className="w-56">
          <TextField name="target" value={targetId} onChange={(value) => { setTargetId(value); setPage(1); }} fullWidth>
            <Label>目标 ID</Label>
            <Input placeholder="授权 / 订单 / 客户 UUID" />
          </TextField>
        </div>
      </div>

      <DataTable
        ariaLabel="审计日志"
        columns={columns}
        items={list.data?.items ?? []}
        isLoading={list.isLoading}
        emptyTitle="没有匹配的日志"
        emptyDescription="调整筛选条件，或先在后台做一次操作。"
        footer={
          <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0}
            onChange={(nextPage, nextSize) => { setPage(nextPage); setPageSize(nextSize); }} />
        }
      />

      {expandedRow ? (
        <div className="mt-4 rounded-xl border border-black/8 p-4 dark:border-white/10">
          <p className="mb-2 text-xs font-medium opacity-70">
            变更详情 · {expandedRow.action} · {formatDateTime(expandedRow.createdAt)}
          </p>
          <pre className="max-h-72 overflow-auto rounded-lg bg-black/5 p-3 text-[11px] leading-relaxed dark:bg-white/5">
            {JSON.stringify(expandedRow.diff ?? {}, null, 2)}
          </pre>
          <p className="mt-2 text-[11px] opacity-45">
            requestId: {expandedRow.requestId ?? '—'} · UA: {expandedRow.userAgent ?? '—'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
