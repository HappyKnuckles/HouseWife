import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Card, EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { LocationComposer } from '../../features/inventory/components/LocationComposer';
import { useLocations } from '../../features/inventory/hooks';
import { locationIcon } from '../../features/inventory/locations';
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
    composer: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
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

  const [composing, setComposing] = useState(false);

  if (isLoading) return <LoadingState label="Orte werden geladen…" />;
  if (error) return <ErrorState error={error} />;

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

      {/* Deliberately stays open after a create: the form re-points itself at
          the location it just made, which is how "Schrank, dann Schub 1-3"
          happens in one sitting. The header button closes it. */}
      {composing ? (
        <Card style={styles.composer}>
          <LocationComposer />
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
