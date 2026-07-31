import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { Chip } from '../../components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
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
import { radius, shadow, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

export default function TodosScreen() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    clear: { ...typography.caption, color: c.primary },
    composer: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
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
    metaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    composerActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
  }));
  const { data: todos, isLoading, isRefetching, refetch, error } = useTodos();
  const { data: members } = useMembers();
  const memberMap = useMemberMap();

  const router = useRouter();
  const addTodo = useAddTodo();
  const updateTodo = useUpdateTodo();
  const toggleTodo = useToggleTodo();
  const deleteTodo = useDeleteTodo();
  const clearCompleted = useClearCompleted();

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
      Alert.alert('Konnte nicht gespeichert werden', err instanceof Error ? err.message : String(err));
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

          const fromInventory = item.source === 'restock';

          return (
            <View
              style={[
                styles.row,
                item.is_done && styles.rowDone,
                editingId === item.id && styles.rowEditing,
              ]}
            >
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
                {item.is_done ? <Ionicons name="checkmark" size={16} color={colors.textInverse} /> : null}
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
                {fromInventory ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="cart-outline" size={12} color={colors.textFaint} />
                    <Text style={styles.rowMeta}>
                      Bestand niedrig{person ? ` · für ${person.display_name}` : ''}
                    </Text>
                  </View>
                ) : person ? (
                  <Text style={styles.rowMeta}>für {person.display_name}</Text>
                ) : null}
              </Pressable>

              {fromInventory && item.product_id ? (
                <Pressable
                  onPress={() => router.push(`/inventar/produkt/${item.product_id}`)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Produkt öffnen"
                >
                  <Ionicons name="cube-outline" size={18} color={colors.textFaint} />
                </Pressable>
              ) : person ? (
                <Avatar name={person.display_name} color={person.color} size={24} />
              ) : null}

              <Pressable
                onPress={() => void deleteTodo.mutateAsync(item.id)}
                hitSlop={8}
                accessibilityLabel={`${item.title} löschen`}
              >
                <Ionicons name="trash-outline" size={18} color={colors.textFaint} />
              </Pressable>
            </View>
          );
        }}
      />
    </Screen>
  );
}
