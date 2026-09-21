import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ORDER_PROVIDERS, ORDER_STATUSES, type OrderProvider, type OrderStatus } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

export class OrderItemDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsString() @MaxLength(60) planCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) quantity?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unitPriceCents?: number;
}

export class CreateOrderDto {
  @IsEmail() email!: string;

  @IsOptional() @IsUUID() customerId?: string;

  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsOptional() @IsString() @MaxLength(40) couponCode?: string;
  @IsOptional() @IsIn(ORDER_PROVIDERS) provider?: OrderProvider;
  @IsOptional() @IsString() @MaxLength(120) providerRef?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** 建单后直接标记为已支付（线下收款场景） */
  @IsOptional() @IsBoolean() @Type(() => Boolean) markPaid?: boolean;
}

export class ListOrdersDto extends PaginationDto {
  @IsOptional() @IsIn(ORDER_STATUSES) status?: OrderStatus;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export class RefundOrderDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) revokeLicenses?: boolean;
}

export class MarkPaidDto {
  @IsOptional() @IsIn(ORDER_PROVIDERS) provider?: OrderProvider;
  @IsOptional() @IsString() @MaxLength(120) providerRef?: string;
}

export class PaymentCallbackDto {
  @IsString() @MaxLength(120) eventId!: string;
  @IsOptional() @IsString() @MaxLength(60) orderNo?: string;
  @IsOptional() @IsString() @MaxLength(120) providerRef?: string;
  @IsIn(['paid', 'refunded', 'cancelled']) status!: 'paid' | 'refunded' | 'cancelled';
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) amountCents?: number;
}
