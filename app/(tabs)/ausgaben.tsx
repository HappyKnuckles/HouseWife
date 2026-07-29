import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { Button } from '../../src/components/Button';
import { Card, EmptyState } from '../../src/components/Card';
import { Segmented } from '../../src/components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../src/components/Screen';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { useExpenses, useMyBalance, useSettleUp } from '../../src/features/expenses/hooks';
import { useMemberMap } from '../../src/features/household/hooks';
import { formatCents, formatDate } from '../../src/lib/format';
import { radius, spacing, typography } from '../../src/lib/theme';
import { useAppTheme, useThemedStyles } from '../../src/lib/theme-context';

export default function ExpensesScreen() {
  const router = useRouter();
  const { profile } = useAuth();
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
    balanceWrapper: { paddingHorizontal: spacing.lg },
    balanceCard: { gap: 2 },
    balanceLabel: { ...typography.micro, color: c.textMuted, textTransform: 'uppercase' as const },
    balanceValue: { ...typography.display, fontSize: 32 },
    balanceHint: { ...typography.caption, color: c.textMuted },
    settleButton: { marginTop: spacing.md },
    filter: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
    list: { paddingTop: spacing.md, paddingBottom: spacing.xxl * 2 },
    expenseCard: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingVertical: spacing.md,
    },
    expenseText: { flex: 1, gap: 2 },
    expenseTitle: { ...typography.bodyStrong, color: c.text },
    expenseMeta: { ...typography.caption, color: c.textMuted },
    expenseAmounts: { alignItems: 'flex-end' as const, gap: 2 },
    expenseTotal: { ...typography.bodyStrong, color: c.text },
    expenseShare: { ...typography.caption },
  }));
  const members = useMemberMap();

  const [filter, setFilter] = useState<'open' | 'settled'>('open');
  const { data: expenses, isLoading, isRefetching, refetch, error } = useExpenses(filter);
  const { mine, other } = useMyBalance();
  const settleUp = useSettleUp();

  if (isLoading) return <LoadingState label="Ausgaben werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const net = mine?.net_cents ?? 0;

  function confirmSettle() {
    Alert.alert(
      'Alles ausgleichen?',
      net === 0
        ? 'Es steht nichts offen — die offenen Ausgaben werden trotzdem als abgerechnet markiert.'
        : `${formatCents(Math.abs(net))} werden als ausgeglichen verbucht und alle offenen Ausgaben geschlossen.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Ausgleichen',
          onPress: async () => {
            try {
              await settleUp.mutateAsync({ method: 'transfer' });
            } catch (err) {
              Alert.alert('Fehlgeschlagen', err instanceof Error ? err.message : String(err));
            }
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Ausgaben"
        subtitle="Wer hat was bezahlt"
        right={
          <Pressable
            onPress={() => router.push('/ausgaben/neu')}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Neue Ausgabe"
          >
            <Ionicons name="add" size={22} color={colors.textInverse} />
          </Pressable>
        }
      />

      <View style={styles.balanceWrapper}>
        <Card style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Aktueller Stand</Text>
          <Text style={[styles.balanceValue, { color: net === 0 ? colors.text : net > 0 ? colors.success : colors.danger }]}>
            {net === 0 ? 'Ausgeglichen' : formatCents(Math.abs(net))}
          </Text>
          <Text style={styles.balanceHint}>
            {net === 0
              ? 'Nichts offen zwischen euch.'
              : net > 0
                ? `${other?.display_name ?? 'Dein Partner'} schuldet dir Geld.`
                : `Du schuldest ${other?.display_name ?? 'deinem Partner'} Geld.`}
          </Text>

          {(expenses?.length ?? 0) > 0 && filter === 'open' ? (
            <Button
              label="Ausgleichen"
              variant="secondary"
              onPress={confirmSettle}
              loading={settleUp.isPending}
              style={styles.settleButton}
            />
          ) : null}
        </Card>
      </View>

      <View style={styles.filter}>
        <Segmented
          options={[
            { value: 'open', label: 'Offen' },
            { value: 'settled', label: 'Abgerechnet' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>

      <FlatList
        data={expenses ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            title={filter === 'open' ? 'Keine offenen Ausgaben' : 'Noch nichts abgerechnet'}
            body={filter === 'open' ? 'Trage eure erste gemeinsame Ausgabe ein.' : undefined}
          />
        }
        renderItem={({ item }) => {
          const payer = members[item.paid_by];
          const myShare = item.expense_shares.find((s) => s.profile_id === profile?.id)?.share_cents ?? 0;
          const iPaid = item.paid_by === profile?.id;

          return (
            <Card style={styles.expenseCard} onPress={() => router.push(`/ausgaben/${item.id}`)}>
              <Avatar name={payer?.display_name} color={payer?.color} size={38} />

              <View style={styles.expenseText}>
                <Text style={styles.expenseTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.expenseMeta}>
                  {payer?.display_name ?? 'Unbekannt'} · {formatDate(item.purchased_at)}
                  {item.expense_items.length > 0 ? ` · ${item.expense_items.length} Posten` : ''}
                </Text>
              </View>

              <View style={styles.expenseAmounts}>
                <Text style={styles.expenseTotal}>{formatCents(item.total_cents, item.currency)}</Text>
                <Text style={[styles.expenseShare, { color: iPaid ? colors.success : colors.textMuted }]}>
                  {iPaid
                    ? `+${formatCents(item.total_cents - myShare, item.currency)}`
                    : `−${formatCents(myShare, item.currency)}`}
                </Text>
              </View>

              {item.receipts.length > 0 ? (
                <Ionicons name="receipt-outline" size={16} color={colors.textFaint} />
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}
