import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WsException } from '@nestjs/websockets';
import { Repository } from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
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

  const payload = {
    sub: 'u1',
    username: 'u1',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        {
          provide: getRepositoryToken(WarehouseStaff),
          useValue: { existsBy: jest.fn() },
        },
      ],
    }).compile();

    gateway = module.get(RealtimeGateway);
    jwtService = module.get(JwtService);
    warehouseStaffRepository = module.get(getRepositoryToken(WarehouseStaff));
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('disconnects a socket with no access_token cookie', async () => {
      const client = createSocket();

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('disconnects when the token fails verification', async () => {
      const client = createSocket({
        handshake: { headers: { cookie: 'access_token=bad' } },
      });
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a locked user even with a validly-signed token', async () => {
      const client = createSocket({
        handshake: { headers: { cookie: 'access_token=good' } },
      });
      jwtService.verifyAsync.mockResolvedValue({
        ...payload,
        status: UserStatus.LOCKED,
      });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('accepts a valid token and attaches the user to the socket', async () => {
      const client = createSocket({
        handshake: {
          headers: { cookie: 'other=1; access_token=good; more=2' },
        },
      });
      jwtService.verifyAsync.mockResolvedValue(payload);

      await gateway.handleConnection(client as never);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('good', {
        secret: process.env.JWT_SECRET,
      });
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toEqual({
        id: 'u1',
        username: 'u1',
        role: UserRole.STAFF,
      });
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
});
