// 全站共用的动效参数：缓动曲线偏「慢出」，弹簧阻尼足，不过冲，整体舒缓。
export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const EASE_SOFT = [0.32, 0.72, 0, 1] as const

export const SPRING_LAYOUT = { type: 'spring', stiffness: 300, damping: 34, mass: 0.7 } as const
export const SPRING_PANEL = { type: 'spring', stiffness: 260, damping: 32, mass: 0.8 } as const
export const SPRING_PRESS = { type: 'spring', stiffness: 500, damping: 30, mass: 0.6 } as const
export const SPRING_SOFT = { type: 'spring', stiffness: 140, damping: 26, mass: 1 } as const

/**
 * 列表条目进场：轻轻上浮。
 * 不用 filter，也不要套在含 .glass 的容器上：祖先的 opacity/filter 会让里面的毛玻璃失效。
 */
export const itemIn = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.18 } },
}

export const stagger = (i: number, step = 0.035, max = 0.4) => Math.min(i * step, max)
