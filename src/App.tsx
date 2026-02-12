import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

// 六边形方向枚举 (0-5 表示六个方向)
enum Direction {
  RIGHT = 0,
  DOWN_RIGHT = 1,
  DOWN_LEFT = 2,
  LEFT = 3,
  UP_LEFT = 4,
  UP_RIGHT = 5,
}

// 六边形坐标 (使用轴向坐标系统)
interface HexCoord {
  q: number // 列
  r: number // 行
}

// 蛇的身体段
interface SnakeSegment extends HexCoord {
  side: number // 0 = A面, 1 = B面
}

// 食物
interface Food extends HexCoord {
  side: number // 0 = A面, 1 = B面
}

// 游戏状态
interface GameState {
  snake: SnakeSegment[]
  food: Food
  direction: Direction
  currentSide: number // 当前显示的面 0 = A面, 1 = B面
  score: number
  gameOver: boolean
  isPlaying: boolean
  eatEffect: { x: number; y: number; active: boolean; timestamp: number } | null
  wrapImmunity: number // 翻转后的免疫步数（>0时不会撞墙）
}

// 六边形大小配置 - 格子变小
const HEX_SIZE = 10
const HEX_WIDTH = HEX_SIZE * 2
const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE
const GRID_RADIUS = 15 // 增大区域半径

// 方向向量 (轴向坐标)
const DIRECTION_VECTORS = [
  { q: 1, r: 0 },   // RIGHT
  { q: 0, r: 1 },   // DOWN_RIGHT
  { q: -1, r: 1 },  // DOWN_LEFT
  { q: -1, r: 0 },  // LEFT
  { q: 0, r: -1 },  // UP_LEFT
  { q: 1, r: -1 },  // UP_RIGHT
]

// 翻转出口定义 - 三对对称边
const WRAP_EDGE_PAIRS = [
  {
    name: 'horizontal',
    checks: [(c: HexCoord) => c.q === -GRID_RADIUS, (c: HexCoord) => c.q === GRID_RADIUS]  // 左、右
  },
  {
    name: 'diagonal1',
    checks: [(c: HexCoord) => c.r === GRID_RADIUS, (c: HexCoord) => c.r === -GRID_RADIUS]  // 左下、右上
  },
  {
    name: 'diagonal2',
    checks: [(c: HexCoord) => -c.q - c.r === GRID_RADIUS, (c: HexCoord) => -c.q - c.r === -GRID_RADIUS]  // 左上、右下
  }
]

// 随机选择一对边作为翻转出口（整局不变）
const FIXED_WRAP_PAIR_INDEX = Math.floor(Math.random() * 3)

// 检查格子是否是翻转出口
function isWrapExit(coord: HexCoord): boolean {
  return WRAP_EDGE_PAIRS[FIXED_WRAP_PAIR_INDEX].checks.some(check => check(coord))
}

// 检查格子是否在任意边上（用于显示墙壁）
function isOnAnyEdge(coord: HexCoord): boolean {
  return WRAP_EDGE_PAIRS.some(pair => pair.checks.some(check => check(coord)))
}

// 测试翻转逻辑
function testWrapLogic() {
  console.log('=== 翻转逻辑测试 ===')
  console.log('GRID_RADIUS:', GRID_RADIUS)
  console.log('FIXED_WRAP_PAIR_INDEX:', FIXED_WRAP_PAIR_INDEX)
  console.log('翻转边对:', WRAP_EDGE_PAIRS[FIXED_WRAP_PAIR_INDEX].name)

  // 测试各种翻转场景
  const testCases = [
    { coord: { q: -GRID_RADIUS, r: 0 }, dir: Direction.LEFT, desc: '左边向左' },
    { coord: { q: GRID_RADIUS, r: 0 }, dir: Direction.RIGHT, desc: '右边向右' },
    { coord: { q: 0, r: GRID_RADIUS }, dir: Direction.DOWN_LEFT, desc: '左下向左下' },
    { coord: { q: 0, r: -GRID_RADIUS }, dir: Direction.UP_RIGHT, desc: '右上向右上' },
    { coord: { q: 0, r: GRID_RADIUS }, dir: Direction.UP_LEFT, desc: '左下向左上' },
    { coord: { q: 0, r: -GRID_RADIUS }, dir: Direction.DOWN_RIGHT, desc: '右上向右下' },
    // 用户提到的具体例子：左下从下到上第三个格子
    { coord: { q: -2, r: GRID_RADIUS }, dir: Direction.UP_RIGHT, desc: '左下从下到上第3个格子' },
    { coord: { q: 2, r: -GRID_RADIUS }, dir: Direction.DOWN_LEFT, desc: '右上从上到下第3个格子' },
  ]

  for (const tc of testCases) {
    const exitInfo = getExitInfo(tc.coord, tc.dir)
    console.log(`${tc.desc}:`)
    console.log(`  原位置: (${tc.coord.q}, ${tc.coord.r}), 方向: ${tc.dir}`)
    console.log(`  是否翻转: ${exitInfo.isWrap}`)
    if (exitInfo.newCoord) {
      console.log(`  新位置: (${exitInfo.newCoord.q}, ${exitInfo.newCoord.r}), 有效: ${isValidPosition(exitInfo.newCoord)}`)
    }
  }
  console.log('=== 测试结束 ===')
}

