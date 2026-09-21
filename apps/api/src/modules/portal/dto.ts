import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/pagination';

export class PortalRegisterDto {
  @IsEmail() email!: string;
  @IsString() @Length(8, 128) @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码至少 8 位且需同时包含字母和数字' })
  password!: string;
  @IsOptional() @IsString() @MaxLength(60) name?: string;
}

export class PortalLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(6) @MaxLength(128) password!: string;
}

export class PortalRefreshDto {
  @IsString() @MinLength(10) refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
  @IsString() @Length(8, 128) @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '密码至少 8 位且需同时包含字母和数字' })
  password!: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
}

export class ChangePortalPasswordDto {
  @IsString() @MinLength(6) @MaxLength(128) currentPassword!: string;
  @IsString() @Length(8, 128) @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '新密码至少 8 位且需同时包含字母和数字' })
  newPassword!: string;
}

export class ListMyLicensesDto extends PaginationDto {}

export class ListMyOrdersDto extends PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) declare pageSize?: number;
}
