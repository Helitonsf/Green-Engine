export type CycleStatus = 'ACTIVE' | 'COMPLETED' | 'RESET';
export type BetResult = 'GREEN' | 'RED';

export interface Green15kCycle {
  id: string;
  userId: string;
  targetAmount: number;
  currentAmount: number;
  status: CycleStatus;
  createdAt: Date;
  endedAt?: Date;
}

export interface Green15kBet {
  id: string;
  cycleId: string;
  matchId: string;
  market: string;
  odd: number;
  stake: number;
  result?: BetResult;
}
