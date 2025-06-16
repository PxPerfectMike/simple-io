"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Users, Gamepad2, Wifi, WifiOff, RefreshCw, Trophy } from "lucide-react"

interface Player {
  id: string
  username: string
  x: number
  y: number
  color: string
  score: number
}

interface Food {
  id: string
  x: number
  y: number
  color: string
}

const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600
const PLAYER_SIZE = 20
const FOOD_SIZE = 8
const MOVE_SPEED = 3
const UPDATE_INTERVAL = 100 // Update every 100ms

export default function Component() {
  const [gameState, setGameState] = useState<"login" | "connecting" | "playing" | "disconnected">("login")
  const [username, setUsername] = useState("")
  const [players, setPlayers] = useState<Record<string, Player>>({})
  const [food, setFood] = useState<Food[]>([])
  const [myPlayerId, setMyPlayerId] = useState<string>("")
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const [lastServerUpdate, setLastServerUpdate] = useState<number>(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const keysRef = useRef<Set<string>>(new Set())
  const lastPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const animationFrameRef = useRef<number>()
  const updateIntervalRef = useRef<NodeJS.Timeout>()
  const movementQueueRef = useRef<{ x: number; y: number } | null>(null)

  // API call helper
  const apiCall = async (endpoint: string, data?: Record<string, unknown>) => {
    try {
      const response = await fetch(endpoint, {
        method: data ? "POST" : "GET",
        headers: data ? { "Content-Type": "application/json" } : {},
        body: data ? JSON.stringify(data) : undefined,
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      console.error("API call failed:", error)
      throw error
    }
  }

  // Connect to game
  const connectToGame = useCallback(async () => {
    setGameState("connecting")
    setConnectionStatus("connecting")

    try {
      const playerId = Math.random().toString(36).substr(2, 9)
      setMyPlayerId(playerId)

      // Join the game
      const joinResponse = await apiCall("/api/game-state", {
        type: "join",
        playerId,
        username,
      })

      if (joinResponse.success) {
        setConnectionStatus("connected")
        setGameState("playing")

        // Start polling for updates
        startGameUpdates()
      } else {
        throw new Error("Failed to join game")
      }
    } catch (error) {
      console.error("Failed to connect:", error)
      setConnectionStatus("disconnected")
      setGameState("disconnected")
    }
  }, [username])

  // Start game update polling
  const startGameUpdates = useCallback(() => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current)
    }

    const updateGame = async () => {
      try {
        // Send any pending movement
        if (movementQueueRef.current && myPlayerId) {
          await apiCall("/api/game-state", {
            type: "move",
            playerId: myPlayerId,
            x: movementQueueRef.current.x,
            y: movementQueueRef.current.y,
          })
          movementQueueRef.current = null
        }

        // Get current game state
        const gameData = await apiCall("/api/game-state")

        // Only update if server state has changed
        if (gameData.lastUpdate > lastServerUpdate) {
          const playersMap: Record<string, Player> = {}
          gameData.players.forEach((player: Player) => {
            playersMap[player.id] = player
          })
          setPlayers(playersMap)
          setFood(gameData.food)
          setLastServerUpdate(gameData.lastUpdate)
        }

        setConnectionStatus("connected")
      } catch (error) {
        console.error("Failed to update game:", error)
        setConnectionStatus("disconnected")
      }
    }

    updateGame() // Initial update
    updateIntervalRef.current = setInterval(updateGame, UPDATE_INTERVAL)
  }, [myPlayerId, lastServerUpdate])

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase())
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase())
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [])

  // Game loop for movement and collision detection
  useEffect(() => {
    if (gameState !== "playing" || !myPlayerId || !players[myPlayerId]) return

    const gameLoop = () => {
      const myPlayer = players[myPlayerId]
      if (!myPlayer) return

      let newX = myPlayer.x
      let newY = myPlayer.y
      let moved = false

      // Handle movement
      if (keysRef.current.has("w") || keysRef.current.has("arrowup")) {
        newY = Math.max(0, newY - MOVE_SPEED)
        moved = true
      }
      if (keysRef.current.has("s") || keysRef.current.has("arrowdown")) {
        newY = Math.min(CANVAS_HEIGHT - PLAYER_SIZE, newY + MOVE_SPEED)
        moved = true
      }
      if (keysRef.current.has("a") || keysRef.current.has("arrowleft")) {
        newX = Math.max(0, newX - MOVE_SPEED)
        moved = true
      }
      if (keysRef.current.has("d") || keysRef.current.has("arrowright")) {
        newX = Math.min(CANVAS_WIDTH - PLAYER_SIZE, newX + MOVE_SPEED)
        moved = true
      }

      // Queue movement for server update
      if (moved && (newX !== lastPositionRef.current.x || newY !== lastPositionRef.current.y)) {
        lastPositionRef.current = { x: newX, y: newY }
        movementQueueRef.current = { x: newX, y: newY }

        // Update local position immediately for smooth movement
        setPlayers((prev) => ({
          ...prev,
          [myPlayerId]: { ...prev[myPlayerId], x: newX, y: newY },
        }))
      }

      // Check food collision
      food.forEach((foodItem) => {
        const distance = Math.sqrt(
          Math.pow(newX + PLAYER_SIZE / 2 - (foodItem.x + FOOD_SIZE / 2), 2) +
            Math.pow(newY + PLAYER_SIZE / 2 - (foodItem.y + FOOD_SIZE / 2), 2),
        )

        if (distance < PLAYER_SIZE / 2 + FOOD_SIZE / 2) {
          // Send food collection to server
          apiCall("/api/game-state", {
            type: "collectFood",
            playerId: myPlayerId,
            foodId: foodItem.id,
          }).catch(console.error)
        }
      })

      animationFrameRef.current = requestAnimationFrame(gameLoop)
    }

    animationFrameRef.current = requestAnimationFrame(gameLoop)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [gameState, myPlayerId, players, food])

  // Render game
  useEffect(() => {
    if (gameState !== "playing") return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear canvas
    ctx.fillStyle = "#1a1a2e"
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // Draw grid
    ctx.strokeStyle = "#16213e"
    ctx.lineWidth = 1
    for (let x = 0; x < CANVAS_WIDTH; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, CANVAS_HEIGHT)
      ctx.stroke()
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += 40) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(CANVAS_WIDTH, y)
      ctx.stroke()
    }

    // Draw food
    food.forEach((foodItem) => {
      ctx.fillStyle = foodItem.color
      ctx.beginPath()
      ctx.arc(foodItem.x + FOOD_SIZE / 2, foodItem.y + FOOD_SIZE / 2, FOOD_SIZE / 2, 0, Math.PI * 2)
      ctx.fill()
    })

    // Draw players
    Object.values(players).forEach((player) => {
      // Player circle
      ctx.fillStyle = player.color
      ctx.beginPath()
      ctx.arc(player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2, PLAYER_SIZE / 2, 0, Math.PI * 2)
      ctx.fill()

      // Player border (highlight current player)
      ctx.strokeStyle = player.id === myPlayerId ? "#ffff00" : "#ffffff"
      ctx.lineWidth = player.id === myPlayerId ? 3 : 2
      ctx.stroke()

      // Player name
      ctx.fillStyle = "#ffffff"
      ctx.font = "12px Arial"
      ctx.textAlign = "center"
      ctx.fillText(player.username, player.x + PLAYER_SIZE / 2, player.y - 5)
    })
  }, [gameState, players, food, myPlayerId])

  const handleJoinGame = () => {
    if (username.trim()) {
      connectToGame()
    }
  }

  const handleLeaveGame = async () => {
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current)
    }

    if (myPlayerId) {
      try {
        await apiCall("/api/game-state", {
          type: "leave",
          playerId: myPlayerId,
        })
      } catch (error) {
        console.error("Error leaving game:", error)
      }
    }

    setGameState("login")
    setPlayers({})
    setFood([])
    setMyPlayerId("")
    setConnectionStatus("disconnected")
  }

  const handleReconnect = () => {
    connectToGame()
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-5xl font-bold text-white mb-4">Dot.io</h1>
        <p className="text-lg text-white/80 mb-8 max-w-xl">
          Eat dots, grow bigger and climb the leaderboard against players around the world.
        </p>
        <Card className="w-full max-w-md bg-white/5 backdrop-blur-md border border-white/20 shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
              <Gamepad2 className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-white">Join the Arena</CardTitle>
            <CardDescription className="text-white/70">
              Enter a username to start playing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="Your name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleJoinGame()}
                maxLength={20}
              />
            </div>
            <Button onClick={handleJoinGame} className="w-full" disabled={!username.trim()}>
              Play Now
            </Button>
            <div className="text-center text-sm text-white/70">
              Use WASD or arrow keys to move around and collect food!
            </div>
          </CardContent>
        </Card>
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6 text-white/90 max-w-md w-full">
          <div className="flex flex-col items-center gap-2">
            <Users className="h-6 w-6" />
            <span className="text-sm">Multiplayer</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Gamepad2 className="h-6 w-6" />
            <span className="text-sm">Easy Controls</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Trophy className="h-6 w-6" />
            <span className="text-sm">Leaderboard</span>
          </div>
        </div>
      </div>
    )
  }

  if (gameState === "connecting") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center p-8">
            <RefreshCw className="h-12 w-12 animate-spin text-blue-500 mb-4" />
            <p className="text-lg font-medium">Connecting to game server...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (gameState === "disconnected") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-900 via-gray-900 to-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <WifiOff className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <CardTitle className="text-2xl font-bold">Connection Lost</CardTitle>
            <CardDescription>Unable to connect to the game server</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleReconnect} className="w-full">
              Reconnect
            </Button>
            <Button onClick={handleLeaveGame} variant="outline" className="w-full">
              Back to Menu
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score)

  return (
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-white">Dot.io Game</h1>
            <Badge variant="secondary" className="flex items-center gap-1">
              <Users className="w-4 h-4" />
              {Object.keys(players).length} players
            </Badge>
            <Badge
              variant={connectionStatus === "connected" ? "default" : "destructive"}
              className="flex items-center gap-1"
            >
              {connectionStatus === "connected" ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {connectionStatus}
            </Badge>
          </div>
          <Button variant="outline" onClick={handleLeaveGame}>
            Leave Game
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Game Canvas */}
          <div className="lg:col-span-3">
            <Card className="p-4">
              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="border border-gray-300 rounded-lg w-full max-w-full"
                style={{ aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}` }}
              />
              <div className="mt-2 text-center text-sm text-muted-foreground">
                Use WASD or arrow keys to move • Collect colored dots to grow your score • Yellow border = You
              </div>
            </Card>
          </div>

          {/* Leaderboard */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Leaderboard</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sortedPlayers.map((player, index) => (
                  <div
                    key={player.id}
                    className={`flex items-center justify-between p-2 rounded ${
                      player.id === myPlayerId ? "bg-blue-100 dark:bg-blue-900" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">#{index + 1}</span>
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: player.color }} />
                      <span className="text-sm truncate max-w-20">{player.username}</span>
                      {player.id === myPlayerId && <span className="text-xs text-blue-600">(You)</span>}
                    </div>
                    <Badge variant="secondary">{player.score}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
