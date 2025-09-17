export interface SingleStake {
  address: string;
  amount: number;
  time: number; // timestamp
  hasWithdrawn?: boolean; // tracks if player has withdrawn
  withdrawMultiplier?: number; // multiplier at which they withdrew
}

export interface QueuedStake {
  address: string;
  amount: number;
  time: number; // timestamp when queued
  transactionId?: string; // optional transaction ID for tracking
}

export interface GameState {
  players: Map<string, SingleStake>;
  pendingQueue: Map<string, QueuedStake>; // bets queued for next round
  startTime: number;
  endTime: number;
  crashAt: number;
  phase: 'waiting' | 'running' | 'ended';
}