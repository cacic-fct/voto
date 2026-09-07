export type PollResultsFinalizationState = 'idle' | 'pending' | 'failed' | 'complete';

export async function reconcilePollResults<T>(
  load: () => Promise<T>,
  callbacks: {
    isCurrent: () => boolean;
    apply: (results: T) => void;
    fail: () => void;
  },
): Promise<void> {
  try {
    const results = await load();
    if (callbacks.isCurrent()) {
      callbacks.apply(results);
    }
  } catch {
    if (callbacks.isCurrent()) {
      callbacks.fail();
    }
  }
}
