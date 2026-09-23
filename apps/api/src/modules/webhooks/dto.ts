import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString,
  IsUrl, Max, MaxLength, Min, MinLength, registerDecorator,
  type ValidationOptions, type ValidationArguments,
} from 'class-validator';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

/**
 * N15（SSRF）：Webhook 目标地址不得指向内网/链路本地/云元数据主机。
 * - 始终拦截：localhost/*.local、RFC1918 私网、CGNAT、169.254.0.0/16（含 169.254.169.254）、
 *   IPv6 unique-local (fc00::/7) 与 link-local (fe80::/10)、0.0.0.0/8、非 http(s)。
 * - 回环（127.0.0.0/8、::1）放行：自托管部署与验收脚本常向本机接收端投递；
 *   仅管理员可配置 URL，云元数据与私网仍拦截。DNS rebinding 不在本检查范围内。
 */
export function isSafeWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return !isBlockedWebhookHost(parsed.hostname);
}

function isBlockedWebhookHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;

  // IPv4（含 ::ffff:a.b.c.d 形式的映射地址归一到点分四段再判断）
  if (host.startsWith('::ffff:') && host.includes('.')) {
    host = host.slice('::ffff:'.length);
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return false;                       // 回环：本机接收端/验收允许
    if (a === 169 && b === 254) return true;           // 链路本地 / 云元数据
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }

  // IPv6
  if (host.includes(':')) {
    if (host === '::') return true;
    if (host === '::1') return false;                  // 回环：允许
    if (/^f[cd]/.test(host)) return true;              // fc00::/7 unique local
    if (/^fe[89ab]/.test(host)) return true;           // fe80::/10 link-local
    return false;
  }

  return false;
}

/** class-validator 装饰器：在 IsUrl 基础上追加内网/元数据主机拦截。 */
export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isSafeWebhookUrl',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isSafeWebhookUrl(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} 不能指向内网/元数据主机（仅允许公网 http/https；本机回环地址允许用于本地接收端）`;
        },
      },
    });
  };
}

export class CreateWebhookDto {
  // require_protocol: validator 在 require_tld=false 时会把 "not-a-url" 当作合法主机名
  @IsUrl(
    { require_tld: false, require_protocol: true, protocols: ['http', 'https'] },
    { message: '必须是带 http(s):// 的合法地址' },
  )
  @IsSafeWebhookUrl()
  @MaxLength(500)
  url!: string;

  @IsOptional() @IsString() @MaxLength(120) description?: string;

  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events!: WebhookEvent[];

  /** 自定义签名密钥；留空则由系统生成 */
  @IsOptional() @IsString() @MinLength(16) @MaxLength(120) secret?: string;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }, { message: '必须是带 http(s):// 的合法地址' })
  @IsSafeWebhookUrl()
  @MaxLength(500)
  url?: string;
  @IsOptional() @IsString() @MaxLength(120) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(WEBHOOK_EVENTS.length) @IsIn(WEBHOOK_EVENTS, { each: true }) events?: WebhookEvent[];
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
  @IsOptional() @IsBoolean() @Type(() => Boolean) rotateSecret?: boolean;
}

export class ListDeliveriesDto extends PaginationDto {
  @IsOptional() @IsString() endpointId?: string;
  @IsOptional() @IsIn(['pending', 'success', 'failed']) status?: 'pending' | 'success' | 'failed';
  /** 按事件类型过滤（如 license.activated） */
  @IsOptional() @IsIn(WEBHOOK_EVENTS)
  event?: WebhookEvent;
}

export class TestWebhookDto {
  @IsOptional() @IsString() @MaxLength(60) event?: string;
}