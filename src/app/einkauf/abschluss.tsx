import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card, EmptyState } from '../../components/Card';
import { Chip } from '../../components/Segmented';
import { LoadingState, Screen } from '../../components/Screen';
import { useAddStock, useLocations, useScanIn } from '../../features/inventory/hooks';
import { useCloseShoppingRows, useTodos } from '../../features/todos/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';
import { formatQuantity } from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

/**
 * Where one item goes. A row has at least one of these and can have several —
 * two crates of water in the fridge and the other four in the Keller is a
 * normal shop, and one location per product cannot say it.
 */
interface Allocation {
  /** Stable across re-renders; locations can repeat, so they cannot be the key. */
  key: string;
  locationId: string | null;
  quantity: number;
}

let allocationCounter = 0;
const nextKey = () => `alloc-${++allocationCounter}`;

/**
 * Einkauf abschließen — step one of two: putting the shopping away.
 *
 * The list said what to buy and how many; this says what actually came home
 * and where it went. Both differ from the plan routinely: the butter was on
 * offer so four came instead of two, and the drinks split between the fridge
 * and the cellar. So the count has no ceiling, and every row can be spread
 * across as many places as it needs.
 *
 * The number in the row header is always the sum of its allocations rather
 * than a separate figure they have to agree with — splitting moves stock
 * between shelves instead of inventing it, and there is no way to leave the
 * screen in a state where the two disagree.
 *
 * Money is deliberately not here. It belongs on the Ausgaben screen, which
 * already knows how to split a total, pick a payer and photograph a receipt,
 * so this screen finishes by handing over to it.
 */
