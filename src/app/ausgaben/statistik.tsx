import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Card, EmptyState } from '../../components/Card';
import { Segmented } from '../../components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { categoryMeta } from '../../features/expenses/categories';
import {
  useCategoryMonth,
  useRecurringExpenses,
  useTopItems,
} from '../../features/expenses/hooks';
import { formatCents, formatMonth, monthKey, relativeTime } from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useThemedStyles } from '../../lib/theme-context';

/** Three months back is as far as a two-person household usually cares to look. */
const MONTH_OPTIONS = [0, -1, -2].map((offset) => ({
  value: monthKey(offset),
  label: offset === 0 ? 'Dieser Monat' : formatMonth(monthKey(offset)).split(' ')[0],
}));

export default function StatsScreen() {
  const styles = useThemedStyles((c) => ({
    content: { paddingBottom: spacing.xxl * 2, gap: spacing.md },
    picker: { paddingHorizontal: spacing.lg },
    card: { marginHorizontal: spacing.lg, gap: spacing.md },
    sectionTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginLeft: spacing.lg + spacing.xs,
      marginTop: spacing.sm,
    },
    total: { ...typography.display, fontSize: 30, color: c.text },
    totalLabel: { ...typography.micro, color: c.textMuted, textTransform: 'uppercase' as const },
    totalHint: { ...typography.caption, color: c.textMuted },
    catRow: { gap: spacing.sm },
    catTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    catName: { ...typography.body, color: c.text, flex: 1 },
    catAmount: { ...typography.bodyStrong, color: c.text },
    catCount: { ...typography.caption, color: c.textFaint, minWidth: 46, textAlign: 'right' as const },
    // A plain proportional bar rather than a chart library: one dependency
    // fewer, and with ~10 categories a ranked bar list reads faster than a pie.
    barTrack: { height: 6, borderRadius: radius.pill, backgroundColor: c.surfaceMuted, overflow: 'hidden' as const },
    barFill: { height: 6, borderRadius: radius.pill },
    itemRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    itemRank: { ...typography.captionStrong, color: c.textFaint, width: 20 },
    itemText: { flex: 1, gap: 2 },
    itemName: { ...typography.body, color: c.text, textTransform: 'capitalize' as const },
    itemMeta: { ...typography.caption, color: c.textFaint },
    itemCount: { ...typography.bodyStrong, color: c.text },
    divider: { height: 1, backgroundColor: c.border },
    fixedRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    fixedText: { flex: 1, gap: 2 },
    fixedName: { ...typography.body, color: c.text },
    fixedMeta: { ...typography.caption, color: c.textMuted },
  }));

  const [month, setMonth] = useState(MONTH_OPTIONS[0].value);
  const { data: categories, isLoading, error } = useCategoryMonth(month);
  const { data: topItems } = useTopItems(8);
  const { data: recurring } = useRecurringExpenses();

  if (isLoading) return <LoadingState label="Statistik wird geladen…" />;
  if (error) return <ErrorState error={error} />;

  const rows = categories ?? [];
  const monthTotal = rows.reduce((sum, row) => sum + row.total_cents, 0);
  const expenseCount = rows.reduce((sum, row) => sum + row.expense_count, 0);
  // The bar scale is relative to the biggest category, not to the total —
  // otherwise everything below the leader is an unreadable sliver.
  const biggest = rows[0]?.total_cents ?? 0;

  const activeFixed = (recurring ?? []).filter((r) => r.is_active);
  const fixedMonthly = activeFixed.reduce((sum, r) => {
    const perPeriod = r.amount_cents / r.recurrence_interval;
    return sum + Math.round(r.recurrence_unit === 'month' ? perPeriod : (perPeriod * 52) / 12);
  }, 0);

  return (
    <Screen edges={[]}>
      <ScreenHeader title="Statistik" subtitle="Wohin das Geld geht" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.picker}>
          <Segmented options={MONTH_OPTIONS} value={month} onChange={setMonth} />
        </View>

        <Card style={styles.card}>
          <View>
            <Text style={styles.totalLabel}>{formatMonth(month)}</Text>
            <Text style={styles.total}>{formatCents(monthTotal)}</Text>
            <Text style={styles.totalHint}>
              {expenseCount === 0
                ? 'Noch nichts erfasst.'
                : `${expenseCount} Ausgabe${expenseCount === 1 ? '' : 'n'} · davon ${formatCents(fixedMonthly)} Fixkosten pro Monat`}
            </Text>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>Nach Kategorie</Text>
        {rows.length === 0 ? (
          <EmptyState title="Keine Ausgaben in diesem Monat" />
        ) : (
          <Card style={styles.card}>
            {rows.map((row) => {
              const meta = categoryMeta(row.category);
              const share = biggest > 0 ? row.total_cents / biggest : 0;
              return (
                <View key={row.category} style={styles.catRow}>
                  <View style={styles.catTop}>
                    <Ionicons name={meta.icon} size={16} color={meta.color} />
                    <Text style={styles.catName}>{row.category}</Text>
                    <Text style={styles.catCount}>{row.expense_count}×</Text>
                    <Text style={styles.catAmount}>{formatCents(row.total_cents)}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { width: `${Math.max(share * 100, 2)}%`, backgroundColor: meta.color },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        <Text style={styles.sectionTitle}>Am häufigsten gekauft</Text>
        {(topItems ?? []).length === 0 ? (
          <EmptyState
            title="Noch keine Posten"
            body="Erfasse eine Ausgabe mit einzelnen Posten, um zu sehen, was ihr am öftesten kauft."
          />
        ) : (
          <Card style={styles.card}>
            {(topItems ?? []).map((item, index) => (
              <View key={item.item_name}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.itemRow}>
                  <Text style={styles.itemRank}>{index + 1}.</Text>
                  <View style={styles.itemText}>
                    <Text style={styles.itemName}>{item.item_name}</Text>
                    <Text style={styles.itemMeta}>
                      {formatCents(item.total_cents)} · zuletzt {relativeTime(item.last_purchased_at)}
                    </Text>
                  </View>
                  <Text style={styles.itemCount}>{item.purchase_count}×</Text>
                </View>
              </View>
            ))}
          </Card>
        )}

        {activeFixed.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Fixkosten</Text>
            <Card style={styles.card}>
              {activeFixed.map((item, index) => {
                const meta = categoryMeta(item.category);
                return (
                  <View key={item.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <View style={[styles.fixedRow, index > 0 && { paddingTop: spacing.md }]}>
                      <Ionicons name={meta.icon} size={16} color={meta.color} />
                      <View style={styles.fixedText}>
                        <Text style={styles.fixedName}>{item.name}</Text>
                      </View>
                      <Text style={styles.catAmount}>{formatCents(item.amount_cents, item.currency)}</Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
