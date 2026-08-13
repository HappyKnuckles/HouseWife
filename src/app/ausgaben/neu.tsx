import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { LoadingState, Screen } from '../../components/Screen';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  ExpenseForm,
  type ExpenseFormValues,
} from '../../features/expenses/components/ExpenseForm';
import { useCreateExpense, useUploadReceipt } from '../../features/expenses/hooks';
import { pickReceipt, type PickedReceipt, type ReceiptSource } from '../../features/expenses/pick-receipt';
import { useMembers } from '../../features/household/hooks';
import { useLinkShoppingRows } from '../../features/todos/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

/** Comma-separated todo ids from whichever screen handed this shop over. */
function linkIdsFromParams(raw: string | string[] | undefined): string[] {
  return typeof raw === 'string' ? raw.split(',').filter(Boolean) : [];
}

/** Newline-separated names from the Einkaufsliste checkout, if it sent any. */
function itemsFromParams(raw: string | string[] | undefined) {
  if (typeof raw !== 'string') return undefined;

  const names = raw
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  return names.length > 0
    ? names.map((name) => ({ name, total_cents: 0, paid_for: null }))
    : undefined;
}

export default function NewExpenseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    title?: string;
    category?: string;
    items?: string;
    date?: string;
    /** Comma-separated todo ids to stamp with this expense once it exists. */
    link?: string;
  }>();
  const { profile } = useAuth();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    field: { gap: spacing.sm },
    flex: { flex: 1 },
    label: { ...typography.captionStrong, color: c.textMuted },
    hint: { ...typography.caption, color: c.textFaint },
    receiptButtons: { flexDirection: 'row' as const, gap: spacing.md },
    receiptStrip: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    receiptThumb: {
      width: 96,
      height: 124,
      borderRadius: radius.md,
      backgroundColor: c.surfaceMuted,
      overflow: 'hidden' as const,
    },
    receiptImage: { width: '100%' as const, height: '100%' as const },
    thumbRemove: {
      position: 'absolute' as const,
      top: 4,
      right: 4,
      width: 26,
      height: 26,
      borderRadius: radius.pill,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
  }));
  const { data: members, isLoading } = useMembers();
  const createExpense = useCreateExpense();
  const uploadReceipt = useUploadReceipt();
  const linkRows = useLinkShoppingRows();

  // Held locally until the expense exists: the storage path contains the
  // expense id, so there is nothing to upload to yet. More than one, because a
  // big shop comes off the printer as two or three separate strips.
  const [receipts, setReceipts] = useState<PickedReceipt[]>([]);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <LoadingState />;

  async function addReceipt(from: ReceiptSource) {
    const picked = await pickReceipt(from);
    if (picked) setReceipts((prev) => [...prev, picked]);
  }

  async function save(values: ExpenseFormValues) {
    setSaving(true);
    try {
      const expense = await createExpense.mutateAsync(values);

      // The receipts can only be uploaded once the expense exists — its id is
      // part of the storage path the RLS policy authorises on. Sequential, so
      // a phone on shop wifi is not asked to push three photos at once.
      for (const receipt of receipts) {
        await uploadReceipt.mutateAsync({ expenseId: expense.id, ...receipt });
      }

      // Stamp the shop this expense paid for, so the Einkaufshistorie can show
      // the two as one thing. Its own try: the expense is saved either way, and
      // reporting that as a failed save would be a lie about the money.
      const ids = linkIdsFromParams(params.link);
      if (ids.length > 0) {
        try {
          await linkRows.mutateAsync({ ids, expenseId: expense.id });
        } catch (err) {
          Alert.alert(
            'Ausgabe gespeichert',
            `Der Einkauf konnte nicht damit verknüpft werden: ${errorMessage(err)}`,
          );
        }
      }

      router.back();
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ExpenseForm
          members={members ?? []}
          // `title`/`category`/`items` come in as query params when another
          // screen hands over — the Einkaufsliste checkout does, so the shop
          // you just finished arrives here already named instead of being
          // retyped.
          //
          // The items are seeded at 0 €, so they cost nothing until a price is
          // typed and stay invisible unless you switch the split to "Pro
          // Posten". That is the point: the names are the tedious part of
          // itemising a shop, and they are the part the list already knows.
          initial={{
            paidBy: profile?.id ?? null,
            title: typeof params.title === 'string' ? params.title : undefined,
            category: typeof params.category === 'string' ? params.category : undefined,
            items: itemsFromParams(params.items),
            // The day the shopping was actually ticked off, which is not
            // necessarily today — the checkout can be reached long after.
            purchasedAt: typeof params.date === 'string' ? params.date : undefined,
          }}
          submitLabel="Ausgabe speichern"
          submitting={saving}
          onSubmit={(values) => void save(values)}
        >
          <View style={styles.field}>
            <Text style={styles.label}>Belege</Text>

            {receipts.length > 0 ? (
              <View style={styles.receiptStrip}>
                {receipts.map((receipt) => (
                  <View key={receipt.uri} style={styles.receiptThumb}>
                    <Image
                      source={{ uri: receipt.uri }}
                      style={styles.receiptImage}
                      contentFit="cover"
                    />
                    <Pressable
                      onPress={() =>
                        setReceipts((prev) => prev.filter((item) => item.uri !== receipt.uri))
                      }
                      hitSlop={6}
                      style={styles.thumbRemove}
                      accessibilityRole="button"
                      accessibilityLabel="Beleg entfernen"
                    >
                      <Ionicons name="close" size={15} color="#FFFFFF" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.receiptButtons}>
              <Button
                label={receipts.length > 0 ? 'Weiteres Foto' : 'Foto'}
                variant="secondary"
                onPress={() => void addReceipt('camera')}
                style={styles.flex}
                icon={<Ionicons name="camera" size={16} color={colors.text} />}
              />
              <Button
                label="Galerie"
                variant="secondary"
                onPress={() => void addReceipt('library')}
                style={styles.flex}
                icon={<Ionicons name="images" size={16} color={colors.text} />}
              />
            </View>

            {/* Said here rather than discovered later: the photo is the point,
                not a shortcut to typing less — nothing reads it for you. */}
            <Text style={styles.hint}>
              Wird zur Ausgabe gespeichert, damit später nachvollziehbar bleibt, was gekauft wurde.
            </Text>
          </View>
        </ExpenseForm>
      </ScrollView>
    </Screen>
  );
}
