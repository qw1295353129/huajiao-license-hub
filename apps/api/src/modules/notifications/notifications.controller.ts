import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Audience, Roles } from '../../common/decorators';
import { NotificationsService } from './notifications.service';

class ListEmailLogsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

@ApiTags('admin/email')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/email-logs')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '邮件发送日志（未配置 SMTP 时只记录不发送）' })
  list(@Query() query: ListEmailLogsDto) {
    return this.notifications.list(query);
  }

  @Get('status')
  @Roles('support')
  @ApiOperation({ summary: '邮件通道配置状态' })
  status() {
    return {
      smtpConfigured: this.notifications.enabled,
      hint: this.notifications.enabled ? '已配置 SMTP，邮件会真实发送' : '未配置 SMTP：邮件只写日志，不会外发',
    };
  }
}
