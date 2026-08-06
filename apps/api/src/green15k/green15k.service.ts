import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateCycleDto, RegisterBetDto } from './dto';
import { BetResult, Green15kBet, Green15kCycle } from './green15k.types';

@Injectable()
export class Green15kService {
  private readonly cycles = new Map<string, Green15kCycle>();
  private readonly bets = new Map<string, Green15kBet>();

  createCycle(input: CreateCycleDto): Green15kCycle {
    const active = [...this.cycles.values()].find((cycle) => cycle.userId === input.userId && cycle.status === 'ACTIVE');
    if (active) throw new BadRequestException('O usuário já possui um ciclo ativo.');
    const cycle: Green15kCycle = { id: randomUUID(), userId: input.userId, targetAmount: input.targetAmount, currentAmount: input.initialAmount, status: 'ACTIVE', createdAt: new Date() };
    this.cycles.set(cycle.id, cycle);
    return cycle;
  }

  registerBet(cycleId: string, input: RegisterBetDto): Green15kBet {
    const cycle = this.getActiveCycle(cycleId);
    if (input.stake > cycle.currentAmount) throw new BadRequestException('A stake não pode exceder o saldo do ciclo.');
    const bet: Green15kBet = { id: randomUUID(), cycleId, ...input };
    this.bets.set(bet.id, bet);
    return bet;
  }

  settleBet(betId: string, result: BetResult): Green15kCycle {
    const bet = this.bets.get(betId);
    if (!bet) throw new NotFoundException('Aposta não encontrada.');
    if (bet.result) throw new BadRequestException('Aposta já foi confirmada.');
    const cycle = this.getActiveCycle(bet.cycleId);
    bet.result = result;
    if (result === 'RED') {
      cycle.status = 'RESET';
      cycle.endedAt = new Date();
      return cycle;
    }
    cycle.currentAmount += bet.stake * (bet.odd - 1);
    if (cycle.currentAmount >= cycle.targetAmount) { cycle.status = 'COMPLETED'; cycle.endedAt = new Date(); }
    return cycle;
  }

  getCycle(cycleId: string) { return this.cycles.get(cycleId) ?? (() => { throw new NotFoundException('Ciclo não encontrado.'); })(); }
  private getActiveCycle(cycleId: string) { const cycle = this.getCycle(cycleId); if (cycle.status !== 'ACTIVE') throw new BadRequestException('O ciclo não está ativo.'); return cycle; }
}
