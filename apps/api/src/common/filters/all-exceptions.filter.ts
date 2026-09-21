import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErrorCodes } from '../errors';

interface ErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/** 统一错误出口：任何异常都收敛为 { code, message, details?, requestId }。 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const requestId = String((request as { id?: string }).id ?? '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorEnvelope = { code: ErrorCodes.INTERNAL_ERROR, message: '服务器内部错误' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') {
        body = { code: this.codeFromStatus(status), message: response };
      } else if (response && typeof response === 'object') {
        const raw = response as Record<string, unknown>;
        // class-validator 的 ValidationPipe 返回 { message: string[] }
        const rawMessage = raw.message;
        if (Array.isArray(rawMessage)) {
          body = {
            code: ErrorCodes.VALIDATION_FAILED,
            message: '参数校验失败',
            details: { errors: rawMessage },
          };
        } else {
          body = {
            code: typeof raw.code === 'string' ? raw.code : this.codeFromStatus(status),
            message: typeof rawMessage === 'string' ? rawMessage : exception.message,
            details: raw.details,
          };
        }
      }
    } else {
      const message = exception instanceof Error ? exception.message : String(exception);
      this.logger.error('未处理异常：' + message, exception instanceof Error ? exception.stack : undefined);
      if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
        body.details = { cause: message };
      }
    }

    if (requestId) body.requestId = requestId;
    if (status >= 500) {
      this.logger.error('[' + requestId + '] ' + request.method + ' ' + request.url + ' -> ' + status + ' ' + body.message);
    }
    void reply.status(status).send(body);
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST: return ErrorCodes.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED: return ErrorCodes.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN: return ErrorCodes.FORBIDDEN;
      case HttpStatus.NOT_FOUND: return ErrorCodes.NOT_FOUND;
      case HttpStatus.CONFLICT: return ErrorCodes.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS: return ErrorCodes.RATE_LIMITED;
      default: return status >= 500 ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.VALIDATION_FAILED;
    }
  }
}
