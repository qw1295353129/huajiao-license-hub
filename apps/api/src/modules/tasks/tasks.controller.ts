import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { Audit, Audience, Roles } from '../../common/decorators';
import { TasksService } from './tasks.service';

class RunTaskDto {
  @IsString()
  @IsIn(['expire-licenses', 'expiry-reminders', 'webhook-deliveries', 'cleanup'])
  task!: string;
}

@ApiTags('admin/tasks')
@ApiBearerAuth('admin')
@Audience('admin')
@Roles('admin')
@Controller('admin/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('backlog')
  @Roles('support')
  @ApiOperation({ summary: '待处理事项计数（待投递 Webhook、7 天内到期授权）' })
  backlog() {
    return this.tasks.backlog();
  }

  @Post('run')
  @Audit({ action: 'task.run', targetType: 'task' })
  @ApiOperation({ summary: '手动触发定时任务（排障与自测用）' })
  async run(@Body() dto: RunTaskDto) {
    try {
      return await this.tasks.run(dto.task);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '任务执行失败');
    }
  }
}
