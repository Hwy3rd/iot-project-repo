import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ROLES_KEY,
  WAREHOUSE_LIST_SCOPE_KEY,
  WAREHOUSE_SCOPE_KEY,
} from '../../libs/constants/metadata.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const buildContext = (role: UserRole) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u1', role } }),
      }),
    }) as unknown as ExecutionContext;

  const guardWith = (metadata: Record<string, unknown>) => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => metadata[key]),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('rejects a global role not in @Roles on an unscoped route', () => {
    const guard = guardWith({ [ROLES_KEY]: [UserRole.ADMIN] });

    expect(() => guard.canActivate(buildContext(UserRole.MANAGER))).toThrow(
      ForbiddenException,
    );
  });

  it.each([WAREHOUSE_SCOPE_KEY, WAREHOUSE_LIST_SCOPE_KEY])(
    'defers to WarehouseScopeGuard on a %s route for non-admins',
    (key) => {
      const guard = guardWith({
        [ROLES_KEY]: [UserRole.ADMIN, UserRole.MANAGER],
        [key]: {},
      });

      expect(guard.canActivate(buildContext(UserRole.STAFF))).toBe(true);
    },
  );

  it('still checks an admin against @Roles on a scoped route', () => {
    const guard = guardWith({
      [ROLES_KEY]: [UserRole.TECHNICIAN],
      [WAREHOUSE_SCOPE_KEY]: {},
    });

    expect(() => guard.canActivate(buildContext(UserRole.ADMIN))).toThrow(
      ForbiddenException,
    );
  });
});
