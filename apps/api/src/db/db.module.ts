import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { CONFIG_TOKEN, type AppConfig } from '../config/configuration';
import { createDatabase, type DatabaseHandle } from './db.provider';
import { applyMigrations } from './migrate';

export const DB = 'DB_HANDLE';

const dbProvider = {
  provide: DB,
  inject: [CONFIG_TOKEN],
  useFactory: async (config: AppConfig): Promise<DatabaseHandle> => {
    const handle = await createDatabase(config);
    if (config.database.autoMigrate) {
      // 在依赖注入阶段完成迁移，保证后续 onApplicationBootstrap（初始化管理员等）看到完整表结构
      await applyMigrations(handle, (msg) => Logger.log(msg, 'Database'));
    }
    return handle;
  },
};

@Global()
@Module({
  providers: [dbProvider],
  exports: [dbProvider],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
