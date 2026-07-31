import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card, EmptyState } from '../../components/Card';
import { Chip } from '../../components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useCreateLocation, useLocations } from '../../features/inventory/hooks';
import { LOCATION_KINDS, locationIcon } from '../../features/inventory/locations';
import { Alert } from '../../lib/alert';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

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
  const [kind, setKind] = useState('room');
  /** Anything typed here wins over the chips — `kind` is free text now. */
  const [customKind, setCustomKind] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);

  if (isLoading) return <LoadingState label="Orte werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      await createLocation.mutateAsync({ name: trimmed, kind: customKind.trim() || kind, parentId });
      setName('');
      setKind('room');
      setCustomKind('');
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
            {LOCATION_KINDS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                active={kind === option.value && customKind.trim() === ''}
                onPress={() => {
                  setKind(option.value);
                  setCustomKind('');
                }}
              />
            ))}
          </View>
          <TextField
            value={customKind}
            onChangeText={setCustomKind}
            placeholder="oder eigene Art, z. B. Speisekammer"
            hint="Eigene Arten bekommen ein neutrales Symbol."
          />

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
              <Ionicons name={locationIcon(item.kind)} size={18} color={colors.textMuted} />
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
