import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import {
  RESPONSE_MESSAGE,
  SERIALIZE_DTO,
} from '../../libs/constants/metadata.constant';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';

interface Response<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T | null;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  constructor(private readonly reflector: Reflector) {}

  private serializeData(data: unknown, dto?: new (...args: any[]) => object) {
    if (!dto || data == null) return data;

    if (Array.isArray(data)) {
      return plainToInstance(dto, data, { excludeExtraneousValues: true });
    }

    return plainToInstance(dto, data, { excludeExtraneousValues: true });
  }

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Response<T>> {
    const defaultMessage = 'Success';
    const message = this.reflector.get<string>(
      RESPONSE_MESSAGE,
      context.getHandler(),
    );
    const serializeDto = this.reflector.get<new (...args: any[]) => object>(
      SERIALIZE_DTO,
      context.getHandler(),
    );

    const statusCode = context.switchToHttp().getResponse().statusCode;

    return next.handle().pipe(
      map((data) => ({
        success: true,
        statusCode,
        message: message || defaultMessage,
        data: (this.serializeData(data, serializeDto) as T) ?? null,
      })),
    );
  }
}
