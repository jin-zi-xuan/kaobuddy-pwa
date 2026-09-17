import type { CardProgress, CardSession, LearnCard } from './types';

export function restoreCardSession(cards: LearnCard[], saved: CardSession | undefined): CardSession | null {
  if (!saved || saved.signature !== JSON.stringify(cards) || !Array.isArray(saved.queue) || !saved.queue.length) return null;
  if (![1,2].includes(saved.round) || !Number.isInteger(saved.index) || saved.index < 0 || saved.index >= saved.queue.length) return null;
  if (typeof saved.flipped !== 'boolean' || !saved.progress || typeof saved.progress !== 'object') return null;
  if (!saved.queue.every(id => cards.some(card => card.id === id)) || new Set(saved.queue).size !== saved.queue.length) return null;
  if (!Object.values(saved.progress).every(value => ['mastered','uncertain','unknown'].includes(value))) return null;
  return saved;
}

export function nextCardRound(cards: LearnCard[], progress: Record<string, CardProgress>, lastId: string, answer: CardProgress) {
  const updated = {...progress, [lastId]: answer};
  return { progress: updated, weak: cards.filter(card => updated[card.id] !== 'mastered'), mastered: cards.filter(card => updated[card.id] === 'mastered').length };
}
