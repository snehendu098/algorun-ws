# WebSocket Game Server Testing Guide

## Setup

1. **Start the server**:
   ```bash
   cd ws
   bun run dev
   ```
   Server will run on `http://localhost:3001`

## Testing with Postman

### 1. HTTP Endpoints (Regular REST API)

#### Check Server Status
- **Method**: GET
- **URL**: `http://localhost:3001/`
- **Expected Response**: `Game WebSocket Server Running!`

#### Get Current Game State
- **Method**: GET
- **URL**: `http://localhost:3001/game/state`
- **Expected Response**:
```json
{
  "phase": "waiting",
  "stakes": [],
  "totalPlayers": 0,
  "totalStakeAmount": 0,
  "currentMultiplier": 1.00
}
```

### 2. WebSocket Connection Testing

#### Setup WebSocket Connection in Postman
1. Click **New** → **WebSocket Request**
2. Enter URL: `ws://localhost:3001/ws`
3. Click **Connect**

#### Expected Initial Message
When you connect, you should receive:
```json
{
  "type": "game_state",
  "data": {
    "phase": "waiting",
    "stakes": [],
    "totalPlayers": 0,
    "totalStakeAmount": 0,
    "currentMultiplier": 1.00
  }
}
```

## Game Flow Testing

### Step 1: Join the Game (During Waiting Phase)

**Send Message**:
```json
{
  "type": "join_game",
  "address": "player1_wallet_address",
  "amount": 100
}
```

**Expected Response**:
```json
{
  "type": "join_result",
  "success": true,
  "message": "Joined game successfully"
}
```

**Broadcast to All Clients**:
```json
{
  "type": "player_joined",
  "address": "player1_wallet_address",
  "amount": 100,
  "totalPlayers": 1,
  "stakes": [
    {"address": "player1_wallet_address", "stake": 100}
  ],
  "totalStakeAmount": 100
}
```

### Step 2: Multiple Players Join

Open multiple WebSocket connections (use different tabs in Postman) and send:

**Player 2**:
```json
{
  "type": "join_game",
  "address": "player2_wallet_address",
  "amount": 250
}
```

**Player 3**:
```json
{
  "type": "join_game",
  "address": "player3_wallet_address",
  "amount": 50
}
```

### Step 3: Game Starts (After 15 seconds)

**Broadcast Message**:
```json
{
  "type": "game_started",
  "stakes": [
    {"address": "player1_wallet_address", "stake": 100},
    {"address": "player2_wallet_address", "stake": 250},
    {"address": "player3_wallet_address", "stake": 50}
  ],
  "totalPlayers": 3,
  "totalStakeAmount": 400
}
```

### Step 4: Real-time Multiplier Updates

During the game, you'll receive continuous updates:
```json
{"type": "multiplier_update", "multiplier": 1.01, "timestamp": 1694901234567}
{"type": "multiplier_update", "multiplier": 1.02, "timestamp": 1694901234668}
{"type": "multiplier_update", "multiplier": 1.03, "timestamp": 1694901234769}
...
```

### Step 5: Player Withdrawal

**Send Message**:
```json
{
  "type": "withdraw",
  "address": "player1_wallet_address"
}
```

**Expected Response**:
```json
{
  "type": "withdraw_result",
  "success": true,
  "payout": 150.50,
  "message": "Withdrawal successful"
}
```

**Broadcast to All Clients**:
```json
{
  "type": "player_withdrew",
  "address": "player1_wallet_address",
  "multiplier": 1.50,
  "payout": 150.50,
  "remainingPlayers": 2,
  "stakes": [
    {"address": "player2_wallet_address", "stake": 250},
    {"address": "player3_wallet_address", "stake": 50}
  ],
  "totalStakeAmount": 300
}
```

### Step 6: Game Ends (Crash)

**Broadcast Message**:
```json
{
  "type": "game_ended",
  "crashAt": 2.34,
  "survivingPlayers": ["player2_wallet_address", "player3_wallet_address"]
}
```

### Step 7: Next Game Cycle

After 2 seconds, you'll receive:
```json
{
  "type": "waiting_phase",
  "message": "Waiting for next game",
  "waitTime": 15000
}
```

## Testing Scenarios

### Scenario 1: Full Game Cycle
1. Connect 3 WebSocket clients
2. All join during waiting phase
3. Wait for game to start
4. Let multiplier reach ~1.50
5. One player withdraws
6. Let game crash
7. Observe next game cycle

### Scenario 2: Late Join Attempt
1. Connect during game phase
2. Try to join:
```json
{
  "type": "join_game",
  "address": "late_player",
  "amount": 100
}
```
3. Should receive:
```json
{
  "type": "join_result",
  "success": false,
  "message": "Cannot join game at this time"
}
```

### Scenario 3: Invalid Withdrawal
1. Try to withdraw when not in game:
```json
{
  "type": "withdraw",
  "address": "non_existent_player"
}
```
2. Should receive:
```json
{
  "type": "withdraw_result",
  "success": false,
  "payout": null,
  "message": "Cannot withdraw at this time"
}
```

### Scenario 4: Get Current Multiplier
```json
{
  "type": "get_multiplier"
}
```

**Response**:
```json
{
  "type": "current_multiplier",
  "multiplier": 1.23
}
```

## Error Testing

### Invalid Message Format
**Send**:
```json
{
  "invalid": "message"
}
```

**Expected Response**:
```json
{
  "type": "error",
  "message": "Unknown message type"
}
```

### Malformed JSON
**Send**: `invalid json`

**Expected Response**:
```json
{
  "type": "error",
  "message": "Invalid message format"
}
```

## Tips for Testing

1. **Use multiple tabs** in Postman to simulate multiple players
2. **Watch timing** - you have 15 seconds to join before game starts
3. **Monitor console logs** in your terminal for server-side events
4. **Test edge cases** like withdrawing immediately when game starts
5. **Observe multiplier progression** - it should increase smoothly from 1.00 to crash point

## Expected Console Output

```
WebSocket connection opened
Withdraw - Address: player1_wallet_address, Stake: 100, Multiplier: 1.50, Payout: 150
Saving game to DB - Crashed at: 2.34
WebSocket connection closed
```