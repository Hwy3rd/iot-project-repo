import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { JoinWarehouseDto } from './dto/join-warehouse.dto';
import { readCookie, warehouseRoom } from './realtime.util';

interface AccessTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  status: UserStatus;
}

// What handleConnection puts on client.data — the same shape JwtStrategy
// puts on req.user for REST, minus the DB round-trip (same "don't hit the DB
// per request" reasoning as the REST access token — see server/CLAUDE.md).
interface SocketUser {
  id: string;
  username: string;
  role: UserRole;
}

interface SocketData {
  user?: SocketUser;
}

// Socket.io types client.data as `any` unless the 4th generic (SocketData)
// is filled in — this is what makes client.data.user a typed access instead
// of one, everywhere in this gateway.
type AppSocket = Socket<
  Record<string, (...args: unknown[]) => void>,
  Record<string, (...args: unknown[]) => void>,
  Record<string, never>,
  SocketData
>;

// Base realtime transport, config-only for now: connection auth + warehouse-
// scoped rooms (`join:warehouse`/`leave:warehouse`) + emitToWarehouse() for
// other services to call. Nothing calls emitToWarehouse() yet — no
// module pushes alerts/telemetry over this — wiring that up is a separate
// follow-up (see AlertsService, which currently only enqueues a push
// notification job, not a realtime broadcast).
//
// Rooms are per-warehouse (`warehouse:{id}`), not one global channel, so a
// client only receives events for warehouses it explicitly joined — see
// docs/system-design.md's `/topic/alerts` note, which this deliberately
// deviates from (a single shared channel would leak every warehouse's
// alerts to every connected client).
@WebSocketGateway({
  cors: {
    origin: (process.env.WS_CORS_ORIGIN ?? 'http://localhost:5173').split(','),
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
  ) {}

  // Cookie-based, same as the REST access token (see JwtStrategy) — the
  // browser sends it automatically on the socket.io handshake as long as
  // the client connects with `withCredentials: true` and the CORS origin
  // above matches. No DB read here either, same "role/status only refresh
  // once the token itself expires" tradeoff as the REST side.
  async handleConnection(client: AppSocket): Promise<void> {
    const token = readCookie(
      client.handshake.headers.cookie,
      process.env.COOKIE_NAME ?? 'access_token',
    );
    if (!token) {
      this.logger.debug(`Rejected connection ${client.id}: no access token`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: process.env.JWT_SECRET },
      );
      if (payload.status === UserStatus.LOCKED) {
        throw new Error('locked');
      }
      const user: SocketUser = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      };
      client.data.user = user;
    } catch {
      this.logger.debug(`Rejected connection ${client.id}: invalid token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AppSocket): void {
    // No manual room cleanup needed — socket.io leaves every room the
    // socket was in automatically on disconnect.
    this.logger.debug(`Disconnected ${client.id}`);
  }

  // Admins may join any warehouse (full access per the permission matrix in
  // docs/system-design.md); everyone else only one they're assigned to.
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @SubscribeMessage('join:warehouse')
  async handleJoinWarehouse(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() dto: JoinWarehouseDto,
  ): Promise<{ warehouseId: string }> {
    const user = client.data.user;
    if (!user) {
      // Unreachable in practice — handleConnection disconnects unauthenticated
      // sockets before any message can arrive — but never trust that alone.
      throw new WsException('Not authenticated');
    }

    if (user.role !== UserRole.ADMIN) {
      const assigned = await this.warehouseStaffRepository.existsBy({
        userId: user.id,
        warehouseId: dto.warehouseId,
      });
      if (!assigned) {
        throw new WsException(`Not assigned to warehouse ${dto.warehouseId}`);
      }
    }

    await client.join(warehouseRoom(dto.warehouseId));
    return { warehouseId: dto.warehouseId };
  }

  @SubscribeMessage('leave:warehouse')
  async handleLeaveWarehouse(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() dto: JoinWarehouseDto,
  ): Promise<{ warehouseId: string }> {
    await client.leave(warehouseRoom(dto.warehouseId));
    return { warehouseId: dto.warehouseId };
  }

  // For other services to call once they're wired up to push realtime
  // updates (e.g. AlertsService on raise/acknowledge/resolve). `event` is a
  // free-form name (e.g. 'alert:new') — no fixed event catalogue yet.
  emitToWarehouse(warehouseId: string, event: string, payload: unknown): void {
    this.server.to(warehouseRoom(warehouseId)).emit(event, payload);
  }
}
