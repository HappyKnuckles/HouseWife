import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Chip } from '../../src/components/Segmented';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useLocations, useScanIn } from '../../src/features/inventory/hooks';
import type { ProductUnit } from '../../src/lib/database.types';
import { spacing, typography } from '../../src/lib/theme';
import { useThemedStyles } from '../../src/lib/theme-context';

const UNIT_OPTIONS: { value: ProductUnit; label: string }[] = [
  { value: 'piece', label: 'Stück' },
  { value: 'pack', label: 'Packung' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l' },
];

/**
 * Manual inventory entry — for anything that has no barcode to scan, or where
 * scanning just isn't worth it (a bag of stuff from the Wochenmarkt, a
 * half-used bottle you're relabeling). Goes through the same
 * inventory_scan_in() RPC as the camera flow with barcode left null, so it
 * shares the same product-catalog and stock-lot logic — just skips the two
 * lookup steps.
 */
export default function ManualAddScreen() {
  const router = useRouter();
  const styles = useThemedStyles((colors) => ({
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
    label: { ...typography.captionStrong, color: colors.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    submit: { marginTop: spacing.md },
  }));
  const { data: locations } = useLocations();
  const scanIn = useScanIn();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<ProductUnit>('piece');
  const [locationId, setLocationId] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !scanIn.isPending;

  async function save() {
    try {
      await scanIn.mutateAsync({
        barcode: null,
        name: name.trim(),
        brand: brand.trim() || null,
        locationId,
        quantity: Number(quantity.replace(',', '.')) || 1,
        unit,
      });
      router.back();
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label="Produkt"
          value={name}
          onChangeText={setName}
          placeholder="z. B. Mehl"
          autoFocus
        />

        <TextField
          label="Marke (optional)"
          value={brand}
          onChangeText={setBrand}
          placeholder="z. B. Aldi"
        />

        <TextField
          label="Menge"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
        />

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
        </View>

        <Button
          label="Hinzufügen"
          onPress={() => void save()}
          disabled={!canSave}
          loading={scanIn.isPending}
          size="lg"
          style={styles.submit}
        />
      </ScrollView>
    </Screen>
  );
}
