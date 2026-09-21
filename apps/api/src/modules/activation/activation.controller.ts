import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { Public, RequireScopes } from '../../common/decorators';
import { ClientIp } from '../../common/decorators';
import { ActivationService, type CallContext } from './activation.service';
import { LicenseSignerService } from './license-signer.service';
import { ProductsService } from '../products/products.service';
import {
  ActivateDomainDto, ActivateDto, DeactivateDomainDto, DeactivateDto, EntitlementsQueryDto,
  OfflineActivateDto, OfflineRequestDto, TrialDto, VerifyDomainDto, VerifyDto, VersionCheckQueryDto,
} from './dto';

/**
 * 客户端授权 API（/api/v1）。
 * 认证方式：X-Api-Key（作用域受限），与后台的 Bearer 令牌体系完全隔离。
 */
@ApiTags('client/v1')
@ApiHeader({ name: 'X-Api-Key', description: '接入应用密钥', required: true })
@Public()
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class ActivationController {
  constructor(
    private readonly activation: ActivationService,
    private readonly signer: LicenseSignerService,
    private readonly products: ProductsService,
  ) {}

  @Get('public-key')
  @ApiOperation({ summary: '获取授权文件验签公钥（含历史 kid）' })
  async publicKey() {
    const keys = await this.signer.listPublicKeys();
    const active = keys.find((key) => key.status === 'active') ?? keys[0] ?? null;
    return {
      algo: 'ed25519',
      canonicalization: 'JSON 键按字典序、无空白；sig 字段不参与签名',
      current: active ? { kid: active.kid, publicKey: active.publicKey } : null,
      keys: keys.map((key) => ({ kid: key.kid, publicKey: key.publicKey, status: key.status })),
    };
  }

  @Post('activate')
  @RequireScopes('license:activate')
  @ApiOperation({ summary: '激活授权：绑定设备并返回签名授权文件' })
  activate(@Body() dto: ActivateDto, @ClientIp() ip: string): Promise<unknown> {
    const ctx: CallContext = { ip };
    return this.activation.activate(dto, ctx);
  }

  @Post('verify')
  @RequireScopes('license:verify')
  @ApiOperation({ summary: '心跳校验：返回最新权益' })
  verify(@Body() dto: VerifyDto, @ClientIp() ip: string) {
    return this.activation.verify(dto, { ip });
  }

  @Post('deactivate')
  @RequireScopes('license:deactivate')
  @ApiOperation({ summary: '解绑当前设备' })
  deactivate(@Body() dto: DeactivateDto, @ClientIp() ip: string) {
    return this.activation.deactivate(dto, { ip });
  }

  @Get('entitlements')
  @RequireScopes('license:read')
  @ApiOperation({ summary: '查询权益（不消耗设备名额）' })
  async entitlements(@Query() query: EntitlementsQueryDto, @ClientIp() ip: string) {
    if (!query.licenseKey || !query.fingerprint) {
      return { valid: false, reason: 'invalid_not_found', message: '需要提供 licenseKey 与 fingerprint' };
    }
    return this.activation.verify(
      { licenseKey: query.licenseKey, device: { fingerprint: query.fingerprint } },
      { ip },
    );
  }

  /* ---------------- 域名授权（Web 应用 / 插件 / SaaS 场景） ---------------- */

  @Post('activate-domain')
  @RequireScopes('license:activate')
  @ApiOperation({ summary: '域名激活：把站点域名绑定到授权并返回签名授权文件' })
  activateDomain(@Body() dto: ActivateDomainDto, @ClientIp() ip: string) {
    return this.activation.activateDomain(dto, { ip });
  }

  @Post('verify-domain')
  @RequireScopes('license:verify')
  @ApiOperation({ summary: '域名心跳校验：服务端每次请求或定时调用' })
  verifyDomain(@Body() dto: VerifyDomainDto, @ClientIp() ip: string) {
    return this.activation.verifyDomain(dto, { ip });
  }

  @Post('deactivate-domain')
  @RequireScopes('license:deactivate')
  @ApiOperation({ summary: '域名解绑：释放一个域名额度' })
  deactivateDomain(@Body() dto: DeactivateDomainDto, @ClientIp() ip: string) {
    return this.activation.deactivateDomain(dto, { ip });
  }

  @Post('trial')
  @RequireScopes('license:trial')
  @ApiOperation({ summary: '按设备指纹领取试用（同设备同产品仅一次）' })
  trial(@Body() dto: TrialDto, @ClientIp() ip: string) {
    return this.activation.trial(dto, { ip });
  }

  @Post('offline/request')
  @RequireScopes('license:activate')
  @ApiOperation({ summary: '离线激活：生成请求码' })
  offlineRequest(@Body() dto: OfflineRequestDto, @ClientIp() ip: string) {
    return this.activation.offlineRequest(dto, { ip });
  }

  @Post('offline/activate')
  @RequireScopes('license:activate')
  @ApiOperation({ summary: '离线激活：导入手工获取的响应码并本地验签' })
  offlineActivate(@Body() dto: OfflineActivateDto) {
    return this.activation.offlineActivate(dto);
  }

  @Get('version-check')
  @RequireScopes('license:read')
  @ApiOperation({ summary: '查询产品最新版本' })
  async versionCheck(@Query() query: VersionCheckQueryDto) {
    const release = await this.products.latestRelease(query.product, query.channel);
    if (!release) return { product: query.product, latest: null };
    return {
      product: query.product,
      latest: {
        version: release.version,
        channel: release.channel,
        notes: release.notes,
        downloadUrl: release.downloadUrl,
        publishedAt: release.publishedAt.toISOString(),
      },
    };
  }
}