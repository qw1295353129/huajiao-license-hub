import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, ClientIp, CurrentUser, Public, Roles, UserAgent } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { AdminAuthService } from './admin-auth.service';
import { ChangePasswordDto, DisableTotpDto, EnableTotpDto, LoginDto, RefreshDto } from './dto';

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
    return { roles: ['owner', 'admin', 'support', 'readonly'] };
  }
}
