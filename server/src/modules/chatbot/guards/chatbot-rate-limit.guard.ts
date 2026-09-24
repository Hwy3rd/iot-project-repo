import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ChatbotRateLimiterService } from './chatbot-rate-limiter.service';

// Only guards the one REST route that actually costs an LLM call
// (POST :id/messages) — read endpoints (list conversations/messages) are
// plain DB reads and don't need this. The socket path (chatbot:send)
// counts against the same limiter, see ChatbotGateway.
@Injectable()
export class ChatbotRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimiter: ChatbotRateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id: string } }>();
    const userId = request.user?.id;
    if (!userId) {
      // JwtAuthGuard already runs earlier in the global guard chain (see
      // RbacModule) and would have rejected an unauthenticated request —
      // this is just defense in depth, not the primary check.
      return true;
    }
    await this.rateLimiter.consume(userId);
    return true;
  }
}
