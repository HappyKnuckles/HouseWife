import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Card, EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import {
  useAdjustQuantity,
  useInventoryItems,
  useInventoryTotals,
} from '../../features/inventory/hooks';
import { formatDate, formatQuantity, formatQuantityWithUnit } from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

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
    itemCard: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingVertical: spacing.md,
    },
    thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: c.surfaceMuted },
    thumbPlaceholder: { alignItems: 'center' as const, justifyContent: 'center' as const },
    itemText: { flex: 1, gap: 2 },
    itemName: { ...typography.bodyStrong, color: c.text },
    itemMeta: { ...typography.caption, color: c.textMuted },
    itemWarning: { ...typography.caption, color: c.warning },
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
  const adjust = useAdjustQuantity();
  const [search, setSearch] = useState('');

  // Staples at or below their threshold. This list is why an emptied lot can
  // be deleted at all: the product survives with its threshold, so "wir
  // brauchen Klopapier" is still answerable when no stock row exists.
  const lowStock = useMemo(() => (totals ?? []).filter((t) => t.is_low), [totals]);

  // "Geht zur Neige" is a property of the product now, not of one lot — a
  // half-empty shelf is not low if the other shelf is full.
  const lowProductIds = useMemo(
    () => new Set(lowStock.map((t) => t.product_id)),
    [lowStock],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = items ?? [];
    if (!needle) return rows;

    return rows.filter(
      (item) =>
        item.products?.name.toLowerCase().includes(needle) ||
        item.products?.brand?.toLowerCase().includes(needle) ||
        item.products?.barcode?.includes(needle) ||
        item.storage_locations?.name.toLowerCase().includes(needle),
    );
  }, [items, search]);

  if (isLoading) return <LoadingState label="Inventar wird geladen…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <Screen>
      <ScreenHeader
        title="Inventar"
        subtitle={`${items?.length ?? 0} Positionen`}
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
              onPress={() => router.push('/inventar/neu')}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel="Manuell hinzufügen"
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
          lowStock.length > 0 && !search ? (
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
            body={search ? undefined : 'Scanne einen Barcode, um euren Bestand aufzubauen.'}
          />
        }
        renderItem={({ item }) => {
          const low = lowProductIds.has(item.product_id);
          const expiringSoon =
            item.expires_on && new Date(item.expires_on).getTime() - Date.now() < 7 * 86_400_000;

          return (
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
                  <Ionicons name="cube-outline" size={20} color={colors.textFaint} />
                </View>
              )}

              <View style={styles.itemText}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.products?.name ?? 'Unbekannt'}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {item.storage_locations?.name ?? 'Ohne Ort'}
                  {item.products?.brand ? ` · ${item.products.brand}` : ''}
                  {item.opened_at ? ' · angebrochen' : ''}
                </Text>
                {low || expiringSoon ? (
                  <Text style={styles.itemWarning}>
                    {low ? 'Geht zur Neige' : ''}
                    {low && expiringSoon ? ' · ' : ''}
                    {expiringSoon && item.expires_on ? `MHD ${formatDate(item.expires_on)}` : ''}
                  </Text>
                ) : null}
              </View>

              <View style={styles.stepper}>
                <Pressable
                  onPress={() => void adjust.mutateAsync({ itemId: item.id, delta: -1, reason: 'consume' })}
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
            </Card>
          );
        }}
      />
    </Screen>
  );
}
