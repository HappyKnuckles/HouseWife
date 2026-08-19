import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
// Gesture-handler's Pressable, not React Native's — see the comment in
// components/Card.tsx. The lot rows sit inside a SwipeRow.
import { Pressable } from 'react-native-gesture-handler';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, Segmented } from '../../../components/Segmented';
import { ErrorState, LoadingState, Screen } from '../../../components/Screen';
import { SwipeRow, useSwipeRowGroup } from '../../../components/SwipeRow';
import { TextField } from '../../../components/TextField';
import {
  useAdjustQuantity,
  useDeleteItem,
  useDeleteProduct,
  useInventoryTotals,
  useItemsForProduct,
  useLocations,
  useMoveItem,
  useProductCategories,
  useSetDefaultLocation,
  useSetProductKind,
  useSetQuantity,
  useSetRestockThreshold,
  useUpdateProduct,
} from '../../../features/inventory/hooks';
import type { ProductKind } from '../../../lib/database.types';
import { Alert } from '../../../lib/alert';
import { errorMessage } from '../../../lib/errors';
import {
  formatDate,
  formatQuantity,
  formatQuantityWithUnit,
  parseQuantity,
  unitLabel,
} from '../../../lib/format';
import { radius, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';

/**
 * Thresholds worth one tap. The fractions are the point of the list: with whole
 * packs only, "erinnere mich, wenn nur noch eine da ist" fires while a sealed
 * pack is still in the cupboard, and waiting for zero fires too late.
 */
const THRESHOLD_CHOICES = [0, 0.25, 0.5, 1, 2, 3];

/** How much of the opened pack is left. 0 = it is used up, the rest stay. */
const OPEN_FRACTIONS = [0.75, 0.5, 0.25, 0];

const KIND_OPTIONS: { value: ProductKind; label: string }[] = [
  { value: 'consumable', label: 'Vorrat' },
  { value: 'equipment', label: 'Ausstattung' },
];

/**
 * One product: where its stock sits, and whether it is a staple.
 *
 * The staple threshold lives here rather than on a lot because
 * inventory_adjust() deletes a lot the moment it empties — which is exactly
 * when "wir brauchen Klopapier" needs to still be known. See migration 0015.
 */
export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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
    lotWarning: { ...typography.caption, color: c.warning },
    lotOk: { ...typography.caption, color: c.success },
    lotQuantity: { ...typography.bodyStrong, color: c.text },
    divider: { height: 1, backgroundColor: c.border },
    empty: { ...typography.caption, color: c.textMuted },
    editActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
    panel: { gap: spacing.md, paddingBottom: spacing.md },
    panelLabel: { ...typography.captionStrong, color: c.textMuted },
    inline: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: spacing.sm },
  }));

  const { data: totals, isLoading, error } = useInventoryTotals();
  const { data: lots } = useItemsForProduct(id);
  const { data: locations } = useLocations();
  const setThreshold = useSetRestockThreshold();
  const setKind = useSetProductKind();
  const setDefaultLocation = useSetDefaultLocation();
  const updateProduct = useUpdateProduct();
  const moveItem = useMoveItem();
  const setQuantity = useSetQuantity();
  const adjust = useAdjustQuantity();
  const deleteProduct = useDeleteProduct();
  const deleteItem = useDeleteItem();
  const lotSwipeGroup = useSwipeRowGroup();
  const { data: categories } = useProductCategories();

  const product = useMemo(() => totals?.find((t) => t.product_id === id), [totals, id]);

  // Mirrors the server value but is editable before it round-trips, so the
  // chips do not jump back to the old choice for a frame after every tap.
  const [pendingThreshold, setPendingThreshold] = useState<number | null>(null);
  const threshold = pendingThreshold ?? product?.restock_min_quantity ?? null;
  const tracked = threshold !== null;
  /** Same optimistic trick for the Vorrat/Ausstattung switch. */
  const [pendingKind, setPendingKind] = useState<ProductKind | null>(null);
  const kind = pendingKind ?? product?.kind ?? 'consumable';
  const equipment = kind === 'equipment';
  /**
   * The fester Platz, same trick again — but `null` is a real choice here
   * ("noch keiner"), so `undefined` has to carry "no local override" instead.
   */
  const [pendingHome, setPendingHome] = useState<string | null | undefined>(undefined);
  /** Free-text threshold, for the ones no chip covers ("≤ 250 g"). */
  const [thresholdDraft, setThresholdDraft] = useState('');

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftBrand, setDraftBrand] = useState('');
  const [draftCategory, setDraftCategory] = useState('');
  /** Which lot's panel is open; null = none. */
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  /** How much of the open lot to move. Empty means all of it. */
  const [moveAmount, setMoveAmount] = useState('');
  /** The exact-stock field, for amounts the quick chips do not cover. */
  const [exactAmount, setExactAmount] = useState('');

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!product) return <ErrorState error={new Error('Produkt nicht gefunden')} />;

  const home = pendingHome !== undefined ? pendingHome : product.default_location_id;
  const homePath = home ? ((locations ?? []).find((l) => l.id === home)?.path ?? null) : null;
  // Which lots are sitting somewhere other than the fester Platz. A set rather
  // than a per-row expression only so the row below keeps a concise body — it
  // asks the question four times.
  //
  // Keyed off homePath rather than home so nothing is flagged until the Orte
  // have loaded: every label here names the place it belongs, and there is no
  // honest wording for "somewhere I cannot name yet".
  const misplacedLots = new Set(
    equipment && homePath
      ? (lots ?? []).filter((lot) => lot.location_id !== home).map((lot) => lot.id)
      : [],
  );

  // Only one panel is open at a time, so its drafts can live in a single piece
  // of state instead of one per row.
  const openLot = (lots ?? []).find((lot) => lot.id === openPanel) ?? null;
  const wholeLot = moveAmount.trim().length === 0;
  const amount = wholeLot ? (openLot?.quantity ?? 0) : (parseQuantity(moveAmount) ?? NaN);
  const amountValid = !!openLot && Number.isFinite(amount) && amount > 0 && amount <= openLot.quantity;
  const partial = amountValid && !!openLot && amount < openLot.quantity;

  const exact = parseQuantity(exactAmount);
  const exactValid = exact !== null && exact >= 0;

  function togglePanel(lotId: string, quantity: number) {
    const opening = openPanel !== lotId;
    setOpenPanel(opening ? lotId : null);
    // Prefill with the whole lot so the common case is one tap, and so the
    // field doubles as a reminder of how much is actually there.
    setMoveAmount(opening && quantity > 1 ? formatQuantity(quantity) : '');
    setExactAmount(opening ? formatQuantity(quantity) : '');
  }

  function submitMove(lotId: string, locationId: string | null) {
    if (!amountValid) return;
    void moveItem.mutateAsync({ itemId: lotId, locationId, quantity: partial ? amount : null });
    setOpenPanel(null);
    setMoveAmount('');
  }

  /**
   * "Von der offenen Packung ist noch ½ übrig."
   *
   * The sealed packs beside it are whatever was there minus the one that is
   * open — ceil() rather than floor() so the arithmetic is idempotent: a lot
   * already sitting at 1,5 that gets tapped ½ again stays at 1,5 instead of
   * quietly losing a pack each time.
   */
  function setOpenFraction(lotId: string, quantity: number, fraction: number) {
    const sealed = Math.max(Math.ceil(quantity) - 1, 0);
    void setQuantity.mutateAsync({
      itemId: lotId,
      quantity: sealed + fraction,
      opened: fraction > 0,
    });
    setExactAmount(formatQuantity(sealed + fraction));
  }

  function applyExact(lotId: string) {
    const value = parseQuantity(exactAmount);
    if (value === null || value < 0) return;
    void setQuantity.mutateAsync({ itemId: lotId, quantity: value });
    setOpenPanel(null);
  }

  function applyThreshold(next: number | null) {
    setPendingThreshold(next);
    setThresholdDraft('');
    void setThreshold.mutateAsync({ productId: id, threshold: next });
  }

  /**
   * Switching to Ausstattung clears the threshold server-side — the CHECK
   * constraint leaves it no choice. Dropping the local override here hands the
   * display back to the refetched server value instead of leaving a stale "≤ 2"
   * to reappear if they switch straight back.
   */
  function applyKind(next: ProductKind) {
    setPendingKind(next);
    if (next === 'equipment') setPendingThreshold(null);
    void setKind.mutateAsync({ productId: id, kind: next });
  }

  function applyHome(locationId: string | null) {
    setPendingHome(locationId);
    void setDefaultLocation.mutateAsync({ productId: id, locationId });
  }

  function applyThresholdDraft() {
    const value = parseQuantity(thresholdDraft);
    if (value === null || value < 0) return;
    setPendingThreshold(value);
    void setThreshold.mutateAsync({ productId: id, threshold: value });
  }

  function startEditing() {
    setDraftName(product?.name ?? '');
    setDraftBrand(product?.brand ?? '');
    setDraftCategory(product?.category ?? '');
    setEditing(true);
  }

  async function saveEdits() {
    await updateProduct.mutateAsync({
      productId: id,
      patch: {
        name: draftName.trim(),
        brand: draftBrand.trim() || null,
        category: draftCategory.trim() || null,
      },
    });
    setEditing(false);
  }

  function confirmDeleteProduct() {
    Alert.alert(
      `${product?.name} endgültig löschen?`,
      'Der Bestand an allen Orten wird entfernt und der Katalogeintrag verschwindet aus dem Inventar. Das lässt sich nicht rückgängig machen.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProduct.mutateAsync(id);
              router.back();
            } catch (err) {
              Alert.alert('Konnte nicht gelöscht werden', errorMessage(err));
            }
          },
        },
      ],
    );
  }

  /**
   * Removes one lot outright — this location's stock of the product, gone —
   * rather than counting it down to zero. Zeroing deliberately keeps the
   * row (a sealed pack you know is coming, an empty shelf that still marks
   * "this is where it lives"); this is for the row that should not exist at
   * all, a duplicate scan or a place it never actually sat. The product and
   * every other lot are untouched.
   */
  function confirmDeleteLot(lot: { id: string; location_id: string | null; quantity: number }) {
    const where = lot.location_id
      ? ((locations ?? []).find((l) => l.id === lot.location_id)?.path ?? 'diesem Ort')
      : 'ohne Ort';

    Alert.alert(
      `${product?.name} ${equipment ? 'entfernen' : `bei ${where} entfernen`}?`,
      equipment
        ? `Entfernt den Eintrag bei ${where}. Der Katalogeintrag und der feste Platz bleiben erhalten.`
        : 'Nur dieser Posten — der Rest des Bestands bleibt unangetastet.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteItem.mutateAsync(lot.id);
            } catch (err) {
              Alert.alert('Konnte nicht entfernt werden', errorMessage(err));
            }
          },
        },
      ],
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: product.name }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? (
          <Card style={styles.card}>
            <TextField label="Produkt" value={draftName} onChangeText={setDraftName} autoFocus />
            <TextField
              label="Marke (optional)"
              value={draftBrand}
              onChangeText={setDraftBrand}
              placeholder="z. B. Aldi"
            />

            <Text style={styles.rowHint}>Kategorie</Text>
            <View style={styles.chipRow}>
              {(categories ?? []).map((option) => (
                <Chip
                  key={option}
                  label={option}
                  active={draftCategory.trim() === option}
                  // Tapping the active chip clears it — a category is optional.
                  onPress={() => setDraftCategory((prev) => (prev === option ? '' : option))}
                />
              ))}
            </View>
            <TextField
              value={draftCategory}
              onChangeText={setDraftCategory}
              placeholder="z. B. Backen"
              hint="Frei wählbar. Schon benutzte stehen oben als Chip."
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
                {[product.brand, product.category, product.barcode].filter(Boolean).join(' · ') ||
                  'Ohne Marke'}
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
                ? 'Nichts mehr da — steht auf der Einkaufsliste.'
                : `Nur noch ${formatQuantityWithUnit(product.total_quantity, product.unit)} übrig — steht auf der Einkaufsliste.`}
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Art</Text>
        <Card style={styles.card}>
          <Segmented options={KIND_OPTIONS} value={kind} onChange={applyKind} />
          <Text style={styles.rowHint}>
            {equipment
              ? 'Wird besessen, nicht verbraucht: kein Nachkauf, kein MHD — dafür ein fester Platz, an den es gehört.'
              : 'Wird aufgebraucht: Bestand zählt runter und kann automatisch auf der Einkaufsliste landen.'}
          </Text>
        </Card>

        {equipment ? (
          <>
            <Text style={styles.sectionTitle}>Fester Platz</Text>
            <Card style={styles.card}>
              <Text style={styles.rowHint}>
                {homePath
                  ? `Gehört nach ${homePath}. Liegt es woanders, zeigt das Inventar es an.`
                  : 'Noch kein Platz vereinbart. Ohne einen kann das Inventar nicht sagen, ob etwas verräumt wurde.'}
              </Text>
              <View style={styles.chipRow}>
                <Chip
                  label="Noch keiner"
                  active={!home}
                  onPress={() => applyHome(null)}
                />
                {(locations ?? []).map((location) => (
                  <Chip
                    key={location.id}
                    label={location.path}
                    active={home === location.id}
                    onPress={() => applyHome(location.id)}
                  />
                ))}
              </View>
            </Card>
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Regelmäßiger Bedarf</Text>
            <Card style={styles.card}>
              <View style={styles.switchRow}>
                <View style={styles.switchText}>
                  <Text style={styles.rowTitle}>Nachkauf-Erinnerung</Text>
                  <Text style={styles.rowHint}>
                    Landet automatisch auf der Einkaufsliste, sobald der Bestand die Grenze
                    erreicht.
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
                        : `Wenn ${formatQuantityWithUnit(threshold ?? 0, product.unit)} oder weniger übrig sind — eine angebrochene Packung zählt als Bruchteil.`}
                    </Text>
                  </View>
                  <View style={styles.chipRow}>
                    {THRESHOLD_CHOICES.map((choice) => (
                      <Chip
                        key={choice}
                        label={choice === 0 ? 'Leer' : `≤ ${formatQuantity(choice)}`}
                        active={threshold === choice}
                        onPress={() => applyThreshold(choice)}
                      />
                    ))}
                  </View>
                  <View style={styles.inline}>
                    <View style={styles.flex}>
                      <TextField
                        value={thresholdDraft}
                        onChangeText={setThresholdDraft}
                        placeholder={`Eigene Grenze in ${unitLabel(product.unit, 0)}`}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        onSubmitEditing={applyThresholdDraft}
                      />
                    </View>
                    <Button
                      label="Setzen"
                      variant="secondary"
                      onPress={applyThresholdDraft}
                      disabled={parseQuantity(thresholdDraft) === null}
                    />
                  </View>
                </>
              ) : null}
            </Card>
          </>
        )}

        <Text style={styles.sectionTitle}>{equipment ? 'Wo es liegt' : 'Bestand'}</Text>
        <Card style={styles.card}>
          {(lots ?? []).length === 0 ? (
            <Text style={styles.empty}>
              {equipment
                ? 'Gerade nirgends verbucht. Der Eintrag bleibt bestehen, damit der feste Platz nicht verloren geht.'
                : 'Aktuell nichts auf Lager. Der Eintrag bleibt bestehen, damit Scannen und Tippen weiterhin denselben Artikel treffen.'}
            </Text>
          ) : (
            (lots ?? []).map((lot, index) => (
              <View key={lot.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <SwipeRow
                  id={lot.id}
                  group={lotSwipeGroup}
                  rightActions={[
                    {
                      key: 'delete',
                      icon: 'trash-outline',
                      label: 'Entfernen',
                      tone: 'danger',
                      accessibilityLabel: `${lot.storage_locations?.name ?? 'Eintrag'} entfernen`,
                      onPress: () => confirmDeleteLot(lot),
                    },
                  ]}
                >
                  <Pressable
                    onPress={() => togglePanel(lot.id, lot.quantity)}
                    style={styles.lotRow}
                    accessibilityRole="button"
                    accessibilityLabel={equipment ? 'Ort ändern' : 'Menge und Ort ändern'}
                  >
                    <Ionicons
                      name={misplacedLots.has(lot.id) ? 'alert-circle-outline' : 'location-outline'}
                      size={16}
                      color={misplacedLots.has(lot.id) ? colors.warning : colors.textFaint}
                    />
                    <View style={styles.lotText}>
                      <Text style={styles.lotName}>{lot.storage_locations?.name ?? 'Ohne Ort'}</Text>
                      {equipment ? (
                        misplacedLots.has(lot.id) ? (
                          <Text style={styles.lotWarning}>Gehört: {homePath}</Text>
                        ) : home ? (
                          <Text style={styles.lotOk}>Am Platz</Text>
                        ) : null
                      ) : lot.opened_at || lot.expires_on ? (
                        <Text style={styles.lotMeta}>
                          {[
                            lot.opened_at ? 'angebrochen' : null,
                            lot.expires_on ? `MHD ${formatDate(lot.expires_on)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.lotQuantity}>
                      {formatQuantityWithUnit(lot.quantity, lot.unit)}
                    </Text>
                    <Ionicons
                      name={openPanel === lot.id ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textFaint}
                    />
                  </Pressable>
                </SwipeRow>

                {openPanel === lot.id ? (
                  <View style={styles.panel}>
                    {misplacedLots.has(lot.id) ? (
                      <Button
                        label={`Zurück an den Platz: ${homePath}`}
                        variant="secondary"
                        onPress={() => submitMove(lot.id, home)}
                        loading={moveItem.isPending}
                      />
                    ) : null}

                    {/* A Bohrmaschine is not angebrochen. */}
                    {equipment ? null : (
                      <>
                        <Text style={styles.panelLabel}>Angebrochen</Text>
                        <Text style={styles.rowHint}>
                          Wie viel ist von der offenen {unitLabel(lot.unit)} noch übrig? Der Rest des
                          Bestands bleibt, wie er ist.
                        </Text>
                        <View style={styles.chipRow}>
                          {OPEN_FRACTIONS.map((fraction) => (
                            <Chip
                              key={fraction}
                              label={
                                fraction === 0 ? 'aufgebraucht' : `noch ${formatQuantity(fraction)}`
                              }
                              onPress={() => setOpenFraction(lot.id, lot.quantity, fraction)}
                            />
                          ))}
                        </View>
                      </>
                    )}

                    <View style={styles.inline}>
                      <View style={styles.flex}>
                        <TextField
                          label={equipment ? 'Genaue Anzahl' : 'Genauer Bestand'}
                          value={exactAmount}
                          onChangeText={setExactAmount}
                          keyboardType="decimal-pad"
                          selectTextOnFocus
                          returnKeyType="done"
                          onSubmitEditing={() => applyExact(lot.id)}
                          error={exactValid ? null : 'Bitte eine Menge eingeben.'}
                        />
                      </View>
                      <Button
                        label="Übernehmen"
                        variant="secondary"
                        onPress={() => applyExact(lot.id)}
                        disabled={!exactValid || exact === lot.quantity}
                        loading={setQuantity.isPending}
                      />
                    </View>

                    <View style={styles.divider} />

                    {lot.quantity > 1 ? (
                      <TextField
                        label="Menge zum Verschieben"
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

        <Button
          label="Produkt endgültig löschen"
          variant="ghost"
          onPress={confirmDeleteProduct}
          loading={deleteProduct.isPending}
        />
      </ScrollView>
    </Screen>
  );
}
