import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
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
import { Alert } from '../../lib/alert';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

export default function NewExpenseScreen() {
  const router = useRouter();
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

      router.back();
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ExpenseForm
          members={members ?? []}
          initial={{ paidBy: profile?.id ?? null }}
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
