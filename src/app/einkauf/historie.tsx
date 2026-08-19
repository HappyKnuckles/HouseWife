import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, Text, View } from 'react-native';
// Gesture-handler's Pressable, not React Native's — see the comment in
// components/Card.tsx. The trip card sits inside a SwipeRow.
import { Pressable } from 'react-native-gesture-handler';

import { Avatar } from '../../components/Avatar';
import { EmptyState } from '../../components/Card';
import { Segmented } from '../../components/Segmented';
import { ErrorState, LoadingState, Screen } from '../../components/Screen';
import { SwipeRow, useSwipeRowGroup, type SwipeRowGroup } from '../../components/SwipeRow';
import { useMemberMap } from '../../features/household/hooks';
import { useDeleteTrip, useShoppingHistory, useShoppingSuggestions } from '../../features/todos/hooks';
import { Alert } from '../../lib/alert';
import type { TodoRow } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import { dateIso, formatDate, formatQuantity } from '../../lib/format';
import { radius, shadow, spacing, type ThemeColors, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';
import { usePressDim } from '../../lib/usePressDim';

type Mode = 'trips' | 'items';

/** One "Einkauf abschließen": the rows it closed, and the expense if booked. */
interface Trip {
  closedAt: string;
  rows: TodoRow[];
  expenseId: string | null;
}

function historieStyles(c: ThemeColors) {
  return {
    switcher: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    list: { paddingBottom: spacing.xxl * 2 },
    // The date is the headline; everything under it is one day's shopping.
    dayHeading: {
      ...typography.heading,
      color: c.text,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      backgroundColor: c.background,
    },
    // One checkout. The card is what separates two shops on the same day —
    // no clock needed to tell them apart, they are visibly two things.
    // Margin and radius moved onto SwipeRow's own containerStyle: it clips its
    // bounds to hide the delete action off-screen, so the radius has to live
    // wherever that clip happens for the corners to line up.
    tripSwipe: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
    },
    trip: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xs,
    },
    tripHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    tripMeta: { ...typography.caption, color: c.textFaint, flex: 1 },
    tripAction: { ...typography.captionStrong, color: c.primary },
    linkPressed: { opacity: 0.6 },
    divider: { height: 1, backgroundColor: c.border },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowPressed: { opacity: 0.7 },
    rowTitle: { ...typography.body, color: c.text, flex: 1 },
    rowCount: { color: c.textMuted },
    rowMeta: { ...typography.caption, color: c.textFaint },
    dueBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: c.dueTodaySoft,
    },
    dueLabel: { ...typography.micro, color: c.dueToday },

    // --- "Was wir kaufen" -------------------------------------------------
    // Its own set rather than the trip rows above: those live inside a card
    // that supplies the padding and the separation, and reusing them here put
    // bare unpadded lines straight onto the page background.
    itemsIntro: {
      ...typography.caption,
      color: c.textMuted,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
    itemCard: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      ...shadow.card,
    },
    // The initial, not an icon: every row would carry the same cart otherwise,
    // and a wall of identical glyphs is decoration rather than information.
    itemInitial: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: c.primarySoft,
    },
    itemInitialDue: { backgroundColor: c.dueTodaySoft },
    itemInitialLabel: { ...typography.bodyStrong, color: c.primary },
    itemInitialLabelDue: { color: c.dueToday },
    itemBody: { flex: 1, gap: 4 },
    itemName: { ...typography.bodyStrong, color: c.text },
    itemMeta: { ...typography.caption, color: c.textFaint },
    // How far through the usual gap this item is. A number of days means
    // nothing without the rhythm it is measured against; a bar that is nearly
    // full says "bald wieder" at a glance.
    track: {
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceMuted,
      overflow: 'hidden' as const,
    },
    trackFill: { height: 4, borderRadius: radius.pill, backgroundColor: c.primary },
    trackFillDue: { backgroundColor: c.dueToday },
    itemRight: { alignItems: 'flex-end' as const, gap: spacing.xs },
    countPill: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceMuted,
    },
    countLabel: { ...typography.micro, color: c.textMuted },
  };
}

