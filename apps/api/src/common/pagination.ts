import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 所有列表接口共用的分页参数。 */
export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;

  @IsOptional() @IsString() @MaxLength(120)
  q?: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function normalizePaging(page?: number, pageSize?: number): { page: number; pageSize: number; offset: number } {
  const safePage = Math.max(1, Math.floor(page ?? 1));
  const safeSize = Math.min(200, Math.max(1, Math.floor(pageSize ?? 20)));
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}
