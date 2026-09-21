import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { ProductsModule } from '../products/products.module';
import { ActivationController } from './activation.controller';
import { AdminActivationController } from './admin-activation.controller';
import { ActivationService } from './activation.service';
import { LicenseSignerService } from './license-signer.service';
import { SigningKeysController } from './signing-keys.controller';

@Module({
  imports: [
    ProductsModule,
    JwtModule.registerAsync({
      inject: [CONFIG_TOKEN],
      useFactory: (config: AppConfig) => ({
        secret: config.security.jwtSecret,
        signOptions: { issuer: 'licensehub' },
        verifyOptions: { issuer: 'licensehub' },
      }),
    }),
  ],
  controllers: [ActivationController, AdminActivationController, SigningKeysController],
  providers: [ActivationService, LicenseSignerService],
  exports: [ActivationService, LicenseSignerService],
})
export class ActivationModule {}