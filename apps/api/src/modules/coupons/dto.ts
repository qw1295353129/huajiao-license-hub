import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { COUPON_TYPES, type CouponType } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

export class CreateCouponDto {
  @IsString() @MinLength(3) @MaxLength(40)
  code!: string;

  @IsIn(COUPON_TYPES)
  type!: CouponType;

  @Type(() => Number) @IsInt() @Min(1)
  value!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) maxUses?: number;
  @IsOptional() @IsISO8601() validFrom?: string;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) planIds?: string[];
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class UpdateCouponDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) value?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxUses?: number;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class ListCouponsDto extends PaginationDto {
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
}
