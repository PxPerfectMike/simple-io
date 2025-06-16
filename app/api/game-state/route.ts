import { type NextRequest, NextResponse } from "next/server"

interface Player {
  id: string
  username: string
  x: number
  y: number
  color: string
  score: number
  lastUpdate: number
}

interface Food {
  id: string
  x: number
  y: number
  color: string
}

interface GameState {
  players: Map<string, Player>
  food: Food[]
  lastUpdate: number
}

const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600
const PLAYER_SIZE = 20
const FOOD_SIZE = 8
const FOOD_COUNT = 50
const PLAYER_TIMEOUT = 10000 // 10 seconds

// Global game state
const gameState: GameState = {
  players: new Map(),
  food: [],
  lastUpdate: Date.now(),
}

// Generate random color for player
const generateColor = () => {
  const colors = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"]
  return colors[Math.floor(Math.random() * colors.length)]
}

// Generate random food
const generateFood = (): Food => {
  const colors = ["#FF4757", "#2ED573", "#3742FA", "#FF6348", "#FFA502"]
  return {
    id: `food-${Date.now()}-${Math.random()}`,
    x: Math.random() * (CANVAS_WIDTH - FOOD_SIZE),
    y: Math.random() * (CANVAS_HEIGHT - FOOD_SIZE),
    color: colors[Math.floor(Math.random() * colors.length)],
  }
}

// Initialize food if empty
const initializeFood = () => {
  if (gameState.food.length === 0) {
    gameState.food = Array.from({ length: FOOD_COUNT }, () => generateFood())
  }
}

// Clean up inactive players
const cleanupPlayers = () => {
  const now = Date.now()
  const playersToRemove: string[] = []

  gameState.players.forEach((player, id) => {
    if (now - player.lastUpdate > PLAYER_TIMEOUT) {
      playersToRemove.push(id)
    }
  })

  playersToRemove.forEach((id) => {
    gameState.players.delete(id)
  })

  if (playersToRemove.length > 0) {
    gameState.lastUpdate = now
  }
}

export async function GET() {
  cleanupPlayers()

  const playersData = Array.from(gameState.players.values()).map((p) => ({
    id: p.id,
    username: p.username,
    x: p.x,
    y: p.y,
    color: p.color,
    score: p.score,
  }))

  return NextResponse.json({
    players: playersData,
    food: gameState.food,
    lastUpdate: gameState.lastUpdate,
  })
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const now = Date.now()

    switch (data.type) {
      case "join":
        initializeFood()

        const newPlayer: Player = {
          id: data.playerId,
          username: data.username,
          x: Math.random() * (CANVAS_WIDTH - PLAYER_SIZE),
          y: Math.random() * (CANVAS_HEIGHT - PLAYER_SIZE),
          color: generateColor(),
          score: 0,
          lastUpdate: now,
        }

        gameState.players.set(data.playerId, newPlayer)
        gameState.lastUpdate = now

        return NextResponse.json({ success: true, player: newPlayer })

      case "move":
        if (gameState.players.has(data.playerId)) {
          const player = gameState.players.get(data.playerId)!

          // Validate movement bounds
          const newX = Math.max(0, Math.min(CANVAS_WIDTH - PLAYER_SIZE, data.x))
          const newY = Math.max(0, Math.min(CANVAS_HEIGHT - PLAYER_SIZE, data.y))

          player.x = newX
          player.y = newY
          player.lastUpdate = now
          gameState.lastUpdate = now
        }

        return NextResponse.json({ success: true })

      case "collectFood":
        if (gameState.players.has(data.playerId)) {
          const foodId = data.foodId
          const foodIndex = gameState.food.findIndex((f) => f.id === foodId)

          if (foodIndex !== -1) {
            // Remove the food
            gameState.food.splice(foodIndex, 1)

            // Update player score
            const player = gameState.players.get(data.playerId)!
            player.score += 1
            player.lastUpdate = now

            // Generate new food
            const newFood = generateFood()
            gameState.food.push(newFood)

            gameState.lastUpdate = now

            return NextResponse.json({
              success: true,
              newFood,
              playerScore: player.score,
            })
          }
        }

        return NextResponse.json({ success: false })

      case "heartbeat":
        // Update last active time without changing position
        if (gameState.players.has(data.playerId)) {
          const player = gameState.players.get(data.playerId)!
          player.lastUpdate = now
        }

        return NextResponse.json({ success: true })

      case "leave":
        if (gameState.players.has(data.playerId)) {
          gameState.players.delete(data.playerId)
          gameState.lastUpdate = now
        }

        return NextResponse.json({ success: true })

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }
  } catch (error) {
    console.error("Error processing request:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
