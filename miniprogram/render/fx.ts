/** 粒子 / 闪光 / 震屏反馈（逻辑坐标），由站点壳每帧更新与绘制 */

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
}

const particles: Particle[] = []
let flashColor = ''
let flashLife = 0
let shakeLife = 0
let shakePower = 0

// 视觉效果的随机性与游戏逻辑无关，这里用独立的轻量 LCG，避免使用 Math.random
let fxSeed = 1234567
function frand(): number {
  fxSeed = (Math.imul(fxSeed, 1664525) + 1013904223) | 0
  return (fxSeed >>> 0) / 4294967296
}

export function burst(x: number, y: number, color = '#ffcc33', count = 18): void {
  for (let i = 0; i < count; i++) {
    const a = frand() * Math.PI * 2
    const sp = 120 + frand() * 360
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 120,
      life: 0,
      max: 500 + frand() * 400,
      color,
      size: 5 + frand() * 7,
    })
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400)
}

export function flash(color = 'rgba(255,255,255,0.5)'): void {
  flashColor = color
  flashLife = 220
}

export function shake(power = 10): void {
  shakePower = power
  shakeLife = 260
}

export function fxActive(): boolean {
  return particles.length > 0 || flashLife > 0 || shakeLife > 0
}

export function updateFx(dt: number): void {
  const s = dt / 1000
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.life += dt
    if (p.life >= p.max) {
      particles.splice(i, 1)
      continue
    }
    p.vy += 900 * s
    p.x += p.vx * s
    p.y += p.vy * s
  }
  flashLife = Math.max(0, flashLife - dt)
  shakeLife = Math.max(0, shakeLife - dt)
}

/** 震屏偏移（站点壳在绘制游戏前应用） */
export function shakeOffset(): [number, number] {
  if (shakeLife <= 0) return [0, 0]
  const k = (shakeLife / 260) * shakePower
  return [(frand() - 0.5) * 2 * k, (frand() - 0.5) * 2 * k]
}

export function drawFx(ctx: CanvasRenderingContext2D, vw: number, vh: number): void {
  for (const p of particles) {
    const a = 1 - p.life / p.max
    ctx.globalAlpha = a
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  if (flashLife > 0) {
    ctx.globalAlpha = flashLife / 220
    ctx.fillStyle = flashColor
    ctx.fillRect(0, 0, vw, vh)
    ctx.globalAlpha = 1
  }
}

export function clearFx(): void {
  particles.length = 0
  flashLife = 0
  shakeLife = 0
}
