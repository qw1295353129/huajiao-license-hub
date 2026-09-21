import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString,
  IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/pagination';
import { LICENSE_SOURCES, LICENSE_STATUSES, type LicenseSource, type LicenseStatus } from '@license-hub/shared';

export class CreateLicenseDto {
  @IsUUID()
  productId!: string;

  @IsOptional() @IsUUID()
  planId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  planCode?: string;

  @IsOptional() @IsString() @MaxLength(64)
  customerEmail?: string;

  /** 自定义授权码（留空自动生成）。仅支持字母数字，会被归一化。 */
  @IsOptional() @IsString() @MinLength(12) @MaxLength(40)
  key?: string;

  @IsOptional() @IsISO8601()
  expiresAt?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36500)
  durationDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  maxDevices?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  featureKeys?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  maxUsages?: number;

  /** 覆盖策略的域名额度（0 = 关闭域名授权） */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  maxDomains?: number;

  @IsOptional() @IsBoolean()
  allowSubdomains?: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  @IsOptional() @IsIn(LICENSE_SOURCES)
  source?: LicenseSource;
}

export class BatchCreateLicensesDto {
  @IsUUID()
  productId!: string;

  @IsOptional() @IsUUID()
  planId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  planCode?: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(5000)
  count!: number;

  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36500) durationDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) maxDevices?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) featureKeys?: string[];
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() @MaxLength(60) batchLabel?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) maxDomains?: number;
  @IsOptional() @IsBoolean() allowSubdomains?: boolean;
}

export class UpdateLicenseDto {
  @IsOptional() @IsISO8601() expiresAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) maxDevices?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) featureKeys?: string[];
  @IsOptional() @IsString() @MaxLength(64) customerEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) remainingUsages?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) maxDomains?: number;
  @IsOptional() @IsBoolean() allowSubdomains?: boolean;
}

export class LicenseActionDto {
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

export class ExtendLicenseDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(36500)
  days!: number;

  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

export class ListLicensesDto extends PaginationDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(LICENSE_STATUSES) status?: LicenseStatus;
  @IsOptional() @IsString() @MaxLength(120) customerEmail?: string;
  @IsOptional() @IsIn(LICENSE_SOURCES) source?: LicenseSource;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) expiringInDays?: number;
  @IsOptional() @IsIn(['createdAt', 'expiresAt', 'lastVerifiedAt', 'activationCount'])
  sortBy?: 'createdAt' | 'expiresAt' | 'lastVerifiedAt' | 'activationCount';
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}

export class ExportLicensesDto extends ListLicensesDto {
  /** 是否导出授权码明文（默认只导出掩码，导出明文会写审计） */
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  reveal?: boolean;
}

export class ImportLicensesDto {
  /** CSV 文本，列：product_slug, plan_code, key?, customer_email?, expires_at?, duration_days?, max_devices?, notes? */
  @IsString() @MinLength(3)
  csv!: string;

  @IsOptional() @IsBoolean()
  dryRun?: boolean;
}

export class RedeemInputDto {
  @IsString() @MinLength(6) @MaxLength(40)
  code!: string;

  @IsOptional() @IsEmail()
  email?: string;
}