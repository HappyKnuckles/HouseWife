import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, Switch, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card, EmptyState } from '../../components/Card';
import { Chip } from '../../components/Segmented';
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
  useUpdateRecurringExpense,
} from '../../features/expenses/hooks';
import {
  CADENCES,
  RECURRING_PRESETS,
  cadenceFor,
  monthlyEquivalentCents,
  nextOccurrence,
  scheduleLabel,
  type Cadence,
} from '../../features/expenses/recurring';
import { useMembers } from '../../features/household/hooks';
import { Alert } from '../../lib/alert';
import type { RecurringExpenseRow } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import {
  formatCents,
  formatDate,
  parseAmountToCents,
  parseDateOnly,
  parseGermanDate,
  todayIso,
} from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

const DEFAULT_CADENCE = CADENCES.find((c) => c.key === 'month')!;

/** "1.234,50" — what parseAmountToCents() reads back without loss. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** First of next month, the usual date for anything billed monthly. */
function firstOfNextMonthIso(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Fixkosten — the recurring-expense templates.
 *
 * Nothing here books money directly. The hourly cron materialises a due
 * template into a normal expense (see generate_due_recurring_expenses()), so
 * rent shows up in the Ausgaben list, the balance and the stats exactly like a
 * hand-entered one. This screen is only about *what* repeats and *when*.
 *
 * The date field is the important one for anything not billed monthly: a
 * yearly insurance has to start on *its* date, not today, or the whole year's
 * premium is booked the moment it is entered.
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
    composerTitle: { ...typography.bodyStrong, color: c.text },
    field: { gap: spacing.xs },
    label: { ...typography.captionStrong, color: c.textMuted },
    hint: { ...typography.caption, color: c.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    toggleRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.md,
    },
    toggleText: { flex: 1, gap: 2 },
    toggleLabel: { ...typography.body, color: c.text },
    list: { paddingTop: spacing.md, paddingBottom: spacing.xxl * 2 },
    listHeader: { paddingBottom: spacing.md },
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
    rowAmountBox: { alignItems: 'flex-end' as const, gap: 2 },
    rowAmount: { ...typography.bodyStrong, color: c.text },
    rowPerMonth: { ...typography.caption, color: c.textMuted },
    inactive: { opacity: 0.5 },
  }));

  const { data: members } = useMembers();
  const { data: recurring, isLoading, error } = useRecurringExpenses();
  const createRecurring = useCreateRecurringExpense();
  const updateRecurring = useUpdateRecurringExpense();
  const setActive = useSetRecurringExpenseActive();
  const deleteRecurring = useDeleteRecurringExpense();
  const swipeGroup = useSwipeRowGroup();

  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [cadence, setCadence] = useState<Cadence>(DEFAULT_CADENCE);
  const [dueOn, setDueOn] = useState(formatDate(todayIso()));
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [paidBy, setPaidBy] = useState<string | null>(profile?.id ?? null);

  if (isLoading) return <LoadingState label="Fixkosten werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const active = (recurring ?? []).filter((r) => r.is_active);
  const monthlyTotal = active.reduce(
    (sum, r) => sum + monthlyEquivalentCents(r.amount_cents, r.recurrence_unit, r.recurrence_interval),
    0,
  );

  const amountCents = parseAmountToCents(amount) ?? 0;
  const dueIso = parseGermanDate(dueOn);
  const isDueNow = !!dueIso && dueIso <= todayIso();
  // "Schon bezahlt" only makes sense for a date that would otherwise be
  // booked right away; for a future date it is simply ignored.
  const effectiveDueIso =
    dueIso && isDueNow && alreadyPaid ? nextOccurrence(dueIso, cadence.unit, cadence.interval) : dueIso;

  const canSave = name.trim().length > 0 && amountCents > 0 && !!paidBy && !!dueIso;
  const saving = createRecurring.isPending || updateRecurring.isPending;

  function resetForm() {
    setEditingId(null);
    setName('');
    setAmount('');
    setCategory(null);
    setCadence(DEFAULT_CADENCE);
    setDueOn(formatDate(todayIso()));
    setAlreadyPaid(false);
    setPaidBy(profile?.id ?? null);
    setComposing(false);
  }

  function startEdit(item: RecurringExpenseRow) {
    setEditingId(item.id);
    setName(item.name);
    setAmount(centsToInput(item.amount_cents));
    setCategory(item.category);
    // An older template with a cadence the chips don't offer (e.g. every 2
    // weeks) keeps its own unit/interval rather than being forced to monthly.
    setCadence(
      cadenceFor(item.recurrence_unit, item.recurrence_interval) ?? {
        key: 'custom',
        label: scheduleLabel(item.recurrence_unit, item.recurrence_interval, null),
        unit: item.recurrence_unit,
        interval: item.recurrence_interval,
      },
    );
    setDueOn(formatDate(item.next_due_on));
    setAlreadyPaid(false);
    setPaidBy(item.paid_by);
    setComposing(true);
  }

  function applyPreset(preset: (typeof RECURRING_PRESETS)[number]) {
    setName(preset.name);
    setCategory(preset.category);
    setCadence(CADENCES.find((c) => c.key === preset.cadenceKey) ?? DEFAULT_CADENCE);
  }

  async function submit() {
    if (!paidBy || !effectiveDueIso) return;
    const input = {
      name: name.trim(),
      amountCents,
      paidBy,
      category,
      recurrenceUnit: cadence.unit,
      recurrenceInterval: cadence.interval,
      // The day the cron keeps landing on comes from the chosen date, so
      // "Jährlich ab 15.03." stays on the 15th instead of drifting.
      dayOfMonth: cadence.unit === 'month' ? parseDateOnly(effectiveDueIso).getDate() : null,
      nextDueOn: effectiveDueIso,
    };

    try {
      if (editingId) {
        await updateRecurring.mutateAsync({ id: editingId, ...input });
      } else {
        await createRecurring.mutateAsync(input);
      }
      resetForm();
    } catch (err) {
      Alert.alert(editingId ? 'Konnte nicht gespeichert werden' : 'Konnte nicht angelegt werden', errorMessage(err));
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
          onPress: () => {
            if (editingId === id) resetForm();
            void deleteRecurring.mutateAsync(id);
          },
        },
      ],
    );
  }

  const perMonthPreview =
    amountCents > 0 && (cadence.unit === 'week' || cadence.interval > 1)
      ? monthlyEquivalentCents(amountCents, cadence.unit, cadence.interval)
      : null;

  const dueHint = !dueIso
    ? null
    : isDueNow && !alreadyPaid
      ? 'Wird beim nächsten Durchlauf (innerhalb einer Stunde) gebucht.'
      : `Erste Buchung am ${formatDate(effectiveDueIso!)}.`;

  const header = (
    <View style={styles.listHeader}>
      <Card style={styles.totalCard}>
        <Text style={styles.totalLabel}>Pro Monat</Text>
        <Text style={styles.totalValue}>{formatCents(monthlyTotal)}</Text>
        <Text style={styles.totalHint}>
          Jährliche und vierteljährliche Kosten anteilig umgerechnet. Gebucht wird am Fälligkeitstag, 50/50
          geteilt.
        </Text>
      </Card>

      {composing ? (
        <Card style={styles.composer}>
          <Text style={styles.composerTitle}>{editingId ? 'Fixkosten bearbeiten' : 'Neue Fixkosten'}</Text>

          {!editingId ? (
            <View style={styles.field}>
              <Text style={styles.label}>Schnellauswahl</Text>
              <View style={styles.chipRow}>
                {RECURRING_PRESETS.map((preset) => (
                  <Chip
                    key={preset.name}
                    label={preset.name}
                    color={categoryMeta(preset.category).color}
                    active={name === preset.name}
                    onPress={() => applyPreset(preset)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <TextField label="Name" value={name} onChangeText={setName} placeholder="z. B. Haftpflicht" />

          <TextField
            label="Betrag pro Zahlung"
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            keyboardType="decimal-pad"
            hint={perMonthPreview !== null ? `≈ ${formatCents(perMonthPreview)} pro Monat` : undefined}
          />

          <View style={styles.field}>
            <Text style={styles.label}>Wie oft?</Text>
            <View style={styles.chipRow}>
              {CADENCES.map((option) => (
                <Chip
                  key={option.key}
                  label={option.label}
                  active={cadence.unit === option.unit && cadence.interval === option.interval}
                  onPress={() => setCadence(option)}
                />
              ))}
              {cadence.key === 'custom' ? <Chip label={cadence.label} active onPress={() => {}} /> : null}
            </View>
          </View>

          <View style={styles.field}>
            <TextField
              label={editingId ? 'Nächste Abbuchung' : 'Erste Abbuchung'}
              value={dueOn}
              onChangeText={setDueOn}
              placeholder="TT.MM.JJJJ"
              keyboardType="numbers-and-punctuation"
              error={dueOn.trim().length > 0 && !dueIso ? 'Bitte als TT.MM.JJJJ eingeben.' : null}
            />
            <View style={styles.chipRow}>
              <Chip
                label="Heute"
                active={dueIso === todayIso()}
                onPress={() => setDueOn(formatDate(todayIso()))}
              />
              <Chip
                label="1. nächsten Monat"
                active={dueIso === firstOfNextMonthIso()}
                onPress={() => setDueOn(formatDate(firstOfNextMonthIso()))}
              />
            </View>
          </View>

          {isDueNow ? (
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Schon bezahlt</Text>
                <Text style={styles.hint}>Erst ab der nächsten Fälligkeit buchen</Text>
              </View>
              <Switch value={alreadyPaid} onValueChange={setAlreadyPaid} trackColor={{ true: colors.primary }} />
            </View>
          ) : null}

          {dueHint ? <Text style={styles.hint}>{dueHint}</Text> : null}

          <View style={styles.field}>
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

          <View style={styles.field}>
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
            label={editingId ? 'Speichern' : 'Fixkosten anlegen'}
            onPress={() => void submit()}
            disabled={!canSave}
            loading={saving}
          />
        </Card>
      ) : null}
    </View>
  );

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
            accessibilityLabel={composing ? 'Formular schließen' : 'Neue Fixkosten'}
          >
            <Ionicons name={composing ? 'close' : 'add'} size={22} color={colors.textInverse} />
          </Pressable>
        }
      />

      {/* Header lives inside the list so the longer form scrolls on small phones. */}
      <FlatList
        data={recurring ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        // iOS: lift the list above the keyboard so the lower form fields stay reachable.
        automaticallyAdjustKeyboardInsets
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            title="Noch keine Fixkosten"
            body="Trage Miete, Strom oder Versicherungen einmal ein — sie werden danach automatisch gebucht."
          />
        }
        renderItem={({ item }) => {
          const meta = categoryMeta(item.category);
          const spread = item.recurrence_unit === 'week' || item.recurrence_interval > 1;
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
                <Pressable
                  onPress={() => startEdit(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name} bearbeiten`}
                >
                  <Card style={[styles.row, !item.is_active && styles.inactive]}>
                    <View style={[styles.rowIcon, { backgroundColor: meta.color + '1F' }]}>
                      <Ionicons name={meta.icon} size={18} color={meta.color} />
                    </View>

                    <View style={styles.rowText}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowMeta}>
                        {scheduleLabel(
                          item.recurrence_unit,
                          item.recurrence_interval,
                          item.day_of_month,
                          item.next_due_on,
                        )}
                        {item.is_active ? ` · nächste am ${formatDate(item.next_due_on)}` : ' · pausiert'}
                      </Text>
                    </View>

                    <View style={styles.rowAmountBox}>
                      <Text style={styles.rowAmount}>{formatCents(item.amount_cents, item.currency)}</Text>
                      {spread ? (
                        <Text style={styles.rowPerMonth}>
                          ≈ {formatCents(
                            monthlyEquivalentCents(item.amount_cents, item.recurrence_unit, item.recurrence_interval),
                            item.currency,
                          )}
                          /Mon.
                        </Text>
                      ) : null}
                    </View>

                    <Switch
                      value={item.is_active}
                      onValueChange={(value) => void setActive.mutateAsync({ id: item.id, isActive: value })}
                      trackColor={{ true: colors.primary }}
                    />
                  </Card>
                </Pressable>
              </SwipeRow>
            </View>
          );
        }}
      />
    </Screen>
  );
}

