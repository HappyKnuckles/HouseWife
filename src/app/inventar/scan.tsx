import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Chip } from '../../components/Segmented';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { LocationComposer } from '../../features/inventory/components/LocationComposer';
import {
  useBarcodeResolver,
  useLocations,
  useResolveLocationBarcode,
  useScanIn,
} from '../../features/inventory/hooks';
import { Alert } from '../../lib/alert';
import type { LocationPathRow } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

/** What the scan sheet knows after a barcode has been resolved. */
interface Draft {
  barcode: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  provider: string | null;
  origin: 'known' | 'external' | 'unknown';
}

/**
 * One scanner, two kinds of tag:
 *  - a product barcode (EAN/UPC/Code128) opens the add-to-inventory sheet
 *  - a location's own QR code (from Inventar → Orte) sets the "active
 *    location" banner instead, so everything scanned afterwards defaults to
 *    that shelf/drawer without reselecting it every time.
 */
export default function ScanScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    fill: { flex: 1 as const, backgroundColor: '#000' },
    overlay: { flex: 1 as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.lg },
    reticle: {
      width: '72%' as const,
      height: 150,
      borderRadius: radius.lg,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.85)',
    },
    hint: { ...typography.caption, color: 'rgba(255,255,255,0.9)' },
    footer: { padding: spacing.lg, paddingBottom: spacing.xl, backgroundColor: c.background },
    locationBanner: {
      position: 'absolute' as const,
      top: spacing.xxl,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      backgroundColor: 'rgba(37,99,235,0.92)',
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    locationBannerText: { ...typography.captionStrong, color: c.textInverse, flex: 1 },
    toast: {
      position: 'absolute' as const,
      top: spacing.xxl,
      alignSelf: 'center' as const,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    toastText: { ...typography.captionStrong, color: c.text },
    sheet: {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '75%' as const,
      backgroundColor: c.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    sheetContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
    sheetHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.borderStrong,
      alignSelf: 'center' as const,
      marginBottom: spacing.sm,
    },
    sheetOrigin: { ...typography.micro, color: c.textMuted, textTransform: 'uppercase' as const },
    barcode: { ...typography.caption, color: c.textFaint },
    field: { gap: spacing.sm },
    label: { ...typography.captionStrong, color: c.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    composer: {
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.surfaceMuted,
    },
    sheetActions: { flexDirection: 'row' as const, gap: spacing.md, marginTop: spacing.sm },
    flex: { flex: 1 },
    permission: { flex: 1 as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md },
    permissionTitle: { ...typography.title, color: c.text },
    permissionBody: { ...typography.body, color: c.textMuted, textAlign: 'center' as const },
  }));
  const [permission, requestPermission] = useCameraPermissions();
  const { data: locations } = useLocations();

  const resolveProduct = useBarcodeResolver();
  const resolveLocation = useResolveLocationBarcode();
  const scanIn = useScanIn();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [activeLocation, setActiveLocation] = useState<LocationPathRow | null>(null);
  /** Whether the inline "Neuer Ort" form under the Ort chips is open. */
  const [creatingLocation, setCreatingLocation] = useState(false);

  // Guards continuous camera frames from re-triggering a lookup that is
  // already in flight — mutation.isPending alone lags one render behind the
  // async call starting, which is enough for a fast phone to fire twice.
  const resolvingRef = useRef(false);

  const onBarcodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (draft || resolvingRef.current || !data) return;
      // Already the active location — nothing to do, and no need to re-hit the DB.
      if (activeLocation && data === activeLocation.barcode) return;

      resolvingRef.current = true;
      try {
        const location = await resolveLocation.mutateAsync(data);
        if (location) {
          setActiveLocation(location);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return;
        }

        // Not a location tag. Only product barcodes (EAN/UPC/Code128) are
        // numeric — anything else here is a QR we don't recognise, so leave
        // it alone rather than opening an empty "unknown product" sheet for
        // some unrelated code.
        if (!/^[0-9]{6,14}$/.test(data)) return;

        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const result = await resolveProduct.mutateAsync(data);

        if (result.kind === 'known') {
          setDraft({
            barcode: data,
            name: result.product.name,
            brand: result.product.brand,
            imageUrl: result.product.image_url,
            provider: null,
            origin: 'known',
          });
          setLocationId(activeLocation?.id ?? result.product.default_location_id ?? null);
        } else if (result.kind === 'external') {
          setDraft({
            barcode: data,
            name: result.result.name,
            brand: result.result.brand ?? null,
            imageUrl: result.result.imageUrl ?? null,
            provider: result.provider,
            origin: 'external',
          });
          setLocationId(activeLocation?.id ?? null);
        } else {
          setDraft({
            barcode: data,
            name: '',
            brand: null,
            imageUrl: null,
            provider: null,
            origin: 'unknown',
          });
          setLocationId(activeLocation?.id ?? null);
        }
      } finally {
        resolvingRef.current = false;
      }
    },
    [draft, activeLocation, resolveLocation, resolveProduct],
  );

  async function save() {
    if (!draft) return;

    try {
      await scanIn.mutateAsync({
        barcode: draft.barcode,
        name: draft.name.trim(),
        brand: draft.brand,
        imageUrl: draft.imageUrl,
        locationId,
        quantity: Number(quantity.replace(',', '.')) || 1,
        externalProvider: draft.provider,
      });

      setSaved(draft.name.trim());
      setDraft(null);
      setQuantity('1');
      setCreatingLocation(false);
      setTimeout(() => setSaved(null), 2500);
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  if (!permission) return <View style={styles.fill} />;

  if (!permission.granted) {
    return (
      <Screen padded edges={['top', 'bottom']}>
        <View style={styles.permission}>
          <Ionicons name="camera-outline" size={40} color={colors.textFaint} />
          <Text style={styles.permissionTitle}>Kamera freigeben</Text>
          <Text style={styles.permissionBody}>
            Zum Scannen von Barcodes braucht die App Zugriff auf die Kamera.
          </Text>
          <Button label="Zugriff erlauben" onPress={() => void requestPermission()} />
        </View>
      </Screen>
    );
  }

  const busy = resolveLocation.isPending || resolveProduct.isPending;

  return (
    <View style={styles.fill}>
      <CameraView
        style={styles.fill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr'],
        }}
        onBarcodeScanned={draft ? undefined : (result) => void onBarcodeScanned(result)}
      >
        {activeLocation ? (
          <View style={styles.locationBanner}>
            <Ionicons name="location" size={16} color={colors.textInverse} />
            <Text style={styles.locationBannerText} numberOfLines={1}>
              {activeLocation.path}
            </Text>
            <Pressable
              onPress={() => setActiveLocation(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Ort nicht mehr automatisch verwenden"
            >
              <Ionicons name="close" size={16} color={colors.textInverse} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.overlay}>
          <View style={styles.reticle} />
          <Text style={styles.hint}>
            {busy
              ? 'Suche…'
              : activeLocation
                ? 'Artikel scannen — landet automatisch hier'
                : 'Barcode oder Orts-Code ins Feld halten'}
          </Text>
        </View>
      </CameraView>

      {saved ? (
        <View style={styles.toast}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={styles.toastText}>{saved} hinzugefügt</Text>
        </View>
      ) : null}

      {draft ? (
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetOrigin}>
              {draft.origin === 'known'
                ? 'Schon im Bestand'
                : draft.origin === 'external'
                  ? `Gefunden über ${draft.provider}`
                  : 'Neues Produkt'}
            </Text>

            <TextField
              label="Produkt"
              value={draft.name}
              onChangeText={(t) => setDraft({ ...draft, name: t })}
              placeholder="Name eingeben"
              autoFocus={draft.origin === 'unknown'}
            />

            <Text style={styles.barcode}>EAN {draft.barcode}</Text>

            <TextField
              label="Menge"
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
            />

            <View style={styles.field}>
              <Text style={styles.label}>Ort</Text>
              <View style={styles.chipRow}>
                <Chip label="Ohne" active={!locationId} onPress={() => setLocationId(null)} />
                {(locations ?? []).map((location) => (
                  <Chip
                    key={location.id}
                    label={location.path}
                    active={locationId === location.id}
                    onPress={() => setLocationId(location.id)}
                  />
                ))}
                <Chip
                  // Not "Abbrechen": that word already belongs to the button
                  // that throws the whole scan away.
                  label={creatingLocation ? 'Neuer Ort schließen' : '+ Neuer Ort'}
                  active={creatingLocation}
                  onPress={() => setCreatingLocation((v) => !v)}
                />
              </View>

              {/* Putting something away into a shelf that has no entry yet is
                  the moment you notice it is missing — so the full composer,
                  custom Art included, is here rather than a bare name field. */}
              {creatingLocation ? (
                <View style={styles.composer}>
                  <LocationComposer
                    onCreated={(created) => {
                      // A batch like "Schub 1-3" leaves the first one selected:
                      // the item in your hand goes somewhere, and the other
                      // chips are one tap away.
                      setLocationId(created[0]?.id ?? null);
                      setCreatingLocation(false);
                    }}
                  />
                </View>
              ) : null}
            </View>

            <View style={styles.sheetActions}>
              <Button
                label="Abbrechen"
                variant="secondary"
                onPress={() => {
                  setDraft(null);
                  setCreatingLocation(false);
                }}
                style={styles.flex}
              />
              <Button
                label="Hinzufügen"
                onPress={() => void save()}
                disabled={draft.name.trim().length === 0}
                loading={scanIn.isPending}
                style={styles.flex}
              />
            </View>
          </ScrollView>
        </View>
      ) : (
        <View style={styles.footer}>
          <Button label="Fertig" variant="secondary" onPress={() => router.back()} />
        </View>
      )}
    </View>
  );
}
