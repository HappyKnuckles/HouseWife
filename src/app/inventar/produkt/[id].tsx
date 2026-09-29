import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ScrollView,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
// Gesture-handler's Pressable, not React Native's — see the comment in
// components/Card.tsx. The lot rows sit inside a SwipeRow.
import { Pressable } from 'react-native-gesture-handler';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, Segmented } from '../../../components/Segmented';
import { ErrorState, LoadingState, Screen } from '../../../components/Screen';
import { SwipeRow, useSwipeRowGroup, type SwipeRowGroup } from '../../../components/SwipeRow';
import { TextField } from '../../../components/TextField';
import type { InventoryItemWithRefs } from '../../../features/inventory/api';
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
  useUpdateItem,
  useUpdateProduct,
} from '../../../features/inventory/hooks';
import type { ProductKind, ProductUnit } from '../../../lib/database.types';
import { Alert } from '../../../lib/alert';
import { errorMessage } from '../../../lib/errors';
import {
  EXPIRY_CHOICES,
  UNIT_OPTIONS,
  countedInPacks,
  formatDate,
  formatQuantity,
  formatQuantityWithUnit,
  parseGermanDate,
  parseQuantity,
  shiftDays,
  todayIso,
  unitLabel,
} from '../../../lib/format';
import { radius, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';
import { usePressDim } from '../../../lib/usePressDim';

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
    totalWrap: { alignItems: 'flex-end' as const, gap: 2 },
    totalMeta: { ...typography.caption, color: c.textMuted },
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
    lotRowPressed: { opacity: 0.7 },
    lotText: { flex: 1, gap: 2 },
    lotName: { ...typography.body, color: c.text },
    lotMeta: { ...typography.caption, color: c.textFaint },
    lotWarning: { ...typography.caption, color: c.warning },
    lotOk: { ...typography.caption, color: c.success },
    lotQuantity: { ...typography.bodyStrong, color: c.text },
    divider: { height: 1, backgroundColor: c.border },
    empty: { ...typography.caption, color: c.textMuted },
    unitWarning: { ...typography.caption, color: c.warning },
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
  const updateItem = useUpdateItem();
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
  const totalWeightGrams =
    !equipment && product?.net_quantity ? product.total_quantity * product.net_quantity : null;
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
  const [draftUnit, setDraftUnit] = useState<ProductUnit>('piece');
  /** Grams per Packung, as typed. Empty means "nicht hinterlegt". */
  const [draftWeight, setDraftWeight] = useState('');
  /** Which lot's panel is open; null = none. */
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  /** How much of the open lot to move. Empty means all of it. */
  const [moveAmount, setMoveAmount] = useState('');
  /** The exact-stock field, for amounts the quick chips do not cover. */
  const [exactAmount, setExactAmount] = useState('');
  /** The open lot's MHD as typed, German-style. Empty means "kein MHD". */
  const [expiryDraft, setExpiryDraft] = useState('');

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

  // Empty is a real answer ("kein Gewicht hinterlegt"); only a number that
  // cannot be read, or one that is not positive, holds the save.
  const parsedWeight = parseQuantity(draftWeight);
  const weightInvalid =
    draftWeight.trim().length > 0 && (parsedWeight === null || parsedWeight <= 0);

  // An empty field is "kein MHD", a perfectly normal answer — only text that
  // cannot be read as a date holds the save. Same rule as the Anlegen-Screen.
  const expiryIso = expiryDraft.trim() ? parseGermanDate(expiryDraft) : null;
  const expiryInvalid = expiryDraft.trim().length > 0 && expiryIso === null;
  const expiryChanged = !!openLot && expiryIso !== openLot.expires_on;
  /**
   * A lot is keyed by product, Ort *and* MHD, so moving one lot's date onto
   * another's would collide on inventory_items_lot_unique. Every lot is loaded
   * here, so the clash can be named before the write instead of coming back as
   * a raw Postgres 23505.
   */
  const expiryTaken =
    expiryChanged &&
    (lots ?? []).some(
      (lot) =>
        lot.id !== openLot?.id &&
        lot.location_id === openLot?.location_id &&
        lot.expires_on === expiryIso,
    );

  function togglePanel(lotId: string, quantity: number) {
    const opening = openPanel !== lotId;
    setOpenPanel(opening ? lotId : null);
    // Prefill with the whole lot so the common case is one tap, and so the
    // field doubles as a reminder of how much is actually there.
    setMoveAmount(opening && quantity > 1 ? formatQuantity(quantity) : '');
    setExactAmount(opening ? formatQuantity(quantity) : '');
    const lot = (lots ?? []).find((l) => l.id === lotId);
    setExpiryDraft(opening && lot?.expires_on ? formatDate(lot.expires_on) : '');
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

  /**
   * The exact count, with "angebrochen" kept honest by the same rule
   * setOpenFraction() writes: the fractional part *is* the pack that is open,
   * so a number without one says there is no open pack any more. Counting 1,5
   * back up to 2 is zwei volle Packungen, not "zwei, davon eine offen" — the
   * flag has to go with the fraction that justified it.
   *
   * Only where a fraction carries that meaning. In g or ml the amount is just
   * the amount: 250 says nothing about whether die Tüte offen ist, so there the
   * flag is left exactly as it was rather than guessed at.
   */
  function applyExact(lotId: string, unit: string) {
    const value = parseQuantity(exactAmount);
    if (value === null || value < 0) return;
    void setQuantity.mutateAsync({
      itemId: lotId,
      quantity: value,
      opened: countedInPacks(unit) ? !Number.isInteger(value) : undefined,
    });
    setOpenPanel(null);
  }

  /**
   * Corrects a lot's MHD — the date typed a month out, or the one that was
   * never entered at all.
   *
   * A plain UPDATE rather than an RPC, so unlike a move nothing merges: the
   * collision is caught by expiryTaken above and the button stays disabled.
   * The 23505 here is only the race — another phone writing that date first.
   */
  async function applyExpiry(lotId: string) {
    if (expiryInvalid || expiryTaken || !expiryChanged) return;
    try {
      await updateItem.mutateAsync({ itemId: lotId, patch: { expires_on: expiryIso } });
      setOpenPanel(null);
    } catch (err) {
      Alert.alert(
        'MHD konnte nicht geändert werden',
        (err as { code?: string })?.code === '23505'
          ? 'An diesem Ort gibt es schon einen Bestand mit diesem MHD. Verschieb den Bestand dorthin, statt das Datum zu ändern.'
          : errorMessage(err),
      );
    }
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
    setDraftUnit(product?.unit ?? 'piece');
    setDraftWeight(product?.net_quantity ? formatQuantity(product.net_quantity) : '');
    setEditing(true);
  }

  async function saveEdits() {
    if (weightInvalid) return;
    await updateProduct.mutateAsync({
      productId: id,
      patch: {
        name: draftName.trim(),
        brand: draftBrand.trim() || null,
        category: draftCategory.trim() || null,
        // Ausstattung is counted in Stück and weighs nothing worth recording —
        // the same rule the Anlegen-Screen applies, so switching Art there and
        // correcting the unit here cannot end up disagreeing.
        unit: equipment ? 'piece' : draftUnit,
        // Unlike on the Anlegen-Screen, an empty field here *is* a deliberate
        // erasure: it was prefilled with whatever was stored, so clearing it
        // means "das Gewicht stimmt nicht mehr", not "nicht angegeben".
        net_quantity: equipment || parsedWeight === null ? null : parsedWeight,
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

            {/* Ausstattung wird in Stück gezählt und nicht gewogen. */}
            {equipment ? null : (
              <>
                <Text style={styles.rowHint}>Einheit</Text>
                <View style={styles.chipRow}>
                  {UNIT_OPTIONS.map((option) => (
                    <Chip
                      key={option.value}
                      label={option.label}
                      active={draftUnit === option.value}
                      onPress={() => setDraftUnit(option.value)}
                    />
                  ))}
                </View>
                {/* Nothing converts the stored numbers — a lot sitting at 500
                    stays at 500, it is only read as kg instead of g afterwards.
                    Converting would be the wrong guess as often as the right
                    one (the unit is usually wrong *because* the number was
                    entered for the intended unit all along), so this says what
                    will happen rather than deciding it for them. */}
                {draftUnit !== product.unit ? (
                  <Text style={styles.unitWarning}>
                    Nur die Einheit ändert sich, die Zahlen bleiben stehen: aus{' '}
                    {formatQuantityWithUnit(product.total_quantity, product.unit)} wird{' '}
                    {formatQuantityWithUnit(product.total_quantity, draftUnit)}.
                  </Text>
                ) : null}

                <TextField
                  label="Gewicht pro Packung (g, optional)"
                  value={draftWeight}
                  onChangeText={setDraftWeight}
                  keyboardType="decimal-pad"
                  error={weightInvalid ? 'Bitte eine Zahl größer als 0 eingeben.' : null}
                  hint={
                    parsedWeight && !weightInvalid
                      ? `${formatQuantity(product.total_quantity)} × ${formatQuantity(parsedWeight)} g = ${formatQuantity(product.total_quantity * parsedWeight)} g gesamt.`
                      : 'Leer lassen heißt: kein Gesamtgewicht ausrechnen.'
                  }
                />
              </>
            )}

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
                disabled={draftName.trim().length === 0 || weightInvalid}
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
            <View style={styles.totalWrap}>
              <Text style={styles.total}>{formatQuantity(product.total_quantity)}</Text>
              {totalWeightGrams !== null ? (
                <Text style={styles.totalMeta}>{formatQuantity(totalWeightGrams)} g gesamt</Text>
              ) : null}
            </View>
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
                <LotRowHeader
                  lot={lot}
                  equipment={equipment}
                  misplaced={misplacedLots.has(lot.id)}
                  atHome={!!home}
                  homePath={homePath}
                  expanded={openPanel === lot.id}
                  swipeGroup={lotSwipeGroup}
                  styles={styles}
                  onToggle={() => togglePanel(lot.id, lot.quantity)}
                  onDelete={() => confirmDeleteLot(lot)}
                />

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
                          onSubmitEditing={() => applyExact(lot.id, lot.unit)}
                          error={exactValid ? null : 'Bitte eine Menge eingeben.'}
                        />
                      </View>
                      <Button
                        label="Übernehmen"
                        variant="secondary"
                        onPress={() => applyExact(lot.id, lot.unit)}
                        disabled={!exactValid || exact === lot.quantity}
                        loading={setQuantity.isPending}
                      />
                    </View>

                    {/* Eine Bohrmaschine hat kein MHD. */}
                    {equipment ? null : (
                      <>
                        <View style={styles.inline}>
                          <View style={styles.flex}>
                            <TextField
                              label="MHD"
                              value={expiryDraft}
                              onChangeText={setExpiryDraft}
                              placeholder="TT.MM.JJJJ"
                              keyboardType="numbers-and-punctuation"
                              returnKeyType="done"
                              onSubmitEditing={() => void applyExpiry(lot.id)}
                              error={
                                expiryInvalid
                                  ? 'Bitte als TT.MM.JJJJ eingeben.'
                                  : expiryTaken
                                    ? 'An diesem Ort gibt es dafür schon einen Bestand.'
                                    : null
                              }
                            />
                          </View>
                          <Button
                            label="Übernehmen"
                            variant="secondary"
                            onPress={() => void applyExpiry(lot.id)}
                            disabled={!expiryChanged || expiryInvalid || expiryTaken}
                            loading={updateItem.isPending}
                          />
                        </View>
                        <View style={styles.chipRow}>
                          {EXPIRY_CHOICES.map((choice) => (
                            <Chip
                              key={choice.days}
                              label={choice.label}
                              active={!!expiryIso && expiryIso === shiftDays(todayIso(), choice.days)}
                              onPress={() =>
                                setExpiryDraft(formatDate(shiftDays(todayIso(), choice.days)))
                              }
                            />
                          ))}
                          {expiryDraft.trim() ? (
                            <Chip label="Kein MHD" onPress={() => setExpiryDraft('')} />
                          ) : null}
                        </View>
                        {/* Below the chips rather than as the field's `hint`:
                            styles.inline aligns on flex-end, so a third line
                            inside the TextField pushes Übernehmen down past the
                            input it belongs to. */}
                        <Text style={styles.rowHint}>Leer lassen heißt: kein MHD.</Text>
                      </>
                    )}

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

interface LotRowStyles {
  lotRow: StyleProp<ViewStyle>;
  lotRowPressed: StyleProp<ViewStyle>;
  lotText: StyleProp<ViewStyle>;
  lotName: StyleProp<TextStyle>;
  lotWarning: StyleProp<TextStyle>;
  lotOk: StyleProp<TextStyle>;
  lotMeta: StyleProp<TextStyle>;
  lotQuantity: StyleProp<TextStyle>;
}

/**
 * Its own component, not inline in the `.map()` above: the delayed
 * press-dim below needs `usePressDim()`, which only gets its own slot of
 * state when called from a real per-row component instance — see the same
 * note on TodoRow in todos.tsx.
 */
function LotRowHeader({
  lot,
  equipment,
  misplaced,
  atHome,
  homePath,
  expanded,
  swipeGroup,
  styles,
  onToggle,
  onDelete,
}: {
  lot: InventoryItemWithRefs;
  equipment: boolean;
  misplaced: boolean;
  atHome: boolean;
  homePath: string | null;
  expanded: boolean;
  swipeGroup: SwipeRowGroup;
  styles: LotRowStyles;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { colors } = useAppTheme();
  // Not Pressable's own `pressed` render-prop: this row sits inside a
  // SwipeRow, and that fires the instant a finger lands — including the
  // first moment of a swipe drag — see the comment on usePressDim.
  const rowPress = usePressDim();

  return (
    <SwipeRow
      id={lot.id}
      group={swipeGroup}
      rightActions={[
        {
          key: 'delete',
          icon: 'trash-outline',
          label: 'Entfernen',
          tone: 'danger',
          accessibilityLabel: `${lot.storage_locations?.name ?? 'Eintrag'} entfernen`,
          onPress: onDelete,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        onPressIn={rowPress.onPressIn}
        onPressOut={rowPress.onPressOut}
        style={[styles.lotRow, rowPress.pressed && styles.lotRowPressed]}
        accessibilityRole="button"
        accessibilityLabel={equipment ? 'Ort ändern' : 'Menge und Ort ändern'}
      >
        <Ionicons
          name={misplaced ? 'alert-circle-outline' : 'location-outline'}
          size={16}
          color={misplaced ? colors.warning : colors.textFaint}
        />
        <View style={styles.lotText}>
          <Text style={styles.lotName}>{lot.storage_locations?.name ?? 'Ohne Ort'}</Text>
          {equipment ? (
            misplaced ? (
              <Text style={styles.lotWarning}>Gehört: {homePath}</Text>
            ) : atHome ? (
              <Text style={styles.lotOk}>Am Platz</Text>
            ) : null
          ) : lot.opened_at || lot.expires_on ? (
            <Text style={styles.lotMeta}>
              {[lot.opened_at ? 'angebrochen' : null, lot.expires_on ? `MHD ${formatDate(lot.expires_on)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
        </View>
        <Text style={styles.lotQuantity}>{formatQuantityWithUnit(lot.quantity, lot.unit)}</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textFaint} />
      </Pressable>
    </SwipeRow>
  );
}
