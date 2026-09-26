import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { SettingsService } from './settings.service';

/** 公开站点信息：登录页 / 门户 / 浏览器标题用，免认证。 */
@ApiTags('system')
@Public()
@Controller('site')
export class SiteController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: '公开站点信息（站点名称等）' })
  async get() {
    const s = await this.settings.get();
    return { siteName: s.siteName, allowRegistration: s.allowRegistration };
  }
}