/**
 * Einkaufshistorie — two questions, two shapes.
 *
 * "Was haben wir letzten Samstag geholt" is a diary: rows grouped by the day
 * they were ticked off, with who ticked them and a link to the expense if the
 * shop was booked as one — and a way to book one now if it was not. Putting
 * the shopping away and paying for it are separate acts that routinely happen
 * days apart, so the checkout lets you skip the money entirely; this is where
 * it catches up.
 *
 * "Wie oft kaufen wir eigentlich Käse" is a completely different question, and
 * a chronological list answers it badly — so the second tab is the aggregate:
 * how often, how long ago, and whether it is due again. That is also exactly
 * what feeds the one-tap chips on the Einkaufsliste, so this screen is the
 * place you go to understand why something was suggested.
 *
 * No prices anywhere, on either tab. What a shop cost is a question about
 * money and belongs under Ausgaben, which can answer it properly; here it
 * would only be a number you cannot do anything with.
 */
export default function ShoppingHistoryScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles(historieStyles);

  const [mode, setMode] = useState<Mode>('trips');
  const { data: history, isLoading, error } = useShoppingHistory();
  const { data: suggestions } = useShoppingSuggestions();
  const memberMap = useMemberMap();
  const deleteTrip = useDeleteTrip();
  const swipeGroup = useSwipeRowGroup();

  /**
   * Two levels: the day is the heading, and each checkout under it is its own
   * block.
   *
   * "Einkauf abschließen" writes one `cleared_at` across every row it closes —
   * a single UPDATE with a single timestamp — so rows sharing that value are
   * exactly the rows that went through the checkout together. That makes it
   * the trip identity, with no `shopping_trips` table to keep in step: closed
   * together *means* bought together.
   *
   * The day heading carries the date and nothing else. Two shops on a Saturday
   * are two blocks under one date rather than two headings with clocks on
   * them — a shop is not a time of day, and the separation is the point, not
   * the timestamp.
   */
  const days = useMemo(() => {
    const byTrip = new Map<string, TodoRow[]>();

    for (const row of history ?? []) {
      if (!row.cleared_at) continue;
      const bucket = byTrip.get(row.cleared_at) ?? [];
      bucket.push(row);
      byTrip.set(row.cleared_at, bucket);
    }

    const byDay = new Map<string, Trip[]>();
    for (const [closedAt, rows] of byTrip) {
      const day = dateIso(closedAt);
      const bucket = byDay.get(day) ?? [];
      // One expense per shop in practice, so the first link found is the
      // shop's; the booking action appears only when there is none at all.
      bucket.push({
        closedAt,
        rows,
        expenseId: rows.find((row) => row.expense_id)?.expense_id ?? null,
      });
      byDay.set(day, bucket);
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, trips]) => ({
        title: day,
        data: trips.sort((a, b) => b.closedAt.localeCompare(a.closedAt)),
      }));
  }, [history]);

  /**
   * Books an expense for a shop that was closed without one.
   *
   * Paying and putting away are separate acts and routinely happen days apart,
   * so the checkout lets you skip the money — this is how it gets attached
   * afterwards. The row ids ride along in `link`; /ausgaben/neu stamps them
   * once the expense exists.
   *
   * Dated by when the shopping was ticked off rather than when the checkout
   * was finished — same rule the checkout itself uses, so booking now and
   * booking then produce the same expense.
   */
  function bookExpense(rows: TodoRow[]) {
    const doneAt = rows
      .map((row) => row.done_at)
      .filter((at): at is string => !!at)
      .sort()
      .at(-1);

    const query = new URLSearchParams({
      title: 'Einkauf',
      category: 'Lebensmittel',
      items: rows.map((row) => row.title).join('\n'),
      link: rows.map((row) => row.id).join(','),
      ...(doneAt ? { date: dateIso(doneAt) } : {}),
    });
    router.push(`/ausgaben/neu?${query.toString()}`);
  }

  /**
   * "This trip should never have counted" — a real delete, not just clearing
   * it off a list. Stock already put away during checkout is untouched (a
   * separate table, separate act), and a booked expense stays too; either can
   * be undone on its own screen. The dialog says so, because both look like
   * they should disappear along with the trip and neither does.
   */
  function confirmDeleteTrip(trip: Trip) {
    Alert.alert(
      'Einkauf löschen?',
      trip.expenseId
        ? 'Verschwindet aus der Historie und den Kaufgewohnheiten. Bereits eingeräumter Bestand und die verknüpfte Ausgabe bleiben bestehen.'
        : 'Verschwindet aus der Historie und den Kaufgewohnheiten. Bereits eingeräumter Bestand bleibt bestehen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTrip.mutateAsync(trip.rows.map((row) => row.id));
            } catch (err) {
              Alert.alert('Konnte nicht gelöscht werden', errorMessage(err));
            }
          },
        },
      ],
    );
  }

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
          sections={days}
          keyExtractor={(trip) => trip.closedAt}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          ListEmptyComponent={
            <EmptyState
              title="Noch nichts gekauft"
              body="Abgehakte Einträge landen hier, sobald der Einkauf abgeschlossen ist — mit Link zur Ausgabe, wenn ihr sie gebucht habt."
            />
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.dayHeading}>{formatDate(section.title)}</Text>
          )}
          renderItem={({ item: trip }) => (
            <SwipeRow
              id={trip.closedAt}
              group={swipeGroup}
              containerStyle={styles.tripSwipe}
              rightActions={[
                {
                  key: 'delete',
                  icon: 'trash-outline',
                  label: 'Löschen',
                  tone: 'danger',
                  accessibilityLabel: 'Diesen Einkauf löschen',
                  onPress: () => confirmDeleteTrip(trip),
                },
              ]}
            >
              <View style={styles.trip}>
                <View style={styles.tripHeader}>
                  <Text style={styles.tripMeta}>{trip.rows.length} Sachen</Text>

                  {trip.expenseId ? (
                    <TripActionLink
                      label="Ausgabe ansehen"
                      styles={styles}
                      onPress={() => router.push(`/ausgaben/${trip.expenseId}`)}
                    />
                  ) : (
                    <TripActionLink
                      label="Ausgabe buchen"
                      accessibilityLabel="Ausgabe für diesen Einkauf buchen"
                      styles={styles}
                      onPress={() => bookExpense(trip.rows)}
                    />
                  )}
                </View>

                {trip.rows.map((row, index) => (
                  <View key={row.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <TripItemRow
                      row={row}
                      person={row.done_by ? memberMap[row.done_by] : null}
                      styles={styles}
                      onPress={row.product_id ? () => router.push(`/inventar/produkt/${row.product_id}`) : undefined}
                    />
                  </View>
                ))}
              </View>
            </SwipeRow>
          )}
        />
      ) : (
        <SectionList
          sections={[{ title: 'items', data: items }]}
          keyExtractor={(item) => item.item_key}
          contentContainerStyle={styles.list}
          renderSectionHeader={() => null}
          ListHeaderComponent={
            items.length > 0 ? (
              <Text style={styles.itemsIntro}>
                Sortiert nach dem, was ihr am häufigsten holt. Dieselbe Liste schlägt auf der
                Einkaufsliste die Ein-Tipp-Chips vor.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              title="Noch keine Gewohnheiten"
              body="Nach ein paar Einkäufen steht hier, was ihr regelmäßig holt — und wann es wieder so weit ist."
            />
          }
          renderItem={({ item }) => {
            const due = !!item.is_due;

            // How far into the usual gap this item is, 0–1. Only drawn where
            // there is a rhythm to measure against: a thing bought once has a
            // "days since" but no expectation to compare it to, and a bar at
            // an arbitrary fill would be inventing one.
            const rhythm =
              item.avg_interval_days && item.avg_interval_days > 0 && item.days_since_bought !== null
                ? Math.min(1, item.days_since_bought / item.avg_interval_days)
                : null;

            return (
              <View style={styles.itemCard}>
                <View style={[styles.itemInitial, due && styles.itemInitialDue]}>
                  <Text style={[styles.itemInitialLabel, due && styles.itemInitialLabelDue]}>
                    {item.name.trim().charAt(0).toUpperCase()}
                  </Text>
                </View>

                <View style={styles.itemBody}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.itemMeta} numberOfLines={1}>
                    {[
                      item.avg_interval_days
                        ? `ca. alle ${Math.round(item.avg_interval_days)} Tage`
                        : 'noch kein Rhythmus',
                      item.days_since_bought !== null
                        ? `zuletzt vor ${item.days_since_bought} T.`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>

                  {rhythm !== null ? (
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.trackFill,
                          due && styles.trackFillDue,
                          // Percentage width, so it lays out against whatever
                          // the row happens to be on this screen.
                          { width: `${Math.round(rhythm * 100)}%` },
                        ]}
                      />
                    </View>
                  ) : null}
                </View>

                <View style={styles.itemRight}>
                  {/* The count is what the sort is on, so it belongs on the
                      row — otherwise the order looks arbitrary. */}
                  <View style={styles.countPill}>
                    {/* An item can be known only from receipt lines and never
                        from a ticked-off row, so times_bought is 0 for it —
                        the price side is then the only count there is. */}
                    <Text style={styles.countLabel}>
                      {item.times_bought || item.times_paid}×
                    </Text>
                  </View>
                  {due ? (
                    <View style={styles.dueBadge}>
                      <Text style={styles.dueLabel}>fällig</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

type HistorieStyles = ReturnType<typeof historieStyles>;

/**
 * Its own component, not inline in `renderItem`: the delayed press-dim
 * below needs `usePressDim()`, which only gets its own slot of state when
 * called from a real per-row component instance — see the same note on
 * TodoRow in todos.tsx.
 */
function TripActionLink({
  label,
  accessibilityLabel,
  styles,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  styles: HistorieStyles;
  onPress: () => void;
}) {
  const press = usePressDim();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.tripAction, press.pressed && styles.linkPressed]}>{label}</Text>
    </Pressable>
  );
}

/** Same extraction reason as TripActionLink above. */
function TripItemRow({
  row,
  person,
  styles,
  onPress,
}: {
  row: TodoRow;
  person: { display_name: string; color: string } | null;
  styles: HistorieStyles;
  /** Undefined when the row never resolved to a product — nothing to open. */
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const press = usePressDim();

  return (
    // A row is about the thing. The shop's expense is the block header's
    // business — repeating it per line put a receipt icon on every single
    // row of a booked shop.
    <Pressable
      style={[styles.row, press.pressed && styles.rowPressed]}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      {/* "3× Milch", because two bottles and six are the same shop only in
          the sense that both happened. */}
      <Text style={styles.rowTitle} numberOfLines={1}>
        {row.quantity > 1 ? <Text style={styles.rowCount}>{formatQuantity(row.quantity)}× </Text> : null}
        {row.title}
      </Text>

      {/* No "vor 3 Tagen" per row any more: the date is the heading above,
          and every row under it would repeat the same phrase. */}
      {row.source === 'restock' ? <Text style={styles.rowMeta}>Nachkauf</Text> : null}

      {person ? (
        <Avatar
          name={person.display_name}
          color={person.color}
          size={22}
          accessibilityLabel={`abgehakt von ${person.display_name}`}
        />
      ) : null}

      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textFaint} /> : null}
    </Pressable>
  );
}
