import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export class DeviceDto {
  /** 设备指纹：客户端自行生成（建议 硬件序列号/安装 ID 的哈希）。 */
  @IsString() @MinLength(8) @MaxLength(256)
  fingerprint!: string;

  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(40)
  os?: string;

  @IsOptional() @IsString() @MaxLength(40)
  appVersion?: string;
}

export class ActivateDto {
  @IsString() @MinLength(8) @MaxLength(40)
  licenseKey!: string;

  @IsOptional() @IsString() @MaxLength(60)
  product?: string;

  @ValidateNested() @Type(() => DeviceDto)
  device!: DeviceDto;
}

export class VerifyDto {
  @IsOptional() @IsString() @MaxLength(40)
  licenseKey?: string;

  /** 激活时返回的短期令牌（快路径，避免每次都查授权码） */
  @IsOptional() @IsString() @MaxLength(2048)
  accessToken?: string;

  @ValidateNested() @Type(() => DeviceDto)
  device!: DeviceDto;
}

export class DeactivateDto {
  @IsString() @MinLength(8) @MaxLength(40)
  licenseKey!: string;

  @ValidateNested() @Type(() => DeviceDto)
  device!: DeviceDto;

  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}

export class TrialDto {
  @IsString() @MaxLength(60)
  product!: string;

  @ValidateNested() @Type(() => DeviceDto)
  device!: DeviceDto;

  @IsOptional() @IsString() @MaxLength(120)
  email?: string;
}

export class EntitlementsQueryDto {
  @IsOptional() @IsString() @MaxLength(40)
  licenseKey?: string;

  @IsOptional() @IsString() @MaxLength(256)
  fingerprint?: string;

  @IsOptional() @IsString() @MaxLength(60)
  product?: string;
}

export class OfflineRequestDto {
  @IsOptional() @IsString() @MaxLength(40)
  licenseKey?: string;

  @IsString() @MaxLength(60)
  product!: string;

  @ValidateNested() @Type(() => DeviceDto)
  device!: DeviceDto;
}

export class OfflineActivateDto {
  @IsString() @MinLength(20) @MaxLength(8000)
  requestCode!: string;

  @IsString() @MinLength(20) @MaxLength(20000)
  responseCode!: string;
}

export class OfflineResponseDto {
  @IsString() @MinLength(20) @MaxLength(8000)
  requestCode!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650)
  offlineGraceDays?: number;
}

export class VersionCheckQueryDto {
  @IsString() @MaxLength(60)
  product!: string;

  @IsOptional() @IsIn(['stable', 'beta', 'alpha'])
  channel?: 'stable' | 'beta' | 'alpha';
}

export class ListActivationsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
  @IsOptional() @IsIn(['active', 'deactivated', 'blocked', 'pending']) status?: 'active' | 'deactivated' | 'blocked' | 'pending';
}
