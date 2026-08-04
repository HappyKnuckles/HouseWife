import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { LoadingState, Screen } from '../../components/Screen';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  ExpenseForm,
  type ExpenseFormValues,
} from '../../features/expenses/components/ExpenseForm';
import { useCreateExpense, useUploadReceipt } from '../../features/expenses/hooks';
import { requestOcr } from '../../features/expenses/ocr';
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
    receiptButtons: { flexDirection: 'row' as const, gap: spacing.md },
    receiptPreview: { gap: spacing.sm },
    receiptImage: { width: '100%' as const, height: 200, borderRadius: radius.md, backgroundColor: c.surfaceMuted },
  }));
  const { data: members, isLoading } = useMembers();
  const createExpense = useCreateExpense();
  const uploadReceipt = useUploadReceipt();
  const linkRows = useLinkShoppingRows();

  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <LoadingState />;

  async function pickImage(from: 'camera' | 'library') {
    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Keine Berechtigung', 'Bitte erlaube den Zugriff in den Einstellungen.');
      return;
    }

    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });

    if (!result.canceled && result.assets[0]) setReceiptUri(result.assets[0].uri);
  }

  async function save(values: ExpenseFormValues) {
    setSaving(true);
    try {
      const expense = await createExpense.mutateAsync(values);

      // The receipt can only be uploaded once the expense exists — its id is
      // part of the storage path the RLS policy authorises on.
      if (receiptUri) {
        const receipt = await uploadReceipt.mutateAsync({ expenseId: expense.id, uri: receiptUri });
        // OCR is best-effort and must never block saving.
        void requestOcr(receipt.id).catch(() => undefined);
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
            <Text style={styles.label}>Beleg</Text>
            {receiptUri ? (
              <View style={styles.receiptPreview}>
                <Image source={{ uri: receiptUri }} style={styles.receiptImage} contentFit="cover" />
                <Button label="Entfernen" variant="ghost" onPress={() => setReceiptUri(null)} />
              </View>
            ) : (
              <View style={styles.receiptButtons}>
                <Button
                  label="Foto"
                  variant="secondary"
                  onPress={() => void pickImage('camera')}
                  style={styles.flex}
                  icon={<Ionicons name="camera" size={16} color={colors.text} />}
                />
                <Button
                  label="Galerie"
                  variant="secondary"
                  onPress={() => void pickImage('library')}
                  style={styles.flex}
                  icon={<Ionicons name="images" size={16} color={colors.text} />}
                />
              </View>
            )}
          </View>
        </ExpenseForm>
      </ScrollView>
    </Screen>
  );
}
