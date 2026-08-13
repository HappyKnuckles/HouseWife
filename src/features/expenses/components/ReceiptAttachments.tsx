/**
 * Belege on an expense that already exists.
 *
 * "Was war eigentlich in dem 87-€-Einkauf" is answered by a photo of the till
 * roll and nothing else in the app, so the photo is the whole feature — it is
 * an album, not an input stage for anything.
 *
 * Uploads happen the moment a photo is picked rather than on a save button:
 * the expense is already saved, so there is nothing to save it *with*, and a
 * pending attachment that vanishes when you navigate back would be the worst
 * of both.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Alert } from '../../../lib/alert';
import type { ReceiptRow } from '../../../lib/database.types';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';
import { useDeleteReceipt, useSignedReceiptUrl, useUploadReceipt } from '../hooks';
import { pickReceipt, type ReceiptSource } from '../pick-receipt';

export function ReceiptAttachments({
  expenseId,
  receipts,
  onOpen,
}: {
  expenseId: string;
  receipts: ReceiptRow[];
  /** Hands the signed URL up so the screen can show it full-screen. */
  onOpen: (url: string) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    card: { gap: spacing.md },
    empty: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: spacing.xs,
      paddingVertical: spacing.xl,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed' as const,
      borderColor: c.borderStrong,
    },
    emptyText: { ...typography.caption, color: c.textMuted, textAlign: 'center' as const },
    buttons: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
  }));

  const upload = useUploadReceipt();
  const [busy, setBusy] = useState(false);

  async function add(from: ReceiptSource) {
    const picked = await pickReceipt(from);
    if (!picked) return;

    setBusy(true);
    try {
      await upload.mutateAsync({ expenseId, ...picked });
    } catch (err) {
      Alert.alert('Beleg konnte nicht hochgeladen werden', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Oldest first, so the order does not shuffle when one is added.
  const ordered = [...receipts].sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <View style={styles.card}>
      {ordered.length > 0 ? (
        ordered.map((receipt) => (
          <ReceiptPreview key={receipt.id} receipt={receipt} onOpen={onOpen} />
        ))
      ) : (
        <View style={styles.empty}>
          <Ionicons name="receipt-outline" size={26} color={colors.textFaint} />
          <Text style={styles.emptyText}>
            Noch kein Beleg. Fotografier den Kassenbon — dann weißt du auch nächsten Monat noch,
            was drin war.
          </Text>
        </View>
      )}

      <View style={styles.buttons}>
        <Button
          label={ordered.length > 0 ? 'Weiteres Foto' : 'Foto'}
          variant="secondary"
          onPress={() => void add('camera')}
          disabled={busy}
          loading={busy}
          style={styles.flex}
          icon={<Ionicons name="camera" size={16} color={colors.text} />}
        />
        <Button
          label="Galerie"
          variant="secondary"
          onPress={() => void add('library')}
          disabled={busy}
          style={styles.flex}
          icon={<Ionicons name="images" size={16} color={colors.text} />}
        />
      </View>
    </View>
  );
}

/**
 * One stored receipt. Its own component because the signed URL is a hook, and
 * a private bucket means every image needs one of its own.
 */
function ReceiptPreview({
  receipt,
  onOpen,
}: {
  receipt: ReceiptRow;
  onOpen: (url: string) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    wrap: { gap: spacing.sm },
    frame: {
      width: '100%' as const,
      height: 300,
      borderRadius: radius.md,
      backgroundColor: c.surfaceMuted,
      overflow: 'hidden' as const,
    },
    image: { width: '100%' as const, height: '100%' as const },
    placeholder: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
    // On the image rather than beside it: the actions belong to this receipt,
    // and with several stacked up a row of buttons underneath stops saying
    // which one it would delete.
    overlay: {
      position: 'absolute' as const,
      top: spacing.sm,
      right: spacing.sm,
      flexDirection: 'row' as const,
      gap: spacing.sm,
    },
    action: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
  }));

  const { data: url } = useSignedReceiptUrl(receipt.storage_path);
  const remove = useDeleteReceipt();

  function confirmDelete() {
    Alert.alert('Beleg löschen?', 'Das Foto wird endgültig entfernt.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => {
          remove.mutate(receipt, {
            onError: (err) => Alert.alert('Konnte nicht gelöscht werden', errorMessage(err)),
          });
        },
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.frame}
        onPress={() => (url ? onOpen(url) : undefined)}
        disabled={!url}
        accessibilityRole="button"
        accessibilityLabel="Beleg groß ansehen"
      >
        {url ? (
          <Image source={{ uri: url }} style={styles.image} contentFit="contain" />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="receipt-outline" size={28} color={colors.textFaint} />
          </View>
        )}

        <View style={styles.overlay}>
          {url ? (
            <View style={styles.action}>
              <Ionicons name="expand" size={17} color="#FFFFFF" />
            </View>
          ) : null}
          <Pressable
            onPress={confirmDelete}
            hitSlop={6}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel="Beleg löschen"
          >
            <Ionicons name="trash-outline" size={17} color="#FFFFFF" />
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}
