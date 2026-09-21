import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audience, CurrentUser } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import { ChangePortalPasswordDto, ListMyLicensesDto, ListMyOrdersDto, UpdateProfileDto } from './dto';
import { PortalAuthService } from './portal-auth.service';
import { PortalService } from './portal.service';

@ApiTags('portal')
@ApiBearerAuth('admin')
@Audience('customer')
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly portalAuth: PortalAuthService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: '我的资料与统计' })
  me(@CurrentUser() user: RequestUser) {
    return this.portal.me(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: '修改资料' })
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.portal.updateProfile(user.id, dto);
  }

  @Post('me/password')
  @ApiOperation({ summary: '修改密码（注销其它会话，保留当前）' })
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePortalPasswordDto) {
    return this.portalAuth.changePassword(user.id, dto.currentPassword, dto.newPassword, user.sessionId);
  }

  @Get('licenses')
  @ApiOperation({ summary: '我的授权' })
  licenses(@CurrentUser() user: RequestUser, @Query() query: ListMyLicensesDto) {
    return this.portal.licenses(user.id, query);
  }

  @Get('licenses/:id')
  @ApiOperation({ summary: '授权详情（含设备列表）' })
  licenseDetail(@CurrentUser() user: RequestUser, @Param() params: IdParamDto) {
    return this.portal.licenseDetail(user.id, params.id);
  }

  @Delete('licenses/:id/devices/:activationId')
  @ApiOperation({ summary: '自助解绑设备（每 30 天限次）' })
  unbind(
    @CurrentUser() user: RequestUser,
    @Param('id') licenseId: string,
    @Param('activationId') activationId: string,
  ) {
    return this.portal.unbindDevice(user.id, licenseId, activationId);
  }

  @Delete('licenses/:id/domains/:domainId')
  @ApiOperation({ summary: '自助解绑域名（换站点时使用）' })
  unbindDomain(
    @CurrentUser() user: RequestUser,
    @Param('id') licenseId: string,
    @Param('domainId') domainId: string,
  ) {
    return this.portal.unbindDomain(user.id, licenseId, domainId);
  }

  @Get('orders')
  @ApiOperation({ summary: '我的订单' })
  orders(@CurrentUser() user: RequestUser, @Query() query: ListMyOrdersDto) {
    return this.portal.orders(user.id, query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: '订单详情' })
  orderDetail(@CurrentUser() user: RequestUser, @Param() params: IdParamDto) {
    return this.portal.orderDetail(user.id, params.id);
  }

  @Post('redeem')
  @ApiOperation({ summary: '卡密兑换' })
  redeem(@CurrentUser() user: RequestUser, @Body() dto: { code: string }) {
    return this.portal.redeem(user.id, dto.code);
  }

  @Get('downloads')
  @ApiOperation({ summary: '可下载的版本（按已购产品过滤）' })
  downloads(@CurrentUser() user: RequestUser) {
    return this.portal.downloads(user.id);
  }
}