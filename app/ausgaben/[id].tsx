import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Avatar, Badge } from '../../src/components/Avatar';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ErrorState, LoadingState, Screen } from '../../src/components/Screen';
import { useDeleteExpense, useExpense, useSignedReceiptUrl } from '../../src/features/expenses/hooks';
import { ocrStatusLabel, parseReceiptPayload } from '../../src/features/expenses/ocr';
import { useMemberMap } from '../../src/features/household/hooks';
import { formatCents, formatDate } from '../../src/lib/format';
import { radius, spacing, typography } from '../../src/lib/theme';
import { useAppTheme, useThemedStyles } from '../../src/lib/theme-context';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    hero: { gap: spacing.sm },
    heroTop: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.sm,
    },
    title: { ...typography.title, color: c.text, flex: 1 },
    amount: { ...typography.display, fontSize: 32, color: c.text },
    payerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    payerText: { ...typography.caption, color: c.textMuted },
    note: { ...typography.body, color: c.textMuted, marginTop: spacing.sm },
    sectionTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginLeft: spacing.xs,
    },
    section: { paddingVertical: spacing.sm },
    divider: { height: 1, backgroundColor: c.border },
    shareRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.md },
    shareName: { ...typography.body, color: c.text, flex: 1 },
    shareAmount: { ...typography.bodyStrong, color: c.text },
    itemRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.md },
    itemText: { flex: 1, gap: 2 },
    itemName: { ...typography.body, color: c.text },
    itemMeta: { ...typography.caption, color: c.textFaint },
    itemAmount: { ...typography.bodyStrong, color: c.text },
    receiptCard: { gap: spacing.md },
    receiptImage: { width: '100%' as const, height: 320, borderRadius: radius.md, backgroundColor: c.surfaceMuted },
    receiptPlaceholder: {
      width: '100%' as const,
      height: 160,
      borderRadius: radius.md,
      backgroundColor: c.surfaceMuted,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    ocrStatus: { ...typography.caption, color: c.textMuted },
  }));
  const members = useMemberMap();

  const { data: expense, isLoading, error } = useExpense(id);
  const deleteExpense = useDeleteExpense();

  const receipt = expense?.receipts[0] ?? null;
  const { data: receiptUrl } = useSignedReceiptUrl(receipt?.storage_path);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!expense) return <ErrorState error={new Error('Ausgabe nicht gefunden')} />;

  const payer = members[expense.paid_by];
  const parsed = receipt ? parseReceiptPayload(receipt.ocr_parsed) : null;

  function confirmDelete() {
    Alert.alert('Ausgabe löschen?', 'Das lässt sich nicht rückgängig machen.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense.mutateAsync(id);
          router.back();
        },
      },
    ]);
  }

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <Text style={styles.title}>{expense.title}</Text>
            <Badge
              label={expense.status === 'open' ? 'Offen' : 'Abgerechnet'}
              fg={expense.status === 'open' ? colors.warning : colors.success}
              bg={expense.status === 'open' ? colors.dueTodaySoft : colors.successSoft}
            />
          </View>
          <Text style={styles.amount}>{formatCents(expense.total_cents, expense.currency)}</Text>
          <View style={styles.payerRow}>
            <Avatar name={payer?.display_name} color={payer?.color} size={24} />
            <Text style={styles.payerText}>
              Bezahlt von {payer?.display_name ?? 'Unbekannt'} · {formatDate(expense.purchased_at)}
            </Text>
          </View>
          {expense.note ? <Text style={styles.note}>{expense.note}</Text> : null}
        </Card>

        <Text style={styles.sectionTitle}>Aufteilung</Text>
        <Card style={styles.section}>
          {expense.expense_shares.map((share, index) => {
            const member = members[share.profile_id];
            return (
              <View key={share.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.shareRow}>
                  <Avatar name={member?.display_name} color={member?.color} size={28} />
                  <Text style={styles.shareName}>{member?.display_name ?? 'Unbekannt'}</Text>
                  <Text style={styles.shareAmount}>{formatCents(share.share_cents, expense.currency)}</Text>
                </View>
              </View>
            );
          })}
        </Card>

        {expense.expense_items.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Posten</Text>
            <Card style={styles.section}>
              {expense.expense_items
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((item, index) => {
                  const assignee = item.paid_for ? members[item.paid_for] : null;
                  return (
                    <View key={item.id}>
                      {index > 0 ? <View style={styles.divider} /> : null}
                      <View style={styles.itemRow}>
                        <View style={styles.itemText}>
                          <Text style={styles.itemName}>{item.name}</Text>
                          <Text style={styles.itemMeta}>
                            {assignee ? `nur ${assignee.display_name}` : 'geteilt'}
                            {item.source === 'ocr' ? ' · automatisch erkannt' : ''}
                          </Text>
                        </View>
                        <Text style={styles.itemAmount}>
                          {formatCents(item.total_cents, expense.currency)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
            </Card>
          </>
        ) : null}

        {receipt ? (
          <>
            <Text style={styles.sectionTitle}>Beleg</Text>
            <Card style={styles.receiptCard}>
              {receiptUrl ? (
                <Image source={{ uri: receiptUrl }} style={styles.receiptImage} contentFit="contain" />
              ) : (
                <View style={styles.receiptPlaceholder}>
                  <Ionicons name="receipt-outline" size={28} color={colors.textFaint} />
                </View>
              )}
              <Text style={styles.ocrStatus}>
                {ocrStatusLabel(receipt)}
                {parsed && parsed.lines.length > 0 ? ` · ${parsed.lines.length} Zeilen erkannt` : ''}
              </Text>
            </Card>
          </>
        ) : null}

        <Button label="Ausgabe löschen" variant="ghost" onPress={confirmDelete} />
      </ScrollView>
    </Screen>
  );
}
