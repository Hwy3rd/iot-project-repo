import { Test, TestingModule } from '@nestjs/testing';
import { ProductTypesController } from './product-types.controller';
import { ProductTypesService } from './product-types.service';

describe('ProductTypesController', () => {
  let controller: ProductTypesController;
  const productTypesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductTypesController],
      providers: [
        { provide: ProductTypesService, useValue: productTypesService },
      ],
    }).compile();

    controller = module.get<ProductTypesController>(ProductTypesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findOne to the service', async () => {
    productTypesService.findOne.mockResolvedValue({ id: '1' });

    await controller.findOne('1');

    expect(productTypesService.findOne).toHaveBeenCalledWith('1');
  });

  it('delegates remove to the service', async () => {
    await controller.remove('1');

    expect(productTypesService.remove).toHaveBeenCalledWith('1');
  });
});
