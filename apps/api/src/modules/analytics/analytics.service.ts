/**
 * 看板聚合查询。
 *
 * 说明：这里刻意使用原始 SQL —— 聚合、窗口与 generate_series 用 Query Builder 表达反而更晦涩，
 * 而且这些语句是只读统计，不涉及注入风险（所有变量都通过参数占位符传入）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { DashboardSummary, TimeseriesPoint } from '@license-hub/shared';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';

/** node-postgres 与 PGlite 都返回 { rows }，此处统一取行数组。 */
async function runQuery<T>(handle: DatabaseHandle, query: SQL): Promise<T[]> {
  const result = (await handle.db.execute(query)) as unknown;
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB) private readonly handle: DatabaseHandle) {}

  async summary(): Promise<DashboardSummary> {
    const [licenseStats] = await runQuery<Record<string, unknown>>(this.handle, sql`
      select
        count(*)::int as total,
        count(*) filter (where status = 'active' and (expires_at is null or expires_at > now()))::int as active,
        count(*) filter (where expires_at is not null and expires_at between now() and now() + interval '7 days'
                          and status in ('active', 'issued'))::int as expiring,
        count(*) filter (where created_at >= now() - interval '7 days')::int as new_7d
      from licenses
    `);

    const [customerStats] = await runQuery<Record<string, unknown>>(this.handle, sql`
      select count(*)::int as total from customers
    `);

    const [deviceStats] = await runQuery<Record<string, unknown>>(this.handle, sql`
      select
        (select count(*)::int from devices) as total,
        (select count(distinct device_id)::int from verification_logs
           where device_id is not null and at >= now() - interval '7 days') as active_7d
    `);

    const [activationStats] = await runQuery<Record<string, unknown>>(this.handle, sql`
      select count(*)::int as today
      from license_events
      where type = 'activated' and created_at >= date_trunc('day', now())
    `);

    const [revenueStats] = await runQuery<Record<string, unknown>>(this.handle, sql`
      select
        coalesce(sum(total_cents) filter (where status = 'paid'), 0)::int as total,
        coalesce(sum(total_cents) filter (where status = 'paid' and paid_at >= now() - interval '30 days'), 0)::int as last_30d
      from orders
    `);

    // 试用转化：同一设备指纹后来拿到了非试用授权（发码时写入 licenses.metadata.trialFingerprint）
    const [trialStats] = await runQuery<Record<string, unknown>>(this.handle, sql`
      select
        (select count(*)::int from trials) as total_trials,
        (select count(distinct t.fingerprint_hash)::int
           from trials t
           join licenses l
             on l.source <> 'trial'
            and l.metadata->>'trialFingerprint' = t.fingerprint_hash
        ) as converted
    `);

    const totalTrials = toNumber(trialStats?.total_trials);
    const converted = toNumber(trialStats?.converted);

    return {
      totalLicenses: toNumber(licenseStats?.total),
      activeLicenses: toNumber(licenseStats?.active),
      expiringIn7Days: toNumber(licenseStats?.expiring),
      newLicenses7Days: toNumber(licenseStats?.new_7d),
      totalCustomers: toNumber(customerStats?.total),
      totalDevices: toNumber(deviceStats?.total),
      activeDevices7Days: toNumber(deviceStats?.active_7d),
      activationsToday: toNumber(activationStats?.today),
      revenueTotalCents: toNumber(revenueStats?.total),
      revenue30DaysCents: toNumber(revenueStats?.last_30d),
      trialConversionRate: totalTrials > 0 ? Math.min(1, converted / totalTrials) : 0,
    };
  }

  async timeseries(days = 30): Promise<TimeseriesPoint[]> {
    const safeDays = Math.min(365, Math.max(1, Math.floor(days)));
    const data = await runQuery<Record<string, unknown>>(this.handle, sql`
      with series as (
        select generate_series(
          -- 含今天在内共 safeDays 个点
          (current_date - make_interval(days => ${safeDays - 1}))::date,
          current_date,
          interval '1 day'
        )::date as day
      )
      select
        to_char(s.day, 'MM-DD') as date,
        coalesce((select count(*)::int from license_events e
                   where e.type = 'activated' and e.created_at::date = s.day), 0) as activations,
        coalesce((select count(*)::int from verification_logs v
                   where v.at::date = s.day), 0) as verifications,
        coalesce((select count(*)::int from licenses l
                   where l.created_at::date = s.day), 0) as new_licenses
      from series s
      order by s.day asc
    `);
    return data.map((row) => ({
      date: String(row.date),
      activations: toNumber(row.activations),
      verifications: toNumber(row.verifications),
      newLicenses: toNumber(row.new_licenses),
    }));
  }

  async recentEvents(limit = 10) {
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    return runQuery<{ id: string; action: string; actor_email: string | null; created_at: Date }>(
      this.handle,
      sql`
        select id, action, actor_email, created_at
        from audit_logs
        order by created_at desc
        limit ${safeLimit}
      `,
    );
  }

  async expiringSoon(limit = 10) {
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    return runQuery<{ id: string; key_masked: string; product_name: string; expires_at: Date }>(
      this.handle,
      sql`
        select l.id, l.key_masked, p.name as product_name, l.expires_at
        from licenses l
        join products p on p.id = l.product_id
        where l.expires_at is not null
          and l.expires_at between now() and now() + interval '7 days'
          and l.status in ('active', 'issued')
        order by l.expires_at asc
        limit ${safeLimit}
      `,
    );
  }

  async overview() {
    const [summary, timeseries, recent, expiring] = await Promise.all([
      this.summary(),
      this.timeseries(30),
      this.recentEvents(10),
      this.expiringSoon(5),
    ]);
    return {
      summary,
      timeseries,
      recentEvents: recent.map((row) => ({
        id: String(row.id),
        action: String(row.action),
        actorEmail: row.actor_email,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      expiringSoon: expiring.map((row) => ({
        id: String(row.id),
        keyMasked: String(row.key_masked),
        productName: String(row.product_name),
        expiresAt: new Date(row.expires_at).toISOString(),
      })),
    };
  }
}