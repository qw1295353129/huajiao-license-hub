import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { API_KEY_SCOPES, type ApiKeyScope } from '@license-hub/shared';
import { PaginationDto } from '../../common/pagination';

export class CreateApiKeyDto {
  @IsString() @MinLength(1) @MaxLength(60)
  name!: string;

  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(20) @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: ApiKeyScope[];

  @IsOptional() @IsUUID()
  productId?: string;

  @IsOptional() @IsISO8601()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsIn(API_KEY_SCOPES, { each: true }) scopes?: ApiKeyScope[];
  @IsOptional() @IsBoolean() revoked?: boolean;
}

export class ListApiKeysDto extends PaginationDto {
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) declare pageSize?: number;
}
