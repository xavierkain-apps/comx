// The MSG sheet history: quick messages, SOS and voice memos, newest first,
// kept for the app's run. Same limits and rule as the watch
// (ios/SoarXVoiceWatch/History.swift, MessageHistory.add).

export const HISTORY_MAX_ITEMS = 30;
/** Voice memos kept (their audio stays in memory, about 60 KB each). */
export const HISTORY_MAX_CLIPS = 10;

/**
 * Adds `item` in front. Drops items beyond `maxItems`, and voice items (with
 * a `clip`) beyond the `maxClips` newest ones.
 */
export function addToHistory<T extends {clip?: unknown}>(
  items: readonly T[],
  item: T,
  maxItems: number = HISTORY_MAX_ITEMS,
  maxClips: number = HISTORY_MAX_CLIPS,
): T[] {
  let clips = 0;
  return [item, ...items].filter((it, index) => {
    if (it.clip === undefined) return index < maxItems;
    clips += 1;
    return index < maxItems && clips <= maxClips;
  });
}
