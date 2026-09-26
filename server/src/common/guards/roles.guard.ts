import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ROLES_KEY,
  WAREHOUSE_LIST_SCOPE_KEY,
  WAREHOUSE_SCOPE_KEY,
} from '../../libs/constants/metadata.constant';
import { UserRole } from '../../libs/constants/user.constant';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role: UserRole } }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not found in request');
    }

    // Warehouse-scoped routes: for everyone but Admin, WarehouseScopeGuard
    // checks the role together with the warehouse assignment once it has
    // resolved the warehouse (a list route never rejects, it just narrows
    // to nothing). See docs/RBAC.md §3.
    const isWarehouseScoped =
      this.reflector.getAllAndOverride<unknown>(WAREHOUSE_SCOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ??
      this.reflector.getAllAndOverride<unknown>(WAREHOUSE_LIST_SCOPE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    if (isWarehouseScoped && user.role !== UserRole.ADMIN) return true;

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Access denied');
    }

    return true;
  }
}
