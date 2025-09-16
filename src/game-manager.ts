import { SingleStake, GameState } from './types';
import { withdraw, saveToDB, calculateMultiplier } from './game-functions';

export class GameManager {
  private gameState: GameState;
  private gameTimer: Timer | null = null;
  private waitTimer: Timer | null = null;
  private endTimer: Timer | null = null;
  private updateTimer: Timer | null = null;
  private lastSentMultiplier: number = 1.00;
  private clients: Set<any> = new Set();

  constructor() {
    this.gameState = {
      players: new Map(),
      startTime: 0,
      endTime: 0,
      crashAt: 0,
      phase: 'waiting'
    };
    this.startWaitingPhase();
  }

  addClient(ws: any) {
    this.clients.add(ws);
  }

  removeClient(ws: any) {
    this.clients.delete(ws);
  }

  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach(client => {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('Error sending message to client:', error);
        this.clients.delete(client);
      }
    });
  }

  joinGame(address: string, amount: number): boolean {
    if (this.gameState.phase !== 'waiting') {
      return false; // Cannot join when game is running or ended
    }

    const stake: SingleStake = {
      address,
      amount,
      time: Date.now()
    };

    this.gameState.players.set(address, stake);

    // Create stakes array in client format
    const stakes = Array.from(this.gameState.players.entries()).map(([addr, stakeData]) => ({
      address: addr,
      stake: stakeData.amount
    }));

    this.broadcast({
      type: 'player_joined',
      address,
      amount,
      totalPlayers: this.gameState.players.size,
      stakes: stakes,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0)
    });

    return true;
  }

  async withdrawPlayer(address: string): Promise<number | null> {
    if (this.gameState.phase !== 'running') {
      return null; // Can only withdraw during running phase
    }

    const stake = this.gameState.players.get(address);
    if (!stake) {
      return null; // Player not found
    }

    const currentTime = Date.now();
    const multiplier = calculateMultiplier(
      this.gameState.startTime,
      this.gameState.endTime,
      currentTime,
      this.gameState.crashAt
    );

    const payout = withdraw(address, stake, multiplier);

    // Remove player from game
    this.gameState.players.delete(address);

    // Create updated stakes array in client format
    const stakes = Array.from(this.gameState.players.entries()).map(([addr, stakeData]) => ({
      address: addr,
      stake: stakeData.amount
    }));

    this.broadcast({
      type: 'player_withdrew',
      address,
      multiplier,
      payout,
      remainingPlayers: this.gameState.players.size,
      stakes: stakes,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0)
    });

    return payout;
  }

  private generateRandomCrashMultiplier(): number {
    // Generate random number between 1.00 and 5.00
    return 1.00 + Math.random() * 4.00;
  }

  private startWaitingPhase() {
    this.gameState.phase = 'waiting';
    this.gameState.players.clear();

    this.broadcast({
      type: 'waiting_phase',
      message: 'Waiting for next game',
      waitTime: 15000
    });

    this.waitTimer = setTimeout(() => {
      this.startGame();
    }, 15000); // 15 seconds wait
  }

  private startGame() {
    const crashMultiplier = this.generateRandomCrashMultiplier();
    const startTime = Date.now();

    // Calculate game duration based on crash multiplier
    // If crash is at 5.00, game should last full duration
    // If crash is at 1.00, game should end immediately
    const maxDuration = 10000; // 10 seconds max game duration
    const gameDuration = ((crashMultiplier - 1.00) / 4.00) * maxDuration;

    this.gameState = {
      ...this.gameState,
      startTime,
      endTime: startTime + gameDuration,
      crashAt: crashMultiplier,
      phase: 'running'
    };

    // Create stakes array in client format for game start
    const stakes = Array.from(this.gameState.players.entries()).map(([address, stakeData]) => ({
      address,
      stake: stakeData.amount
    }));

    this.broadcast({
      type: 'game_started',
      stakes: stakes,
      totalPlayers: this.gameState.players.size,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0)
    });

    // Start real-time updates
    this.startRealtimeUpdates();

    // End the game when crash time is reached
    this.gameTimer = setTimeout(() => {
      this.endGame();
    }, gameDuration);
  }

  private startRealtimeUpdates() {
    // Reset last sent multiplier for new game
    this.lastSentMultiplier = 1.00;

    // Check for multiplier changes every 10ms for precision
    this.updateTimer = setInterval(() => {
      if (this.gameState.phase === 'running') {
        const currentMultiplier = calculateMultiplier(
          this.gameState.startTime,
          this.gameState.endTime,
          Date.now(),
          this.gameState.crashAt
        );
        const roundedMultiplier = Math.round(currentMultiplier * 100) / 100; // Round to 2 decimal places

        // Only send update if multiplier changed by at least 0.01
        if (Math.abs(roundedMultiplier - this.lastSentMultiplier) >= 0.01) {
          this.lastSentMultiplier = roundedMultiplier;

          this.broadcast({
            type: 'multiplier_update',
            multiplier: parseFloat(roundedMultiplier.toFixed(2)), // Ensure 2 decimal places
            timestamp: Date.now()
          });
        }
      }
    }, 10); // Check every 10ms for smooth detection
  }

  private stopRealtimeUpdates() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  private async endGame() {
    this.gameState.phase = 'ended';

    // Stop real-time updates
    this.stopRealtimeUpdates();

    // Save crash data to database
    await saveToDB(this.gameState.crashAt);

    this.broadcast({
      type: 'game_ended',
      crashAt: this.gameState.crashAt,
      survivingPlayers: Array.from(this.gameState.players.keys())
    });

    // Wait 2 seconds then start next waiting phase
    this.endTimer = setTimeout(() => {
      this.startWaitingPhase();
    }, 2000);
  }

  getCurrentMultiplier(): number {
    if (this.gameState.phase !== 'running') {
      return 1.00;
    }

    return calculateMultiplier(
      this.gameState.startTime,
      this.gameState.endTime,
      Date.now(),
      this.gameState.crashAt
    );
  }

  getGameState() {
    const stakes = Array.from(this.gameState.players.entries()).map(([address, stakeData]) => ({
      address,
      stake: stakeData.amount
    }));

    return {
      phase: this.gameState.phase,
      stakes: stakes,
      totalPlayers: this.gameState.players.size,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0),
      currentMultiplier: this.getCurrentMultiplier()
    };
  }

  cleanup() {
    if (this.gameTimer) clearTimeout(this.gameTimer);
    if (this.waitTimer) clearTimeout(this.waitTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.stopRealtimeUpdates();
  }
}