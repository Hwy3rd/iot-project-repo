import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { Request, Response } from 'express';

// Registered as APP_FILTER (see app.module.ts), so this runs for every
// transport Nest supports here, not just HTTP — including RealtimeGateway's
// WebSocket handlers (e.g. the WsException in handleJoinWarehouse). A plain
// `@Catch()` filter that assumes host.switchToHttp() would crash on those:
// getRequest()/getResponse() return the socket/data args instead, which
// don't have .method/.url/.status(). WS exceptions are delegated to Nest's
// own BaseWsExceptionFilter instead, which already does the right thing
// (emits an `exception` event back to the client).
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly wsExceptionFilter = new BaseWsExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      this.wsExceptionFilter.catch(exception, host);
      return;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();

      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object') {
        const responseBody = res as {
          message?: string | string[];
          error?: string;
        };
        if (Array.isArray(responseBody.message)) {
          errors = responseBody.message;
          message = responseBody.error || 'Validation failed';
        } else if (typeof responseBody.message === 'string') {
          message = responseBody.message;
        }
      }
    }

    this.logger.error(
      `${request.method} ${request.url} -> ${status} ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message,
      ...(errors ? { errors } : {}),
    });
  }
}
