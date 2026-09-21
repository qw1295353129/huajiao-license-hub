import { useQuery } from '@tanstack/react-query';
import { Card, Chip, Separator } from '@heroui/react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, KeyRound, MonitorSmartphone, Receipt, TrendingUp, Users } from 'lucide-react';
import type { DashboardSummary, TimeseriesPoint } from '@license-hub/shared';
import { api } from '@/lib/api';
import { ErrorNotice, Loading, PageHeader, StatCard } from '@/components/common/ui';
import { formatMoney, formatNumber } from '@/lib/format';

interface OverviewResponse {
  summary: DashboardSummary;
  timeseries: TimeseriesPoint[];
  recentEvents: { id: string; action: string; actorEmail: string | null; createdAt: string }[];
  expiringSoon: { id: string; keyMasked: string; productName: string; expiresAt: string }[];
}

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<OverviewResponse>('/api/admin/dashboard'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Loading label="正在汇总运营数据…" />;
  if (error) return <ErrorNotice error={error} onRetry={() => void refetch()} />;
  if (!data) return null;

  const { summary, timeseries } = data;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="运营概览"
        description="授权、激活、收入的实时快照（每 60 秒自动刷新）"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="授权总数"
          value={formatNumber(summary.totalLicenses)}
          hint={'近 7 天新增 ' + formatNumber(summary.newLicenses7Days)}
          icon={<KeyRound size={16} />}
          tone="accent"
        />
        <StatCard
          label="有效授权"
          value={formatNumber(summary.activeLicenses)}
          hint={'7 天内到期 ' + formatNumber(summary.expiringIn7Days)}
          icon={<Activity size={16} />}
          tone="success"
        />
        <StatCard
          label="今日激活"
          value={formatNumber(summary.activationsToday)}
          hint={'7 日活跃设备 ' + formatNumber(summary.activeDevices7Days)}
          icon={<TrendingUp size={16} />}
          tone="accent"
        />
        <StatCard
          label="累计收入"
          value={formatMoney(summary.revenueTotalCents)}
          hint={'近 30 天 ' + formatMoney(summary.revenue30DaysCents)}
          icon={<Receipt size={16} />}
          tone="success"
        />
        <StatCard label="客户数" value={formatNumber(summary.totalCustomers)} icon={<Users size={16} />} />
        <StatCard label="设备数" value={formatNumber(summary.totalDevices)} icon={<MonitorSmartphone size={16} />} />
        <StatCard
          label="试用转化率"
          value={(summary.trialConversionRate * 100).toFixed(1) + '%'}
          hint="试用后 30 天内付费比例"
          icon={<TrendingUp size={16} />}
          tone="warning"
        />
        <StatCard
          label="即将到期"
          value={formatNumber(summary.expiringIn7Days)}
          hint="建议提前发送续费提醒"
          icon={<Activity size={16} />}
          tone="warning"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Card.Header>
            <Card.Title>近 30 天趋势</Card.Title>
            <Card.Description>激活、心跳校验与新增授权</Card.Description>
          </Card.Header>
          <Card.Content>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeseries} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="gAct" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.72 0.15 165)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="oklch(0.72 0.15 165)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.12} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
                  <ChartTooltip
                    contentStyle={{
                      background: 'var(--color-neutral-900)',
                      border: 'none',
                      borderRadius: 10,
                      fontSize: 12,
                      color: 'white',
                    }}
                  />
                  <Area type="monotone" dataKey="activations" name="激活" stroke="var(--color-brand-500)" fill="url(#gAct)" strokeWidth={2} />
                  <Area type="monotone" dataKey="newLicenses" name="新增授权" stroke="oklch(0.72 0.15 165)" fill="url(#gNew)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>最近操作</Card.Title>
            <Card.Description>来自审计日志</Card.Description>
          </Card.Header>
          <Card.Content>
            {data.recentEvents.length === 0 ? (
              <p className="py-6 text-center text-xs opacity-45">暂无操作记录</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.recentEvents.slice(0, 8).map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">{event.action}</span>
                    <span className="shrink-0 opacity-45">{event.actorEmail ?? 'system'}</span>
                  </li>
                ))}
              </ul>
            )}
            <Separator className="my-3" />
            <p className="mb-2 text-xs font-medium opacity-60">7 天内到期</p>
            {data.expiringSoon.length === 0 ? (
              <p className="py-2 text-center text-xs opacity-45">没有即将到期的授权</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.expiringSoon.slice(0, 5).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="mono-code truncate">{item.keyMasked}</span>
                    <Chip color="warning" size="sm" variant="soft">
                      <Chip.Label>{item.expiresAt.slice(0, 10)}</Chip.Label>
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}
