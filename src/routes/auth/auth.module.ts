import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RolesService } from './roles.service'

@Module({
  controllers: [AuthController],
  providers: [AuthService, RolesService],
})
export class AuthModule {}
