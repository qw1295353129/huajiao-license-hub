import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, Roles } from '../../common/decorators';
import { IdParamDto } from '../products/dto';
import { CreateCouponDto, ListCouponsDto, UpdateCouponDto } from './dto';
import { CouponsService } from './coupons.service';

@ApiTags('admin/coupons')
@ApiBearerAuth('admin')
@Audience('admin')
@Roles('admin')
@Controller('admin/coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @Roles('support')
  @ApiOperation({ summary: '优惠券列表' })
  list(@Query() query: ListCouponsDto) {
    return this.coupons.list(query);
  }

  @Post()
  @Audit({ action: 'coupon.create', targetType: 'coupon' })
  @ApiOperation({ summary: '创建优惠券' })
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @Patch(':id')
  @Audit({ action: 'coupon.update', targetType: 'coupon' })
  @ApiOperation({ summary: '修改优惠券' })
  update(@Param() params: IdParamDto, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(params.id, dto);
  }

  @Delete(':id')
  @Audit({ action: 'coupon.delete', targetType: 'coupon' })
  @ApiOperation({ summary: '删除优惠券' })
  remove(@Param() params: IdParamDto) {
    return this.coupons.remove(params.id);
  }
}