export default function ShoppingCheckoutScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    card: { gap: spacing.md },
    sectionTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginLeft: spacing.xs,
    },
    hint: { ...typography.caption, color: c.textMuted },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.bodyStrong, color: c.text },
    rowTitleOff: { color: c.textFaint, textDecorationLine: 'line-through' as const },
    rowMeta: { ...typography.caption, color: c.textFaint },
    total: { ...typography.bodyStrong, color: c.text },
    divider: { height: 1, backgroundColor: c.border },
    allocations: { gap: spacing.sm, paddingLeft: spacing.xl, paddingTop: spacing.sm },
    allocation: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    allocationName: { ...typography.caption, color: c.text, flex: 1 },
    stepper: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.pill,
      paddingHorizontal: 2,
    },
    stepperButton: {
      width: 30,
      height: 30,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    stepperValue: {
      ...typography.captionStrong,
      color: c.text,
      minWidth: 26,
      textAlign: 'center' as const,
    },
    splitButton: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    splitLabel: { ...typography.caption, color: c.primary },
    chipRow: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: spacing.sm,
      paddingBottom: spacing.sm,
    },
    actions: { gap: spacing.sm },
  }));

  const { data: items, isLoading } = useTodos('shopping');
  const { data: locations } = useLocations();
  const addStock = useAddStock();
  const scanIn = useScanIn();
  const closeRows = useCloseShoppingRows();

  const bought = useMemo(() => (items ?? []).filter((t) => t.is_done), [items]);

  /** Allocations by row id — where each bought item is going, and how many. */
  const [plan, setPlan] = useState<Record<string, Allocation[]>>({});
  /** Rows to leave out of the inventory — bought, but not something you stock. */
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  /** Which allocation's location picker is open; only ever one. */
  const [picking, setPicking] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);

  // Seeded during render rather than in an effect: the values come straight
  // from the query, and an effect would paint one frame of empty steppers.
  if (!seeded && bought.length > 0) {
    setPlan(
      Object.fromEntries(
        bought.map((row) => [
          row.id,
          // One allocation, no location — "wherever it usually lives".
          [{ key: nextKey(), locationId: null, quantity: row.quantity }],
        ]),
      ),
    );
    setSeeded(true);
  }

  if (isLoading) return <LoadingState />;

  const allocationsFor = (row: { id: string; quantity: number }): Allocation[] =>
    plan[row.id] ?? [{ key: `seed-${row.id}`, locationId: null, quantity: row.quantity }];

  const totalFor = (row: { id: string; quantity: number }) =>
    allocationsFor(row).reduce((sum, allocation) => sum + allocation.quantity, 0);

  const locationName = (id: string | null) =>
    id ? ((locations ?? []).find((l) => l.id === id)?.path ?? 'Ort') : 'Wie immer';

  function update(rowId: string, next: (current: Allocation[]) => Allocation[]) {
    setPlan((prev) => ({ ...prev, [rowId]: next(prev[rowId] ?? []) }));
  }

  function step(rowId: string, key: string, delta: number) {
    update(rowId, (current) =>
      current.map((allocation) =>
        allocation.key === key
          ? { ...allocation, quantity: Math.max(0.5, allocation.quantity + delta) }
          : allocation,
      ),
    );
  }

  /**
   * Splitting moves stock rather than adding it: the new shelf takes one off
   * the fullest existing one, so the header total does not jump when you say
   * "and two of those go in the fridge". Only when nothing is left to take
   * does the total grow — which reads as "I bought one more", and is right.
   */
  function addLocation(rowId: string) {
    update(rowId, (current) => {
      const fullest = current.reduce(
        (best, allocation) => (allocation.quantity > best.quantity ? allocation : best),
        current[0],
      );

      const donate = fullest && fullest.quantity > 1;
      return [
        ...current.map((allocation) =>
          donate && allocation.key === fullest.key
            ? { ...allocation, quantity: allocation.quantity - 1 }
            : allocation,
        ),
        { key: nextKey(), locationId: null, quantity: 1 },
      ];
    });
  }

  /** Removing a shelf hands its stock back rather than losing it. */
  function removeLocation(rowId: string, key: string) {
    update(rowId, (current) => {
      if (current.length <= 1) return current;
      const removed = current.find((allocation) => allocation.key === key);
      const rest = current.filter((allocation) => allocation.key !== key);
      if (removed) rest[0] = { ...rest[0], quantity: rest[0].quantity + removed.quantity };
      return rest;
    });
  }

  async function bookStock() {
    for (const row of bought) {
      if (skipped[row.id]) continue;

      // One call per shelf. Sequential because each writes a movement row and
      // fires the restock trigger; a whole shop is a couple of dozen at most.
      for (const allocation of allocationsFor(row)) {
        if (allocation.quantity <= 0) continue;

        if (row.product_id) {
          // Exact — the row came from a restock reminder and knows its product.
          await addStock.mutateAsync({
            productId: row.product_id,
            quantity: allocation.quantity,
            locationId: allocation.locationId,
            note: 'Einkauf',
          });
        } else {
          // Hand-written, so there may be no catalog entry yet.
          // inventory_scan_in() matches on the normalised name and creates one
          // only if nothing matched — which is what stops "Käse" becoming a
          // second product every time you buy cheese. Two allocations of the
          // same name therefore land on one product in two locations.
          await scanIn.mutateAsync({
            name: row.title,
            quantity: allocation.quantity,
            locationId: allocation.locationId,
          });
        }
      }
    }
  }

  async function finish(withStock: boolean) {
    setBusy(true);
    try {
      if (withStock) await bookStock();
      await closeRows.mutateAsync({ ids: bought.map((row) => row.id) });

      // replace, not push: going "back" to a checkout for a list that is now
      // empty is a dead end.
      router.replace('/ausgaben/neu?title=Einkauf&category=Lebensmittel');
    } catch (err) {
      Alert.alert('Konnte nicht eingeräumt werden', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const stocking = bought.filter((row) => !skipped[row.id]);

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Einräumen' }} />

      {bought.length === 0 ? (
        <EmptyState
          title="Nichts abgehakt"
          body="Hak auf der Einkaufsliste ab, was im Wagen liegt — dann lässt sich der Einkauf hier abschließen."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Was ist mitgekommen</Text>
          <Card style={styles.card}>
            <Text style={styles.hint}>
              Die Zahl steht auf dem, was du aufgeschrieben hast. Änder sie, wenn es mehr geworden
              ist — und teil auf, wenn nicht alles an denselben Ort kommt.
            </Text>

            {bought.map((row, index) => {
              const off = !!skipped[row.id];
              const allocations = allocationsFor(row);
              const total = totalFor(row);
              const split = allocations.length > 1;

              return (
                <View key={row.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}

                  <View style={styles.row}>
                    <Pressable
                      onPress={() => setSkipped((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                      hitSlop={6}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !off }}
                      accessibilityLabel={`${row.title} einräumen`}
                    >
                      <Ionicons
                        name={off ? 'square-outline' : 'checkbox'}
                        size={22}
                        color={off ? colors.textFaint : colors.primary}
                      />
                    </Pressable>

                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, off && styles.rowTitleOff]}>{row.title}</Text>
                      {total !== row.quantity ? (
                        <Text style={styles.rowMeta}>
                          geplant waren {formatQuantity(row.quantity)}
                        </Text>
                      ) : row.source === 'restock' ? (
                        <Text style={styles.rowMeta}>Nachkauf</Text>
                      ) : null}
                    </View>

                    {off ? null : split ? (
                      // Once it is spread across shelves the header is a
                      // read-out, not a control — the per-shelf steppers own
                      // the number so the two can never disagree.
                      <Text style={styles.total}>{formatQuantity(total)}</Text>
                    ) : (
                      <View style={styles.stepper}>
                        <Pressable
                          onPress={() => step(row.id, allocations[0].key, -1)}
                          disabled={total <= 1}
                          hitSlop={4}
                          style={styles.stepperButton}
                          accessibilityRole="button"
                          accessibilityLabel="Eins weniger"
                        >
                          <Ionicons
                            name="remove"
                            size={18}
                            color={total <= 1 ? colors.border : colors.text}
                          />
                        </Pressable>

                        <Text style={styles.stepperValue}>{formatQuantity(total)}</Text>

                        {/* No upper bound on purpose — the shop decides how
                            many came home, not the list. */}
                        <Pressable
                          onPress={() => step(row.id, allocations[0].key, 1)}
                          hitSlop={4}
                          style={styles.stepperButton}
                          accessibilityRole="button"
                          accessibilityLabel="Eins mehr"
                        >
                          <Ionicons name="add" size={18} color={colors.text} />
                        </Pressable>
                      </View>
                    )}
                  </View>

                  {off ? null : (
                    <View style={styles.allocations}>
                      {allocations.map((allocation) => {
                        const pickerKey = `${row.id}:${allocation.key}`;
                        const open = picking === pickerKey;

                        return (
                          <View key={allocation.key}>
                            <View style={styles.allocation}>
                              <Ionicons name="location-outline" size={14} color={colors.textFaint} />

                              <Pressable
                                onPress={() => setPicking(open ? null : pickerKey)}
                                style={styles.rowText}
                                accessibilityRole="button"
                                accessibilityLabel="Ort wählen"
                              >
                                <Text style={styles.allocationName} numberOfLines={1}>
                                  {locationName(allocation.locationId)}
                                </Text>
                              </Pressable>

                              {split ? (
                                <View style={styles.stepper}>
                                  <Pressable
                                    onPress={() => step(row.id, allocation.key, -1)}
                                    disabled={allocation.quantity <= 0.5}
                                    hitSlop={4}
                                    style={styles.stepperButton}
                                    accessibilityRole="button"
                                    accessibilityLabel="Eins weniger hier"
                                  >
                                    <Ionicons
                                      name="remove"
                                      size={16}
                                      color={allocation.quantity <= 0.5 ? colors.border : colors.text}
                                    />
                                  </Pressable>
                                  <Text style={styles.stepperValue}>
                                    {formatQuantity(allocation.quantity)}
                                  </Text>
                                  <Pressable
                                    onPress={() => step(row.id, allocation.key, 1)}
                                    hitSlop={4}
                                    style={styles.stepperButton}
                                    accessibilityRole="button"
                                    accessibilityLabel="Eins mehr hier"
                                  >
                                    <Ionicons name="add" size={16} color={colors.text} />
                                  </Pressable>
                                </View>
                              ) : null}

                              {split ? (
                                <Pressable
                                  onPress={() => removeLocation(row.id, allocation.key)}
                                  hitSlop={6}
                                  accessibilityRole="button"
                                  accessibilityLabel="Diesen Ort entfernen"
                                >
                                  <Ionicons name="close" size={16} color={colors.textFaint} />
                                </Pressable>
                              ) : null}
                            </View>

                            {open ? (
                              <View style={styles.chipRow}>
                                <Chip
                                  label="Wie immer"
                                  active={!allocation.locationId}
                                  onPress={() => {
                                    update(row.id, (current) =>
                                      current.map((a) =>
                                        a.key === allocation.key ? { ...a, locationId: null } : a,
                                      ),
                                    );
                                    setPicking(null);
                                  }}
                                />
                                {(locations ?? []).map((location) => (
                                  <Chip
                                    key={location.id}
                                    label={location.path}
                                    active={allocation.locationId === location.id}
                                    onPress={() => {
                                      update(row.id, (current) =>
                                        current.map((a) =>
                                          a.key === allocation.key
                                            ? { ...a, locationId: location.id }
                                            : a,
                                        ),
                                      );
                                      setPicking(null);
                                    }}
                                  />
                                ))}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}

                      <Pressable
                        onPress={() => addLocation(row.id)}
                        style={styles.splitButton}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.title} auf mehrere Orte aufteilen`}
                      >
                        <Ionicons name="add" size={14} color={colors.primary} />
                        <Text style={styles.splitLabel}>Auf einen weiteren Ort aufteilen</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </Card>

          <View style={styles.actions}>
            <Button
              label={
                stocking.length > 0
                  ? `${stocking.length} einräumen · weiter zur Ausgabe`
                  : 'Weiter zur Ausgabe'
              }
              onPress={() => void finish(true)}
              disabled={busy}
              loading={busy}
              size="lg"
            />
            <Button
              label="Ohne Inventar abschließen"
              variant="ghost"
              onPress={() => void finish(false)}
              disabled={busy}
            />
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
