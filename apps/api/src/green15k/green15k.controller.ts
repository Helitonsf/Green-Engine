import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateCycleDto, RegisterBetDto } from './dto';
import { Green15kService } from './green15k.service';

@Controller('green-15k/cycles')
export class Green15kController {
  constructor(private readonly service: Green15kService) {}
  @Post() create(@Body() input: CreateCycleDto) { return this.service.createCycle(input); }
  @Get(':cycleId') findOne(@Param('cycleId') cycleId: string) { return this.service.getCycle(cycleId); }
  @Post(':cycleId/bets') registerBet(@Param('cycleId') cycleId: string, @Body() input: RegisterBetDto) { return this.service.registerBet(cycleId, input); }
  @Post('bets/:betId/green') green(@Param('betId') betId: string) { return this.service.settleBet(betId, 'GREEN'); }
  @Post('bets/:betId/red') red(@Param('betId') betId: string) { return this.service.settleBet(betId, 'RED'); }
}
