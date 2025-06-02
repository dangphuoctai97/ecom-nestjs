import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { ZodSerializationException } from 'nestjs-zod'

@Catch(HttpException)
export class HttpExceptionFiler extends BaseExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFiler.name)

  catch(exception: HttpException, host: ArgumentsHost) {
    if (exception instanceof ZodSerializationException) {
      const zodError = exception.getZodError()
      this.logger.error(`ZodSerializationException: ${zodError.message}`)
    }

    super.catch(exception, host)
  }
}
