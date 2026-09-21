import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, Audience, Roles } from '../../common/decorators';
import {
  CreateFeatureDto, CreatePlanDto, CreateProductDto, CreateReleaseDto, IdParamDto,
  ProductListDto, UpdatePlanDto, UpdateProductDto,
} from './dto';
import { ProductsService } from './products.service';

@ApiTags('admin/products')
@ApiBearerAuth('admin')
@Audience('admin')
@Controller('admin')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /* ---------------- 产品 ---------------- */

  @Get('products')
  @Roles('support')
  @ApiOperation({ summary: '产品列表（含策略数、授权数统计）' })
  list(@Query() query: ProductListDto) {
    return this.products.list(query);
  }

  @Post('products')
  @Roles('admin')
  @Audit({ action: 'product.create', targetType: 'product' })
  @ApiOperation({ summary: '新建产品' })
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Get('products/:id')
  @Roles('support')
  @ApiOperation({ summary: '产品详情（含策略、功能点、版本）' })
  detail(@Param() params: IdParamDto) {
    return this.products.detail(params.id);
  }

  @Patch('products/:id')
  @Roles('admin')
  @Audit({ action: 'product.update', targetType: 'product' })
  @ApiOperation({ summary: '修改产品' })
  update(@Param() params: IdParamDto, @Body() dto: UpdateProductDto) {
    return this.products.update(params.id, dto);
  }

  @Delete('products/:id')
  @Roles('admin')
  @Audit({ action: 'product.archive', targetType: 'product' })
  @ApiOperation({ summary: '归档产品（不物理删除，避免授权悬空）' })
  archive(@Param() params: IdParamDto) {
    return this.products.archive(params.id);
  }

  /* ---------------- 策略 ---------------- */

  @Get('products/:id/plans')
  @Roles('support')
  @ApiOperation({ summary: '产品的授权策略列表' })
  listPlans(@Param() params: IdParamDto) {
    return this.products.listPlans(params.id);
  }

  @Post('products/:id/plans')
  @Roles('admin')
  @Audit({ action: 'plan.create', targetType: 'plan' })
  @ApiOperation({ summary: '新建授权策略' })
  createPlan(@Param() params: IdParamDto, @Body() dto: CreatePlanDto) {
    return this.products.createPlan(params.id, dto);
  }

  @Patch('plans/:id')
  @Roles('admin')
  @Audit({ action: 'plan.update', targetType: 'plan' })
  @ApiOperation({ summary: '修改授权策略' })
  updatePlan(@Param() params: IdParamDto, @Body() dto: UpdatePlanDto) {
    return this.products.updatePlan(params.id, dto);
  }

  @Delete('plans/:id')
  @Roles('admin')
  @Audit({ action: 'plan.archive', targetType: 'plan' })
  @ApiOperation({ summary: '归档授权策略' })
  archivePlan(@Param() params: IdParamDto) {
    return this.products.archivePlan(params.id);
  }

  /* ---------------- 功能点 ---------------- */

  @Post('products/:id/features')
  @Roles('admin')
  @Audit({ action: 'feature.create', targetType: 'product' })
  @ApiOperation({ summary: '新增功能点' })
  addFeature(@Param() params: IdParamDto, @Body() dto: CreateFeatureDto) {
    return this.products.addFeature(params.id, dto);
  }

  @Delete('features/:id')
  @Roles('admin')
  @Audit({ action: 'feature.delete', targetType: 'feature' })
  @ApiOperation({ summary: '删除功能点' })
  removeFeature(@Param() params: IdParamDto) {
    return this.products.removeFeature(params.id);
  }

  /* ---------------- 版本发布 ---------------- */

  @Post('products/:id/releases')
  @Roles('admin')
  @Audit({ action: 'release.create', targetType: 'product' })
  @ApiOperation({ summary: '登记新版本' })
  addRelease(@Param() params: IdParamDto, @Body() dto: CreateReleaseDto) {
    return this.products.addRelease(params.id, dto);
  }
}
