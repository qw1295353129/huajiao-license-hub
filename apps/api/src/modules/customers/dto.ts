import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CUSTOMER_STATUSES, type CustomerStatus } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

export class ListCustomersDto extends PaginationDto {
  @IsOptional() @IsIn(CUSTOMER_STATUSES) status?: CustomerStatus;
}

export class CreateCustomerDto {
  @IsEmail() email!: string;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsIn(CUSTOMER_STATUSES) status?: CustomerStatus;
}

export class ResetCustomerPasswordDto {
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) newPassword?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) sendEmail?: boolean;
}

export class AdminCustomerListDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) declare pageSize?: number;
}