// 将轴向坐标转换为屏幕坐标
function hexToPixel(q: number, r: number): { x: number; y: number } {
  const x = HEX_SIZE * (3 / 2 * q)
  const y = HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r)
  return { x, y }
}

// 生成六边形路径
function createHexPath(centerX: number, centerY: number, size: number): string {
  const points: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i
    const x = centerX + size * Math.cos(angle)
    const y = centerY + size * Math.sin(angle)
    points.push(`${x},${y}`)
  }
  return `M ${points.join(' L ')} Z`
}

// 获取所有有效的六边形格子
function getValidHexCells(): HexCoord[] {
  const cells: HexCoord[] = []
  for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
    const r1 = Math.max(-GRID_RADIUS, -q - GRID_RADIUS)
    const r2 = Math.min(GRID_RADIUS, -q + GRID_RADIUS)
    for (let r = r1; r <= r2; r++) {
      cells.push({ q, r })
    }
  }
  return cells
}

// 检查坐标是否相等
function isSameCoord(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r
}

// 检查坐标是否在蛇身上（考虑双面）
function isOnSnake(coord: HexCoord, side: number, snake: SnakeSegment[]): boolean {
  return snake.some(segment => isSameCoord(segment, coord) && segment.side === side)
}



// 获取格子从哪个方向出去会越界，并判断是否是翻转出口
// 翻转后从对称位置出现
function getExitInfo(
  coord: HexCoord,
  direction: Direction
): {
  isWrap: boolean;
  newCoord?: HexCoord;
} {
  const vector = DIRECTION_VECTORS[direction]
  const next = { q: coord.q + vector.q, r: coord.r + vector.r }

  if (!isValidPosition(next)) {
    // 检查当前格子是否在翻转出口上
    if (isWrapExit(coord)) {
      // 根据当前翻转边的对称轴计算蛇头的轴对称位置
      const activeEdgePair = WRAP_EDGE_PAIRS[FIXED_WRAP_PAIR_INDEX]
      let newCoord: HexCoord
      
      if (activeEdgePair.name === 'horizontal') {
        // 水平边 (q = ±GRID_RADIUS)，对称轴是 q = 0
        // 关于 q=0 对称：q' = -q, r' = r
        newCoord = {
          q: -coord.q,
          r: coord.r
        }
      } else if (activeEdgePair.name === 'diagonal1') {
        // 对角线1 (r = ±GRID_RADIUS)，对称轴是 r = 0
        // 关于 r=0 对称：q' = q, r' = -r
        newCoord = {
          q: coord.q,
          r: -coord.r
        }
      } else {
        // 对角线2 (s = ±GRID_RADIUS，即 -q-r = ±GRID_RADIUS)，对称轴是 s = 0
        // 关于 s=0 对称：q' = -r, r' = -q
        newCoord = {
          q: -coord.r,
          r: -coord.q
        }
      }
      
      // 确保新位置在有效范围内，如果不在，则向中心方向调整
      if (!isValidPosition(newCoord)) {
        // 向中心方向调整一个单位
        const centerVector = {
          q: newCoord.q > 0 ? -1 : (newCoord.q < 0 ? 1 : 0),
          r: newCoord.r > 0 ? -1 : (newCoord.r < 0 ? 1 : 0)
        }
        newCoord = {
          q: newCoord.q + centerVector.q,
          r: newCoord.r + centerVector.r
        }
      }

      return { isWrap: true, newCoord }
    }
    return { isWrap: false }
  }

  return { isWrap: false }
}

