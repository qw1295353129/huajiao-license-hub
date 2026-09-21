import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, Roles } from '../../common/decorators';
import { IdParamDto } from '../products/dto';
import { CreateCustomerDto, ListCustomersDto, ResetCustomerPasswordDto, UpdateCustomerDto } from './dto';
import { CustomersService } from './customers.service';

@ApiTags('admin/customers')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '客户列表（含授权数、订单数、累计消费）' })
  list(@Query() query: ListCustomersDto) {
    return this.customers.list(query);
  }

  @Post()
  @Roles('admin')
  @Audit({ action: 'customer.create', targetType: 'customer', recordBody: false })
  @ApiOperation({ summary: '手工创建客户' })
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Get(':id')
  @Roles('support')
  @ApiOperation({ summary: '客户详情（含授权与订单）' })
  detail(@Param() params: IdParamDto) {
    return this.customers.detail(params.id);
  }

  @Patch(':id')
  @Roles('admin')
  @Audit({ action: 'customer.update', targetType: 'customer' })
  @ApiOperation({ summary: '修改客户资料或状态' })
  update(@Param() params: IdParamDto, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(params.id, dto);
  }

  @Post(':id/reset-password')
  @Roles('admin')
  @Audit({ action: 'customer.reset_password', targetType: 'customer', recordBody: false })
  @ApiOperation({ summary: '重置客户密码（可指定或随机生成并邮件通知）' })
  resetPassword(@Param() params: IdParamDto, @Body() dto: ResetCustomerPasswordDto) {
    return this.customers.resetPassword(params.id, dto);
  }

  @Post(':id/block')
  @Roles('admin')
  @Audit({ action: 'customer.block', targetType: 'customer' })
  @ApiOperation({ summary: '封禁客户' })
  block(@Param() params: IdParamDto) {
    return this.customers.block(params.id, true);
  }

  @Post(':id/unblock')
  @Roles('admin')
  @Audit({ action: 'customer.unblock', targetType: 'customer' })
  @ApiOperation({ summary: '解封客户' })
  unblock(@Param() params: IdParamDto) {
    return this.customers.block(params.id, false);
  }
}
