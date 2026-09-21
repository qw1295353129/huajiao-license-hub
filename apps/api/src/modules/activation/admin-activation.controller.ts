import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import { ActivationService } from './activation.service';
import { ListActivationsDto, OfflineResponseDto } from './dto';

class BlacklistDto {
  @IsBoolean() blacklisted!: boolean;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

class ReasonDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

@ApiTags('admin/devices')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin')
export class AdminActivationController {
  constructor(private readonly activation: ActivationService) {}

  @Get('activations')
  @Roles('support')
  @ApiOperation({ summary: '设备绑定记录（可按状态过滤，pending 为待审批）' })
  listActivations(@Query() query: ListActivationsDto) {
    return this.activation.listActivations(query);
  }

  @Post('activations/:id/approve')
  @Roles('admin')
  @Audit({ action: 'activation.approve', targetType: 'activation' })
  @ApiOperation({ summary: '批准待审批设备' })
  approve(@Param() params: IdParamDto, @CurrentUser() user: RequestUser) {
    return this.activation.approveActivation(params.id, { id: user.id, email: user.email });
  }

  @Delete('activations/:id')
  @Roles('admin')
  @Audit({ action: 'activation.revoke', targetType: 'activation' })
  @ApiOperation({ summary: '强制解绑设备' })
  revoke(@Param() params: IdParamDto, @Body() dto: ReasonDto, @CurrentUser() user: RequestUser) {
    return this.activation.revokeActivation(params.id, { id: user.id, email: user.email }, dto.reason);
  }

  @Get('devices')
  @Roles('support')
  @ApiOperation({ summary: '设备注册表' })
  listDevices(@Query() query: ListActivationsDto) {
    return this.activation.listDevices(query);
  }

  @Post('devices/:id/blacklist')
  @Roles('admin')
  @Audit({ action: 'device.blacklist', targetType: 'device' })
  @ApiOperation({ summary: '封禁 / 解封设备' })
  blacklist(@Param() params: IdParamDto, @Body() dto: BlacklistDto, @CurrentUser() user: RequestUser) {
    return this.activation.blacklistDevice(params.id, dto.blacklisted, dto.reason, { id: user.id });
  }

  @Post('licenses/:id/offline-response')
  @Roles('admin')
  @Audit({ action: 'license.offline_response', targetType: 'license' })
  @ApiOperation({ summary: '用离线请求码换取响应码（离线激活）' })
  offlineResponse(@Param() params: IdParamDto, @Body() dto: OfflineResponseDto) {
    return this.activation.offlineResponse(params.id, dto.requestCode, dto.offlineGraceDays);
  }
}
