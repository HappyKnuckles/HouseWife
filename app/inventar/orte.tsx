import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Card, EmptyState } from '../../src/components/Card';
import { Chip } from '../../src/components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useCreateLocation, useLocations } from '../../src/features/inventory/hooks';
import type { LocationKind } from '../../src/lib/database.types';
import { radius, spacing, typography } from '../../src/lib/theme';
import { useAppTheme, useThemedStyles } from '../../src/lib/theme-context';

const KIND_OPTIONS: { value: LocationKind; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'room', label: 'Raum', icon: 'home-outline' },
  { value: 'cabinet', label: 'Schrank', icon: 'file-tray-stacked-outline' },
  { value: 'shelf', label: 'Regal', icon: 'library-outline' },
  { value: 'box', label: 'Kiste', icon: 'cube-outline' },
  { value: 'fridge', label: 'Kühlschrank', icon: 'snow-outline' },
  { value: 'freezer', label: 'Gefrierschrank', icon: 'snow-outline' },
  { value: 'other', label: 'Sonstiges', icon: 'ellipsis-horizontal-outline' },
];

const kindIcon = (kind: LocationKind) =>
  KIND_OPTIONS.find((k) => k.value === kind)?.icon ?? 'location-outline';

/**
 * Manage storage locations: create them, and see at a glance which ones
 * already have a scannable code. The actual QR generation/display lives on
 * the per-location detail screen — this is the list + create surface.
 */
export default function LocationsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    addButton: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    composer: { marginHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
    label: { ...typography.captionStrong, color: c.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    list: { paddingBottom: spacing.xxl * 2 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingVertical: spacing.md,
    },
    rowIcon: { width: 22, alignItems: 'center' as const },
    rowPath: { ...typography.body, color: c.text, flex: 1 },
    noCode: { ...typography.caption, color: c.textFaint },
  }));
  const { data: locations, isLoading, error } = useLocations();
  const createLocation = useCreateLocation();

  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('room');
  const [parentId, setParentId] = useState<string | null>(null);

  if (isLoading) return <LoadingState label="Orte werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      await createLocation.mutateAsync({ name: trimmed, kind, parentId });
      setName('');
      setKind('room');
      setParentId(null);
      setComposing(false);
    } catch (err) {
      Alert.alert('Konnte nicht angelegt werden', err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Orte"
        subtitle={`${locations?.length ?? 0} Orte`}
        right={
          <Pressable
            onPress={() => setComposing((v) => !v)}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Neuer Ort"
          >
            <Ionicons name={composing ? 'close' : 'add'} size={22} color={colors.textInverse} />
          </Pressable>
        }
      />

      {composing ? (
        <Card style={styles.composer}>
          <TextField
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="z. B. Schub 1"
            autoFocus
          />

          <Text style={styles.label}>Art</Text>
          <View style={styles.chipRow}>
            {KIND_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={kind === option.value}
                onPress={() => setKind(option.value)}
              />
            ))}
          </View>

          <Text style={styles.label}>Übergeordneter Ort (optional)</Text>
          <View style={styles.chipRow}>
            <Chip label="Kein übergeordneter Ort" active={!parentId} onPress={() => setParentId(null)} />
            {(locations ?? []).map((location) => (
              <Chip
                key={location.id}
                label={location.path}
                active={parentId === location.id}
                onPress={() => setParentId(location.id)}
              />
            ))}
          </View>

          <Button
            label="Ort anlegen"
            onPress={() => void submit()}
            disabled={name.trim().length === 0}
            loading={createLocation.isPending}
          />
        </Card>
      ) : null}

      <FlatList
        data={locations ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            title="Noch keine Orte"
            body="Lege Orte wie „Vorratsschrank“ oder „Schub 1“ an, um ihnen einen Scan-Code zu geben."
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.row} onPress={() => router.push(`/inventar/orte/${item.id}`)}>
            <View style={styles.rowIcon}>
              <Ionicons name={kindIcon(item.kind)} size={18} color={colors.textMuted} />
            </View>
            <Text style={styles.rowPath} numberOfLines={1}>
              {item.path}
            </Text>
            {item.barcode ? (
              <Ionicons name="qr-code" size={18} color={colors.success} />
            ) : (
              <Text style={styles.noCode}>Kein Code</Text>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Card>
        )}
      />
    </Screen>
  );
}
