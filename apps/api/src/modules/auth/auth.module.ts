import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [CONFIG_TOKEN],
      useFactory: (config: AppConfig) => ({
        secret: config.security.jwtSecret,
        signOptions: { issuer: 'licensehub' },
        verifyOptions: { issuer: 'licensehub' },
      }),
    }),
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, TokenService],
  exports: [AdminAuthService, TokenService, JwtModule],
})
export class AuthModule {}
