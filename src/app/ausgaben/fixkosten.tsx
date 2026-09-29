import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, Switch, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card, EmptyState } from '../../components/Card';
import { Chip, Segmented } from '../../components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { SwipeRow, useSwipeRowGroup } from '../../components/SwipeRow';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../features/auth/AuthProvider';
import { EXPENSE_CATEGORIES, categoryMeta } from '../../features/expenses/categories';
import {
  useCreateRecurringExpense,
  useDeleteRecurringExpense,
  useRecurringExpenses,
  useSetRecurringExpenseActive,
} from '../../features/expenses/hooks';
import { useMembers } from '../../features/household/hooks';
import { Alert } from '../../lib/alert';
import type { RecurringExpenseUnit } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import { formatCents, formatDate, parseAmountToCents, todayIso } from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

const DAY_CHOICES = [1, 5, 10, 15, 20, 25];

/** "Monatlich am 1." / "Alle 2 Wochen" */
function scheduleLabel(unit: RecurringExpenseUnit, every: number, dayOfMonth: number | null): string {
  if (unit === 'month') {
    const day = dayOfMonth ? ` am ${dayOfMonth}.` : '';
    return every === 1 ? `Monatlich${day}` : `Alle ${every} Monate${day}`;
  }
  return every === 1 ? 'Wöchentlich' : `Alle ${every} Wochen`;
}

/**
 * Fixkosten — the recurring-expense templates.
 *
 * Nothing here books money directly. The hourly cron materialises a due
 * template into a normal expense (see generate_due_recurring_expenses()), so
 * rent shows up in the Ausgaben list, the balance and the stats exactly like a
 * hand-entered one. This screen is only about *what* repeats and *when*.
 */
