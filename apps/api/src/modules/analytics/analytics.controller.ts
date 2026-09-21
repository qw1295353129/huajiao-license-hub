import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audience, Roles } from '../../common/decorators';
import { AnalyticsService } from './analytics.service';

@ApiTags('admin/dashboard')
@ApiBearerAuth('admin')
@Audience('admin')
@Roles('support')
@Controller('admin/dashboard')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @ApiOperation({ summary: '看板总览：KPI + 30 天趋势 + 最近操作 + 即将到期' })
  overview() {
    return this.analytics.overview();
  }

  @Get('summary')
  @ApiOperation({ summary: '仅 KPI' })
  summary() {
    return this.analytics.summary();
  }

  @Get('timeseries')
  @ApiOperation({ summary: '时间序列' })
  timeseries(@Query('days') days?: string) {
    return this.analytics.timeseries(days ? Number(days) : 30);
  }
}
