import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Audience, ClientIp, CurrentUser, Public, UserAgent } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import {
  ForgotPasswordDto, PortalLoginDto, PortalRefreshDto, PortalRegisterDto, ResetPasswordDto,
  ResendVerifyDto, VerifyEmailDto,
} from './dto';
import { PortalAuthService } from './portal-auth.service';

@ApiTags('portal/auth')
@Audience('customer')
@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly auth: PortalAuthService) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '客户注册' })
  register(@Body() dto: PortalRegisterDto, @ClientIp() ip: string, @UserAgent() ua: string) {
    return this.auth.register(dto, { ip, userAgent: ua });
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '客户登录' })
  login(@Body() dto: PortalLoginDto, @ClientIp() ip: string, @UserAgent() ua: string) {
    return this.auth.login(dto, { ip, userAgent: ua });
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: '刷新令牌（轮换）' })
  refresh(@Body() dto: PortalRefreshDto, @ClientIp() ip: string, @UserAgent() ua: string) {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent: ua });
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: '退出登录' })
  logout(@Body() dto: PortalRefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Public()
  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '邮箱验证（验证成功后认领历史授权）' })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Post('resend-verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '重发验证邮件（已有未验证账号的恢复路径）' })
  resendVerify(@Body() dto: ResendVerifyDto) {
    return this.auth.resendVerify(dto.email);
  }

  @Public()
  @Post('forgot-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '找回密码（发送重置链接）' })
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: '使用令牌重置密码' })
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('logout-all')
  @ApiOperation({ summary: '注销全部会话（保留当前会话）' })
  logoutAll(@CurrentUser() user: RequestUser) {
    return this.auth.logoutAll(user.id, user.sessionId);
  }
}