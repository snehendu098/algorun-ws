import { SingleStake, QueuedStake, GameState } from "./types";
import { withdraw, saveToDB, calculateMultiplier } from "./game-functions";
import { createHmac } from "crypto";

export class GameManager {
  private gameState: GameState;
  private gameTimer: Timer | null = null;
  private waitTimer: Timer | null = null;
  private endTimer: Timer | null = null;
  private updateTimer: Timer | null = null;
  private lastSentMultiplier: number = 1.0;
  private currentDisplayMultiplier: number = 1.0;
  private clients: Set<any> = new Set();

  constructor() {
    this.gameState = {
      players: new Map(),
      pendingQueue: new Map(),
      startTime: 0,
      endTime: 0,
      crashAt: 0,
      phase: "waiting",
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
    this.clients.forEach((client) => {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error("Error sending message to client:", error);
        this.clients.delete(client);
      }
    });
  }

  joinGame(
    address: string,
    amount: number,
    transactionId?: string
  ): { success: boolean; queued: boolean; message: string } {
    // Check if player already has a queued bet
    if (this.gameState.pendingQueue.has(address)) {
      return {
        success: false,
        queued: false,
        message: "You already have a bet queued for the next round",
      };
    }

    // If game is in waiting phase, add to current game
    if (this.gameState.phase === "waiting") {
      const stake: SingleStake = {
        address,
        amount,
        time: Date.now(),
      };

      this.gameState.players.set(address, stake);

      // Create stakes array in client format
      const stakes = Array.from(this.gameState.players.entries()).map(
        ([addr, stakeData]) => ({
          address: addr,
          stake: stakeData.amount,
          hasWithdrawn: stakeData.hasWithdrawn || false,
        })
      );

      this.broadcast({
        type: "player_joined",
        address,
        amount,
        totalPlayers: this.gameState.players.size,
        stakes: stakes,
        totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0),
      });

      return {
        success: true,
        queued: false,
        message: "Successfully joined the current game",
      };
    }

    // If game is running or ended, add to queue for next round
    if (
      this.gameState.phase === "running" ||
      this.gameState.phase === "ended"
    ) {
      const queuedStake: QueuedStake = {
        address,
        amount,
        time: Date.now(),
        transactionId,
      };

      this.gameState.pendingQueue.set(address, queuedStake);

      // Notify all clients about the queued bet
      this.broadcast({
        type: "bet_queued",
        address,
        amount,
        queueSize: this.gameState.pendingQueue.size,
        message: "Your bet has been queued for the next round",
      });

      return {
        success: true,
        queued: true,
        message: "Your bet has been queued for the next round",
      };
    }

