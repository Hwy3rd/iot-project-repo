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
import { FilesInterceptor } from '@nestjs/platform-express';
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
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Roles(UserRole.ADMIN)
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
