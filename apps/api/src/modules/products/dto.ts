import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/pagination';
import {
  LICENSE_TYPES, OVER_LIMIT_POLICIES, PLAN_STATUSES, PRODUCT_STATUSES, RELEASE_CHANNELS,
  type LicenseType, type OverLimitPolicy, type PlanStatus, type ProductStatus, type ReleaseChannel,
} from '@license-hub/shared';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$/;

export class CreateProductDto {
  @IsString() @Matches(SLUG_RE, { message: 'slug 只能包含小写字母、数字与中划线（3~50 位）' })
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(500)
  logoUrl?: string;

  @IsOptional() @IsString() @MaxLength(500)
  websiteUrl?: string;

  @IsOptional() @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @IsOptional() @IsString() @MaxLength(12)
  keyPrefix?: string;
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) websiteUrl?: string;
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
  @IsOptional() @IsString() @MaxLength(12) keyPrefix?: string;
}

export class CreateFeatureDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{0,48}$/i, { message: '功能点 key 只能包含字母、数字、点、下划线、中划线' })
  key!: string;

  @IsString() @MinLength(1) @MaxLength(60)
  name!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;
}

export class CreatePlanDto {
  @IsString() @Matches(CODE_RE, { message: 'code 只能包含小写字母、数字、下划线、中划线' })
  code!: string;

  @IsString() @MinLength(1) @MaxLength(80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsIn(LICENSE_TYPES)
  licenseType!: LicenseType;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36500)
  durationDays?: number | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  maxDevices?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650)
  offlineGraceDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8760)
  heartbeatIntervalHours?: number;

  @IsOptional() @IsIn(OVER_LIMIT_POLICIES)
  overLimitPolicy?: OverLimitPolicy;

  @IsOptional() @IsBoolean()
  requireDeviceApproval?: boolean;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  featureKeys?: string[];

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxUsages?: number | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  priceCents?: number;

  @IsOptional() @IsString() @MaxLength(8)
  currency?: string;
}

export class UpdatePlanDto extends CreatePlanDto {
  @IsOptional() @IsString() @Matches(CODE_RE) declare code: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) declare name: string;
  @IsOptional() @IsIn(LICENSE_TYPES) declare licenseType: LicenseType;
  @IsOptional() @IsIn(PLAN_STATUSES) status?: PlanStatus;
}

export class CreateReleaseDto {
  @IsString() @MaxLength(40)
  version!: string;

  @IsOptional() @IsIn(RELEASE_CHANNELS)
  channel?: ReleaseChannel;

  @IsOptional() @IsString() @MaxLength(4000)
  notes?: string;

  @IsOptional() @IsString() @MaxLength(500)
  downloadUrl?: string;

  @IsOptional() @IsISO8601()
  publishedAt?: string;
}

export class ProductListDto extends PaginationDto {
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
}

export class IdParamDto {
  @IsUUID() id!: string;
}
