import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { LicenseSignerService } from './license-signer.service';

@ApiTags('admin/signing-keys')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/signing-keys')
export class SigningKeysController {
  constructor(private readonly signer: LicenseSignerService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '签名密钥列表（含已轮换的历史公钥）' })
  list() {
    return this.signer.listPublicKeys();
  }

  @Get('active')
  @Roles('support')
  @ApiOperation({ summary: '当前签发用的密钥（把公钥内置到客户端）' })
  async active() {
    const key = await this.signer.getActiveKey();
    if (!key) return { kid: null, publicKey: null, instructions: '尚未生成签名密钥，请调用 rotate 生成' };
    return {
      kid: key.kid,
      publicKey: key.publicKey,
      algo: key.algo,
      createdAt: key.createdAt,
      instructions: '客户端内置该公钥即可离线验签；轮换后旧公钥仍可验签历史授权文件',
    };
  }

  @Post('rotate')
  @Roles('owner')
  @Audit({ action: 'signing_key.rotate', targetType: 'signing_key' })
  @ApiOperation({ summary: '轮换签名密钥（旧密钥转为 retired，仍可验签）' })
  rotate(@CurrentUser() user: RequestUser) {
    return this.signer.rotate(user.id);
  }

  @Post('create')
  @Roles('owner')
  @Audit({ action: 'signing_key.create', targetType: 'signing_key' })
  @ApiOperation({ summary: '首次生成签名密钥（已有 active 时请用 rotate）' })
  async create(@CurrentUser() user: RequestUser) {
    const existing = await this.signer.getActiveKey();
    if (existing) {
      return { created: false, kid: existing.kid, message: '已存在 active 密钥，如需更换请调用 rotate' };
    }
    const created = await this.signer.createKey(user.id);
    return { created: true, kid: created.kid, publicKey: created.publicKey };
  }
}
