import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Audit, Audience, Roles } from '../../common/decorators';
import { SettingsService } from './settings.service';

class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(60) siteName?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) allowRegistration?: boolean;
  @IsOptional() @IsString() @MaxLength(8) defaultCurrency?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) trialDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) selfUnbindPer30d?: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) expireReminderDays?: number[];
}

class SetSecretDto {
  @IsString() @MinLength(3) @MaxLength(80) key!: string;
  @IsString() @MinLength(8) @MaxLength(200) value!: string;
}

@ApiTags('admin/settings')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '站点设置' })
  get() {
    return this.settings.get();
  }

  @Patch()
  @Roles('admin')
  @Audit({ action: 'settings.update', targetType: 'settings' })
  @ApiOperation({ summary: '更新站点设置' })
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }

  @Get('secrets')
  @Roles('admin')
  @ApiOperation({ summary: '第三方密钥配置状态（不返回值）' })
  listSecrets() {
    return this.settings.listSecrets();
  }

  @Post('secrets')
  @Roles('owner')
  @Audit({ action: 'settings.set_secret', targetType: 'settings', recordBody: false })
  @ApiOperation({ summary: '写入第三方密钥（加密存储，仅 owner）' })
  setSecret(@Body() dto: SetSecretDto) {
    return this.settings.setSecret(dto.key, dto.value);
  }
}
