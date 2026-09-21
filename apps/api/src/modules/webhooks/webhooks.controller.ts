import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import { WEBHOOK_EVENTS } from '@license-hub/shared';
import { CreateWebhookDto, ListDeliveriesDto, TestWebhookDto, UpdateWebhookDto } from './dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('admin/webhooks')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('events')
  @Roles('support')
  @ApiOperation({ summary: '可订阅的事件清单' })
  events() {
    return { events: WEBHOOK_EVENTS };
  }

  @Get()
  @Roles('support')
  @ApiOperation({ summary: 'Webhook 端点列表（含投递统计）' })
  list() {
    return this.webhooks.list();
  }

  @Post()
  @Roles('admin')
  @Audit({ action: 'webhook.create', targetType: 'webhook', recordBody: false })
  @ApiOperation({ summary: '创建 Webhook（签名密钥仅返回一次）' })
  create(@Body() dto: CreateWebhookDto, @CurrentUser() user: RequestUser) {
    return this.webhooks.create(dto, { id: user.id });
  }

  @Patch(':id')
  @Roles('admin')
  @Audit({ action: 'webhook.update', targetType: 'webhook', recordBody: false })
  @ApiOperation({ summary: '修改 Webhook（rotateSecret=true 时轮换密钥）' })
  update(@Param() params: IdParamDto, @Body() dto: UpdateWebhookDto) {
    return this.webhooks.update(params.id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  @Audit({ action: 'webhook.delete', targetType: 'webhook' })
  @ApiOperation({ summary: '删除 Webhook' })
  remove(@Param() params: IdParamDto) {
    return this.webhooks.remove(params.id);
  }

  @Get(':id/secret')
  @Roles('owner')
  @Audit({ action: 'webhook.reveal_secret', targetType: 'webhook', recordBody: false })
  @ApiOperation({ summary: '查看签名密钥（仅 owner，写审计）' })
  reveal(@Param() params: IdParamDto) {
    return this.webhooks.revealSecret(params.id);
  }

  @Post(':id/test')
  @Roles('admin')
  @Audit({ action: 'webhook.test', targetType: 'webhook' })
  @ApiOperation({ summary: '发送测试事件并返回投递结果' })
  test(@Param() params: IdParamDto, @Body() dto: TestWebhookDto) {
    return this.webhooks.test(params.id, dto.event);
  }

  @Get('deliveries')
  @Roles('support')
  @ApiOperation({ summary: '投递日志' })
  deliveries(@Query() query: ListDeliveriesDto) {
    return this.webhooks.listDeliveries(query);
  }

  @Post('deliveries/:id/replay')
  @Roles('admin')
  @Audit({ action: 'webhook.replay', targetType: 'webhook_delivery' })
  @ApiOperation({ summary: '重放单条投递' })
  replay(@Param() params: IdParamDto) {
    return this.webhooks.replay(params.id);
  }

  @Post('deliveries/replay-failed')
  @Roles('admin')
  @Audit({ action: 'webhook.replay_failed', targetType: 'webhook' })
  @ApiOperation({ summary: '批量重放失败投递' })
  async replayFailed(@Query('endpointId') endpointId?: string) {
    const requeued = await this.webhooks.replayFailed(endpointId);
    return { ok: true, requeued };
  }
}
