import type { Scope } from '@dayplanner/core';
import { useState } from 'react';

/**
 * The question every menu edit of an Occurrence asks: "Just this one" or "This and following" (no "Whole series").
 * It only asks; the core decides what each answer reaches. Ticking and dragging never come here.
 */

type Action = (scope: Scope | undefined) => unknown;

/**
 * `ask(action)` runs the action right away for an item that is not an Occurrence (scope left out), and otherwise
 * shows the question and runs it with the answer.
 */
export function useScopeAsk(asks: boolean) {
  const [pending, setPending] = useState<Action | null>(null);
  return {
    pending: pending !== null,
    ask: (action: Action) => (asks ? setPending(() => action) : void action(undefined)),
    choose: async (scope: Scope) => {
      const action = pending;
      setPending(null);
      await action?.(scope);
    },
    cancel: () => setPending(null),
  };
}

export function ScopePrompt({ ask }: { ask: ReturnType<typeof useScopeAsk> }) {
  if (!ask.pending) return null;
  return (
    <fieldset className="scope" role="group" aria-label="Apply to">
      <legend>This item repeats. Apply to</legend>
      <button type="button" className="primary" onClick={() => ask.choose('one')}>
        Just this one
      </button>
      <button type="button" className="primary" onClick={() => ask.choose('following')}>
        This and following
      </button>
      <button type="button" onClick={ask.cancel}>
        Back
      </button>
    </fieldset>
  );
}
