import { Type } from 'class-transformer';
import {
  IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { LICENSE_STATUSES, type LicenseStatus } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

/* ------------------------------------------------ 管理端 */

export class CreateDomainLicenseDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsString() @MaxLength(60) planCode?: string;

  @IsOptional() @IsEmail() customerEmail?: string;

  /** 可直接带上要授权的域名（支持多个，逗号或数组） */
  @IsOptional() domains?: string[] | string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) maxDomains?: number;
  @IsOptional() @IsBoolean() allowSubdomains?: boolean;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36500) durationDays?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateDomainLicenseDto {
  @IsOptional() @IsISO8601() expiresAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) maxDomains?: number;
  @IsOptional() @IsBoolean() allowSubdomains?: boolean;
  @IsOptional() @IsString() @MaxLength(60) customerEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
  @IsOptional() @IsIn(LICENSE_STATUSES) status?: LicenseStatus;
}

export class AddDomainDto {
  @IsString() @MinLength(1) @MaxLength(300) domain!: string;
  @IsOptional() @IsIn(['production', 'staging', 'development'])
  environment?: 'production' | 'staging' | 'development';
}

export class ListDomainLicensesDto extends PaginationDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsIn(LICENSE_STATUSES) status?: LicenseStatus;
  @IsOptional() @IsString() @MaxLength(120) customerEmail?: string;
}

export class ExtendDomainLicenseDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(36500) days!: number;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class DomainActionDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

/* ------------------------------------------------ 客户端（网站自助） */

export class DomainActivateDto {
  /** 站点域名，支持带协议/端口/路径，服务端会归一化 */
  @IsString() @MinLength(1) @MaxLength(300) domain!: string;

  @IsOptional() @IsString() @MaxLength(60) product?: string;
  @IsOptional() @IsIn(['production', 'staging', 'development'])
  environment?: 'production' | 'staging' | 'development';
  @IsOptional() @IsString() @MaxLength(300) userAgent?: string;
}

export class DomainVerifyDto {
  @IsString() @MinLength(1) @MaxLength(300) domain!: string;
  @IsOptional() @IsString() @MaxLength(2048) accessToken?: string;
  @IsOptional() @IsString() @MaxLength(300) userAgent?: string;
}

export class DomainDeactivateDto {
  @IsString() @MinLength(1) @MaxLength(300) domain!: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