    return {
      success: false,
      queued: false,
      message: "Unable to place bet at this time",
    };
  }

  async withdrawPlayer(address: string): Promise<number | null> {
    if (this.gameState.phase !== "running") {
      return null; // Can only withdraw during running phase
    }

    const stake = this.gameState.players.get(address);
    if (!stake) {
      return null; // Player not found
    }

    // Use the current display multiplier instead of calculating based on time
    const multiplier = this.currentDisplayMultiplier;

    // Calculate payout
    const payout = stake.amount * multiplier;

    // Mark player as withdrawn but keep in game state
    stake.hasWithdrawn = true;
    stake.withdrawMultiplier = multiplier;
    this.gameState.players.set(address, stake);

    // Create updated stakes array in client format (include withdrawn players)
    const stakes = Array.from(this.gameState.players.entries()).map(
      ([addr, stakeData]) => ({
        address: addr,
        stake: stakeData.amount,
        hasWithdrawn: stakeData.hasWithdrawn || false,
      })
    );

    // Broadcast withdrawal immediately for better UX
    this.broadcast({
      type: "player_withdrew",
      address,
      multiplier,
      payout,
      remainingPlayers: this.gameState.players.size,
      stakes: stakes,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0),
    });

    // Process actual withdrawal transaction asynchronously (don't wait)
    if (this.gameState.players.size > 0) {
      withdraw(address, stake, multiplier).catch((error) => {
        console.error(`Error processing withdrawal for ${address}:`, error);
      });
    }

    return payout;
  }

  private generateRandomCrashMultiplier(): number {
    // Generate random number between 1.00 and 5.00
    return 1.0 + Math.random() * 4.0;
  }

  private processPendingQueue() {
    if (this.gameState.pendingQueue.size === 0) return;

    // Process all queued bets
    const processedBets: Array<{ address: string; amount: number }> = [];

    this.gameState.pendingQueue.forEach((queuedStake, address) => {
      const stake: SingleStake = {
        address: queuedStake.address,
        amount: queuedStake.amount,
        time: Date.now(),
      };

      this.gameState.players.set(address, stake);
      processedBets.push({ address, amount: queuedStake.amount });
    });

    // Clear the queue
    this.gameState.pendingQueue.clear();

    // Create stakes array in client format
    const stakes = Array.from(this.gameState.players.entries()).map(
      ([addr, stakeData]) => ({
        address: addr,
        stake: stakeData.amount,
        hasWithdrawn: stakeData.hasWithdrawn || false,
      })
    );

    // Notify clients about processed queue
    this.broadcast({
      type: "queue_processed",
      processedBets,
      totalPlayers: this.gameState.players.size,
      stakes: stakes,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0),
      message: `${processedBets.length} queued bet(s) have been added to the game`,
    });
  }

  private startWaitingPhase() {
    this.gameState.phase = "waiting";
    this.gameState.players.clear();
    this.currentDisplayMultiplier = 1.0; // Reset display multiplier

    // Process any pending queued bets first
    this.processPendingQueue();

    this.broadcast({
      type: "waiting_phase",
      message: "Waiting for next game",
      waitTime: 15000,
      queueSize: this.gameState.pendingQueue.size,
    });

    this.waitTimer = setTimeout(() => {
      this.startGame();
    }, 15000); // 15 seconds wait
  }

  private startGame() {
    const crashMultiplier = this.generateRandomCrashMultiplier();
    const startTime = Date.now();

    this.gameState = {
      ...this.gameState,
      startTime,
      endTime: 0, // Not used anymore since we control timing via multiplier progression
      crashAt: crashMultiplier,
      phase: "running",
    };

    // Create stakes array in client format for game start
    const stakes = Array.from(this.gameState.players.entries()).map(
      ([address, stakeData]) => ({
        address,
        stake: stakeData.amount,
        hasWithdrawn: stakeData.hasWithdrawn || false,
      })
    );

    this.broadcast({
      type: "game_started",
      stakes: stakes,
      totalPlayers: this.gameState.players.size,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0),
    });

    // Start real-time updates - this will control game ending
    this.startRealtimeUpdates();

    // Remove the conflicting game timer - let multiplier progression control the end
  }

  private startRealtimeUpdates() {
    // Reset last sent multiplier for new game
    this.lastSentMultiplier = 1.0;
    this.currentDisplayMultiplier = 1.0;

    const updateMultiplier = () => {
      if (this.gameState.phase !== "running") {
        return;
      }

      // Check if we've reached or exceeded the crash point
      if (this.currentDisplayMultiplier >= this.gameState.crashAt) {
        // Send the final crash multiplier
        this.broadcast({
          type: "multiplier_update",
          multiplier: this.gameState.crashAt,
          timestamp: Date.now(),
        });

        // End game immediately
        this.endGame();
        return;
      }

      // Send current multiplier update
      this.broadcast({
        type: "multiplier_update",
        multiplier: parseFloat(this.currentDisplayMultiplier.toFixed(2)),
        timestamp: Date.now(),
      });

      // Calculate increment and next interval based on current multiplier level
      const multiplierLevel = Math.floor(this.currentDisplayMultiplier);

      // Time intervals: 1-2: 10s, 2-3: 5s, 3-4: 2.5s, etc.
      const baseInterval = 10000; // 10 seconds for 1-2 range
      const levelDuration = baseInterval / Math.pow(2, multiplierLevel - 1);

      // Calculate increment per update (0.01 increments)
      const updatesPerLevel = levelDuration / 100; // Update every 100ms
      const incrementPerUpdate = 1.0 / updatesPerLevel;

      // Increment the multiplier
      this.currentDisplayMultiplier = Math.min(
        this.currentDisplayMultiplier + incrementPerUpdate,
        this.gameState.crashAt
      );

      // Schedule next update every 100ms
      this.updateTimer = setTimeout(updateMultiplier, 100);
    };

    // Start the first update
    updateMultiplier();
  }

  private stopRealtimeUpdates() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }

  private async endGame() {
    this.gameState.phase = "ended";

    // Stop real-time updates
    this.stopRealtimeUpdates();

    // Broadcast game ended immediately for better UX
    this.broadcast({
      type: "game_ended",
      crashAt: this.gameState.crashAt,
      survivingPlayers: Array.from(this.gameState.players.entries())
        .filter(([_, stake]) => !stake.hasWithdrawn)
        .map(([address, _]) => address),
    });

    // Save crash data to database only if there were players in the game
    if (this.gameState.players.size > 0) {
      saveToDB(this.gameState.crashAt).catch((error) => {
        console.error("Error saving to database:", error);
      });
    }

    // Wait 2 seconds then start next waiting phase
    this.endTimer = setTimeout(() => {
      this.startWaitingPhase();
    }, 2000);
  }

  getCurrentMultiplier(): number {
    if (this.gameState.phase !== "running") {
      return 1.0;
    }

    return this.currentDisplayMultiplier;
  }

  getGameState() {
    const stakes = Array.from(this.gameState.players.entries()).map(
      ([address, stakeData]) => ({
        address,
        stake: stakeData.amount,
        hasWithdrawn: stakeData.hasWithdrawn || false,
      })
    );

    const queuedBets = Array.from(this.gameState.pendingQueue.entries()).map(
      ([address, queueData]) => ({
        address,
        amount: queueData.amount,
      })
    );

    return {
      phase: this.gameState.phase,
      stakes: stakes,
      totalPlayers: this.gameState.players.size,
      totalStakeAmount: stakes.reduce((sum, stake) => sum + stake.stake, 0),
      currentMultiplier: this.getCurrentMultiplier(),
      queuedBets: queuedBets,
      queueSize: this.gameState.pendingQueue.size,
    };
  }

  cleanup() {
    if (this.gameTimer) clearTimeout(this.gameTimer);
    if (this.waitTimer) clearTimeout(this.waitTimer);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.stopRealtimeUpdates();
  }
}
