import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
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
import { QueryUserDto } from './dto/query-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from './users.service';
import { BulkDeleteDto } from '../../common/bulk/bulk-delete';

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
  findAll(@Query() query: QueryUserDto) {
    return this.usersService.findAll(query);
  }

  // Declared before the ':id' routes so "me" isn't taken for an id. Every
  // role; always your own account, and the current password is required.
  @Serialize(UserResponseDto)
  @Audit({
    action: 'user.password_change',
    targetType: 'user',
    entity: User,
  })
  @HttpCode(HttpStatus.OK)
  @Post('me/password')
  changePassword(@GetUserId() userId: string, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
    );
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

  // Admin sets a new password for another account; ends its session.
  @Roles(UserRole.ADMIN)
  @Audit({ action: 'user.password_reset', targetType: 'user', entity: User })
  @Serialize(UserResponseDto)
  @HttpCode(HttpStatus.OK)
  @Post(':id/password')
  resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @GetUserId() actorId: string,
  ) {
    return this.usersService.resetPassword(id, dto.newPassword, actorId);
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

  @Roles(UserRole.ADMIN)
  @Audit({
    action: 'user.delete',
    targetType: 'user',
    entity: User,
    bulk: true,
  })
  @HttpCode(HttpStatus.OK)
  @Post('bulk-delete')
  bulkRemove(@Body() dto: BulkDeleteDto, @GetUserId() callerId: string) {
    return this.usersService.bulkRemove(dto.ids, callerId);
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
