import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/auth-context';
import { IdParamDto } from '../products/dto';
import { CreateApiKeyDto, ListApiKeysDto, UpdateApiKeyDto } from './dto';
import { ApiKeysService } from './api-keys.service';

@ApiTags('admin/api-keys')
@ApiBearerAuth('admin')
@Audience('admin')
@Roles('admin')
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: 'API Key 列表' })
  list(@Query() query: ListApiKeysDto) {
    return this.service.list(query);
  }

  @Post()
  @Audit({ action: 'api_key.create', targetType: 'api_key', recordBody: false })
  @ApiOperation({ summary: '创建 API Key（明文仅返回一次）' })
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, { id: user.id });
  }

  @Get(':id/reveal')
  @Audit({ action: 'api_key.reveal', targetType: 'api_key', recordBody: false })
  @ApiOperation({ summary: '查看 API Key 明文（写审计）' })
  reveal(@Param() params: IdParamDto) {
    return this.service.reveal(params.id);
  }

  @Patch(':id')
  @Audit({ action: 'api_key.update', targetType: 'api_key', recordBody: false })
  @ApiOperation({ summary: '修改 API Key（改名、改作用域、吊销）' })
  update(@Param() params: IdParamDto, @Body() dto: UpdateApiKeyDto) {
    return this.service.update(params.id, dto);
  }

  @Delete(':id')
  @Audit({ action: 'api_key.delete', targetType: 'api_key' })
  @ApiOperation({ summary: '删除 API Key' })
  remove(@Param() params: IdParamDto) {
    return this.service.remove(params.id);
  }
}
