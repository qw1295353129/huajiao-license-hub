import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import {
  AddDomainDto, CreateDomainLicenseDto, DomainActionDto, ExtendDomainLicenseDto,
  ListDomainLicensesDto, UpdateDomainLicenseDto,
} from './dto';
import { DomainLicensesService } from './domain-licenses.service';

/** 域名授权管理（与授权码完全分开的一套体系）。 */
@ApiTags('admin/domain-licenses')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/domain-licenses')
export class DomainLicensesController {
  constructor(private readonly domains: DomainLicensesService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '域名授权列表' })
  list(@Query() query: ListDomainLicensesDto) {
    return this.domains.list(query);
  }

  @Get('stats')
  @Roles('support')
  @ApiOperation({ summary: '域名授权统计' })
  stats() {
    return this.domains.stats();
  }

  @Post()
  @Roles('admin')
  @Audit({ action: 'domain_license.create', targetType: 'domain_license' })
  @ApiOperation({ summary: '新建域名授权（可直接带上要授权的域名）' })
  create(@Body() dto: CreateDomainLicenseDto, @CurrentUser() user: RequestUser) {
    return this.domains.create(dto, { id: user.id, email: user.email });
  }

  @Get(':id')
  @Roles('support')
  @ApiOperation({ summary: '域名授权详情（含已授权域名与事件）' })
  detail(@Param() params: IdParamDto) {
    return this.domains.detail(params.id);
  }

  @Patch(':id')
  @Roles('admin')
  @Audit({ action: 'domain_license.update', targetType: 'domain_license' })
  @ApiOperation({ summary: '修改域名授权（到期、额度、子域、归属、状态）' })
  update(@Param() params: IdParamDto, @Body() dto: UpdateDomainLicenseDto, @CurrentUser() user: RequestUser) {
    return this.domains.update(params.id, dto, { id: user.id, email: user.email });
  }

  @Delete(':id')
  @Roles('admin')
  @Audit({ action: 'domain_license.delete', targetType: 'domain_license' })
  @ApiOperation({ summary: '删除域名授权（连带解绑其域名）' })
  remove(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.domains.remove(params.id, { id: user.id, email: user.email });
  }

  @Post(':id/revoke')
  @Roles('admin')
  @Audit({ action: 'domain_license.revoke', targetType: 'domain_license' })
  @ApiOperation({ summary: '吊销域名授权' })
  revoke(@Param() params: IdParamDto, @Body() dto: DomainActionDto, @CurrentUser() user: RequestUser) {
    return this.domains.transition(params.id, 'revoke', dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/suspend')
  @Roles('admin')
  @Audit({ action: 'domain_license.suspend', targetType: 'domain_license' })
  @ApiOperation({ summary: '暂停域名授权' })
  suspend(@Param() params: IdParamDto, @Body() dto: DomainActionDto, @CurrentUser() user: RequestUser) {
    return this.domains.transition(params.id, 'suspend', dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/resume')
  @Roles('admin')
  @Audit({ action: 'domain_license.resume', targetType: 'domain_license' })
  @ApiOperation({ summary: '恢复域名授权' })
  resume(@Param() params: IdParamDto, @Body() dto: DomainActionDto, @CurrentUser() user: RequestUser) {
    return this.domains.transition(params.id, 'resume', dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/extend')
  @Roles('admin')
  @Audit({ action: 'domain_license.extend', targetType: 'domain_license' })
  @ApiOperation({ summary: '延长有效期' })
  extend(@Param() params: IdParamDto, @Body() dto: ExtendDomainLicenseDto, @CurrentUser() user: RequestUser) {
    return this.domains.extend(params.id, dto.days, dto.reason, { id: user.id, email: user.email });
  }

  @Post(':id/domains')
  @Roles('admin')
  @Audit({ action: 'domain_license.add_domain', targetType: 'domain_license' })
  @ApiOperation({ summary: '为该授权绑定一个域名' })
  addDomain(@Param() params: IdParamDto, @Body() dto: AddDomainDto, @CurrentUser() user: RequestUser) {
    return this.domains.addDomain(params.id, dto, { id: user.id, email: user.email, type: 'admin' });
  }

  @Delete('domains/:domainId')
  @Roles('admin')
  @Audit({ action: 'domain_license.remove_domain', targetType: 'authorized_domain' })
  @ApiOperation({ summary: '解绑某个已授权域名' })
  removeDomain(@Param('domainId') domainId: string, @CurrentUser() user: RequestUser) {
    return this.domains.removeDomain(domainId, { id: user.id, email: user.email, type: 'admin' }, 'admin_unbind');
  }
}
