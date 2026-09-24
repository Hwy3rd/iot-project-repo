import { Inject, Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { Repository } from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { blockedUserKey, REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { JoinWarehouseDto } from './dto/join-warehouse.dto';
import type { AppSocket, SocketData } from './realtime.types';
import {
  readCookie,
  REALTIME_GATEWAY_OPTIONS,
  userRoom,
  warehouseRoom,
} from './realtime.util';

interface AccessTokenPayload {
  sub: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  exp: number;
}

// Base realtime transport: connection auth, a per-user room every socket
// joins (`user:{id}`, emitToUser()), warehouse-scoped rooms
// (`join:warehouse`/`leave:warehouse`, emitToWarehouse()). Feature gateways
// (ChatbotGateway) share this socket.io server and rely on the auth done
// here. Nothing calls emitToWarehouse() yet — pushing alerts/telemetry over
// it is a separate follow-up (AlertsService currently only enqueues a push
// notification job, not a realtime broadcast).
//
// Rooms are per-warehouse (`warehouse:{id}`), not one global channel, so a
// client only receives events for warehouses it explicitly joined — see
// docs/system-design.md's `/topic/alerts` note, which this deliberately
// deviates from (a single shared channel would leak every warehouse's
// alerts to every connected client).
@WebSocketGateway(REALTIME_GATEWAY_OPTIONS)
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Auth runs as handshake middleware, not in handleConnection: socket.io
  // only fires the client's `connect` (and only lets events through) after
  // every middleware calls next(), so no handler — in this gateway or a
  // feature gateway — can ever see a socket whose auth is still in flight.
  // A rejected handshake surfaces on the client as `connect_error`.
  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticate(socket as AppSocket).then((ok) =>
        ok ? next() : next(new Error('Unauthorized')),
      );
    });
  }

  // Cookie-based, same as the REST access token (see JwtStrategy) — the
  // browser sends it automatically on the socket.io handshake as long as
  // the client connects with `withCredentials: true` and the CORS origin
  // above matches. No DB read here either, same "role/status only refresh
  // once the token itself expires" tradeoff as the REST side.
  async authenticate(client: AppSocket): Promise<boolean> {
    const token = readCookie(
      client.handshake.headers.cookie,
      process.env.COOKIE_NAME ?? 'access_token',
    );
    if (!token) {
      this.logger.debug(`Rejected connection ${client.id}: no access token`);
      return false;
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(
        token,
        { secret: process.env.JWT_SECRET },
      );
      if (
        payload.status === UserStatus.LOCKED ||
        (await this.redis.exists(blockedUserKey(payload.sub)))
      ) {
        throw new Error('locked');
      }
      client.data.user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        tokenExpiresAt: payload.exp * 1000,
      };
      return true;
    } catch {
      this.logger.debug(`Rejected connection ${client.id}: invalid token`);
      return false;
    }
  }

  async handleConnection(client: AppSocket): Promise<void> {
    const user = client.data.user;
    if (!user) {
      // Unreachable while the middleware above is registered — never trust
      // that alone.
      client.disconnect(true);
      return;
    }
    await client.join(userRoom(user.id));
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

  // Called when an account is locked or deleted: drops the user's open
  // sockets now, rather than leaving them connected until they reconnect
  // (handleConnection would then refuse them via the blocked-user key).
  async disconnectUser(userId: string): Promise<void> {
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      if ((socket.data as SocketData | undefined)?.user?.id === userId) {
        socket.disconnect(true);
      }
    }
  }

  // All open sockets of one user (every tab/device), nobody else's.
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  // For other services to call once they're wired up to push realtime
  // updates (e.g. AlertsService on raise/acknowledge/resolve). `event` is a
  // free-form name (e.g. 'alert:new') — no fixed event catalogue yet.
  emitToWarehouse(warehouseId: string, event: string, payload: unknown): void {
    this.server.to(warehouseRoom(warehouseId)).emit(event, payload);
  }
}
