import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WsException } from '@nestjs/websockets';
import { Repository } from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { RealtimeGateway } from './realtime.gateway';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createSocket = (overrides: Record<string, unknown> = {}) => ({
  id: 'sock1',
  handshake: { headers: {} },
  data: {} as Record<string, unknown>,
  disconnect: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  ...overrides,
});

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let jwtService: { verifyAsync: jest.Mock };
  let warehouseStaffRepository: MockRepository<WarehouseStaff>;
  let redis: { exists: jest.Mock };

  const payload = {
    sub: 'u1',
    username: 'u1',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
    exp: 2_000_000_000,
  };

  beforeEach(async () => {
    redis = { exists: jest.fn().mockResolvedValue(0) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        {
          provide: getRepositoryToken(WarehouseStaff),
          useValue: { existsBy: jest.fn() },
        },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    gateway = module.get(RealtimeGateway);
    jwtService = module.get(JwtService);
    warehouseStaffRepository = module.get(getRepositoryToken(WarehouseStaff));
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('authenticate', () => {
    it('rejects a socket with no access_token cookie', async () => {
      const client = createSocket();

      await expect(gateway.authenticate(client as never)).resolves.toBe(false);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('rejects when the token fails verification', async () => {
      const client = createSocket({
        handshake: { headers: { cookie: 'access_token=bad' } },
      });
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await expect(gateway.authenticate(client as never)).resolves.toBe(false);
    });

    it('rejects a locked user even with a validly-signed token', async () => {
      const client = createSocket({
        handshake: { headers: { cookie: 'access_token=good' } },
      });
      jwtService.verifyAsync.mockResolvedValue({
        ...payload,
        status: UserStatus.LOCKED,
      });

      await expect(gateway.authenticate(client as never)).resolves.toBe(false);
    });

    it('rejects a user whose account was locked after the token was issued', async () => {
      const client = createSocket({
        handshake: { headers: { cookie: 'access_token=good' } },
      });
      jwtService.verifyAsync.mockResolvedValue(payload);
      redis.exists.mockResolvedValue(1);

      await expect(gateway.authenticate(client as never)).resolves.toBe(false);
      expect(redis.exists).toHaveBeenCalledWith('blocked:u1');
    });

    it('accepts a valid token and attaches the user to the socket', async () => {
      const client = createSocket({
        handshake: {
          headers: { cookie: 'other=1; access_token=good; more=2' },
        },
      });
      jwtService.verifyAsync.mockResolvedValue(payload);

      await expect(gateway.authenticate(client as never)).resolves.toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('good', {
        secret: process.env.JWT_SECRET,
      });
      expect(client.data.user).toEqual({
        id: 'u1',
        username: 'u1',
        role: UserRole.STAFF,
        tokenExpiresAt: payload.exp * 1000,
      });
    });
  });

  describe('afterInit handshake middleware', () => {
    const runMiddleware = async (client: ReturnType<typeof createSocket>) => {
      const use = jest.fn();
      gateway.afterInit({ use } as never);
      const [middleware] = use.mock.calls[0] as [
        (socket: unknown, next: (err?: Error) => void) => void,
      ];
      return new Promise<Error | undefined>((resolve) =>
        middleware(client, resolve),
      );
    };

    it('lets an authenticated socket through', async () => {
      jwtService.verifyAsync.mockResolvedValue(payload);

      const error = await runMiddleware(
        createSocket({
          handshake: { headers: { cookie: 'access_token=good' } },
        }),
      );

      expect(error).toBeUndefined();
    });

    it('fails the handshake (connect_error) without a valid token', async () => {
      const error = await runMiddleware(createSocket());

      expect(error?.message).toBe('Unauthorized');
    });
  });

  describe('handleConnection', () => {
    it("joins the user's own room", async () => {
      const client = createSocket({
        data: { user: { id: 'u1', username: 'u1', role: UserRole.STAFF } },
      });

      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith('user:u1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('drops a socket that somehow skipped authentication', async () => {
      const client = createSocket();

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleJoinWarehouse', () => {
    it('throws when the socket has no authenticated user', async () => {
      const client = createSocket();

      await expect(
        gateway.handleJoinWarehouse(client as never, { warehouseId: 'w1' }),
      ).rejects.toThrow(WsException);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('lets an admin join any warehouse without an assignment check', async () => {
      const client = createSocket({
        data: { user: { id: 'u1', username: 'u1', role: UserRole.ADMIN } },
      });

      const result = await gateway.handleJoinWarehouse(client as never, {
        warehouseId: 'w1',
      });

      expect(warehouseStaffRepository.existsBy).not.toHaveBeenCalled();
      expect(client.join).toHaveBeenCalledWith('warehouse:w1');
      expect(result).toEqual({ warehouseId: 'w1' });
    });

    it('lets a non-admin join a warehouse they are assigned to', async () => {
      const client = createSocket({
        data: { user: { id: 'u1', username: 'u1', role: UserRole.STAFF } },
      });
      warehouseStaffRepository.existsBy!.mockResolvedValue(true);

      await gateway.handleJoinWarehouse(client as never, {
        warehouseId: 'w1',
      });

      expect(warehouseStaffRepository.existsBy).toHaveBeenCalledWith({
        userId: 'u1',
        warehouseId: 'w1',
      });
      expect(client.join).toHaveBeenCalledWith('warehouse:w1');
    });

    it('rejects a non-admin joining a warehouse they are not assigned to', async () => {
      const client = createSocket({
        data: { user: { id: 'u1', username: 'u1', role: UserRole.STAFF } },
      });
      warehouseStaffRepository.existsBy!.mockResolvedValue(false);

      await expect(
        gateway.handleJoinWarehouse(client as never, { warehouseId: 'w1' }),
      ).rejects.toThrow(WsException);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleLeaveWarehouse', () => {
    it('leaves the room for the given warehouse, no assignment check', async () => {
      const client = createSocket();

      const result = await gateway.handleLeaveWarehouse(client as never, {
        warehouseId: 'w1',
      });

      expect(client.leave).toHaveBeenCalledWith('warehouse:w1');
      expect(result).toEqual({ warehouseId: 'w1' });
    });
  });

  describe('emitToWarehouse', () => {
    it('emits to the room for that warehouse only', () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      gateway.emitToWarehouse('w1', 'alert:new', { id: 'a1' });

      expect(to).toHaveBeenCalledWith('warehouse:w1');
      expect(emit).toHaveBeenCalledWith('alert:new', { id: 'a1' });
    });
  });

  describe('emitToUser', () => {
    it("emits to that user's room only", () => {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      gateway.server = { to } as never;

      gateway.emitToUser('u1', 'chatbot:message', { id: 'm1' });

      expect(to).toHaveBeenCalledWith('user:u1');
      expect(emit).toHaveBeenCalledWith('chatbot:message', { id: 'm1' });
    });
  });

  describe('disconnectUser', () => {
    it("drops only the given user's sockets", async () => {
      const mine = { data: { user: { id: 'u1' } }, disconnect: jest.fn() };
      const other = { data: { user: { id: 'u2' } }, disconnect: jest.fn() };
      gateway.server = {
        fetchSockets: jest.fn().mockResolvedValue([mine, other]),
      } as never;

      await gateway.disconnectUser('u1');

      expect(mine.disconnect).toHaveBeenCalledWith(true);
      expect(other.disconnect).not.toHaveBeenCalled();
    });
  });
});
