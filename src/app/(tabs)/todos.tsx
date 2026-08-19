import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
// Gesture-handler's Pressable, not React Native's — see the comment in
// components/Card.tsx. Rows here sit inside a SwipeRow.
import { Pressable } from 'react-native-gesture-handler';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Chip } from '../../components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { SwipeRow, useSwipeRowGroup } from '../../components/SwipeRow';
import { TextField } from '../../components/TextField';
import { useMemberMap, useMembers } from '../../features/household/hooks';
import {
  useAddTodo,
  useClearCompleted,
  useDeleteTodo,
  useTodos,
  useToggleTodo,
  useUpdateTodo,
} from '../../features/todos/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';
import { radius, shadow, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

export default function TodosScreen() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    clear: { ...typography.caption, color: c.primary },
    composer: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    list: { paddingBottom: spacing.xxl * 2 },
    // The shadow lives out here rather than on `row`: SwipeRow clips its own
    // bounds to hide the delete action off-screen, and overflow: hidden on an
    // ancestor clips a shadow drawn inside it just the same as it clips
    // content. `swipeContainer` only carries the matching border radius, so
    // the revealed action's corners line up with the card peeking out from
    // behind it.
    rowWrap: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      ...shadow.card,
    },
    swipeContainer: { borderRadius: radius.md },
    row: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    // Fading `row` itself let the swipe action's color bleed through a done
    // item's card even before swiping (an opaque background stops being
    // opaque at 55%) — so the fade lives on the content instead, and `row`
    // stays a solid card no matter what sits behind it.
    rowContent: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    rowDone: { opacity: 0.55 },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      borderWidth: 2,
      borderColor: c.borderStrong,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    checkboxDone: { backgroundColor: c.success, borderColor: c.success },
    rowEditing: { borderWidth: 1, borderColor: c.primary },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.body, color: c.text },
    rowTitleDone: { textDecorationLine: 'line-through' as const, color: c.textMuted },
    rowMeta: { ...typography.caption, color: c.textFaint },
    composerActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
  }));
  const { data: todos, isLoading, isRefetching, refetch, error } = useTodos('todo');
  const { data: members } = useMembers();
  const memberMap = useMemberMap();

  const addTodo = useAddTodo('todo');
  const updateTodo = useUpdateTodo();
  const toggleTodo = useToggleTodo('todo');
  const deleteTodo = useDeleteTodo('todo');
  const clearCompleted = useClearCompleted('todo');
  const swipeGroup = useSwipeRowGroup();

  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  /** Which to-do the composer is currently editing; null = writing a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) return <LoadingState label="To-dos werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const open = (todos ?? []).filter((t) => !t.is_done);
  const done = (todos ?? []).filter((t) => t.is_done);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;

    const id = editingId;
    setTitle('');
    setEditingId(null);
    setAssignee(null);

    try {
      if (id) await updateTodo.mutateAsync({ id, patch: { title: trimmed, assignee_id: assignee } });
      else await addTodo.mutateAsync({ title: trimmed, assigneeId: assignee });
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  function startEditing(todo: { id: string; title: string; assignee_id: string | null }) {
    setEditingId(todo.id);
    setTitle(todo.title);
    setAssignee(todo.assignee_id);
  }

  function cancelEditing() {
    setEditingId(null);
    setTitle('');
    setAssignee(null);
  }

  function confirmDelete(id: string, title: string) {
    Alert.alert(`${title} löschen?`, 'Das lässt sich nicht rückgängig machen.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: () => void deleteTodo.mutateAsync(id) },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader
        title="To-dos"
        subtitle={open.length === 0 ? 'Nichts offen' : `${open.length} offen`}
        right={
          done.length > 0 ? (
            <Pressable onPress={() => void clearCompleted.mutateAsync()} hitSlop={8}>
              <Text style={styles.clear}>Erledigte löschen</Text>
            </Pressable>
          ) : undefined
        }
      />

      <View style={styles.composer}>
        <TextField
          value={title}
          onChangeText={setTitle}
          placeholder={editingId ? 'To-do ändern…' : 'Was muss erledigt werden?'}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        <View style={styles.chipRow}>
          <Chip label="Egal wer" active={!assignee} onPress={() => setAssignee(null)} />
          {(members ?? []).map((member) => (
            <Chip
              key={member.id}
              label={member.display_name}
              color={member.color}
              active={assignee === member.id}
              onPress={() => setAssignee(member.id)}
            />
          ))}
        </View>
        {editingId ? (
          <View style={styles.composerActions}>
            <Button label="Abbrechen" variant="secondary" onPress={cancelEditing} style={styles.flex} />
            <Button
              label="Speichern"
              onPress={() => void submit()}
              disabled={title.trim().length === 0}
              loading={updateTodo.isPending}
              style={styles.flex}
            />
          </View>
        ) : null}
      </View>

      <FlatList
        data={[...open, ...done]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState title="Alles erledigt" body="Neue Aufgaben landen hier — bei euch beiden sofort." />
        }
        renderItem={({ item }) => {
          const person = item.assignee_id ? memberMap[item.assignee_id] : null;

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
                    accessibilityLabel: `${item.title} löschen`,
                    onPress: () => confirmDelete(item.id, item.title),
                  },
                ]}
              >
                <View style={[styles.row, editingId === item.id && styles.rowEditing]}>
                  <View style={[styles.rowContent, item.is_done && styles.rowDone]}>
                    <Pressable
                      onPress={() => {
                        void Haptics.selectionAsync();
                        void toggleTodo.mutateAsync({ id: item.id, isDone: !item.is_done });
                      }}
                      hitSlop={8}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.is_done }}
                      style={[styles.checkbox, item.is_done && styles.checkboxDone]}
                    >
                      {item.is_done ? (
                        <Ionicons name="checkmark" size={16} color={colors.textInverse} />
                      ) : null}
                    </Pressable>

                    <Pressable
                      onPress={() => startEditing(item)}
                      style={styles.rowText}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title} bearbeiten`}
                    >
                      <Text style={[styles.rowTitle, item.is_done && styles.rowTitleDone]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {person ? <Text style={styles.rowMeta}>für {person.display_name}</Text> : null}
                    </Pressable>

                    {person ? <Avatar name={person.display_name} color={person.color} size={24} /> : null}
                  </View>
                </View>
              </SwipeRow>
            </View>
          );
        }}
      />
    </Screen>
  );
}
