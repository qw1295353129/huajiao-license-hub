import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import { CreateRedeemBatchDto, ListRedeemBatchesDto, ListRedeemCodesDto } from './dto';
import { RedeemService } from './redeem.service';

@ApiTags('admin/redeem')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/redeem')
export class RedeemController {
  constructor(private readonly redeem: RedeemService) {}

  @Get('batches')
  @Roles('support')
  @ApiOperation({ summary: '卡密批次列表' })
  listBatches(@Query() query: ListRedeemBatchesDto) {
    return this.redeem.listBatches(query);
  }

  @Post('batches')
  @Roles('admin')
  @Audit({ action: 'redeem.batch_create', targetType: 'redeem_batch', recordBody: true })
  @ApiOperation({ summary: '生成卡密批次（明文仅返回一次）' })
  createBatch(@Body() dto: CreateRedeemBatchDto, @CurrentUser() user: RequestUser) {
    return this.redeem.createBatch(dto, { id: user.id, email: user.email });
  }

  @Get('codes')
  @Roles('support')
  @ApiOperation({ summary: '卡密列表（掩码）' })
  listCodes(@Query() query: ListRedeemCodesDto) {
    return this.redeem.listCodes(query);
  }

  @Get('batches/:id/export')
  @Roles('admin')
  @Audit({ action: 'redeem.export', targetType: 'redeem_batch', recordBody: false })
  @ApiOperation({ summary: '导出批次卡密 CSV（默认含明文）' })
  async exportBatch(
    @Param() params: IdParamDto,
    @Query('reveal') reveal: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const csv = await this.redeem.exportCodes(params.id, reveal !== 'false');
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', 'attachment; filename="redeem-codes.csv"');
    return csv;
  }

  @Post('codes/:id/void')
  @Roles('admin')
  @Audit({ action: 'redeem.code_void', targetType: 'redeem_code' })
  @ApiOperation({ summary: '作废单张卡密' })
  voidCode(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.redeem.voidCode(params.id, { id: user.id });
  }

  @Delete('batches/:id')
  @Roles('admin')
  @Audit({ action: 'redeem.batch_void', targetType: 'redeem_batch' })
  @ApiOperation({ summary: '作废批次内所有未使用卡密' })
  voidBatch(@Param() params: IdParamDto) {
    return this.redeem.voidBatch(params.id);
  }
}
