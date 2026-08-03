import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';

import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/Card';
import { Segmented } from '../../components/Segmented';
import { ErrorState, LoadingState, Screen } from '../../components/Screen';
import { useMemberMap } from '../../features/household/hooks';
import { useShoppingHistory, useShoppingSuggestions } from '../../features/todos/hooks';
import { formatCents, formatDate, relativeTime } from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

type Mode = 'trips' | 'items';

/**
 * Einkaufshistorie — two questions, two shapes.
 *
 * "Was haben wir letzten Samstag geholt" is a diary: rows grouped by the day
 * they were ticked off, with who ticked them and what the shop cost if it was
 * booked as an expense.
 *
 * "Wie oft kaufen wir eigentlich Käse" is a completely different question, and
 * a chronological list answers it badly — so the second tab is the aggregate:
 * how often, how long ago, what it usually costs, and whether it is due again.
 * That is also exactly what feeds the one-tap chips on the Einkaufsliste, so
 * this screen is the place you go to understand why something was suggested.
 */
export default function ShoppingHistoryScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    switcher: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    list: { paddingBottom: spacing.xxl * 2 },
    sectionHeader: {
      flexDirection: 'row' as const,
      alignItems: 'baseline' as const,
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      backgroundColor: c.background,
    },
    sectionTitle: { ...typography.captionStrong, color: c.text, flex: 1 },
    sectionMeta: { ...typography.caption, color: c.textFaint },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      marginHorizontal: spacing.lg,
      marginBottom: 6,
      borderRadius: radius.md,
      backgroundColor: c.surface,
    },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.body, color: c.text },
    rowMeta: { ...typography.caption, color: c.textFaint },
    dueBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: c.dueTodaySoft,
    },
    dueLabel: { ...typography.micro, color: c.dueToday },
    price: { ...typography.captionStrong, color: c.textMuted },
  }));

  const [mode, setMode] = useState<Mode>('trips');
  const { data: history, isLoading, error } = useShoppingHistory();
  const { data: suggestions } = useShoppingSuggestions();
  const memberMap = useMemberMap();

  /**
   * One section per calendar day. A "Einkauf" is not a modelled thing — it is
   * whatever got ticked off on the same day, which is what people mean by it
   * and costs no schema to say.
   */
  const trips = useMemo(() => {
    const byDay = new Map<string, typeof history>();

    for (const row of history ?? []) {
      if (!row.done_at) continue;
      const day = row.done_at.slice(0, 10);
      const bucket = byDay.get(day) ?? [];
      bucket.push(row);
      byDay.set(day, bucket);
    }

    return [...byDay.entries()].map(([day, rows]) => ({ title: day, data: rows ?? [] }));
  }, [history]);

  const items = useMemo(
    () =>
      [...(suggestions ?? [])]
        .filter((s) => s.times_bought > 0 || s.times_paid > 0)
        .sort((a, b) => b.times_bought + b.times_paid - (a.times_bought + a.times_paid)),
    [suggestions],
  );

  if (isLoading) return <LoadingState label="Historie wird geladen…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Einkaufshistorie' }} />

      <View style={styles.switcher}>
        <Segmented
          options={[
            { value: 'trips', label: 'Einkäufe' },
            { value: 'items', label: 'Was wir kaufen' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </View>

      {mode === 'trips' ? (
        <SectionList
          sections={trips}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <EmptyState
              title="Noch nichts gekauft"
              body="Abgehakte Einträge landen hier, sobald der Einkauf abgeschlossen ist — mit Preis, wenn ihr ihn gebucht habt."
            />
          }
          renderSectionHeader={({ section }) => {
            const withExpense = section.data.filter((row) => row.expense_id).length;
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{formatDate(section.title)}</Text>
                <Text style={styles.sectionMeta}>
                  {section.data.length} Sachen
                  {withExpense > 0 ? ' · gebucht' : ''}
                </Text>
              </View>
            );
          }}
          renderItem={({ item }) => {
            const person = item.done_by ? memberMap[item.done_by] : null;

            return (
              <Pressable
                style={styles.row}
                disabled={!item.expense_id && !item.product_id}
                onPress={() =>
                  item.expense_id
                    ? router.push(`/ausgaben/${item.expense_id}`)
                    : item.product_id
                      ? router.push(`/inventar/produkt/${item.product_id}`)
                      : undefined
                }
                accessibilityRole={item.expense_id || item.product_id ? 'button' : undefined}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  <Text style={styles.rowMeta}>
                    {item.done_at ? relativeTime(item.done_at) : ''}
                    {item.source === 'restock' ? ' · Nachkauf' : ''}
                  </Text>
                </View>

                {person ? (
                  <Avatar
                    name={person.display_name}
                    color={person.color}
                    size={22}
                    accessibilityLabel={`abgehakt von ${person.display_name}`}
                  />
                ) : null}

                {item.expense_id ? (
                  <Ionicons name="receipt-outline" size={16} color={colors.textFaint} />
                ) : null}
              </Pressable>
            );
          }}
        />
      ) : (
        <SectionList
          sections={[{ title: 'items', data: items }]}
          keyExtractor={(item) => item.item_key}
          contentContainerStyle={styles.list}
          renderSectionHeader={() => null}
          ListEmptyComponent={
            <EmptyState
              title="Noch keine Gewohnheiten"
              body="Nach ein paar Einkäufen steht hier, was ihr regelmäßig holt — und wann es wieder so weit ist."
            />
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {[
                    item.times_bought > 0 ? `${item.times_bought}×` : null,
                    item.avg_interval_days ? `ca. alle ${Math.round(item.avg_interval_days)} Tage` : null,
                    item.days_since_bought !== null ? `zuletzt vor ${item.days_since_bought} T.` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>

              {item.is_due ? (
                <View style={styles.dueBadge}>
                  <Text style={styles.dueLabel}>fällig</Text>
                </View>
              ) : null}

              {item.avg_price_cents !== null ? (
                <Text style={styles.price}>{formatCents(item.avg_price_cents)}</Text>
              ) : null}
            </View>
          )}
        />
      )}
    </Screen>
  );
}
