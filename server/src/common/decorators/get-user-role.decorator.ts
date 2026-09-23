import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserRole } from '../../libs/constants/user.constant';

export const GetUserRole = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: { role: UserRole } }>();
    return request.user?.role;
  },
);
