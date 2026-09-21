import type { ReactNode } from 'react';
import { Card, Chip, Spinner } from '@heroui/react';

/** 全站共享的展示组件：统一视觉，避免每个页面各写一套。 */

export function PageHeader({ title, description, actions }: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm opacity-60">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  default: 'text-neutral-500',
  accent: 'text-brand-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-rose-500',
};

export function StatCard({ label, value, hint, icon, tone = 'default' }: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  return (
    <Card>
      <Card.Content>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs opacity-55">{label}</p>
          {icon ? <span className={TONE_CLASS[tone]}>{icon}</span> : null}
        </div>
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
        {hint ? <p className="mt-1 text-[11px] opacity-45">{hint}</p> : null}
      </Card.Content>
    </Card>
  );
}

export function Loading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm opacity-60">
      <Spinner size="sm" />
      {label}
    </div>
  );
}

export function EmptyHint({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-black/10 px-6 py-14 text-center dark:border-white/12">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1.5 max-w-md text-xs leading-relaxed opacity-55">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; color: 'default' | 'accent' | 'success' | 'warning' | 'danger' }> = {
  issued: { label: '已发放', color: 'default' },
  active: { label: '已激活', color: 'success' },
  expired: { label: '已过期', color: 'warning' },
  suspended: { label: '已暂停', color: 'warning' },
  revoked: { label: '已吊销', color: 'danger' },
  banned: { label: '已封禁', color: 'danger' },
  draft: { label: '草稿', color: 'default' },
  archived: { label: '已归档', color: 'default' },
  pending: { label: '待支付', color: 'warning' },
  paid: { label: '已支付', color: 'success' },
  cancelled: { label: '已取消', color: 'default' },
  refunded: { label: '已退款', color: 'danger' },
  unused: { label: '未使用', color: 'accent' },
  used: { label: '已使用', color: 'success' },
  void: { label: '已作废', color: 'default' },
};

export function StatusChip({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' | 'lg' }) {
  const meta = STATUS_META[status] ?? { label: status, color: 'default' as const };
  return <Chip color={meta.color} size={size} variant="soft"><Chip.Label>{meta.label}</Chip.Label></Chip>;
}

export function Tag({ children, color = 'default' }: {
  children: ReactNode;
  color?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  return <Chip color={color} size="sm" variant="soft"><Chip.Label>{children}</Chip.Label></Chip>;
}

/** 键值展示行 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid grid-cols-[92px_1fr] gap-3 py-1.5 text-sm">
      <span className="opacity-50">{label}</span>
      <span className="whitespace-pre-wrap break-all leading-relaxed">{children}</span>
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : '未知错误';
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
      <p className="font-medium text-rose-500">加载失败</p>
      <p className="mt-1 opacity-70">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 text-xs underline opacity-70 hover:opacity-100">
          重试
        </button>
      ) : null}
    </div>
  );
}