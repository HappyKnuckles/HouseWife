import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import {
  useAddRule,
  useDeleteRule,
  useMoveRule,
  useRules,
  useUpdateRule,
} from '../../features/rules/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';
import { radius, shadow, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

/**
 * Hausregeln — the things you agree on once and then forget.
 *
 * Editing reuses the composer at the top rather than turning a row into an
 * input: one text field, one keyboard, and the row keeps its number while you
 * change it.
 */
export default function RulesScreen() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    composer: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
    composerActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
    list: { paddingBottom: spacing.xxl * 2 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      ...shadow.card,
    },
    rowEditing: { borderWidth: 1, borderColor: c.primary },
    number: { ...typography.bodyStrong, color: c.primary, minWidth: 22 },
    rowText: { flex: 1, ...typography.body, color: c.text },
    arrows: { gap: 2 },
    arrow: { paddingHorizontal: spacing.xs },
  }));

  const { data: rules, isLoading, isRefetching, refetch, error } = useRules();
  const addRule = useAddRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const moveRule = useMoveRule();

  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) return <LoadingState label="Regeln werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const list = rules ?? [];

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;

    setText('');
    const id = editingId;
    setEditingId(null);

    try {
      if (id) await updateRule.mutateAsync({ id, text: trimmed });
      else await addRule.mutateAsync(trimmed);
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  function startEditing(id: string, current: string) {
    setEditingId(id);
    setText(current);
  }

  function cancelEditing() {
    setEditingId(null);
    setText('');
  }

  function confirmDelete(id: string, label: string) {
    Alert.alert('Regel löschen?', label, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: () => void deleteRule.mutateAsync(id) },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader
        title="Regeln"
        subtitle={list.length === 0 ? 'Worauf ihr euch geeinigt habt' : `${list.length} Regeln`}
      />

      <View style={styles.composer}>
        <TextField
          value={text}
          onChangeText={setText}
          placeholder={editingId ? 'Regel ändern…' : 'Neue Regel, z. B. Schuhe aus'}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          multiline
        />
        <View style={styles.composerActions}>
          {editingId ? (
            <Button label="Abbrechen" variant="secondary" onPress={cancelEditing} style={styles.flex} />
          ) : null}
          <Button
            label={editingId ? 'Regel speichern' : 'Regel hinzufügen'}
            onPress={() => void submit()}
            disabled={text.trim().length === 0}
            loading={addRule.isPending || updateRule.isPending}
            style={styles.flex}
          />
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Noch keine Regeln"
            body="Schreib oben rein, worauf ihr euch geeinigt habt — es steht sofort auf beiden Handys."
          />
        }
        renderItem={({ item, index }) => (
          <View style={[styles.row, editingId === item.id && styles.rowEditing]}>
            <Text style={styles.number}>{index + 1}.</Text>

            <Pressable
              onPress={() => startEditing(item.id, item.text)}
              style={styles.flex}
              accessibilityRole="button"
              accessibilityLabel={`${item.text} bearbeiten`}
            >
              <Text style={styles.rowText}>{item.text}</Text>
            </Pressable>

            <View style={styles.arrows}>
              <Pressable
                onPress={() => void moveRule.mutateAsync({ id: item.id, direction: 'up' })}
                disabled={index === 0}
                hitSlop={6}
                style={styles.arrow}
                accessibilityRole="button"
                accessibilityLabel="Nach oben"
              >
                <Ionicons
                  name="chevron-up"
                  size={16}
                  color={index === 0 ? colors.border : colors.textFaint}
                />
              </Pressable>
              <Pressable
                onPress={() => void moveRule.mutateAsync({ id: item.id, direction: 'down' })}
                disabled={index === list.length - 1}
                hitSlop={6}
                style={styles.arrow}
                accessibilityRole="button"
                accessibilityLabel="Nach unten"
              >
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={index === list.length - 1 ? colors.border : colors.textFaint}
                />
              </Pressable>
            </View>

            <Pressable
              onPress={() => confirmDelete(item.id, item.text)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${item.text} löschen`}
            >
              <Ionicons name="trash-outline" size={18} color={colors.textFaint} />
            </Pressable>
          </View>
        )}
      />
    </Screen>
  );
}
