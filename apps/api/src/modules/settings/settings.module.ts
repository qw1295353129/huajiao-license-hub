import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { SiteController } from './site.controller';

@Global()
@Module({
  controllers: [SettingsController, SiteController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
