import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Avatar } from '../../src/components/Avatar';
import { EmptyState } from '../../src/components/Card';
import { Chip } from '../../src/components/Segmented';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useMemberMap, useMembers } from '../../src/features/household/hooks';
import {
  useAddTodo,
  useClearCompleted,
  useDeleteTodo,
  useTodos,
  useToggleTodo,
} from '../../src/features/todos/hooks';
import { radius, shadow, spacing, typography } from '../../src/lib/theme';
import { useAppTheme, useThemedStyles } from '../../src/lib/theme-context';

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
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.body, color: c.text },
    rowTitleDone: { textDecorationLine: 'line-through' as const, color: c.textMuted },
    rowMeta: { ...typography.caption, color: c.textFaint },
  }));
  const { data: todos, isLoading, isRefetching, refetch, error } = useTodos();
  const { data: members } = useMembers();
  const memberMap = useMemberMap();

  const addTodo = useAddTodo();
  const toggleTodo = useToggleTodo();
  const deleteTodo = useDeleteTodo();
  const clearCompleted = useClearCompleted();

  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);

  if (isLoading) return <LoadingState label="To-dos werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const open = (todos ?? []).filter((t) => !t.is_done);
  const done = (todos ?? []).filter((t) => t.is_done);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;

    setTitle('');
    await addTodo.mutateAsync({ title: trimmed, assigneeId: assignee });
  }

  return (
    <Screen>
      <ScreenHeader
        title="To-dos"
        subtitle={open.length === 0 ? 'Nichts offen 🎉' : `${open.length} offen`}
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
          placeholder="Was muss erledigt werden?"
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
            <View style={[styles.row, item.is_done && styles.rowDone]}>
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

              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, item.is_done && styles.rowTitleDone]} numberOfLines={2}>
                  {item.title}
                </Text>
                {person ? <Text style={styles.rowMeta}>für {person.display_name}</Text> : null}
              </View>

              {person ? <Avatar name={person.display_name} color={person.color} size={24} /> : null}

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
