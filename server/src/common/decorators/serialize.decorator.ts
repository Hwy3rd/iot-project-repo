import { SetMetadata } from '@nestjs/common';
import { SERIALIZE_DTO } from '../../libs/constants/metadata.constant';

export const Serialize = (dto: new (...args: any[]) => object) =>
  SetMetadata(SERIALIZE_DTO, dto);
