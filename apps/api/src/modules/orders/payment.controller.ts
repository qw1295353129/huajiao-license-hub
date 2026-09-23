import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators';
import { PaymentCallbackDto } from './dto';
import { OrdersService } from './orders.service';

/**
 * 第三方支付回调入口（公开路由，用 HMAC 签名鉴权）。
 * 需要 main/app.setup 注册的内容类型解析器保留 raw body 才能验签。
 */
@ApiTags('payments')
@Public()
@Controller('payments')
export class PaymentController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':provider/callback')
  @ApiOperation({ summary: '支付渠道回调（HMAC 签名 + 事件去重）' })
  callback(
    @Param('provider') provider: string,
    @Body() dto: PaymentCallbackDto,
    @Headers('x-lh-signature') signature: string | undefined,
    @Req() request: FastifyRequest & { rawBody?: string },
  ) {
    // 不回退为 JSON.stringify(dto)：验签必须基于收到的原始字节，缺失即拒绝
    const rawBody = request.rawBody ?? '';
    return this.orders.handleCallback(provider, dto, rawBody, signature);
  }
}
