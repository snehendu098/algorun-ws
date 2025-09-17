export interface SingleStake {
  address: string;
  amount: number;
  time: number; // timestamp
  hasWithdrawn?: boolean; // tracks if player has withdrawn
  withdrawMultiplier?: number; // multiplier at which they withdrew
}

export interface GameState {
  players: Map<string, SingleStake>;
  startTime: number;
  endTime: number;
  crashAt: number;
  phase: 'waiting' | 'running' | 'ended';
}