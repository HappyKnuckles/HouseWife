import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase } from './supabase';

/**
 * Which cached queries a table change can invalidate.
 *
 * Invalidation rather than patching the cache in place, deliberately: several
 * screens read *views* (v_cleaning_agenda, v_household_balances) whose row
 * shape is not the row shape of the table that changed. Patching would mean
 * re-deriving `status`, `days_until` and every balance on the client and
 * getting the same answer Postgres would — a second implementation that can
 * drift. A prefix invalidation costs one small refetch and is always right.
 *
 * TanStack Query matches by key prefix, so ['cleaning'] covers
 * ['cleaning','agenda'], ['cleaning','completions'] and so on.
 */
interface Subscription {
  keys: string[][];
  /** The column carrying the household id. `households` keys on `id` itself. */
  column?: string;
}

const TABLE_INVALIDATIONS: Record<string, Subscription> = {
  cleaning_tasks: { keys: [['cleaning']] },
  cleaning_areas: { keys: [['cleaning']] },
  cleaning_completions: { keys: [['cleaning']] },

  expenses: { keys: [['expenses']] },
  expense_items: { keys: [['expenses']] },
  expense_shares: { keys: [['expenses']] },
  receipts: { keys: [['expenses']] },
  settlements: { keys: [['expenses']] },
  recurring_expenses: { keys: [['expenses']] },

  // One table, two screens: ['todos'] is a prefix of both the to-do list's key
  // and the Einkaufsliste's, so either one changing refetches whichever is open.
  todos: { keys: [['todos']] },
  house_rules: { keys: [['rules']] },
  events: { keys: [['events']] },
  dog_commands: { keys: [['dog-commands']] },

  inventory_items: { keys: [['inventory']] },
  products: { keys: [['inventory']] },
  storage_locations: { keys: [['inventory']] },

  // A renamed member or a changed colour shows up on every screen.
  profiles: { keys: [['household'], ['cleaning'], ['expenses'], ['todos']] },
  households: { keys: [['household']], column: 'id' },
};

/**
 * Subscribes to every household-scoped change on ONE websocket.
 *
 * A channel per table would open a dozen sockets and hit the free-tier
 * concurrent-connection limit with two people and two devices each.
 */
export function useHouseholdRealtime(householdId: string | null | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!householdId) return;

    const channel = supabase.channel(`household:${householdId}`);

    for (const [table, { keys, column }] of Object.entries(TABLE_INVALIDATIONS)) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `${column ?? 'household_id'}=eq.${householdId}`,
        },
        () => {
          for (const queryKey of keys) {
            void queryClient.invalidateQueries({ queryKey });
          }
        },
      );
    }

    channel.subscribe((status) => {
      // Re-subscribing after a dropped connection means we missed whatever
      // happened while offline; refetch everything once rather than trusting
      // a cache that has a hole in it.
      if (status === 'SUBSCRIBED') {
        void queryClient.invalidateQueries();
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, queryClient]);
}
