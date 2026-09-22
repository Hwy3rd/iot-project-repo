import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../../libs/constants/user.constant';

interface RequestWithUser {
  user?: { id: string; role: UserRole };
  params?: Record<string, string>;
}

// Restricts a route to the resource owner (request.params.id === caller's
// id) unless the caller is Admin. Used for "Tự thân" endpoints — e.g.
// GET/PATCH /users/:id, where every role may only touch their own record.
// No DB access needed, so this isn't part of RbacModule's global guards;
// apply it per-route with @UseGuards(SelfScopeGuard).
@Injectable()
export class SelfScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('User not found in request');
    if (user.role === UserRole.ADMIN) return true;

    const targetId = request.params?.id;
    if (user.id !== targetId) {
      throw new ForbiddenException('Can only access your own resource');
    }
    return true;
  }
}
