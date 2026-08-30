import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Segmented';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import {
  useLocations,
  useProductSearch,
  useScanIn,
  useSetDefaultLocation,
  useSetQuantity,
} from '../../features/inventory/hooks';
import { Alert } from '../../lib/alert';
import type { ProductKind, ProductRow, ProductUnit } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import {
  formatDate,
  formatQuantity,
  parseGermanDate,
  parseQuantity,
  shiftDays,
  todayIso,
} from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

const UNIT_OPTIONS: { value: ProductUnit; label: string }[] = [
  { value: 'piece', label: 'Stück' },
  { value: 'pack', label: 'Packung' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l' },
];

/** How much is left in the pack that is already open. Same set as produkt/[id]. */
const OPEN_FRACTIONS = [0.25, 0.5, 0.75];

/** A MHD is months out far more often than days, so the chips skip "morgen". */
const EXPIRY_CHOICES: { label: string; days: number }[] = [
  { label: '1 Woche', days: 7 },
  { label: '1 Monat', days: 30 },
  { label: '3 Monate', days: 90 },
];

const toGerman = (iso: string) => formatDate(iso);

/**
 * Manual inventory entry — the way in for everything that is simply *there*.
 *
 * Not everything that lands in the Vorräte was an Einkauf: the half-used
 * bottle you are relabeling, the jar from the Wochenmarkt, what someone
 * brought over, what stood in the cupboard long before the app existed. None
 * of that should have to be faked as a shopping row and checked out to be
 * counted, so this screen books straight into the stock and never touches
 * Einkaufsliste or Ausgaben.
 *
 * Angebrochen is a first-class answer here rather than an afterthought. The
 * quantity column has been fractional since migration 0025, but a fraction
 * alone cannot tell "½ ist noch übrig" from "eine halbe Packung gekauft" —
 * opened_at does, and it is what makes a lot read as angebrochen everywhere
 * else. It is set in a second call because inventory_scan_in() has no
 * p_opened; passing back the amount that RPC just returned makes the delta
 * zero, and inventory_set_quantity() then writes the flag and returns without
 * logging a movement for stock that never moved.
 *
 * Goes through the same inventory_scan_in() RPC as the camera flow with
 * barcode left null, so it shares the product-catalog and stock-lot logic —
 * it just skips the two lookup steps.
 *
 * `?kind=equipment` switches it to adding Ausstattung: no unit, no MHD and no
 * angebrochen — a Bohrmaschine has none of the three — and the Ort doubles as
 * the fester Platz the thing is expected to be at.
 */
export default function ManualAddScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind: ProductKind = params.kind === 'equipment' ? 'equipment' : 'consumable';
  const equipment = kind === 'equipment';
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
    intro: { ...typography.caption, color: c.textMuted },
    label: { ...typography.captionStrong, color: c.textMuted },
    hint: { ...typography.caption, color: c.textFaint, marginTop: -spacing.xs },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    submit: { marginTop: spacing.md },
    suggestions: { padding: 0, overflow: 'hidden' as const },
    suggestion: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    suggestionText: { flex: 1, gap: 2 },
    suggestionName: { ...typography.body, color: c.text },
    suggestionMeta: { ...typography.caption, color: c.textFaint },
    divider: { height: 1, backgroundColor: c.border },
    matched: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      backgroundColor: c.successSoft,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    matchedText: { ...typography.caption, color: c.success, flex: 1 },
    switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    switchText: { flex: 1, gap: 2 },
    switchTitle: { ...typography.bodyStrong, color: c.text },
    switchHint: { ...typography.caption, color: c.textMuted },
  }));
  const { data: locations } = useLocations();
  const scanIn = useScanIn();
  const markOpened = useSetQuantity();
  const setDefaultLocation = useSetDefaultLocation();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<ProductUnit>('piece');
  const [locationId, setLocationId] = useState<string | null>(null);
  /** "Die Packung ist schon auf" — stamps opened_at on the lot after booking. */
  const [opened, setOpened] = useState(false);
  const [expiry, setExpiry] = useState('');
  /** Set once a suggestion is tapped; cleared as soon as the name is edited. */
  const [matched, setMatched] = useState<ProductRow | null>(null);

  const { data: suggestions } = useProductSearch(matched ? '' : name);

  // A tool from the Vorräte list is not a suggestion for a tool, and vice
  // versa: inventory_scan_in only deduplicates within one kind, so offering a
  // cross-kind match would promise a merge that will not happen.
  const sameKind = (suggestions ?? []).filter((p) => p.kind === kind);

  // Hide the exact-match suggestion: it says nothing the field does not
  // already, and leaves the list showing only genuine alternatives.
  const visibleSuggestions = sameKind.filter(
    (p) => p.name.trim().toLowerCase() !== name.trim().toLowerCase(),
  );

  // An empty field means "kein MHD", which is a perfectly normal answer — only
  // text that cannot be read as a date is worth holding the form for.
  const expiryIso = expiry.trim() ? parseGermanDate(expiry) : null;
  const expiryInvalid = expiry.trim().length > 0 && expiryIso === null;

  function pickSuggestion(product: ProductRow) {
    setMatched(product);
    setName(product.name);
    if (product.brand) setBrand(product.brand);
    setUnit(product.unit);
  }

  function editName(text: string) {
    setName(text);
    // Typing after picking means they meant something else after all.
    if (matched) setMatched(null);
  }

  /**
   * Turning the switch on offers ½ straight away, but only while the amount is
   * still the untouched default — someone who already typed "2,5" has said
   * what is there, and a switch must not overwrite it.
   */
  function toggleOpened(next: boolean) {
    setOpened(next);
    if (next && quantity === '1') setQuantity(formatQuantity(0.5));
  }

  const canSave = name.trim().length > 0 && !expiryInvalid && !scanIn.isPending;

  async function save() {
    // Fractions are deliberate, not a typo to round away: "0,5" is half a pack
    // you already opened. Anything unreadable falls back to one rather than
    // failing the save on a stray character.
    const parsed = parseQuantity(quantity);

    try {
      const item = await scanIn.mutateAsync({
        // Passing the picked product's barcode makes the server-side match
        // exact. Without it the RPC falls back to matching on the name, which
        // prefers the unbarcoded entry — the right default when nothing was
        // picked, but wrong when the user explicitly chose a scanned product.
        barcode: matched?.barcode ?? null,
        name: name.trim(),
        brand: brand.trim() || null,
        locationId,
        quantity: parsed && parsed > 0 ? parsed : 1,
        unit: equipment ? 'piece' : unit,
        // A lot is keyed by product, Ort *and* MHD, so a date entered here
        // keeps this jar apart from the one that goes off next year, instead
        // of merging the two into one number that is right for neither.
        expiresOn: equipment ? null : expiryIso,
        kind,
      });

      // The amount the RPC settled on, not the one that was typed: it may have
      // merged into a lot that was already there. The same number back in
      // means a delta of zero, which inventory_set_quantity() returns on
      // immediately — so this writes opened_at and nothing else.
      if (!equipment && opened) {
        await markOpened.mutateAsync({ itemId: item.id, quantity: item.quantity, opened: true });
      }

      // The RPC already writes default_location_id when it *creates* the
      // product, so this only matters when the name matched an entry that
      // exists — where "ab jetzt gehört das hierhin" is exactly what picking a
      // Platz on this screen means.
      if (equipment && locationId && locationId !== matched?.default_location_id) {
        await setDefaultLocation.mutateAsync({ productId: item.product_id, locationId });
      }
      router.back();
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: equipment ? 'Ausstattung' : 'Vorrat' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Said out loud, because every other way into the Bestand leads
            through die Einkaufsliste: this one exists precisely for the stock
            that was never bought — or was bought long before anybody wrote it
            down. */}
        <Text style={styles.intro}>
          {equipment
            ? 'Was dauerhaft im Haushalt lebt, direkt eintragen — kein Einkauf nötig.'
            : 'Direkt in den Bestand, ohne Einkauf: die angebrochene Packung, das Glas vom Markt, was schon immer im Schrank stand.'}
        </Text>

        <TextField
          label={equipment ? 'Gegenstand' : 'Produkt'}
          value={name}
          onChangeText={editName}
          placeholder={equipment ? 'z. B. Akkuschrauber' : 'z. B. Mehl'}
          autoFocus
          autoCorrect={false}
        />

        {matched ? (
          <View style={styles.matched}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.matchedText}>
              Wird zu „{matched.name}“ dazugebucht statt neu angelegt.
            </Text>
          </View>
        ) : visibleSuggestions.length > 0 ? (
          <Card style={styles.suggestions}>
            {visibleSuggestions.map((product, index) => (
              <View key={product.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  onPress={() => pickSuggestion(product)}
                  style={styles.suggestion}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={equipment ? 'construct-outline' : 'cube-outline'}
                    size={18}
                    color={colors.textFaint}
                  />
                  <View style={styles.suggestionText}>
                    <Text style={styles.suggestionName}>{product.name}</Text>
                    {product.brand || product.barcode ? (
                      <Text style={styles.suggestionMeta}>
                        {[product.brand, product.barcode].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="arrow-up" size={14} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        <TextField
          label={equipment ? 'Marke / Modell (optional)' : 'Marke (optional)'}
          value={brand}
          onChangeText={setBrand}
          placeholder={equipment ? 'z. B. Bosch' : 'z. B. Aldi'}
        />

        {/* Ausstattung is counted in Stück by definition, is never angebrochen
            and has no MHD — eine Bohrmaschine in Millilitern, halb aufgebraucht,
            mindestens haltbar bis, is a question nobody has. */}
        {equipment ? (
          <TextField
            label="Anzahl"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            hint="Wie viele davon ihr besitzt. Meistens 1."
          />
        ) : (
          <>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchTitle}>Angebrochen</Text>
                <Text style={styles.switchHint}>
                  Die Packung ist schon auf. Trag darunter ein, wie viel noch übrig ist.
                </Text>
              </View>
              <Switch
                value={opened}
                onValueChange={toggleOpened}
                trackColor={{ true: colors.primary }}
                accessibilityLabel="Packung ist angebrochen"
              />
            </View>

            <TextField
              label="Menge"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              hint={
                opened
                  ? 'Was noch da ist: ½ ist die halbe offene Packung, 1½ eine volle und eine halbe.'
                  : 'Auch angebrochen: 0,5 ist eine halbe Packung.'
              }
            />

            {/* Only while it is open: on a sealed pack these would invite a
                fraction that then reads as a full one. */}
            {opened ? (
              <View style={styles.chipRow}>
                {OPEN_FRACTIONS.map((fraction) => (
                  <Chip
                    key={fraction}
                    label={`${formatQuantity(fraction)} übrig`}
                    active={parseQuantity(quantity) === fraction}
                    onPress={() => setQuantity(formatQuantity(fraction))}
                  />
                ))}
              </View>
            ) : null}

            <Text style={styles.label}>Einheit</Text>
            <View style={styles.chipRow}>
              {UNIT_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  active={unit === option.value}
                  onPress={() => setUnit(option.value)}
                />
              ))}
            </View>

            {/* Typed rather than picked, for the reason parseGermanDate() gives
                in lib/format.ts — a MHD is months out, which is a lot of
                swiping in a date wheel. */}
            <TextField
              label="MHD (optional)"
              value={expiry}
              onChangeText={setExpiry}
              placeholder="TT.MM.JJJJ"
              keyboardType="numbers-and-punctuation"
              error={expiryInvalid ? 'Bitte als TT.MM.JJJJ eingeben.' : null}
              hint="Taucht im Inventar auf, sobald es weniger als eine Woche hin ist."
            />
            <View style={styles.chipRow}>
              {EXPIRY_CHOICES.map((choice) => (
                <Chip
                  key={choice.days}
                  label={choice.label}
                  active={!!expiryIso && expiryIso === shiftDays(todayIso(), choice.days)}
                  onPress={() => setExpiry(toGerman(shiftDays(todayIso(), choice.days)))}
                />
              ))}
              {expiry.trim() ? <Chip label="Kein MHD" onPress={() => setExpiry('')} /> : null}
            </View>
          </>
        )}

        <Text style={styles.label}>{equipment ? 'Fester Platz' : 'Ort'}</Text>
        {equipment ? (
          <Text style={styles.hint}>
            Wohin es gehört. Liegt es später woanders, zeigt die Liste das an — mit einem Tipp
            zurück an den Platz.
          </Text>
        ) : null}
        <View style={styles.chipRow}>
          <Chip
            label={equipment ? 'Noch keiner' : 'Ohne'}
            active={!locationId}
            onPress={() => setLocationId(null)}
          />
          {(locations ?? []).map((location) => (
            <Chip
              key={location.id}
              label={location.path}
              active={locationId === location.id}
              onPress={() => setLocationId(location.id)}
            />
          ))}
        </View>

        <Button
          label="Hinzufügen"
          onPress={() => void save()}
          disabled={!canSave}
          loading={scanIn.isPending || markOpened.isPending}
          size="lg"
          style={styles.submit}
        />
      </ScrollView>
    </Screen>
  );
}