// 生成随机食物位置（双面）
function generateFood(snake: SnakeSegment[], targetSide?: number): Food {
  const validCells = getValidHexCells()
  const availablePositions: Food[] = []
  
  // 收集所有可用的位置（两面或指定面）
  for (const cell of validCells) {
    const sidesToCheck = targetSide !== undefined ? [targetSide] : [0, 1]
    for (const side of sidesToCheck) {
      if (!isOnSnake(cell, side, snake)) {
        availablePositions.push({ ...cell, side })
      }
    }
  }
  
  if (availablePositions.length === 0) return { q: 0, r: 0, side: 0 }
  return availablePositions[Math.floor(Math.random() * availablePositions.length)]
}

// 获取下一个位置
function getNextPosition(head: HexCoord, direction: Direction): HexCoord {
  const vector = DIRECTION_VECTORS[direction]
  return {
    q: head.q + vector.q,
    r: head.r + vector.r
  }
}

// 检查位置是否在有效区域内
function isValidPosition(coord: HexCoord): boolean {
  return Math.abs(coord.q) <= GRID_RADIUS && 
         Math.abs(coord.r) <= GRID_RADIUS && 
         Math.abs(coord.q + coord.r) <= GRID_RADIUS
}



function App() {
  const validCells = useRef(getValidHexCells())
  const gameLoopRef = useRef<number | null>(null)
  const effectTimeoutRef = useRef<number | null>(null)
  
  // 运行测试
  useEffect(() => {
    testWrapLogic()
  }, [])
  
  const [gameState, setGameState] = useState<GameState>(() => {
    const initialSnake: SnakeSegment[] = [
      { q: 0, r: 0, side: 0 }, 
      { q: -1, r: 0, side: 0 }, 
      { q: -2, r: 0, side: 0 }
    ]
    return {
      snake: initialSnake,
      food: generateFood(initialSnake),
      direction: Direction.RIGHT,
      currentSide: 0,
      score: 0,
      gameOver: false,
      isPlaying: false,
      eatEffect: null,
      wrapImmunity: 0
    }
  })

  // 清理特效定时器
  useEffect(() => {
    return () => {
      if (effectTimeoutRef.current) {
        clearTimeout(effectTimeoutRef.current)
      }
    }
  }, [])

  // 游戏循环
  useEffect(() => {
    if (gameState.isPlaying && !gameState.gameOver) {
      gameLoopRef.current = setInterval(() => {
        setGameState(prev => {
          const head = prev.snake[0]
          let newHead: SnakeSegment
          let newSide = head.side
          let flipped = false
          
          const nextCoord = getNextPosition(head, prev.direction)

          // 检查是否需要翻转或撞墙
          const exitInfo = getExitInfo(head, prev.direction)

          let newDirection = prev.direction
          
          if (exitInfo.isWrap && exitInfo.newCoord) {
            // 翻转出口 - 翻转时免疫墙壁
            newHead = { ...exitInfo.newCoord, side: 1 - head.side }
            newSide = newHead.side
            flipped = true
            
            // 根据当前翻转边的对称轴翻转行进方向，然后取反（往棋盘内部走）
            const activeEdgePair = WRAP_EDGE_PAIRS[FIXED_WRAP_PAIR_INDEX]
            let flippedDirection: Direction
            if (activeEdgePair.name === 'horizontal') {
              // 水平边 (q = ±GRID_RADIUS)，对称轴是 q = 0
              // 关于垂直线对称，左右翻转
              const horizontalFlip: Direction[] = [3, 2, 1, 0, 5, 4]
              flippedDirection = horizontalFlip[prev.direction]
            } else if (activeEdgePair.name === 'diagonal1') {
              // 对角线1 (r = ±GRID_RADIUS)，对称轴是 r = 0
              // 关于水平线对称，上下翻转
              const diagonal1Flip: Direction[] = [0, 5, 4, 3, 2, 1]
              flippedDirection = diagonal1Flip[prev.direction]
            } else {
              // 对角线2 (s = ±GRID_RADIUS)，对称轴是 s = 0
              // 关于 s=0 对称
              const diagonal2Flip: Direction[] = [4, 3, 2, 1, 0, 5]
              flippedDirection = diagonal2Flip[prev.direction]
            }
            // 取反方向（加3再对6取模），使蛇往棋盘内部走
            newDirection = ((flippedDirection + 3) % 6) as Direction
          } else if (!isValidPosition(nextCoord)) {
            // 撞墙
            return { ...prev, gameOver: true, isPlaying: false }
          } else {
            newHead = { ...nextCoord, side: head.side }
          }

          // 检查撞到自己（只检查当前面）
          if (isOnSnake(newHead, newSide, prev.snake)) {
            return { ...prev, gameOver: true, isPlaying: false }
          }

          const newSnake = [newHead, ...prev.snake]
          let newFood = prev.food
          let newScore = prev.score
          let newEatEffect = prev.eatEffect
          let newCurrentSide = flipped ? newSide : prev.currentSide
          let newWrapImmunity = prev.wrapImmunity

          // 如果发生了翻转，设置免疫（翻转后第一格不撞墙）
          // 同时翻转食物到另一面的对应位置
          if (flipped) {
            newWrapImmunity = 1
            // 根据当前翻转边的对称轴计算食物的轴对称位置
            const activeEdgePair = WRAP_EDGE_PAIRS[FIXED_WRAP_PAIR_INDEX]
            let flippedFoodCoord: HexCoord
            
            if (activeEdgePair.name === 'horizontal') {
              // 水平边 (q = ±GRID_RADIUS)，对称轴是 q = 0
              flippedFoodCoord = {
                q: -prev.food.q,
                r: prev.food.r
              }
            } else if (activeEdgePair.name === 'diagonal1') {
              // 对角线1 (r = ±GRID_RADIUS)，对称轴是 r = 0
              flippedFoodCoord = {
                q: prev.food.q,
                r: -prev.food.r
              }
            } else {
              // 对角线2 (s = ±GRID_RADIUS)，对称轴是 s = 0
              flippedFoodCoord = {
                q: -prev.food.r,
                r: -prev.food.q
              }
            }
            
            // 检查翻转后的食物位置是否有效，如果无效则重新生成
            if (isValidPosition(flippedFoodCoord)) {
              newFood = {
                q: flippedFoodCoord.q,
                r: flippedFoodCoord.r,
                side: newSide  // 翻转到新的面
              }
            } else {
              // 如果翻转后的位置无效，重新生成食物（在新的面上）
              newFood = generateFood(newSnake, newSide)
            }
          } else if (newWrapImmunity > 0) {
            // 移动一步后，免疫结束
            newWrapImmunity--
          }
          
          // 检查是否吃到食物
          if (isSameCoord(newHead, prev.food) && newSide === prev.food.side) {
            newScore += 10
            newFood = generateFood(newSnake)
            
            // 触发吃果实特效
            const headPixel = hexToPixel(newHead.q, newHead.r)
            newEatEffect = {
              x: headPixel.x,
              y: headPixel.y,
              active: true,
              timestamp: Date.now()
            }
            
            // 清除之前的特效定时器
            if (effectTimeoutRef.current) {
              clearTimeout(effectTimeoutRef.current)
            }
            
            // 500ms后清除特效
            effectTimeoutRef.current = setTimeout(() => {
              setGameState(s => ({ ...s, eatEffect: null }))
            }, 500)
          } else {
            newSnake.pop()
          }
          
          return {
            ...prev,
            snake: newSnake,
            food: newFood,
            score: newScore,
            direction: newDirection,
            currentSide: newCurrentSide,
            eatEffect: newEatEffect,
            wrapImmunity: newWrapImmunity
          }
        })
      }, 120) // 稍微加快游戏速度
    }
    
    return () => {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }
  }, [gameState.isPlaying, gameState.gameOver])

  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!gameState.isPlaying || gameState.gameOver) return
      
      setGameState(prev => {
        let newDirection = prev.direction
        
        switch (e.key) {
          case 'ArrowLeft':
            newDirection = (prev.direction + 5) % 6 as Direction
            break
          case 'ArrowRight':
            newDirection = (prev.direction + 1) % 6 as Direction
            break
        }
        
        return { ...prev, direction: newDirection }
      })
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [gameState.isPlaying, gameState.gameOver])

  const startGame = useCallback(() => {
    const initialSnake: SnakeSegment[] = [
      { q: 0, r: 0, side: 0 }, 
      { q: -1, r: 0, side: 0 }, 
      { q: -2, r: 0, side: 0 }
    ]
    setGameState({
      snake: initialSnake,
      food: generateFood(initialSnake),
      direction: Direction.RIGHT,
      currentSide: 0,
      score: 0,
      gameOver: false,
      isPlaying: true,
      eatEffect: null,
      wrapImmunity: 0
    })
  }, [])

  const restartGame = useCallback(() => {
    const initialSnake: SnakeSegment[] = [
      { q: 0, r: 0, side: 0 }, 
      { q: -1, r: 0, side: 0 }, 
      { q: -2, r: 0, side: 0 }
    ]
    setGameState({
      snake: initialSnake,
      food: generateFood(initialSnake),
      direction: Direction.RIGHT,
      currentSide: 0,
      score: 0,
      gameOver: false,
      isPlaying: true,
      eatEffect: null,
      wrapImmunity: 0
    })
  }, [])

  // 计算 SVG 视口大小
  const viewBoxWidth = HEX_WIDTH * (GRID_RADIUS * 2 + 3)
  const viewBoxHeight = HEX_HEIGHT * (GRID_RADIUS * 2 + 3)

  return (
    <div className="game-container">
      <div className="game-header">
        <h1>六边形贪吃蛇</h1>
        <div className="score-board">
          <div className="score">得分: {gameState.score}</div>
          <div className="side-indicator">
            当前: {gameState.currentSide === 0 ? 'A面' : 'B面'}
          </div>
        </div>
      </div>
      
      <div className="game-board">
        <svg 
          viewBox={`${-viewBoxWidth/2} ${-viewBoxHeight/2} ${viewBoxWidth} ${viewBoxHeight}`}
          className="game-svg"
        >
          {/* 渲染所有六边形格子 */}
          {validCells.current.map((cell, index) => {
            const { x, y } = hexToPixel(cell.q, cell.r)
            
            // 只显示当前面的蛇
            const snakeOnCell = gameState.snake.filter(s => s.side === gameState.currentSide)
            const isSnakeHead = isSameCoord(cell, snakeOnCell[0] || { q: -999, r: -999 })
            const isSnakeBody = snakeOnCell.slice(1).some(s => isSameCoord(s, cell))
            
            // 食物显示逻辑
            const isFood = isSameCoord(cell, gameState.food) && gameState.food.side === gameState.currentSide
            const isOtherSideFood = isSameCoord(cell, gameState.food) && gameState.food.side !== gameState.currentSide
            
            const onActiveWrapEdge = isWrapExit(cell)  // 是否在当前激活的翻转出口上
            const onOtherEdge = isOnAnyEdge(cell) && !onActiveWrapEdge  // 在其他边上（墙壁）

            let fillColor = '#1e1e32'
            let strokeColor = '#2d2d4a'

            if (isSnakeHead) {
              fillColor = '#4ade80'
              strokeColor = '#22c55e'
            } else if (isSnakeBody) {
              fillColor = '#22c55e'
              strokeColor = '#16a34a'
            } else if (isFood) {
              fillColor = '#f472b6'
              strokeColor = '#ec4899'
            } else if (isOtherSideFood) {
              // 另一面的食物显示为幽灵形态
              fillColor = '#4c1d95'
              strokeColor = '#7c3aed'
            } else if (onActiveWrapEdge) {
              // 当前激活的翻转出口 - 蓝色
              fillColor = '#1e3a5f'
              strokeColor = '#3b82f6'
            }

            return (
              <g key={index}>
                <path
                  d={createHexPath(x, y, HEX_SIZE - 1)}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={onActiveWrapEdge ? "3" : "1.5"}
                  className={`hex-cell ${isSnakeHead ? 'snake-head' : ''} ${isFood ? 'food' : ''} ${isOtherSideFood ? 'ghost-food' : ''} ${onActiveWrapEdge ? 'wrap-exit' : ''}`}
                />
                {isSnakeHead && (
                  <>
                    {/* 蛇头眼睛 */}
                    <circle 
                      cx={x + 4} 
                      cy={y - 2.5} 
                      r="2" 
                      fill="#1a1a2e"
                    />
                    <circle 
                      cx={x + 4} 
                      cy={y + 2.5} 
                      r="2" 
                      fill="#1a1a2e"
                    />
                  </>
                )}
                {isFood && (
                  <g className="food-icon">
                    <circle 
                      cx={x} 
                      cy={y} 
                      r="5" 
                      fill="#fce7f3"
                      className="food-glow"
                    />
                    {/* 星星装饰 */}
                    <path
                      d={`M ${x} ${y-4} L ${x+1} ${y-1} L ${x+4} ${y-1} L ${x+2} ${y+1} L ${x+3} ${y+4} L ${x} ${y+2} L ${x-3} ${y+4} L ${x-2} ${y+1} L ${x-4} ${y-1} L ${x-1} ${y-1} Z`}
                      fill="#fbbf24"
                      className="star-decoration"
                    />
                  </g>
                )}
                {isOtherSideFood && (
                  <g className="ghost-food-icon" opacity="0.6">
                    {/* 幽灵食物 - 半透明且带虚线边框效果 */}
                    <circle 
                      cx={x} 
                      cy={y} 
                      r="5" 
                      fill="#a78bfa"
                      className="ghost-food-glow"
                    />
                    <text
                      x={x}
                      y={y + 1}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#ddd6fe"
                      fontSize="8"
                      fontWeight="bold"
                    >
                      ?
                    </text>
                  </g>
                )}
                {onActiveWrapEdge && (
                  <>
                    {/* 翻转出口标记 - 蓝色圆点 */}
                    <circle
                      cx={x}
                      cy={y}
                      r="3"
                      fill="#60a5fa"
                      className="exit-marker"
                    />
                  </>
                )}
                {onOtherEdge && (
                  <>
                    {/* 墙壁标记 - 红色X */}
                    <line
                      x1={x - 3}
                      y1={y - 3}
                      x2={x + 3}
                      y2={y + 3}
                      stroke="#ef4444"
                      strokeWidth="1.5"
                      className="wall-marker"
                    />
                    <line
                      x1={x + 3}
                      y1={y - 3}
                      x2={x - 3}
                      y2={y + 3}
                      stroke="#ef4444"
                      strokeWidth="1.5"
                      className="wall-marker"
                    />
                  </>
                )}
              </g>
            )
          })}
          
          {/* 吃果实特效 */}
          {gameState.eatEffect && gameState.eatEffect.active && (
            <g className="eat-effect">
              {/* 闪光效果 */}
              <circle
                cx={gameState.eatEffect.x}
                cy={gameState.eatEffect.y}
                r="20"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="3"
                className="flash-ring"
              />
              <circle
                cx={gameState.eatEffect.x}
                cy={gameState.eatEffect.y}
                r="30"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2"
                className="flash-ring-outer"
              />
              {/* 粒子效果 */}
              {[...Array(8)].map((_, i) => {
                const angle = (i * Math.PI) / 4
                const px = gameState.eatEffect!.x + Math.cos(angle) * 15
                const py = gameState.eatEffect!.y + Math.sin(angle) * 15
                return (
                  <circle
                    key={i}
                    cx={px}
                    cy={py}
                    r="3"
                    fill="#fbbf24"
                    className="particle"
                  />
                )
              })}
              {/* 得分飘字 */}
              <text
                x={gameState.eatEffect.x}
                y={gameState.eatEffect.y - 25}
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="16"
                fontWeight="bold"
                className="score-popup"
              >
                +10
              </text>
            </g>
          )}
        </svg>
        
        {/* 游戏结束遮罩 */}
        {gameState.gameOver && (
          <div className="game-over-overlay">
            <div className="game-over-content">
              <h2>游戏结束</h2>
              <p>最终得分: {gameState.score}</p>
              <button onClick={restartGame} className="restart-btn">
                重新开始
              </button>
            </div>
          </div>
        )}
        
        {/* 开始游戏遮罩 */}
        {!gameState.isPlaying && !gameState.gameOver && (
          <div className="start-overlay">
            <div className="start-content">
              <h2>六边形贪吃蛇</h2>
              <div className="instructions">
                <p>使用 ← → 方向键控制蛇的转向</p>
                <p>吃到粉色食物得分并变长</p>
                <p><span className="highlight-blue">🔵蓝色边</span>可翻转 → 从对称位置出现</p>
                <p><span className="highlight-red">🔴红色X</span>是墙壁 | 翻转后切换出口边</p>
              </div>
              <button onClick={startGame} className="start-btn">
                开始游戏
              </button>
            </div>
          </div>
        )}
      </div>
      
      <div className="controls">
        <p>按 ← 左转 | 按 → 右转 | 🔵翻转 🔴墙壁</p>
      </div>
    </div>
  )
}

export default App
