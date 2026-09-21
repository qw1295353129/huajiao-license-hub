import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, ClientIp, CurrentUser, Public, Roles, UserAgent } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { AdminAuthService } from './admin-auth.service';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ADMIN_ROLES, type AdminRole } from '@license-hub/shared';
import { BootstrapAdminDto, ChangePasswordDto, DisableTotpDto, EnableTotpDto, LoginDto, RefreshDto } from './dto';

class UpdateAdminDto {
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsOptional() @IsIn(ADMIN_ROLES) role?: AdminRole;
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
}

class CreateAdminDto extends BootstrapAdminDto {
  @IsOptional() @IsIn(ADMIN_ROLES) declare role?: AdminRole;
}

class ResetAdminPasswordDto {
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) newPassword?: string;
}

@ApiTags('admin/auth')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: '管理员登录（启用双因素时需带 totp）' })
  login(@Body() dto: LoginDto, @ClientIp() ip: string, @UserAgent() ua: string) {
    return this.auth.login({ ...dto, ip, userAgent: ua });
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '刷新访问令牌（refresh 轮换）' })
  refresh(@Body() dto: RefreshDto, @ClientIp() ip: string, @UserAgent() ua: string) {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent: ua });
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: '注销当前刷新令牌' })
  async logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @ApiOperation({ summary: '当前管理员信息' })
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.id);
  }

  @Post('password')
  @Audit({ action: 'admin.password_changed', targetType: 'admin', recordBody: false })
  @ApiOperation({ summary: '修改自己的密码' })
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto);
  }

  @Post('2fa/setup')
  @ApiOperation({ summary: '生成 TOTP 密钥（返回 otpauth URI）' })
  setupTotp(@CurrentUser() user: RequestUser) {
    return this.auth.setupTotp(user.id);
  }

  @Post('2fa/enable')
  @Audit({ action: 'admin.2fa_enabled', targetType: 'admin', recordBody: false })
  @ApiOperation({ summary: '校验动态码并启用双因素' })
  enableTotp(@CurrentUser() user: RequestUser, @Body() dto: EnableTotpDto) {
    return this.auth.enableTotp(user.id, dto.code);
  }

  @Post('2fa/disable')
  @Audit({ action: 'admin.2fa_disabled', targetType: 'admin', recordBody: false })
  @ApiOperation({ summary: '关闭双因素（需密码 + 动态码）' })
  disableTotp(@CurrentUser() user: RequestUser, @Body() dto: DisableTotpDto) {
    return this.auth.disableTotp(user.id, dto.password, dto.code);
  }

  @Get('sessions')
  @ApiOperation({ summary: '我的登录会话列表' })
  sessions(@CurrentUser() user: RequestUser, @Query('current') current?: string) {
    return this.auth.listSessions(user.id, current ?? user.sessionId);
  }

  @Delete('sessions/:id')
  @Audit({ action: 'admin.session_revoked', targetType: 'session' })
  @ApiOperation({ summary: '踢下线指定会话' })
  revokeSession(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.auth.revokeSession(user.id, id);
  }

  @Get('roles')
  @Roles('support')
  @ApiOperation({ summary: '角色列表（示例：需要 support 及以上）' })
  roles() {
    return {
      roles: ADMIN_ROLES,
      matrix: {
        owner: '全部权限，含团队管理与签名密钥轮换',
        admin: '业务全权：产品、授权、订单、卡密、Webhook、客户',
        support: '只读 + 查看明文授权码以外的查询能力',
        readonly: '仅只读',
      },
    };
  }

  /* ---------------- 团队管理（仅 owner） ---------------- */

  @Get('team')
  @Roles('owner')
  @ApiOperation({ summary: '管理员列表' })
  team() {
    return this.auth.listAdmins();
  }

  @Post('team')
  @Roles('owner')
  @Audit({ action: 'admin.create', targetType: 'admin', recordBody: false })
  @ApiOperation({ summary: '新增管理员（可指定角色）' })
  createAdmin(@Body() dto: CreateAdminDto, @CurrentUser() user: RequestUser) {
    return this.auth.createAdmin({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      role: dto.role ?? 'admin',
      actorId: user.id,
      actorLabel: user.email,
    });
  }

  @Patch('team/:id')
  @Roles('owner')
  @Audit({ action: 'admin.update', targetType: 'admin', recordBody: false })
  @ApiOperation({ summary: '修改管理员角色 / 停用启用' })
  updateAdmin(@Param('id') id: string, @Body() dto: UpdateAdminDto, @CurrentUser() user: RequestUser) {
    return this.auth.updateAdmin(id, dto, user.id);
  }

  @Post('team/:id/reset-password')
  @Roles('owner')
  @Audit({ action: 'admin.reset_password', targetType: 'admin', recordBody: false })
  @ApiOperation({ summary: '重置管理员密码（返回一次性随机密码）' })
  resetAdminPassword(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.auth.resetAdminPassword(id, user.id);
  }
}