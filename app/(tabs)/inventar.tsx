import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Card, EmptyState } from '../../src/components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useAdjustQuantity, useInventoryItems } from '../../src/features/inventory/hooks';
import { formatDate } from '../../src/lib/format';
import { radius, spacing, typography } from '../../src/lib/theme';
import { useAppTheme, useThemedStyles } from '../../src/lib/theme-context';

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
  const adjust = useAdjustQuantity();
  const [search, setSearch] = useState('');

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
          const low = item.min_quantity != null && item.quantity <= item.min_quantity;
          const expiringSoon =
            item.expires_on && new Date(item.expires_on).getTime() - Date.now() < 7 * 86_400_000;

          return (
            <Card style={styles.itemCard}>
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

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(1).replace('.', ',');
}
