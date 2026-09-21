import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { REDEEM_STATUSES, type RedeemStatus } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

export class CreateRedeemBatchDto {
  @IsString() @MinLength(1) @MaxLength(60)
  name!: string;

  @IsUUID()
  productId!: string;

  @IsOptional() @IsUUID()
  planId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  planCode?: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(5000)
  quantity!: number;

  @IsOptional() @IsISO8601()
  expiresAt?: string;

  @IsOptional() @IsString() @MaxLength(40)
  channel?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

export class ListRedeemBatchesDto extends PaginationDto {
  @IsOptional() @IsUUID() productId?: string;
}

export class ListRedeemCodesDto extends PaginationDto {
  @IsOptional() @IsUUID() batchId?: string;
  @IsOptional() @IsIn(REDEEM_STATUSES) status?: RedeemStatus;
}

export class RedeemCodeDto {
  @IsString() @MinLength(6) @MaxLength(40)
  code!: string;
}

export class AdminRedeemDto extends RedeemCodeDto {
  @IsOptional() @IsEmail()
  email?: string;
}