export default function FixkostenScreen() {
  const { profile } = useAuth();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    addButton: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    totalCard: { marginHorizontal: spacing.lg, gap: 2 },
    totalLabel: { ...typography.micro, color: c.textMuted, textTransform: 'uppercase' as const },
    totalValue: { ...typography.display, fontSize: 30, color: c.text },
    totalHint: { ...typography.caption, color: c.textMuted },
    composer: { marginHorizontal: spacing.lg, marginTop: spacing.md, gap: spacing.md },
    label: { ...typography.captionStrong, color: c.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    list: { paddingTop: spacing.md, paddingBottom: spacing.xxl * 2 },
    // Card draws its own shadow (see components/Card.tsx), which SwipeRow
    // would clip along with the delete action it hides — so the margin and
    // matching radius sit on SwipeRow's container, outside that clip.
    rowWrap: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.lg },
    swipeContainer: { borderRadius: radius.lg },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    rowIcon: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    rowText: { flex: 1, gap: 2 },
    rowName: { ...typography.bodyStrong, color: c.text },
    rowMeta: { ...typography.caption, color: c.textMuted },
    rowAmount: { ...typography.bodyStrong, color: c.text },
    inactive: { opacity: 0.5 },
  }));

  const { data: members } = useMembers();
  const { data: recurring, isLoading, error } = useRecurringExpenses();
  const createRecurring = useCreateRecurringExpense();
  const setActive = useSetRecurringExpenseActive();
  const deleteRecurring = useDeleteRecurringExpense();
  const swipeGroup = useSwipeRowGroup();

  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [unit, setUnit] = useState<RecurringExpenseUnit>('month');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [paidBy, setPaidBy] = useState<string | null>(profile?.id ?? null);

  if (isLoading) return <LoadingState label="Fixkosten werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const active = (recurring ?? []).filter((r) => r.is_active);
  // Weekly costs are normalised to a monthly figure (52/12) so the headline
  // number means one thing rather than silently mixing cadences.
  const monthlyTotal = active.reduce((sum, r) => {
    const perPeriod = r.amount_cents / r.recurrence_interval;
    return sum + Math.round(r.recurrence_unit === 'month' ? perPeriod : (perPeriod * 52) / 12);
  }, 0);

  const amountCents = parseAmountToCents(amount) ?? 0;
  const canSave = name.trim().length > 0 && amountCents > 0 && !!paidBy;

  function resetForm() {
    setName('');
    setAmount('');
    setCategory(null);
    setUnit('month');
    setDayOfMonth(1);
    setComposing(false);
  }

  async function submit() {
    if (!paidBy) return;
    try {
      await createRecurring.mutateAsync({
        name: name.trim(),
        amountCents,
        paidBy,
        category,
        recurrenceUnit: unit,
        dayOfMonth: unit === 'month' ? dayOfMonth : null,
        // Starts today, so the very next cron run books the first occurrence
        // rather than waiting a whole cycle for a cost that already applies.
        nextDueOn: todayIso(),
      });
      resetForm();
    } catch (err) {
      Alert.alert('Konnte nicht angelegt werden', errorMessage(err));
    }
  }

  function confirmDelete(id: string, label: string) {
    Alert.alert(
      `${label} löschen?`,
      'Bereits gebuchte Ausgaben bleiben erhalten — nur die Wiederholung entfällt. Zum Pausieren reicht der Schalter.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: () => void deleteRecurring.mutateAsync(id),
        },
      ],
    );
  }

  return (
    <Screen edges={[]}>
      <ScreenHeader
        title="Fixkosten"
        subtitle={`${active.length} aktiv`}
        right={
          <Pressable
            onPress={() => (composing ? resetForm() : setComposing(true))}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Neue Fixkosten"
          >
            <Ionicons name={composing ? 'close' : 'add'} size={22} color={colors.textInverse} />
          </Pressable>
        }
      />

      <Card style={styles.totalCard}>
        <Text style={styles.totalLabel}>Pro Monat</Text>
        <Text style={styles.totalValue}>{formatCents(monthlyTotal)}</Text>
        <Text style={styles.totalHint}>
          Wird automatisch als Ausgabe gebucht und 50/50 geteilt, sobald sie fällig ist.
        </Text>
      </Card>

      {composing ? (
        <Card style={styles.composer}>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="z. B. Miete" autoFocus />

          <TextField
            label="Betrag"
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            keyboardType="decimal-pad"
          />

          <View>
            <Text style={styles.label}>Kategorie</Text>
            <View style={styles.chipRow}>
              {EXPENSE_CATEGORIES.map((option) => (
                <Chip
                  key={option.value}
                  label={option.value}
                  color={option.color}
                  active={category === option.value}
                  onPress={() => setCategory((prev) => (prev === option.value ? null : option.value))}
                />
              ))}
            </View>
          </View>

          <Segmented
            options={[
              { value: 'month', label: 'Monatlich' },
              { value: 'week', label: 'Wöchentlich' },
            ]}
            value={unit}
            onChange={setUnit}
          />

          {unit === 'month' ? (
            <View>
              <Text style={styles.label}>Am welchen Tag?</Text>
              <View style={styles.chipRow}>
                {DAY_CHOICES.map((day) => (
                  <Chip
                    key={day}
                    label={`${day}.`}
                    active={dayOfMonth === day}
                    onPress={() => setDayOfMonth(day)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View>
            <Text style={styles.label}>Wer zahlt?</Text>
            <View style={styles.chipRow}>
              {(members ?? []).map((member) => (
                <Chip
                  key={member.id}
                  label={member.display_name}
                  color={member.color}
                  active={paidBy === member.id}
                  onPress={() => setPaidBy(member.id)}
                />
              ))}
            </View>
          </View>

          <Button
            label="Fixkosten anlegen"
            onPress={() => void submit()}
            disabled={!canSave}
            loading={createRecurring.isPending}
          />
        </Card>
      ) : null}

      <FlatList
        data={recurring ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="Noch keine Fixkosten"
            body="Trage Miete, Strom oder Abos einmal ein — sie werden danach automatisch gebucht."
          />
        }
        renderItem={({ item }) => {
          const meta = categoryMeta(item.category);
          return (
            <View style={styles.rowWrap}>
              <SwipeRow
                id={item.id}
                group={swipeGroup}
                containerStyle={styles.swipeContainer}
                rightActions={[
                  {
                    key: 'delete',
                    icon: 'trash-outline',
                    label: 'Löschen',
                    tone: 'danger',
                    accessibilityLabel: `${item.name} löschen`,
                    onPress: () => confirmDelete(item.id, item.name),
                  },
                ]}
              >
                <Card style={[styles.row, !item.is_active && styles.inactive]}>
                  <View style={[styles.rowIcon, { backgroundColor: meta.color + '1F' }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>

                  <View style={styles.rowText}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowMeta}>
                      {scheduleLabel(item.recurrence_unit, item.recurrence_interval, item.day_of_month)}
                      {item.is_active ? ` · nächste am ${formatDate(item.next_due_on)}` : ' · pausiert'}
                    </Text>
                  </View>

                  <Text style={styles.rowAmount}>{formatCents(item.amount_cents, item.currency)}</Text>

                  <Switch
                    value={item.is_active}
                    onValueChange={(value) => void setActive.mutateAsync({ id: item.id, isActive: value })}
                    trackColor={{ true: colors.primary }}
                  />
                </Card>
              </SwipeRow>
            </View>
          );
        }}
      />
    </Screen>
  );
}
