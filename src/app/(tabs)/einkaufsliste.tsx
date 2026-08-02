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
import { errorMessage } from '../../lib/errors';
import { radius, shadow, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

/**
 * Einkaufsliste — the same machinery as the to-do list over the same table,
 * filtered to `list = 'shopping'` (migration 0024).
 *
 * What makes it its own screen rather than a section on the to-dos: this is
 * the one the app writes to by itself. Every staple that falls to its restock
 * threshold appears here within the same second the stock changes, so the list
 * is already right by the time you are standing in the shop — and those rows
 * carry a link back to the product, which a hand-written line cannot.
 */
export default function ShoppingListScreen() {
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

  const { data: items, isLoading, isRefetching, refetch, error } = useTodos('shopping');
  const { data: members } = useMembers();
  const memberMap = useMemberMap();

  const router = useRouter();
  const addItem = useAddTodo('shopping');
  const updateItem = useUpdateTodo();
  const toggleItem = useToggleTodo('shopping');
  const deleteItem = useDeleteTodo('shopping');
  const clearBought = useClearCompleted('shopping');

  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  /** Which entry the composer is currently editing; null = writing a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) return <LoadingState label="Einkaufsliste wird geladen…" />;
  if (error) return <ErrorState error={error} />;

  const open = (items ?? []).filter((t) => !t.is_done);
  const bought = (items ?? []).filter((t) => t.is_done);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;

    const id = editingId;
    setTitle('');
    setEditingId(null);
    setAssignee(null);

    try {
      if (id) await updateItem.mutateAsync({ id, patch: { title: trimmed, assignee_id: assignee } });
      else await addItem.mutateAsync({ title: trimmed, assigneeId: assignee });
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  function startEditing(item: { id: string; title: string; assignee_id: string | null }) {
    setEditingId(item.id);
    setTitle(item.title);
    setAssignee(item.assignee_id);
  }

  function cancelEditing() {
    setEditingId(null);
    setTitle('');
    setAssignee(null);
  }

  return (
    <Screen>
      <ScreenHeader
        title="Einkaufsliste"
        subtitle={open.length === 0 ? 'Nichts zu holen' : `${open.length} auf der Liste`}
        right={
          bought.length > 0 ? (
            <Pressable onPress={() => void clearBought.mutateAsync()} hitSlop={8}>
              <Text style={styles.clear}>Gekauftes löschen</Text>
            </Pressable>
          ) : undefined
        }
      />

      <View style={styles.composer}>
        <TextField
          value={title}
          onChangeText={setTitle}
          placeholder={editingId ? 'Eintrag ändern…' : 'Was fehlt? z. B. Milch'}
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
              loading={updateItem.isPending}
              style={styles.flex}
            />
          </View>
        ) : null}
      </View>

      <FlatList
        data={[...open, ...bought]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Nichts zu holen"
            body="Was ihr aufschreibt steht sofort auf beiden Handys — und was im Inventar zur Neige geht, landet von selbst hier."
          />
        }
        renderItem={({ item }) => {
          const person = item.assignee_id ? memberMap[item.assignee_id] : null;
          // Written by sync_restock_todos(), not by either of you.
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
                  void toggleItem.mutateAsync({ id: item.id, isDone: !item.is_done });
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
                    <Ionicons name="cube-outline" size={12} color={colors.textFaint} />
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
                  <Ionicons name="open-outline" size={18} color={colors.textFaint} />
                </Pressable>
              ) : person ? (
                <Avatar name={person.display_name} color={person.color} size={24} />
              ) : null}

              <Pressable
                onPress={() => void deleteItem.mutateAsync(item.id)}
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
