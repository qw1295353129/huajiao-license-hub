import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'yyyy-MM-dd HH:mm');
  } catch {
    return '—';
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'yyyy-MM-dd');
  } catch {
    return '—';
  }
}

export function fromNow(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return formatDistanceToNow(parseISO(value), { addSuffix: true, locale: zhCN });
  } catch {
    return '—';
  }
}

/** 剩余天数：负数表示已过期；null 表示永久。 */
export function daysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

export function formatMoney(cents: number, currency = 'CNY'): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : '';
  return symbol + (cents / 100).toFixed(2);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

/** 到期状态：用于表格行着色与徽章 */
export type ExpiryTone = 'none' | 'perpetual' | 'expired' | 'critical' | 'warning' | 'ok';

export function expiryTone(expiresAt: string | null | undefined, status?: string): ExpiryTone {
  if (status === 'revoked' || status === 'banned') return 'expired';
  if (!expiresAt) return 'perpetual';
  const days = daysLeft(expiresAt);
  if (days === null) return 'perpetual';
  if (days < 0) return 'expired';
  if (days <= 3) return 'critical';
  if (days <= 14) return 'warning';
  return 'ok';
}
