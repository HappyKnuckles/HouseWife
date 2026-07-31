import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Segmented';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useLocations, useProductSearch, useScanIn } from '../../features/inventory/hooks';
import { Alert } from '../../lib/alert';
import type { ProductRow, ProductUnit } from '../../lib/database.types';
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
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
    label: { ...typography.captionStrong, color: c.textMuted },
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
  }));
  const { data: locations } = useLocations();
  const scanIn = useScanIn();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<ProductUnit>('piece');
  const [locationId, setLocationId] = useState<string | null>(null);
  /** Set once a suggestion is tapped; cleared as soon as the name is edited. */
  const [matched, setMatched] = useState<ProductRow | null>(null);

  const { data: suggestions } = useProductSearch(matched ? '' : name);

  // Hide the exact-match suggestion: it says nothing the field does not
  // already, and leaves the list showing only genuine alternatives.
  const visibleSuggestions = (suggestions ?? []).filter(
    (p) => p.name.trim().toLowerCase() !== name.trim().toLowerCase(),
  );

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

  const canSave = name.trim().length > 0 && !scanIn.isPending;

  async function save() {
    try {
      await scanIn.mutateAsync({
        // Passing the picked product's barcode makes the server-side match
        // exact. Without it the RPC falls back to matching on the name, which
        // prefers the unbarcoded entry — the right default when nothing was
        // picked, but wrong when the user explicitly chose a scanned product.
        barcode: matched?.barcode ?? null,
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
          onChangeText={editName}
          placeholder="z. B. Mehl"
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
                  <Ionicons name="cube-outline" size={18} color={colors.textFaint} />
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
