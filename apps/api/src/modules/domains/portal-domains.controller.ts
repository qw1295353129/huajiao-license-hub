import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audience, CurrentUser } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { AddDomainDto } from './dto';
import { DomainLicensesService } from './domain-licenses.service';

/** 客户门户：查看自己的域名授权、在额度内自助添加/解绑域名。 */
@ApiTags('portal/domains')
@ApiBearerAuth('admin')
@Audience('customer')
@Controller('portal/domain-licenses')
export class PortalDomainsController {
  constructor(private readonly domains: DomainLicensesService) {}

  @Get()
  @ApiOperation({ summary: '我的域名授权（含已授权域名）' })
  list(@CurrentUser() user: RequestUser) {
    return this.domains.listForCustomer(user.id, user.email);
  }

  @Post(':id/domains')
  @ApiOperation({ summary: '添加域名（受额度限制）' })
  addDomain(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: AddDomainDto) {
    return this.domains.addDomainForCustomer(user.id, user.email, id, dto.domain);
  }

  @Delete('domains/:domainId')
  @ApiOperation({ summary: '解绑域名' })
  removeDomain(@CurrentUser() user: RequestUser, @Param('domainId') domainId: string) {
    return this.domains.removeDomainForCustomer(user.id, user.email, domainId);
  }
}
