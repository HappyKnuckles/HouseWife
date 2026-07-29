import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Chip, Segmented } from '../../src/components/Segmented';
import { LoadingState, Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { useCreateExpense, useUploadReceipt } from '../../src/features/expenses/hooks';
import { requestOcr } from '../../src/features/expenses/ocr';
import { computeSplit, validateSplit } from '../../src/features/expenses/split';
import { useMembers } from '../../src/features/household/hooks';
import type { ExpenseItemInput, SplitType } from '../../src/lib/database.types';
import { formatCents, parseAmountToCents } from '../../src/lib/format';
import { radius, spacing, typography } from '../../src/lib/theme';
import { useAppTheme, useThemedStyles } from '../../src/lib/theme-context';

interface DraftItem {
  key: string;
  name: string;
  amount: string;
  paidFor: string | null;
}

export default function NewExpenseScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    field: { gap: spacing.sm },
    flex: { flex: 1 },
    label: { ...typography.captionStrong, color: c.textMuted },
    help: { ...typography.caption, color: c.textFaint },
    error: { ...typography.caption, color: c.danger },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    itemCard: { gap: spacing.sm, padding: spacing.md },
    itemRow: { flexDirection: 'row' as const, gap: spacing.sm, alignItems: 'center' as const },
    itemName: { flex: 2 },
    itemAmount: { flex: 1 },
    itemDelete: { paddingTop: 2 },
    preview: { gap: spacing.sm },
    previewRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    previewName: { ...typography.body, color: c.text, flex: 1 },
    previewAmount: { ...typography.bodyStrong, color: c.text },
    receiptButtons: { flexDirection: 'row' as const, gap: spacing.md },
    receiptPreview: { gap: spacing.sm },
    receiptImage: { width: '100%' as const, height: 200, borderRadius: radius.md, backgroundColor: c.surfaceMuted },
  }));
  const { data: members, isLoading } = useMembers();
  const createExpense = useCreateExpense();
  const uploadReceipt = useUploadReceipt();

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(profile?.id ?? null);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totalCents = parseAmountToCents(amount) ?? 0;
  const memberIds = useMemo(() => (members ?? []).map((m) => m.id), [members]);
  const payer = paidBy ?? profile?.id ?? memberIds[0] ?? '';

  const itemInputs = useMemo<ExpenseItemInput[]>(
    () =>
      items
        .map((item, index) => ({
          name: item.name.trim() || `Posten ${index + 1}`,
          total_cents: parseAmountToCents(item.amount) ?? 0,
          paid_for: item.paidFor,
          position: index,
        }))
        .filter((item) => item.total_cents > 0),
    [items],
  );

  const shares = useMemo(
    () =>
      computeSplit({
        totalCents,
        memberIds,
        payerId: payer,
        splitType,
        items: itemInputs,
        customShares: Object.fromEntries(
          Object.entries(customShares).map(([id, value]) => [id, parseAmountToCents(value) ?? 0]),
        ),
      }),
    [totalCents, memberIds, payer, splitType, itemInputs, customShares],
  );

  const splitError = totalCents > 0 && splitType === 'shares' ? validateSplit(totalCents, shares) : null;
  const canSave = title.trim().length > 0 && totalCents > 0 && !!payer && !splitError && !saving;

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

  async function save() {
    setSaving(true);
    try {
      const expense = await createExpense.mutateAsync({
        title: title.trim(),
        totalCents,
        paidBy: payer,
        splitType,
        items: splitType === 'items' ? itemInputs : [],
        shares:
          splitType === 'shares'
            ? memberIds.map((id) => ({ profile_id: id, share_cents: shares[id] ?? 0 }))
            : null,
      });

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
        <TextField label="Wofür?" value={title} onChangeText={setTitle} placeholder="z. B. Wocheneinkauf" />

        <TextField
          label="Betrag"
          value={amount}
          onChangeText={setAmount}
          placeholder="0,00"
          keyboardType="decimal-pad"
          hint="Komma oder Punkt, beides geht."
        />

        <View style={styles.field}>
          <Text style={styles.label}>Wer hat bezahlt?</Text>
          <View style={styles.chipRow}>
            {(members ?? []).map((member) => (
              <Chip
                key={member.id}
                label={member.display_name}
                color={member.color}
                active={payer === member.id}
                onPress={() => setPaidBy(member.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Aufteilung</Text>
          <Segmented
            options={[
              { value: 'equal', label: '50 / 50' },
              { value: 'shares', label: 'Anteile' },
              { value: 'items', label: 'Pro Posten' },
            ]}
            value={splitType}
            onChange={setSplitType}
          />
        </View>

        {splitType === 'shares' ? (
          <View style={styles.field}>
            {(members ?? []).map((member) => (
              <TextField
                key={member.id}
                label={member.display_name}
                value={customShares[member.id] ?? ''}
                onChangeText={(t) => setCustomShares((prev) => ({ ...prev, [member.id]: t }))}
                placeholder="0,00"
                keyboardType="decimal-pad"
              />
            ))}
            {splitError ? <Text style={styles.error}>{splitError}</Text> : null}
          </View>
        ) : null}

        {splitType === 'items' ? (
          <View style={styles.field}>
            <Text style={styles.label}>Posten</Text>
            <Text style={styles.help}>
              Nicht zugeordnete Posten und der Rest zur Summe werden geteilt.
            </Text>

            {items.map((item, index) => (
              <Card key={item.key} style={styles.itemCard}>
                <View style={styles.itemRow}>
                  <View style={styles.itemName}>
                    <TextField
                      value={item.name}
                      onChangeText={(t) =>
                        setItems((prev) => prev.map((i, n) => (n === index ? { ...i, name: t } : i)))
                      }
                      placeholder="Artikel"
                    />
                  </View>
                  <View style={styles.itemAmount}>
                    <TextField
                      value={item.amount}
                      onChangeText={(t) =>
                        setItems((prev) => prev.map((i, n) => (n === index ? { ...i, amount: t } : i)))
                      }
                      placeholder="0,00"
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <Pressable
                    onPress={() => setItems((prev) => prev.filter((_, n) => n !== index))}
                    hitSlop={8}
                    style={styles.itemDelete}
                  >
                    <Ionicons name="close-circle" size={22} color={colors.textFaint} />
                  </Pressable>
                </View>

                <View style={styles.chipRow}>
                  <Chip
                    label="Geteilt"
                    active={!item.paidFor}
                    onPress={() =>
                      setItems((prev) => prev.map((i, n) => (n === index ? { ...i, paidFor: null } : i)))
                    }
                  />
                  {(members ?? []).map((member) => (
                    <Chip
                      key={member.id}
                      label={`nur ${member.display_name}`}
                      color={member.color}
                      active={item.paidFor === member.id}
                      onPress={() =>
                        setItems((prev) =>
                          prev.map((i, n) => (n === index ? { ...i, paidFor: member.id } : i)),
                        )
                      }
                    />
                  ))}
                </View>
              </Card>
            ))}

            <Button
              label="Posten hinzufügen"
              variant="secondary"
              onPress={() =>
                setItems((prev) => [
                  ...prev,
                  { key: `${Date.now()}-${prev.length}`, name: '', amount: '', paidFor: null },
                ])
              }
            />
          </View>
        ) : null}

        {/* Live preview so the split is understood before saving, not after. */}
        {totalCents > 0 ? (
          <Card style={styles.preview}>
            <Text style={styles.label}>Aufteilung</Text>
            {(members ?? []).map((member) => (
              <View key={member.id} style={styles.previewRow}>
                <Avatar name={member.display_name} color={member.color} size={26} />
                <Text style={styles.previewName}>{member.display_name}</Text>
                <Text style={styles.previewAmount}>{formatCents(shares[member.id] ?? 0)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

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

        <Button
          label="Ausgabe speichern"
          onPress={() => void save()}
          disabled={!canSave}
          loading={saving}
          size="lg"
        />
      </ScrollView>
    </Screen>
  );
}
