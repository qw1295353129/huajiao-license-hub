import type { ReactNode } from 'react';
import { Table, EmptyState, Spinner } from '@heroui/react';

export interface Column<T> {
  id: string;
  label: string;
  isRowHeader?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
  render: (item: T) => ReactNode;
}

/**
 * 统一列表表格：HeroUI v3 的 Table.Content 承载集合 API。
 * 注意 v3 的 Table 根是 div，aria-label 等必须挂在 Table.Content 上。
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
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={ariaLabel}>
          <Table.Header columns={columns}>
            {(column: Column<T>) => (
              <Table.Column id={column.id} isRowHeader={column.isRowHeader} className={column.width}>
                <span className={column.align === 'right' ? 'block text-right' : undefined}>{column.label}</span>
              </Table.Column>
            )}
          </Table.Header>
          <Table.Body
            items={items}
            renderEmptyState={() => (
              <EmptyState className="py-10 text-center">
                {isLoading ? (
                  <span className="inline-flex items-center gap-2 text-sm opacity-60">
                    <Spinner size="sm" /> 加载中…
                  </span>
                ) : (
                  <span className="block">
                    <span className="block text-sm font-medium">{emptyTitle}</span>
                    {emptyDescription ? (
                      <span className="mt-1 block text-xs opacity-55">{emptyDescription}</span>
                    ) : null}
                  </span>
                )}
              </EmptyState>
            )}
          >
            {(item: T) => (
              <Table.Row id={item.id}>
                {columns.map((column) => (
                  <Table.Cell key={column.id} className={column.align === 'right' ? 'text-right' : undefined}>
                    {column.render(item)}
                  </Table.Cell>
                ))}
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
      {footer}
    </Table>
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
