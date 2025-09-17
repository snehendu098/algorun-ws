import { Hono } from 'hono'
import { GameManager } from './game-manager'

const app = new Hono()
const gameManager = new GameManager()

app.get('/', (c) => {
  return c.text('Game WebSocket Server Running!')
})


app.get('/game/state', (c) => {
  return c.json(gameManager.getGameState())
})

export default {
  port: 3001,
  fetch(req: Request, server: any) {
    const url = new URL(req.url)

    if (url.pathname === '/ws') {
      if (server.upgrade(req)) {
        return // upgrade was successful
      }
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    return app.fetch(req)
  },
  websocket: {
    open(ws: any) {
      console.log('WebSocket connection opened')
      gameManager.addClient(ws)

      // Send current game state to new client
      ws.send(JSON.stringify({
        type: 'game_state',
        data: gameManager.getGameState()
      }))
    },

    message(ws: any, message: string) {
      try {
        const data = JSON.parse(message)

        switch (data.type) {
          case 'join_game':
            const result = gameManager.joinGame(data.address, data.amount, data.transactionId)
            ws.send(JSON.stringify({
              type: 'join_result',
              success: result.success,
              queued: result.queued,
              message: result.message
            }))
            break

          case 'withdraw':
            gameManager.withdrawPlayer(data.address).then(payout => {
              ws.send(JSON.stringify({
                type: 'withdraw_result',
                success: payout !== null,
                payout,
                message: payout !== null ? 'Withdrawal successful' : 'Cannot withdraw at this time'
              }))
            })
            break

          case 'get_multiplier':
            ws.send(JSON.stringify({
              type: 'current_multiplier',
              multiplier: gameManager.getCurrentMultiplier()
            }))
            break

          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Unknown message type'
            }))
        }
      } catch (error) {
        console.error('Error processing message:', error)
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }))
      }
    },

    close(ws: any) {
      console.log('WebSocket connection closed')
      gameManager.removeClient(ws)
    }
  }
}
