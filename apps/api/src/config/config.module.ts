import { Global, Module } from '@nestjs/common';
import { CONFIG_TOKEN, loadConfig, type AppConfig } from './configuration';

export const configProvider = {
  provide: CONFIG_TOKEN,
  useFactory: (): AppConfig => loadConfig(),
};

@Global()
@Module({
  providers: [configProvider],
  exports: [configProvider],
})
export class ConfigModule {}
