import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString,
  IsUrl, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

export class CreateWebhookDto {
  // require_protocol: validator 在 require_tld=false 时会把 "not-a-url" 当作合法主机名
  @IsUrl(
    { require_tld: false, require_protocol: true, protocols: ['http', 'https'] },
    { message: '必须是带 http(s):// 的合法地址' },
  )
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