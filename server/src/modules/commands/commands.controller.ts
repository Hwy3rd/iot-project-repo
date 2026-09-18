import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { CommandsService } from './commands.service';
import { AcknowledgeCommandDto } from './dto/acknowledge-command.dto';
import { CommandResponseDto } from './dto/command-response.dto';
import { CreateCommandDto } from './dto/create-command.dto';

@Controller('commands')
export class CommandsController {
  constructor(private readonly commandsService: CommandsService) {}

  @Serialize(CommandResponseDto)
  @Post()
  create(@Body() createCommandDto: CreateCommandDto) {
    return this.commandsService.create(createCommandDto);
  }

  @Serialize(CommandResponseDto)
  @Get()
  findAll() {
    return this.commandsService.findAll();
  }

  @Serialize(CommandResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.commandsService.findOne(id);
  }

  @Serialize(CommandResponseDto)
  @Post(':id/sent')
  markSent(@Param('id') id: string) {
    return this.commandsService.markSent(id);
  }

  @Serialize(CommandResponseDto)
  @Post(':id/ack')
  acknowledge(
    @Param('id') id: string,
    @Body() acknowledgeCommandDto: AcknowledgeCommandDto,
  ) {
    return this.commandsService.acknowledge(id, acknowledgeCommandDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.commandsService.remove(id);
  }
}
