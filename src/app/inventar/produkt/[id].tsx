import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Segmented';
import { ErrorState, LoadingState, Screen } from '../../../components/Screen';
import { TextField } from '../../../components/TextField';
import {
  useAdjustQuantity,
  useInventoryTotals,
  useItemsForProduct,
  useLocations,
  useMoveItem,
  useSetRestockThreshold,
  useUpdateProduct,
} from '../../../features/inventory/hooks';
import { formatDate } from '../../../lib/format';
import { radius, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';

const THRESHOLD_CHOICES = [0, 1, 2, 3, 5];

/**
 * One product: where its stock sits, and whether it is a staple.
 *
 * The staple threshold lives here rather than on a lot because
 * inventory_adjust() deletes a lot the moment it empties — which is exactly
 * when "wir brauchen Klopapier" needs to still be known. See migration 0015.
 */
export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    hero: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: c.surfaceMuted },
    thumbPlaceholder: { alignItems: 'center' as const, justifyContent: 'center' as const },
    heroText: { flex: 1, gap: 2 },
    name: { ...typography.title, color: c.text },
    meta: { ...typography.caption, color: c.textMuted },
    total: { ...typography.display, fontSize: 28, color: c.text },
    sectionTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginLeft: spacing.xs,
    },
    card: { gap: spacing.md },
    switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    switchText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.bodyStrong, color: c.text },
    rowHint: { ...typography.caption, color: c.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    lowBanner: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      backgroundColor: c.dueTodaySoft,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    lowText: { ...typography.caption, color: c.dueToday, flex: 1 },
    lotRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    lotText: { flex: 1, gap: 2 },
    lotName: { ...typography.body, color: c.text },
    lotMeta: { ...typography.caption, color: c.textFaint },
    lotQuantity: { ...typography.bodyStrong, color: c.text },
    divider: { height: 1, backgroundColor: c.border },
    empty: { ...typography.caption, color: c.textMuted },
    editActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
    movePicker: { gap: spacing.sm, paddingBottom: spacing.md },
  }));

  const { data: totals, isLoading, error } = useInventoryTotals();
  const { data: lots } = useItemsForProduct(id);
  const { data: locations } = useLocations();
  const setThreshold = useSetRestockThreshold();
  const updateProduct = useUpdateProduct();
  const moveItem = useMoveItem();
  const adjust = useAdjustQuantity();

  const product = useMemo(() => totals?.find((t) => t.product_id === id), [totals, id]);

  // Mirrors the server value but is editable before it round-trips, so the
  // chips do not jump back to the old choice for a frame after every tap.
  const [pendingThreshold, setPendingThreshold] = useState<number | null>(null);
  const threshold = pendingThreshold ?? product?.restock_min_quantity ?? null;
  const tracked = threshold !== null;

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftBrand, setDraftBrand] = useState('');
  /** Which lot's location picker is open; null = none. */
  const [movingLot, setMovingLot] = useState<string | null>(null);
  /** How much of the open lot to move. Empty means all of it. */
  const [moveAmount, setMoveAmount] = useState('');

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!product) return <ErrorState error={new Error('Produkt nicht gefunden')} />;

  // Only one picker is open at a time, so the amount can live in a single
  // piece of state instead of one per row.
  const openLot = (lots ?? []).find((lot) => lot.id === movingLot) ?? null;
  const wholeLot = moveAmount.trim().length === 0;
  const amount = wholeLot ? (openLot?.quantity ?? 0) : Number(moveAmount.replace(',', '.'));
  const amountValid = !!openLot && Number.isFinite(amount) && amount > 0 && amount <= openLot.quantity;
  const partial = amountValid && !!openLot && amount < openLot.quantity;

  function toggleLot(lotId: string, quantity: number) {
    const opening = movingLot !== lotId;
    setMovingLot(opening ? lotId : null);
    // Prefill with the whole lot so the common case is one tap, and so the
    // field doubles as a reminder of how much is actually there.
    setMoveAmount(opening && quantity > 1 ? formatQuantity(quantity) : '');
  }

  function submitMove(lotId: string, locationId: string | null) {
    if (!amountValid) return;
    void moveItem.mutateAsync({ itemId: lotId, locationId, quantity: partial ? amount : null });
    setMovingLot(null);
    setMoveAmount('');
  }

  function applyThreshold(next: number | null) {
    setPendingThreshold(next);
    void setThreshold.mutateAsync({ productId: id, threshold: next });
  }

  function startEditing() {
    setDraftName(product?.name ?? '');
    setDraftBrand(product?.brand ?? '');
    setEditing(true);
  }

  async function saveEdits() {
    await updateProduct.mutateAsync({
      productId: id,
      patch: { name: draftName.trim(), brand: draftBrand.trim() || null },
    });
    setEditing(false);
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: product.name }} />

      <ScrollView contentContainerStyle={styles.content}>
        {editing ? (
          <Card style={styles.card}>
            <TextField label="Produkt" value={draftName} onChangeText={setDraftName} autoFocus />
            <TextField
              label="Marke (optional)"
              value={draftBrand}
              onChangeText={setDraftBrand}
              placeholder="z. B. Aldi"
            />
            <View style={styles.editActions}>
              <Button
                label="Abbrechen"
                variant="secondary"
                onPress={() => setEditing(false)}
                style={styles.flex}
              />
              <Button
                label="Speichern"
                onPress={() => void saveEdits()}
                disabled={draftName.trim().length === 0}
                loading={updateProduct.isPending}
                style={styles.flex}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.hero} onPress={startEditing}>
            {product.image_url ? (
              <Image source={{ uri: product.image_url }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="cube-outline" size={24} color={colors.textFaint} />
              </View>
            )}
            <View style={styles.heroText}>
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.meta}>
                {[product.brand, product.barcode].filter(Boolean).join(' · ') || 'Ohne Marke'}
              </Text>
            </View>
            <Text style={styles.total}>{formatQuantity(product.total_quantity)}</Text>
            <Ionicons name="create-outline" size={18} color={colors.textFaint} />
          </Card>
        )}

        {product.is_low ? (
          <View style={styles.lowBanner}>
            <Ionicons name="cart" size={16} color={colors.dueToday} />
            <Text style={styles.lowText}>
              {product.total_quantity <= 0
                ? 'Nichts mehr da — steht auf der Nachkauf-Liste.'
                : `Nur noch ${formatQuantity(product.total_quantity)} übrig — steht auf der Nachkauf-Liste.`}
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Regelmäßiger Bedarf</Text>
        <Card style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>Nachkauf-Erinnerung</Text>
              <Text style={styles.rowHint}>
                Ihr bekommt beide eine Erinnerung, sobald der Bestand die Grenze erreicht.
              </Text>
            </View>
            <Switch
              value={tracked}
              onValueChange={(on) => applyThreshold(on ? 1 : null)}
              trackColor={{ true: colors.primary }}
            />
          </View>

          {tracked ? (
            <>
              <View style={styles.divider} />
              <View style={styles.switchText}>
                <Text style={styles.rowTitle}>Erinnern ab</Text>
                <Text style={styles.rowHint}>
                  {threshold === 0
                    ? 'Erst wenn gar nichts mehr da ist.'
                    : `Wenn ${formatQuantity(threshold ?? 0)} oder weniger übrig sind.`}
                </Text>
              </View>
              <View style={styles.chipRow}>
                {THRESHOLD_CHOICES.map((choice) => (
                  <Chip
                    key={choice}
                    label={choice === 0 ? 'Leer' : `≤ ${choice}`}
                    active={threshold === choice}
                    onPress={() => applyThreshold(choice)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </Card>

        <Text style={styles.sectionTitle}>Bestand</Text>
        <Card style={styles.card}>
          {(lots ?? []).length === 0 ? (
            <Text style={styles.empty}>
              Aktuell nichts auf Lager. Der Eintrag bleibt bestehen, damit Scannen und Tippen
              weiterhin denselben Artikel treffen.
            </Text>
          ) : (
            (lots ?? []).map((lot, index) => (
              <View key={lot.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  onPress={() => toggleLot(lot.id, lot.quantity)}
                  style={styles.lotRow}
                  accessibilityRole="button"
                  accessibilityLabel="Ort ändern"
                >
                  <Ionicons name="location-outline" size={16} color={colors.textFaint} />
                  <View style={styles.lotText}>
                    <Text style={styles.lotName}>{lot.storage_locations?.name ?? 'Ohne Ort'}</Text>
                    {lot.expires_on ? (
                      <Text style={styles.lotMeta}>MHD {formatDate(lot.expires_on)}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.lotQuantity}>
                    {formatQuantity(lot.quantity)} {lot.unit}
                  </Text>
                  <Ionicons
                    name={movingLot === lot.id ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textFaint}
                  />
                </Pressable>

                {movingLot === lot.id ? (
                  <View style={styles.movePicker}>
                    {lot.quantity > 1 ? (
                      <TextField
                        label="Menge"
                        value={moveAmount}
                        onChangeText={setMoveAmount}
                        keyboardType="decimal-pad"
                        selectTextOnFocus
                        hint={`von ${formatQuantity(lot.quantity)} an diesem Ort`}
                        error={
                          amountValid ? null : `Bitte 1 bis ${formatQuantity(lot.quantity)} eingeben.`
                        }
                      />
                    ) : null}
                    <Text style={styles.rowHint}>
                      {partial
                        ? `${formatQuantity(amount)} verschieben nach`
                        : 'Alles verschieben nach'}
                    </Text>
                    <View style={styles.chipRow}>
                      <Chip
                        label="Ohne Ort"
                        active={!lot.location_id}
                        disabled={!amountValid}
                        onPress={() => submitMove(lot.id, null)}
                      />
                      {(locations ?? []).map((location) => (
                        <Chip
                          key={location.id}
                          label={location.path}
                          active={lot.location_id === location.id}
                          disabled={!amountValid}
                          onPress={() => submitMove(lot.id, location.id)}
                        />
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </Card>

        <Button
          label="Eins hinzufügen"
          variant="secondary"
          onPress={() => {
            const target = (lots ?? [])[0];
            if (target) void adjust.mutateAsync({ itemId: target.id, delta: 1 });
          }}
          disabled={(lots ?? []).length === 0}
        />
      </ScrollView>
    </Screen>
  );
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(1).replace('.', ',');
}
