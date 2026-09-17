import { useCallback, useEffect, useRef, useState } from "react";
import type { CardProgress, LearnCard, StudyTask } from "./types";
import { createId, storage } from "./storage";
import { restoreCardSession } from "./learningSession";
import { nowIso } from "./utils";

export function useCardLearning() {
  const [sessionModule, setSessionModule] = useState<{id: string; cards: LearnCard[]} | null>(null);
  const [saveError, setSaveError] = useState("");
  const generation = useRef(0);
  const pendingSave = useRef(Promise.resolve());
  const [cardProgress, setCardProgress] = useState<Record<string, CardProgress>>({});
  const [cardLearningRound, setCardLearningRound] = useState(1);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const cardDragLock = useRef(false);
  const [cardQueue, setCardQueue] = useState<LearnCard[]>([]);
  const [streamingCards, setStreamingCards] = useState<LearnCard[]>([]);
  const [isStreamingCards, setIsStreamingCards] = useState(false);
  const [streamingAbort, setStreamingAbort] = useState<AbortController | null>(null);

  const resetCardProgress = useCallback((cards: LearnCard[]) => {
    setCardProgress(Object.fromEntries(cards.map((c) => [c.id, "unknown" as CardProgress])));
    setCardLearningRound(1);
    setCurrentCardIndex(0);
    setIsCardFlipped(false);
    setCardQueue(cards);
  }, []);

  useEffect(() => {
    if (!sessionModule || !cardQueue.length) return;
    const session = {signature: JSON.stringify(sessionModule.cards), queue: cardQueue.map(card => card.id), progress: cardProgress, round: cardLearningRound, index: currentCardIndex, flipped: isCardFlipped};
    pendingSave.current = pendingSave.current.then(() => storage.updateTaskLearning(sessionModule.id, {card_session: session})).catch(() => { setSaveError("学习进度保存失败，请先备份数据再重试。"); });
  }, [sessionModule, cardQueue, cardProgress, cardLearningRound, currentCardIndex, isCardFlipped]);

  const resumeCards = useCallback(async (module: StudyTask) => {
    if (!module.cards?.length) return false;
    const token = ++generation.current;
    await pendingSave.current;
    const latest = (await storage.tasks()).find(task => task.id === module.id) || module;
    if (token !== generation.current) return false;
    const cards = latest.cards || module.cards;
    const saved = restoreCardSession(cards, latest.card_session);
    setSessionModule({id: module.id, cards});
    if (saved) {
      setCardQueue(saved.queue.map(id => cards.find(card => card.id === id)!));
      setCardProgress(saved.progress); setCardLearningRound(saved.round);
      setCurrentCardIndex(saved.index); setIsCardFlipped(saved.flipped);
    } else resetCardProgress([...cards].sort((a,b) => (a.importance ?? 3) - (b.importance ?? 3)));
    return true;
  }, [resetCardProgress]);

  const suspendSession = useCallback(async () => {
    generation.current += 1;
    setSessionModule(null); setCardQueue([]);
    setCardProgress({}); setCardLearningRound(1); setCurrentCardIndex(0); setIsCardFlipped(false);
    await pendingSave.current;
  }, []);

  const completeSession = useCallback(async () => {
    const id = sessionModule?.id;
    setSessionModule(null);
    if (id) {
      pendingSave.current = pendingSave.current.then(() => storage.updateTaskLearning(id, {card_session: undefined})).catch(() => setSaveError("学习完成状态保存失败，请重试。"));
      await pendingSave.current;
    }
  }, [sessionModule]);

  const markCard = useCallback((cardId: string, progress: CardProgress) => {
    setCardProgress((prev) => ({ ...prev, [cardId]: progress }));
  }, []);

  const goToNextCard = useCallback(() => {
    setCurrentCardIndex((i) => (i + 1 < cardQueue.length ? i + 1 : i));
    setIsCardFlipped(false);
  }, [cardQueue.length]);

  const goToPrevCard = useCallback(() => {
    setCurrentCardIndex((i) => Math.max(0, i - 1));
    setIsCardFlipped(false);
  }, []);

  const flipCard = useCallback(() => setIsCardFlipped((v) => !v), []);

  const cancelStreaming = useCallback(() => {
    if (streamingAbort) {
      streamingAbort.abort();
      setStreamingAbort(null);
      setIsStreamingCards(false);
    }
  }, [streamingAbort]);

  const loadSavedCards = useCallback((module: StudyTask) => {
    if (module.cards?.length) {
      resetCardProgress(module.cards);
      return true;
    }
    return false;
  }, [resetCardProgress]);

  const saveCardsToModule = useCallback(async (module: StudyTask, cards: LearnCard[]) => {
    await storage.saveTask({
      ...module,
      cards,
      updated_at: nowIso(),
    });
  }, []);

  return {
    resumeCards, suspendSession, completeSession, saveError,
    cardProgress, setCardProgress,
    cardLearningRound, setCardLearningRound,
    currentCardIndex, setCurrentCardIndex,
    isCardFlipped, setIsCardFlipped,
    cardDragLock,
    cardQueue, setCardQueue,
    streamingCards, setStreamingCards,
    isStreamingCards, setIsStreamingCards,
    streamingAbort, setStreamingAbort,
    resetCardProgress,
    markCard,
    goToNextCard,
    goToPrevCard,
    flipCard,
    cancelStreaming,
    loadSavedCards,
    saveCardsToModule,
  } as const;
}
