import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { ErrorState, LoadingState, Screen } from '../../../components/Screen';
import {
  ExpenseForm,
  type ExpenseFormValues,
} from '../../../features/expenses/components/ExpenseForm';
import { useExpense, useUpdateExpense } from '../../../features/expenses/hooks';
import { useMembers } from '../../../features/household/hooks';
import { Alert } from '../../../lib/alert';
import { errorMessage } from '../../../lib/errors';
import { spacing } from '../../../lib/theme';
import { useThemedStyles } from '../../../lib/theme-context';

/**
 * Editing an existing expense.
 *
 * Saving goes through update_expense(), which re-runs apply_expense_split() —
 * so items and shares are rebuilt from scratch rather than patched, and the
 * deferred balance constraint still has the last word. A settled expense is
 * refused by the RPC (migration 0016); the detail screen hides the entry point
 * for one, and the error below is the backstop if it is reached anyway.
 */
export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useThemedStyles(() => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
  }));

  const { data: members, isLoading: membersLoading } = useMembers();
  const { data: expense, isLoading, error } = useExpense(id);
  const updateExpense = useUpdateExpense();
  const [saving, setSaving] = useState(false);

  if (isLoading || membersLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!expense) return <ErrorState error={new Error('Ausgabe nicht gefunden')} />;
  if (expense.status === 'settled') {
    return (
      <ErrorState
        error={new Error('Diese Ausgabe ist bereits abgerechnet.')}
        hint="Abgerechnete Ausgaben lassen sich nicht mehr ändern."
      />
    );
  }

  async function save(values: ExpenseFormValues) {
    setSaving(true);
    try {
      await updateExpense.mutateAsync({ id, input: values });
      router.back();
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ExpenseForm
          members={members ?? []}
          initial={{
            title: expense.title,
            totalCents: expense.total_cents,
            paidBy: expense.paid_by,
            category: expense.category,
            splitType: expense.split_type,
            items: expense.expense_items
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((item) => ({
                name: item.name,
                total_cents: item.total_cents,
                paid_for: item.paid_for,
              })),
            shares: Object.fromEntries(
              expense.expense_shares.map((share) => [share.profile_id, share.share_cents]),
            ),
          }}
          submitLabel="Änderungen speichern"
          submitting={saving}
          onSubmit={(values) => void save(values)}
        />
      </ScrollView>
    </Screen>
  );
}
