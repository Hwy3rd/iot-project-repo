import {
  BadRequestException,
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
import { Repository } from 'typeorm';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { Shift } from './entities/shift.entity';
import { hoursOverlap, minuteOfDay } from './shift-hours';

const hhmm = (time: string) => time.slice(0, 5);

@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(Shift)
    private readonly shiftsRepository: Repository<Shift>,
  ) {}

  // A template must have a name no other active template has, and hours
  // that overlap none of theirs — so the time of a check-in always points
  // at one shift (work-shift-schedule.ts openShiftAt()). Checked here, not
  // by a DB constraint; two Admins saving at the very same moment could
  // still race, which is acceptable for rarely-edited master data.
  private async assertFits(candidate: Shift) {
    if (minuteOfDay(candidate.startTime) === minuteOfDay(candidate.endTime)) {
      throw new BadRequestException('startTime and endTime must differ');
    }
    const others = (await this.shiftsRepository.find()).filter(
      (s) => s.id !== candidate.id,
    );
    const name = candidate.name.toLocaleLowerCase('vi');
    const sameName = others.find(
      (s) => s.name.toLocaleLowerCase('vi') === name,
    );
    if (sameName) {
      throw new ConflictException(
        `A shift template named "${sameName.name}" already exists`,
      );
    }
    const overlapping = others.find((s) => hoursOverlap(s, candidate));
    if (overlapping) {
      throw new ConflictException(
        `Overlaps shift template "${overlapping.name}" (${hhmm(overlapping.startTime)}-${hhmm(overlapping.endTime)})`,
      );
    }
  }

  async create(createShiftDto: CreateShiftDto) {
    const shift = this.shiftsRepository.create({
      name: createShiftDto.name,
      startTime: createShiftDto.startTime,
      endTime: createShiftDto.endTime,
    });
    await this.assertFits(shift);
    return this.shiftsRepository.save(shift);
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
    await this.assertFits(shift);
    return this.shiftsRepository.save(shift);
  }

  // Soft delete: past work shifts keep pointing at it. Nobody can check in
  // to it any more, and its hours and name are free for a new template.
  async remove(id: string) {
    const result = await this.shiftsRepository.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Shift ${id} not found`);
    }
  }
}
