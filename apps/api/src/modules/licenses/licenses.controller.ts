import {
  Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import {
  BatchCreateLicensesDto, CreateLicenseDto, ExportLicensesDto, ExtendLicenseDto,
  ImportLicensesDto, LicenseActionDto, ListLicensesDto, UpdateLicenseDto,
} from './dto';
import { LicensesService } from './licenses.service';

@ApiTags('admin/licenses')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/licenses')
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '授权列表（支持产品/策略/状态/邮箱/到期/关键字过滤）' })
  list(@Query() query: ListLicensesDto) {
    return this.licenses.list(query);
  }

  @Get('stats')
  @Roles('support')
  @ApiOperation({ summary: '授权状态统计' })
  stats() {
    return this.licenses.stats();
  }

  @Post()
  @Roles('admin')
  @Audit({ action: 'license.create', targetType: 'license' })
  @ApiOperation({ summary: '创建单个授权（返回的明文授权码仅此一次）' })
  create(@Body() dto: CreateLicenseDto, @CurrentUser() user: RequestUser) {
    return this.licenses.create(dto, { id: user.id, email: user.email });
  }

  @Post('batch')
  @Roles('admin')
  @Audit({ action: 'license.batch_create', targetType: 'license', recordBody: true })
  @ApiOperation({ summary: '批量生成授权（最多 5000 条）' })
  batch(@Body() dto: BatchCreateLicensesDto, @CurrentUser() user: RequestUser) {
    return this.licenses.createBatch(dto, { id: user.id, email: user.email });
  }

  @Post('import')
  @Roles('admin')
  @Audit({ action: 'license.import', targetType: 'license', recordBody: false })
  @ApiOperation({ summary: 'CSV 导入授权（支持 dryRun 预检）' })
  import(@Body() dto: ImportLicensesDto, @CurrentUser() user: RequestUser) {
    return this.licenses.importCsv(dto, { id: user.id, email: user.email });
  }

  @Get('export')
  @Roles('admin')
  @Audit({ action: 'license.export', targetType: 'license', recordBody: false })
  @ApiOperation({ summary: '导出 CSV（reveal=true 导出明文并记审计）' })
  async export(
    @Query() query: ExportLicensesDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const csv = await this.licenses.exportCsv(query, { id: user.id, email: user.email });
    const stamp = new Date().toISOString().slice(0, 10);
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', 'attachment; filename="licenses-' + stamp + '.csv"');
    return csv;
  }

  @Get(':id')
  @Roles('support')
  @ApiOperation({ summary: '授权详情（含生命周期事件）' })
  detail(@Param() params: IdParamDto) {
    return this.licenses.detail(params.id);
  }

  @Delete(':id')
  @Roles('admin')
  // 审计由 service 写入（含被删授权的快照），此处不再重复标注
  @ApiOperation({ summary: '删除授权码（不可恢复，写审计）' })
  remove(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.licenses.remove(params.id, { id: user.id, email: user.email });
  }

  @Post('batch-delete')
  @Roles('admin')
  @Audit({ action: 'license.batch_delete', targetType: 'license' })
  @ApiOperation({ summary: '批量删除授权码（按 id 数组，最多 500 条）' })
  removeMany(@Body() dto: { ids: string[] }, @CurrentUser() user: RequestUser) {
    const ids = Array.isArray(dto?.ids) ? dto.ids.slice(0, 500) : [];
    return this.licenses.removeMany(ids, { id: user.id, email: user.email });
  }

  @Get(':id/reveal')
  @Roles('admin')
  @Audit({ action: 'license.reveal_key', targetType: 'license', recordBody: false })
  @ApiOperation({ summary: '查看授权码明文（写审计）' })
  reveal(@Param() params: IdParamDto) {
    return this.licenses.reveal(params.id);
  }

  @Get(':id/activations')
  @Roles('support')
  @ApiOperation({ summary: '该授权的设备绑定记录' })
  activations(@Param() params: IdParamDto) {
    return this.licenses.listActivations(params.id);
  }

  @Patch(':id')
  @Roles('admin')
  @Audit({ action: 'license.update', targetType: 'license' })
  @ApiOperation({ summary: '修改授权（有效期、设备数、功能点、归属邮箱、备注）' })
  update(@Param() params: IdParamDto, @Body() dto: UpdateLicenseDto, @CurrentUser() user: RequestUser) {
    return this.licenses.update(params.id, dto, { id: user.id, email: user.email });
  }

  @Post(':id/revoke')
  @Roles('admin')
  @Audit({ action: 'license.revoke', targetType: 'license' })
  @ApiOperation({ summary: '吊销授权' })
  revoke(@Param() params: IdParamDto, @Body() dto: LicenseActionDto, @CurrentUser() user: RequestUser) {
    return this.licenses.transition(params.id, 'revoke', dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/suspend')
  @Roles('admin')
  @Audit({ action: 'license.suspend', targetType: 'license' })
  @ApiOperation({ summary: '暂停授权（可恢复）' })
  suspend(@Param() params: IdParamDto, @Body() dto: LicenseActionDto, @CurrentUser() user: RequestUser) {
    return this.licenses.transition(params.id, 'suspend', dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/resume')
  @Roles('admin')
  @Audit({ action: 'license.resume', targetType: 'license' })
  @ApiOperation({ summary: '恢复授权' })
  resume(@Param() params: IdParamDto, @Body() dto: LicenseActionDto, @CurrentUser() user: RequestUser) {
    return this.licenses.transition(params.id, 'resume', dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/ban')
  @Roles('admin')
  @Audit({ action: 'license.ban', targetType: 'license' })
  @ApiOperation({ summary: '封禁授权（终态，用于盗版/滥用）' })
  ban(@Param() params: IdParamDto, @Body() dto: LicenseActionDto, @CurrentUser() user: RequestUser) {
    return this.licenses.transition(params.id, 'ban', dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/extend')
  @Roles('admin')
  @Audit({ action: 'license.extend', targetType: 'license' })
  @ApiOperation({ summary: '延长有效期' })
  extend(@Param() params: IdParamDto, @Body() dto: ExtendLicenseDto, @CurrentUser() user: RequestUser) {
    return this.licenses.extend(params.id, dto.days, dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/reset-devices')
  @Roles('admin')
  @Audit({ action: 'license.reset_devices', targetType: 'license' })
  @ApiOperation({ summary: '清空该授权的全部设备绑定' })
  resetDevices(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.licenses.resetDevices(params.id, { id: user.id, email: user.email });
  }

  @Post(':id/reissue')
  @Roles('admin')
  @Audit({ action: 'license.reissue', targetType: 'license' })
  @ApiOperation({ summary: '换发新授权码（旧码立即失效）' })
  reissue(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.licenses.reissue(params.id, { id: user.id, email: user.email });
  }
}