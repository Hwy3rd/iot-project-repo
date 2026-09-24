import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator';
import { User } from './entities/user.entity';
import { FilesInterceptor } from '@nestjs/platform-express';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import { GetUserRole } from '../../common/decorators/get-user-role.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { SelfScopeGuard } from '../../common/guards/self-scope.guard';
import { UserRole } from '../../libs/constants/user.constant';
import { DeleteImageDto } from '../upload-files/dto/delete-image.dto';
import { imageUploadOptions } from '../upload-files/multer-image.options';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(UserRole.ADMIN)
  @Serialize(UserResponseDto)
  @Audit({ action: 'user.create', targetType: 'user', entity: User })
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Roles(UserRole.ADMIN)
  @Serialize(UserResponseDto)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @UseGuards(SelfScopeGuard)
  @Serialize(UserResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @UseGuards(SelfScopeGuard)
  @Serialize(UserResponseDto)
  @Audit({
    action: 'user.update',
    targetType: 'user',
    entity: User,
    resolveAction: (before, after) =>
      before && after && before.role !== after.role
        ? 'user.role_change'
        : undefined,
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @GetUserId() actorId: string,
    @GetUserRole() actorRole: UserRole,
  ) {
    return this.usersService.update(id, updateUserDto, {
      id: actorId,
      role: actorRole,
    });
  }

  // Offboarding: keeps the account and all its history, just blocks login
  // (see docs/REQUIREMENT.md §3.1).
  @Roles(UserRole.ADMIN)
  @Audit({ action: 'user.lock', targetType: 'user', entity: User })
  @Serialize(UserResponseDto)
  @Post(':id/lock')
  lock(@Param('id') id: string, @GetUserId() actorId: string) {
    return this.usersService.lock(id, actorId);
  }

  @Roles(UserRole.ADMIN)
  @Audit({ action: 'user.unlock', targetType: 'user', entity: User })
  @Serialize(UserResponseDto)
  @Post(':id/unlock')
  unlock(@Param('id') id: string) {
    return this.usersService.unlock(id);
  }

  @Roles(UserRole.ADMIN)
  @Audit({ action: 'user.delete', targetType: 'user', entity: User })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @UseGuards(SelfScopeGuard)
  @Serialize(UserResponseDto)
  @Post(':id/images')
  @UseInterceptors(FilesInterceptor('files', 5, imageUploadOptions))
  addImages(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.usersService.addImages(id, files);
  }

  @UseGuards(SelfScopeGuard)
  @Serialize(UserResponseDto)
  @Delete(':id/images')
  removeImage(@Param('id') id: string, @Body() dto: DeleteImageDto) {
    return this.usersService.removeImage(id, dto.url);
  }
}
