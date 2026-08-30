import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Card, EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { SwipeRow, useSwipeRowGroup } from '../../components/SwipeRow';
import { TextField } from '../../components/TextField';
import {
  useAdjustQuantity,
  useDeleteItem,
  useInventoryItems,
  useInventoryTotals,
  useLocations,
  useMoveItem,
} from '../../features/inventory/hooks';
import { Alert } from '../../lib/alert';
import type { ProductKind } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatQuantity, formatQuantityWithUnit } from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

const KIND_OPTIONS: { value: ProductKind; label: string }[] = [
  { value: 'consumable', label: 'Vorräte' },
  { value: 'equipment', label: 'Ausstattung' },
];

/**
 * Two lists behind one toggle, not two screens.
 *
 * Vorräte and Ausstattung share the search, the Orte, the scanner and the whole
 * product catalog — only the per-row question differs: "wie viel ist noch da"
 * against "liegt es, wo es hingehört". Splitting them into separate tabs would
 * have meant maintaining that shared half twice, and made a mis-sorted item a
 * navigation problem instead of one tap.
 */
export default function InventoryScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    headerActions: { flexDirection: 'row' as const, gap: spacing.sm },
    scanButton: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    secondaryButton: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceMuted,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    toggle: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    search: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    list: { paddingBottom: spacing.xxl * 2 },
    restockCard: { marginHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
    restockHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    restockTitle: { ...typography.micro, color: c.dueToday, textTransform: 'uppercase' as const },
    restockLink: { ...typography.caption, color: c.dueToday },
    flex: { flex: 1 },
    restockRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      paddingVertical: 6,
    },
    restockName: { ...typography.body, color: c.text, flex: 1 },
    restockQuantity: { ...typography.caption, color: c.textMuted },
    // Card draws its own shadow, which SwipeRow would clip along with the
    // delete action it hides — so the margin and matching radius sit on
    // SwipeRow's container, outside that clip. See fixkosten.tsx for the
    // same pattern.
    itemWrap: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.lg },
    swipeContainer: { borderRadius: radius.lg },
    itemCard: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: c.surfaceMuted },
    thumbPlaceholder: { alignItems: 'center' as const, justifyContent: 'center' as const },
    itemText: { flex: 1, gap: 2 },
    itemName: { ...typography.bodyStrong, color: c.text },
    itemMeta: { ...typography.caption, color: c.textMuted },
    itemWarning: { ...typography.caption, color: c.warning },
    itemOk: { ...typography.caption, color: c.success },
    returnButton: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.xs,
      backgroundColor: c.warningSoft,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    returnLabel: { ...typography.captionStrong, color: c.warning },
    stepper: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    stepperButton: { width: 26, height: 26, alignItems: 'center' as const, justifyContent: 'center' as const },
    quantity: { ...typography.bodyStrong, color: c.text, minWidth: 22, textAlign: 'center' as const },
  }));
  const { data: items, isLoading, isRefetching, refetch, error } = useInventoryItems();
  const { data: totals } = useInventoryTotals();
  const { data: locations } = useLocations();
  const adjust = useAdjustQuantity();
  const moveItem = useMoveItem();
  const deleteItem = useDeleteItem();
  const swipeGroup = useSwipeRowGroup();
  const [kind, setKind] = useState<ProductKind>('consumable');
  const [search, setSearch] = useState('');

  // Staples at or below their threshold. This list is why an emptied lot can
  // be deleted at all: the product survives with its threshold, so "wir
  // brauchen Klopapier" is still answerable when no stock row exists.
  // Equipment never appears here — v_inventory_totals forces is_low false for
  // it, which is also what keeps it off the Einkaufsliste.
  const lowStock = useMemo(() => (totals ?? []).filter((t) => t.is_low), [totals]);

  // "Geht zur Neige" is a property of the product now, not of one lot — a
  // half-empty shelf is not low if the other shelf is full.
  const lowProductIds = useMemo(
    () => new Set(lowStock.map((t) => t.product_id)),
    [lowStock],
  );

  // Full "Küche › Schublade" paths, so a fester Platz reads the same here as in
  // the Orte-Verwaltung rather than collapsing to a bare "Schublade".
  const locationPaths = useMemo(
    () => new Map((locations ?? []).map((location) => [location.id, location.path])),
    [locations],
  );

  const ofKind = useMemo(
    () => (items ?? []).filter((item) => (item.products?.kind ?? 'consumable') === kind),
    [items, kind],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return ofKind;

    return ofKind.filter(
      (item) =>
        item.products?.name.toLowerCase().includes(needle) ||
        item.products?.brand?.toLowerCase().includes(needle) ||
        item.products?.barcode?.includes(needle) ||
        item.storage_locations?.name.toLowerCase().includes(needle),
    );
  }, [ofKind, search]);

  const equipment = kind === 'equipment';

  /**
   * Removes this one lot — this product, at this location, at this expiry —
   * outright, rather than counting it down to zero. Zeroing keeps the row
   * (see the note on produkt/[id].tsx: an emptied lot still marks "this is
   * where it usually sits"); this is for the row that should not have
   * existed at all, a duplicate scan or a location it never actually was at.
   * The product itself is untouched either way.
   */
  function confirmDeleteItem(item: { id: string; products: { name: string } | null }) {
    Alert.alert(
      `${item.products?.name ?? 'Eintrag'} entfernen?`,
      'Nur dieser Posten an diesem Ort — der Rest des Bestands bleibt unangetastet.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteItem.mutateAsync(item.id);
            } catch (err) {
              Alert.alert('Konnte nicht entfernt werden', errorMessage(err));
            }
          },
        },
      ],
    );
  }

  if (isLoading) return <LoadingState label="Inventar wird geladen…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <Screen>
      <ScreenHeader
        title="Inventar"
        subtitle={`${ofKind.length} ${equipment ? 'Gegenstände' : 'Positionen'}`}
        right={
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/inventar/orte')}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Orte verwalten"
            >
              <Ionicons name="location-outline" size={20} color={colors.text} />
            </Pressable>
            <Pressable
              // Carries the open tab through, so "+" while looking at
              // Ausstattung adds a tool rather than silently a Vorrat.
              onPress={() => router.push(`/inventar/neu?kind=${kind}`)}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel={equipment ? 'Gegenstand hinzufügen' : 'Manuell hinzufügen'}
            >
              <Ionicons name="add" size={20} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/inventar/scan')}
              style={styles.scanButton}
              accessibilityRole="button"
              accessibilityLabel="Barcode scannen"
            >
              <Ionicons name="barcode-outline" size={20} color={colors.textInverse} />
            </Pressable>
          </View>
        }
      />

      <View style={styles.toggle}>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />
      </View>

      <View style={styles.search}>
        <TextField
          value={search}
          onChangeText={setSearch}
          placeholder="Suchen: Name, Marke, Ort, Barcode"
          autoCapitalize="none"
        />
      </View>

      <FlatList
        ListHeaderComponent={
          !equipment && lowStock.length > 0 && !search ? (
            <Card style={styles.restockCard}>
              {/* Every one of these already has a line on the Einkaufsliste,
                  written by sync_restock_todos(). The header is the way over
                  there; the rows below stay pointed at the products, which is
                  the question this screen answers. */}
              <Pressable
                onPress={() => router.push('/einkaufsliste')}
                style={styles.restockHeader}
                accessibilityRole="button"
                accessibilityLabel="Einkaufsliste öffnen"
              >
                <Ionicons name="cart" size={16} color={colors.dueToday} />
                <Text style={[styles.restockTitle, styles.flex]}>Nachkaufen</Text>
                <Text style={styles.restockLink}>Einkaufsliste</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.dueToday} />
              </Pressable>
              {lowStock.map((product) => (
                <Pressable
                  key={product.product_id}
                  onPress={() => router.push(`/inventar/produkt/${product.product_id}`)}
                  style={styles.restockRow}
                  accessibilityRole="button"
                >
                  <Text style={styles.restockName} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={styles.restockQuantity}>
                    {product.total_quantity <= 0
                      ? 'leer'
                      : `noch ${formatQuantityWithUnit(product.total_quantity, product.unit)}`}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </Card>
          ) : null
        }
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            title={search ? 'Nichts gefunden' : 'Noch nichts erfasst'}
            body={
              search
                ? undefined
                : equipment
                  ? 'Trage ein, was dauerhaft im Haushalt lebt — Werkzeug, Geräte, Geschirr — und gib jedem Ding seinen festen Platz.'
                  : 'Scanne einen Barcode, um euren Bestand aufzubauen — oder trag mit + ein, was schon im Schrank steht. Dafür muss nichts über die Einkaufsliste laufen.'
            }
          />
        }
        renderItem={({ item }) => {
          const low = lowProductIds.has(item.product_id);
          const expiringSoon =
            item.expires_on && new Date(item.expires_on).getTime() - Date.now() < 7 * 86_400_000;

          // Ausstattung: where it should be, versus where it is. A null
          // default_location_id is "noch kein Platz vereinbart", which is not
          // the same as being in the wrong one — so it gets its own wording
          // rather than being flagged as misplaced.
          //
          // Requiring the resolved path, not just the id, keeps the flag from
          // appearing for the frame before the Orte have loaded — where it
          // could only name the place it belongs as "Ohne Ort", which is a
          // different claim entirely.
          const home = item.products?.default_location_id ?? null;
          const homePath = home ? (locationPaths.get(home) ?? null) : null;
          const misplaced = equipment && !!homePath && item.location_id !== home;

          return (
            <View style={styles.itemWrap}>
              <SwipeRow
                id={item.id}
                group={swipeGroup}
                containerStyle={styles.swipeContainer}
                rightActions={[
                  {
                    key: 'delete',
                    icon: 'trash-outline',
                    label: 'Entfernen',
                    tone: 'danger',
                    accessibilityLabel: `${item.products?.name ?? 'Eintrag'} entfernen`,
                    onPress: () => confirmDeleteItem(item),
                  },
                ]}
              >
                <Card
                  style={styles.itemCard}
                  onPress={
                    item.product_id
                      ? () => router.push(`/inventar/produkt/${item.product_id}`)
                      : undefined
                  }
                >
                  {item.products?.image_url ? (
                    <Image source={{ uri: item.products.image_url }} style={styles.thumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <Ionicons
                        name={equipment ? 'construct-outline' : 'cube-outline'}
                        size={20}
                        color={colors.textFaint}
                      />
                    </View>
                  )}

                  <View style={styles.itemText}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.products?.name ?? 'Unbekannt'}
                    </Text>
                    <Text style={styles.itemMeta} numberOfLines={1}>
                      {item.storage_locations?.name ?? 'Ohne Ort'}
                      {item.products?.brand ? ` · ${item.products.brand}` : ''}
                      {!equipment && item.opened_at ? ' · angebrochen' : ''}
                      {equipment && item.quantity !== 1 ? ` · ${formatQuantity(item.quantity)}×` : ''}
                    </Text>

                    {equipment ? (
                      misplaced ? (
                        <Text style={styles.itemWarning} numberOfLines={1}>
                          Gehört: {homePath}
                        </Text>
                      ) : home ? (
                        <Text style={styles.itemOk}>Am Platz</Text>
                      ) : (
                        <Text style={styles.itemMeta}>Kein fester Platz</Text>
                      )
                    ) : low || expiringSoon ? (
                      <Text style={styles.itemWarning}>
                        {low ? 'Geht zur Neige' : ''}
                        {low && expiringSoon ? ' · ' : ''}
                        {expiringSoon && item.expires_on ? `MHD ${formatDate(item.expires_on)}` : ''}
                      </Text>
                    ) : null}
                  </View>

                  {equipment ? (
                    misplaced ? (
                      <Pressable
                        // Moves the whole lot, not one of it: a tool that is in the
                        // wrong room is in the wrong room entirely. inventory_move
                        // merges it into whatever already sits at the Platz.
                        onPress={() => void moveItem.mutateAsync({ itemId: item.id, locationId: home })}
                        style={styles.returnButton}
                        accessibilityRole="button"
                        accessibilityLabel={`Zurück an den Platz: ${homePath}`}
                      >
                        <Ionicons name="arrow-undo-outline" size={14} color={colors.warning} />
                        <Text style={styles.returnLabel}>Zurück</Text>
                      </Pressable>
                    ) : null
                  ) : (
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() =>
                          void adjust.mutateAsync({ itemId: item.id, delta: -1, reason: 'consume' })
                        }
                        hitSlop={6}
                        style={styles.stepperButton}
                        accessibilityLabel="Eins entnehmen"
                      >
                        <Ionicons name="remove" size={18} color={colors.text} />
                      </Pressable>

                      <Text style={styles.quantity}>{formatQuantity(item.quantity)}</Text>

                      <Pressable
                        onPress={() => void adjust.mutateAsync({ itemId: item.id, delta: 1 })}
                        hitSlop={6}
                        style={styles.stepperButton}
                        accessibilityLabel="Eins hinzufügen"
                      >
                        <Ionicons name="add" size={18} color={colors.text} />
                      </Pressable>
                    </View>
                  )}
                </Card>
              </SwipeRow>
            </View>
          );
        }}
      />
    </Screen>
  );
}
