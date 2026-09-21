import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@licensehub.local' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @ApiProperty({ example: 'Admin@12345' })
  @IsString()
  @MinLength(6, { message: '密码至少 6 位' })
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ description: '启用双因素后的 6 位动态码' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: '动态码必须是 6 位数字' })
  totp?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(6)
  currentPassword!: string;

  @ApiProperty({ description: '至少 8 位，且包含字母与数字' })
  @IsString()
  @Length(8, 128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: '新密码至少 8 位且需同时包含字母和数字' })
  newPassword!: string;
}

export class EnableTotpDto {
  @ApiProperty({ description: '认证器 App 显示的 6 位动态码' })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class DisableTotpDto {
  @ApiProperty()
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class SessionIdParamDto {
  @ApiProperty()
  @IsString()
  id!: string;
}

export class BootstrapAdminDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(8, 128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ description: '是否创建为 owner 角色' })
  @IsOptional()
  @IsBoolean()
  owner?: boolean;
}
