export interface SingleStake {
  address: string;
  amount: number;
  time: number; // timestamp
}

export interface GameState {
  players: Map<string, SingleStake>;
  startTime: number;
  endTime: number;
  crashAt: number;
  phase: 'waiting' | 'running' | 'ended';
}