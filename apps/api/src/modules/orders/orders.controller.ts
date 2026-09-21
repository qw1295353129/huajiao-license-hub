import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import { CreateOrderDto, ListOrdersDto, MarkPaidDto, RefundOrderDto } from './dto';
import { OrdersService } from './orders.service';

@ApiTags('admin/orders')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '订单列表' })
  list(@Query() query: ListOrdersDto) {
    return this.orders.list(query);
  }

  @Get('stats')
  @Roles('support')
  @ApiOperation({ summary: '订单与收入统计' })
  stats() {
    return this.orders.stats();
  }

  @Post()
  @Roles('admin')
  @Audit({ action: 'order.create', targetType: 'order' })
  @ApiOperation({ summary: '手工建单（线下收款场景可带 markPaid 直接发码）' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: RequestUser) {
    return this.orders.create(dto, { id: user.id, email: user.email });
  }

  @Get(':id')
  @Roles('support')
  @ApiOperation({ summary: '订单详情（含明细与已发授权）' })
  detail(@Param() params: IdParamDto) {
    return this.orders.detail(params.id);
  }

  @Post(':id/mark-paid')
  @Roles('admin')
  @Audit({ action: 'order.mark_paid', targetType: 'order' })
  @ApiOperation({ summary: '标记已支付并自动发码（幂等）' })
  markPaid(@Param() params: IdParamDto, @Body() dto: MarkPaidDto) {
    return this.orders.markPaid(params.id, dto);
  }

  @Post(':id/issue-licenses')
  @Roles('admin')
  @Audit({ action: 'order.issue_licenses', targetType: 'order' })
  @ApiOperation({ summary: '为尚未发码的订单项补发授权' })
  async issue(@Param() params: IdParamDto) {
    const licenses = await this.orders.issueMissingLicenses(params.id);
    return { ok: true, issued: licenses.length, licenses };
  }

  @Post(':id/refund')
  @Roles('admin')
  @Audit({ action: 'order.refund', targetType: 'order' })
  @ApiOperation({ summary: '退款（默认同时吊销关联授权）' })
  refund(@Param() params: IdParamDto, @Body() dto: RefundOrderDto, @CurrentUser() user: RequestUser) {
    return this.orders.refund(params.id, dto, { id: user.id, email: user.email });
  }

  @Post(':id/cancel')
  @Roles('admin')
  @Audit({ action: 'order.cancel', targetType: 'order' })
  @ApiOperation({ summary: '取消待支付订单' })
  cancel(@Param() params: IdParamDto) {
    return this.orders.cancel(params.id);
  }
}
