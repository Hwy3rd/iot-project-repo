import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Expose } from 'class-transformer';
import { lastValueFrom, of } from 'rxjs';
import { SERIALIZE_DTO } from '../../libs/constants/metadata.constant';
import { Paginated } from '../pagination/paginated';
import { TransformInterceptor } from './transform.interceptor';

class ItemDto {
  @Expose()
  id!: string;
}

describe('TransformInterceptor', () => {
  const context = {
    getHandler: () => undefined,
    switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }),
  } as unknown as ExecutionContext;

  const run = (data: unknown, dto?: unknown) => {
    const reflector = {
      get: (key: string) => (key === SERIALIZE_DTO ? dto : undefined),
    } as unknown as Reflector;
    const next: CallHandler = { handle: () => of(data) };
    return lastValueFrom(
      new TransformInterceptor(reflector).intercept(context, next),
    );
  };

  it('serializes only the items of a paginated result and keeps meta', async () => {
    const page = Paginated.of([{ id: '1', secret: 'x' }], 1, {
      page: 1,
      limit: 20,
    });

    const response = await run(page, ItemDto);

    expect(response.data).toEqual({
      items: [{ id: '1' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('still serializes plain arrays', async () => {
    const response = await run([{ id: '1', secret: 'x' }], ItemDto);
    expect(response.data).toEqual([{ id: '1' }]);
  });
});
