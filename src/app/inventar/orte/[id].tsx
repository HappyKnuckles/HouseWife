import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState, LoadingState, Screen } from '../../../components/Screen';
import {
  useAssignLocationBarcode,
  useClearLocationBarcode,
  useDeleteLocation,
  useLocations,
} from '../../../features/inventory/hooks';
import { Alert } from '../../../lib/alert';
import { radius, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';

/**
 * QR generation + display for one location, plus delete.
 *
 * Print or screenshot the code shown here and stick it on the actual
 * shelf/drawer. Scanning it in the inventory scanner (Inventar → Barcode-Icon)
 * sets this location as the active "put away" target for whatever is scanned
 * next — that is what makes "wo ist der Hammer" a scan instead of a search.
 */
export default function LocationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    hero: { alignItems: 'center' as const, gap: spacing.md },
    path: { ...typography.title, color: c.text, textAlign: 'center' as const },
    // Fixed white, not themed: the QR needs a light quiet zone around it to
    // stay scannable regardless of app theme — same reasoning as the
    // scanner's black camera background.
    qrWrapper: { padding: spacing.lg, backgroundColor: '#FFFFFF', borderRadius: radius.md },
    code: { ...typography.captionStrong, color: c.textMuted, letterSpacing: 1 },
    hint: { ...typography.caption, color: c.textMuted, textAlign: 'center' as const },
    placeholder: {
      width: 220,
      height: 220,
      borderRadius: radius.md,
      backgroundColor: c.surfaceMuted,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    actions: { flexDirection: 'row' as const, gap: spacing.md, width: '100%' as const },
    flex: { flex: 1 },
  }));

  const { data: locations, isLoading, error } = useLocations();
  const assignBarcode = useAssignLocationBarcode();
  const clearBarcode = useClearLocationBarcode();
  const deleteLocation = useDeleteLocation();

  const location = useMemo(() => locations?.find((l) => l.id === id), [locations, id]);
  const childCount = useMemo(
    () => (locations ?? []).filter((l) => l.parent_id === id).length,
    [locations, id],
  );

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!location) return <ErrorState error={new Error('Ort nicht gefunden')} />;

  function confirmRegenerate() {
    Alert.alert(
      'Neuen Code erzeugen?',
      'Der alte Code funktioniert danach nicht mehr — ein bereits ausgedruckter oder aufgeklebter Aufkleber wird ungültig.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Neu erzeugen',
          onPress: () => void assignBarcode.mutateAsync({ locationId: id }),
        },
      ],
    );
  }

  function confirmClear() {
    Alert.alert('Code entfernen?', 'Ein bereits angebrachter Aufkleber funktioniert danach nicht mehr.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Entfernen', style: 'destructive', onPress: () => void clearBarcode.mutateAsync(id) },
    ]);
  }

  function confirmDelete() {
    Alert.alert(
      'Ort löschen?',
      childCount > 0
        ? `Dieser Ort hat ${childCount} untergeordnete(n) Ort(e), die mit gelöscht werden. Artikel, die dort lagern, bleiben erhalten, verlieren aber ihren Ort.`
        : 'Artikel, die hier lagern, bleiben erhalten, verlieren aber ihren Ort.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await deleteLocation.mutateAsync(id);
            router.back();
          },
        },
      ],
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: location.name }} />

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.hero}>
          <Text style={styles.path}>{location.path}</Text>

          {location.barcode ? (
            <>
              <View style={styles.qrWrapper}>
                <QRCode value={location.barcode} size={220} />
              </View>
              <Text style={styles.code}>{location.barcode}</Text>
              <Text style={styles.hint}>
                Screenshotte oder fotografiere diesen Code und bring ihn am Ort an. Scanne ihn danach im
                Inventar-Scanner, um diesen Ort als Ziel für die nächsten gescannten Artikel zu setzen.
              </Text>

              <View style={styles.actions}>
                <Button
                  label="Neu erzeugen"
                  variant="secondary"
                  onPress={confirmRegenerate}
                  loading={assignBarcode.isPending}
                  style={styles.flex}
                />
                <Button
                  label="Entfernen"
                  variant="ghost"
                  onPress={confirmClear}
                  loading={clearBarcode.isPending}
                  style={styles.flex}
                />
              </View>
            </>
          ) : (
            <>
              <View style={styles.placeholder}>
                <Ionicons name="qr-code-outline" size={48} color={colors.textFaint} />
              </View>
              <Text style={styles.hint}>
                Erzeuge einen Code, um diesen Ort scannbar zu machen — praktisch für Schränke oder
                Schubladen, in denen ihr öfter etwas verstaut.
              </Text>
              <Button
                label="Code erzeugen"
                onPress={() => void assignBarcode.mutateAsync({ locationId: id })}
                loading={assignBarcode.isPending}
              />
            </>
          )}
        </Card>

        <Button label="Ort löschen" variant="ghost" onPress={confirmDelete} />
      </ScrollView>
    </Screen>
  );
}
