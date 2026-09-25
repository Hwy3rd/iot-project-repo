import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { SearchParam } from '../../../common/query/query-params.decorator';
import { UserRole, UserStatus } from '../../../libs/constants/user.constant';

export class QueryUserDto extends PaginationQueryDto {
  // Matches username, full name, email or phone.
  @SearchParam()
  search?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
