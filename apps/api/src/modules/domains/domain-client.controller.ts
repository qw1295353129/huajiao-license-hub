import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { ClientIp, Public, RequireScopes } from '../../common/decorators';
import { DomainLicensesService } from './domain-licenses.service';
import { LicenseSignerService } from '../activation/license-signer.service';
import { DomainActivateDto, DomainDeactivateDto, DomainVerifyDto } from './dto';

/**
 * 域名授权客户端接口（网站自助接入）。
 * 关键点：**不需要授权码** —— 域名本身就是凭据；X-Api-Key 只用于标识接入的应用。
 */
@ApiTags('client/v1 (domain)')
@ApiHeader({ name: 'X-Api-Key', description: '接入应用密钥', required: true })
@Public()
@UseGuards(ApiKeyGuard)
@Controller('v1/domain')
export class DomainClientController {
  constructor(
    private readonly domains: DomainLicensesService,
    private readonly signer: LicenseSignerService,
  ) {}

  @Post('activate')
  @RequireScopes('license:activate')
  @ApiOperation({ summary: '域名激活：站点填入域名即可获得签名授权文件（无需授权码）' })
  activate(@Body() dto: DomainActivateDto, @ClientIp() ip: string) {
    return this.domains.activate(dto, { ip });
  }

  @Post('verify')
  @RequireScopes('license:verify')
  @ApiOperation({ summary: '域名心跳校验' })
  verify(@Body() dto: DomainVerifyDto) {
    return this.domains.verify(dto);
  }

  @Post('deactivate')
  @RequireScopes('license:deactivate')
  @ApiOperation({ summary: '域名自助解绑（释放额度）' })
  deactivate(@Body() dto: DomainDeactivateDto) {
    return this.domains.deactivate(dto);
  }

  @Get('public-key')
  @RequireScopes('license:read')
  @ApiOperation({ summary: '域名授权文件的验签公钥' })
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
}
