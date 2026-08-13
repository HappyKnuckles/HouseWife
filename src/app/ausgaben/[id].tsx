import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Avatar, Badge } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState, LoadingState, Screen } from '../../components/Screen';
import { categoryMeta } from '../../features/expenses/categories';
import { ReceiptAttachments } from '../../features/expenses/components/ReceiptAttachments';
import { ReceiptViewer } from '../../features/expenses/components/ReceiptViewer';
import { useDeleteExpense, useExpense } from '../../features/expenses/hooks';
import { useMemberMap } from '../../features/household/hooks';
import { Alert } from '../../lib/alert';
import { formatCents, formatDate } from '../../lib/format';
import { spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

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
    categoryRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
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
  }));
  const members = useMemberMap();

  const { data: expense, isLoading, error } = useExpense(id);
  const deleteExpense = useDeleteExpense();

  /** The signed URL currently open full-screen; null = the viewer is closed. */
  const [viewing, setViewing] = useState<string | null>(null);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!expense) return <ErrorState error={new Error('Ausgabe nicht gefunden')} />;

  const payer = members[expense.paid_by];

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
          {expense.category ? (
            <View style={styles.categoryRow}>
              <Ionicons
                name={categoryMeta(expense.category).icon}
                size={14}
                color={categoryMeta(expense.category).color}
              />
              <Text style={styles.payerText}>{expense.category}</Text>
            </View>
          ) : null}
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

        {/*
          Always shown, receipt or not — this is where one gets attached
          afterwards. A shop gets typed in at the till and the bon is still in
          the bag; without this the only chance to photograph it was the one
          screen you already left.
        */}
        <Text style={styles.sectionTitle}>Belege</Text>
        <Card style={styles.receiptCard}>
          <ReceiptAttachments
            expenseId={id}
            receipts={expense.receipts}
            onOpen={setViewing}
          />
        </Card>

        {/*
          Only while open: update_expense() refuses a settled one, because the
          balance view ignores settled expenses and the edit would silently
          move nothing while the settlement went on disagreeing with it.
        */}
        {expense.status === 'open' ? (
          <Button
            label="Bearbeiten"
            variant="secondary"
            onPress={() => router.push(`/ausgaben/bearbeiten/${id}`)}
          />
        ) : null}

        <Button label="Ausgabe löschen" variant="ghost" onPress={confirmDelete} />
      </ScrollView>

      <ReceiptViewer uri={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}
