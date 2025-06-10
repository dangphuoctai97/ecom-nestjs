import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import requetIp from 'request-ip'

export const IP = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest()
  const clientIp = requetIp.getClientIp(request)
  return String(clientIp)
})
