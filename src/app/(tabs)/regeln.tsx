import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
// Gesture-handler's Pressable, not React Native's — see the comment in
// components/Card.tsx. Rows here sit inside a SwipeRow.
import { Pressable } from 'react-native-gesture-handler';

import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { SwipeRow, useSwipeRowGroup, type SwipeRowGroup } from '../../components/SwipeRow';
import { TextField } from '../../components/TextField';
import {
  useAddRule,
  useDeleteRule,
  useMoveRule,
  useRules,
  useUpdateRule,
} from '../../features/rules/hooks';
import { Alert } from '../../lib/alert';
import type { HouseRuleRow } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import { radius, shadow, spacing, type ThemeColors, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';
import { usePressDim } from '../../lib/usePressDim';

/**
 * Hausregeln — the things you agree on once and then forget.
 *
 * Editing reuses the composer at the top rather than turning a row into an
 * input: one text field, one keyboard, and the row keeps its number while you
 * change it.
 */
function rulesStyles(c: ThemeColors) {
  return {
    composer: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
    composerActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
    list: { paddingBottom: spacing.xxl * 2 },
    rowWrap: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      ...shadow.card,
    },
    swipeContainer: { borderRadius: radius.md },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    rowEditing: { borderWidth: 1, borderColor: c.primary },
    rowPressed: { opacity: 0.7 },
    number: { ...typography.bodyStrong, color: c.primary, minWidth: 22 },
    rowText: { flex: 1, ...typography.body, color: c.text },
    arrows: { gap: 2 },
    arrow: { paddingHorizontal: spacing.xs },
  };
}

export default function RulesScreen() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(rulesStyles);

  const { data: rules, isLoading, isRefetching, refetch, error } = useRules();
  const addRule = useAddRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const moveRule = useMoveRule();
  const swipeGroup = useSwipeRowGroup();

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
          <RuleRow
            item={item}
            index={index}
            isFirst={index === 0}
            isLast={index === list.length - 1}
            editing={editingId === item.id}
            swipeGroup={swipeGroup}
            styles={styles}
            onEdit={() => startEditing(item.id, item.text)}
            onDelete={() => confirmDelete(item.id, item.text)}
            onMoveUp={() => void moveRule.mutateAsync({ id: item.id, direction: 'up' })}
            onMoveDown={() => void moveRule.mutateAsync({ id: item.id, direction: 'down' })}
          />
        )}
      />
    </Screen>
  );
}

/**
 * Its own component, not inline in `renderItem`: the delayed press-dim
 * below needs `usePressDim()`, which only gets its own slot of state when
 * called from a real per-row component instance — see the same note on
 * TodoRow in todos.tsx.
 */
function RuleRow({
  item,
  index,
  isFirst,
  isLast,
  editing,
  swipeGroup,
  styles,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  item: HouseRuleRow;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  editing: boolean;
  swipeGroup: SwipeRowGroup;
  styles: ReturnType<typeof rulesStyles>;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { colors } = useAppTheme();
  // Not Pressable's own `pressed` render-prop: this row sits inside a
  // SwipeRow, and that fires the instant a finger lands — including the
  // first moment of a swipe drag — see the comment on usePressDim.
  const editPress = usePressDim();

  return (
    <View style={styles.rowWrap}>
      <SwipeRow
        id={item.id}
        group={swipeGroup}
        containerStyle={styles.swipeContainer}
        rightActions={[
          {
            key: 'delete',
            icon: 'trash-outline',
            label: 'Löschen',
            tone: 'danger',
            accessibilityLabel: `${item.text} löschen`,
            onPress: onDelete,
          },
        ]}
      >
        <View style={[styles.row, editing && styles.rowEditing]}>
          <Text style={styles.number}>{index + 1}.</Text>

          <Pressable
            onPress={onEdit}
            onPressIn={editPress.onPressIn}
            onPressOut={editPress.onPressOut}
            style={[styles.flex, editPress.pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${item.text} bearbeiten`}
          >
            <Text style={styles.rowText}>{item.text}</Text>
          </Pressable>

          <View style={styles.arrows}>
            <Pressable
              onPress={onMoveUp}
              disabled={isFirst}
              hitSlop={6}
              style={styles.arrow}
              accessibilityRole="button"
              accessibilityLabel="Nach oben"
            >
              <Ionicons name="chevron-up" size={16} color={isFirst ? colors.border : colors.textFaint} />
            </Pressable>
            <Pressable
              onPress={onMoveDown}
              disabled={isLast}
              hitSlop={6}
              style={styles.arrow}
              accessibilityRole="button"
              accessibilityLabel="Nach unten"
            >
              <Ionicons name="chevron-down" size={16} color={isLast ? colors.border : colors.textFaint} />
            </Pressable>
          </View>
        </View>
      </SwipeRow>
    </View>
  );
}
