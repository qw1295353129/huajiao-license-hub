import { Fragment, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { Fade } from '@/components/animate-ui/primitives/effects/fade';
import { cn } from '@/lib/utils';

export interface Column<T> {
  id: string;
  label: string;
  isRowHeader?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
  render: (item: T) => ReactNode;
}

/**
 * 统一列表表格：语义化 HTML table，外层滚动容器承载横向滚动与边框。
 */
export function DataTable<T extends { id: string }>({
  ariaLabel,
  columns,
  items,
  isLoading,
  emptyTitle = '暂无数据',
  emptyDescription,
  footer,
}: {
  ariaLabel: string;
  columns: Column<T>[];
  items: T[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full">
      <div className="w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full caption-bottom text-sm" aria-label={ariaLabel}>
          <thead className="border-b border-border bg-muted/40">
            <tr>
              {columns.map((column, i) => (
                <Fragment key={i}>
                  <th
                    scope={column.isRowHeader ? 'row' : undefined}
                    className={cn('px-3 py-2 text-left text-xs font-medium text-muted-foreground', column.width)}
                  >
                    <span className={column.align === 'right' ? 'block text-right' : undefined}>{column.label}</span>
                  </th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((item, i) => (
                <Fragment key={item.id ?? i}>
                  <tr data-id={item.id} className="border-b border-border transition-colors hover:bg-muted/30">
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn('px-3 py-2.5 align-middle', column.align === 'right' ? 'text-right' : undefined)}
                      >
                        {column.render(item)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={99} className="p-0">
                  <Fade
                    inView
                    inViewOnce
                    transition={{ type: 'spring', stiffness: 200, damping: 24 }}
                    className="flex flex-col items-center justify-center gap-2 py-10 text-center"
                  >
                    {isLoading ? (
                      <span className="inline-flex items-center gap-2 text-sm opacity-60">
                        <Spinner className="size-4" /> 加载中…
                      </span>
                    ) : (
                      <span className="block">
                        <span className="block text-sm font-medium">{emptyTitle}</span>
                        {emptyDescription ? (
                          <span className="mt-1 block text-xs opacity-55">{emptyDescription}</span>
                        ) : null}
                      </span>
                    )}
                  </Fade>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs opacity-70">
      <span>
        共 {total} 条 · 第 {page} / {pages} 页
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-black/10 px-2 py-1 disabled:opacity-40 dark:border-white/15"
          disabled={page <= 1}
          onClick={() => onChange(page - 1, pageSize)}
        >
          上一页
        </button>
        <button
          type="button"
          className="rounded-md border border-black/10 px-2 py-1 disabled:opacity-40 dark:border-white/15"
          disabled={page >= pages}
          onClick={() => onChange(page + 1, pageSize)}
        >
          下一页
        </button>
        <select
          className="rounded-md border border-black/10 bg-transparent px-1 py-1 dark:border-white/15"
          value={pageSize}
          onChange={(event) => onChange(1, Number(event.target.value))}
          aria-label="每页条数"
        >
          {[10, 20, 50, 100].map((size) => (
            <option key={size} value={size}>{size} 条/页</option>
          ))}
        </select>
      </div>
    </div>
  );
}
