/** 扑克牌通用数据结构（纯逻辑） */
import type { Rng } from './rng'

export type Suit = 'S' | 'H' | 'D' | 'C'
export const SUITS: Suit[] = ['S', 'H', 'D', 'C']
export const SUIT_SYMBOL: Record<Suit | 'J', string> = { S: '♠', H: '♥', D: '♦', C: '♣', J: '★' }

export interface Card {
  /** 唯一编号（多副牌时也唯一） */
  id: number
  /** 'J' 表示大小王 */
  suit: Suit | 'J'
  /** 1..13（A..K）；王：14=小王，15=大王 */
  rank: number
}

export function makeDeck(opts: { decks?: number; jokers?: boolean } = {}): Card[] {
  const decks = opts.decks ?? 1
  const out: Card[] = []
  let id = 0
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) out.push({ id: id++, suit, rank })
    if (opts.jokers) {
      out.push({ id: id++, suit: 'J', rank: 14 })
      out.push({ id: id++, suit: 'J', rank: 15 })
    }
  }
  return out
}

export function shuffledDeck(r: Rng, opts: { decks?: number; jokers?: boolean } = {}): Card[] {
  return r.shuffle(makeDeck(opts))
}

export function isJoker(c: Card): boolean {
  return c.suit === 'J'
}

export function isRed(c: Card): boolean {
  return c.suit === 'H' || c.suit === 'D'
}

export function rankLabel(rank: number): string {
  if (rank === 1) return 'A'
  if (rank === 11) return 'J'
  if (rank === 12) return 'Q'
  if (rank === 13) return 'K'
  if (rank === 14) return '小王'
  if (rank === 15) return '大王'
  return String(rank)
}

export function cardLabel(c: Card): string {
  if (isJoker(c)) return rankLabel(c.rank)
  return SUIT_SYMBOL[c.suit] + rankLabel(c.rank)
}

/** 按花色、点数排序（返回新数组） */
export function sortCards(cards: readonly Card[]): Card[] {
  const order: Record<string, number> = { S: 0, H: 1, C: 2, D: 3, J: 4 }
  return cards.slice().sort((a, b) => order[a.suit] - order[b.suit] || a.rank - b.rank || a.id - b.id)
}
