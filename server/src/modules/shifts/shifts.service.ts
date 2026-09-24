import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { Shift } from './entities/shift.entity';

@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(Shift)
    private readonly shiftsRepository: Repository<Shift>,
  ) {}

  private async saveShift(shift: Shift): Promise<Shift> {
    try {
      return await this.shiftsRepository.save(shift);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException(
          'A shift template for this shift_type already exists',
        );
      }
      throw error;
    }
  }

  create(createShiftDto: CreateShiftDto) {
    const shift = this.shiftsRepository.create({
      shiftType: createShiftDto.shiftType,
      startTime: createShiftDto.startTime,
      endTime: createShiftDto.endTime,
    });
    return this.saveShift(shift);
  }

  async findAll(query: PaginationQueryDto = {}): Promise<Paginated<Shift>> {
    const pagination = resolvePagination(query);
    const [items, total] = await this.shiftsRepository.findAndCount({
      order: { startTime: 'ASC', id: 'ASC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const shift = await this.shiftsRepository.findOne({ where: { id } });
    if (!shift) {
      throw new NotFoundException(`Shift ${id} not found`);
    }
    return shift;
  }

  async update(id: string, updateShiftDto: UpdateShiftDto) {
    const shift = await this.findOne(id);
    Object.assign(shift, updateShiftDto);
    return this.saveShift(shift);
  }

  async remove(id: string) {
    const result = await this.shiftsRepository.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Shift ${id} not found`);
    }
  }
}
