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
import { exportDogCommands } from '../../features/dogs/export';
import {
  useAddDogCommand,
  useDeleteDogCommand,
  useDogCommands,
  useUpdateDogCommand,
} from '../../features/dogs/hooks';
import { Alert } from '../../lib/alert';
import type { DogCommandRow } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import { radius, shadow, spacing, type ThemeColors, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';
import { usePressDim } from '../../lib/usePressDim';

/**
 * Hundekommandos — the household's shared dog vocabulary.
 *
 * The point of writing them down is that two people use the *same* word with
 * the same meaning, so the screen is deliberately a glossary and not a training
 * log: one word, what it means, and an export that hands the whole thing to
 * whoever has the dog next.
 *
 * Editing reuses the composer at the top rather than turning a row into two
 * inputs — same reasoning as the Regeln screen: one keyboard, one place to
 * look, and the row stays readable while you change it.
 */
function dogCommandsStyles(c: ThemeColors) {
  return {
    exportButton: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceMuted,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    composer: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
    composerActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
    list: { paddingBottom: spacing.xxl * 2 },
    // Shadow lives outside SwipeRow — it clips its own bounds to hide the
    // delete action, which would clip a shadow drawn inside it too.
    rowWrap: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      ...shadow.card,
    },
    swipeContainer: { borderRadius: radius.md },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    rowEditing: { borderWidth: 1, borderColor: c.primary },
    rowText: { flex: 1, gap: 2 },
    rowPressed: { opacity: 0.7 },
    command: { ...typography.bodyStrong, color: c.text },
    description: { ...typography.caption, color: c.textMuted },
    missing: { ...typography.caption, color: c.textFaint, fontStyle: 'italic' as const },
  };
}

export default function DogCommandsScreen() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(dogCommandsStyles);

  const { data: commands, isLoading, isRefetching, refetch, error } = useDogCommands();
  const addCommand = useAddDogCommand();
  const updateCommand = useUpdateDogCommand();
  const deleteCommand = useDeleteDogCommand();
  const swipeGroup = useSwipeRowGroup();

  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  if (isLoading) return <LoadingState label="Kommandos werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const list = commands ?? [];

  async function submit() {
    const trimmed = command.trim();
    if (!trimmed) return;

    const id = editingId;
    const text = description.trim();
    setCommand('');
    setDescription('');
    setEditingId(null);

    try {
      if (id) await updateCommand.mutateAsync({ id, patch: { command: trimmed, description: text } });
      else await addCommand.mutateAsync({ command: trimmed, description: text });
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  function startEditing(entry: { id: string; command: string; description: string | null }) {
    setEditingId(entry.id);
    setCommand(entry.command);
    setDescription(entry.description ?? '');
  }

  function cancelEditing() {
    setEditingId(null);
    setCommand('');
    setDescription('');
  }

  function confirmDelete(id: string, label: string) {
    Alert.alert('Kommando löschen?', label, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: () => void deleteCommand.mutateAsync(id) },
    ]);
  }

  async function share() {
    try {
      const result = await exportDogCommands(list);
      if (result === 'copied') {
        Alert.alert('Kopiert', 'Die Kommandos liegen jetzt in der Zwischenablage.');
      }
    } catch (err) {
      Alert.alert('Export fehlgeschlagen', errorMessage(err));
    }
  }

  return (
    <Screen>
      <ScreenHeader
        title="Hundekommandos"
        subtitle={
          list.length === 0
            ? 'Damit ihr beide dasselbe Wort benutzt'
            : `${list.length} Kommando${list.length === 1 ? '' : 's'}`
        }
        right={
          list.length > 0 ? (
            <Pressable
              onPress={() => void share()}
              style={styles.exportButton}
              accessibilityRole="button"
              accessibilityLabel="Kommandos exportieren"
            >
              <Ionicons name="share-outline" size={20} color={colors.text} />
            </Pressable>
          ) : undefined
        }
      />

      <View style={styles.composer}>
        <TextField
          value={command}
          onChangeText={setCommand}
          placeholder="Kommando, z. B. Sitz"
          autoCapitalize="sentences"
        />
        <TextField
          value={description}
          onChangeText={setDescription}
          placeholder="Was soll der Hund tun? Handzeichen, Belohnung …"
          multiline
        />
        <View style={styles.composerActions}>
          {editingId ? (
            <Button label="Abbrechen" variant="secondary" onPress={cancelEditing} style={styles.flex} />
          ) : null}
          <Button
            label={editingId ? 'Änderung speichern' : 'Kommando hinzufügen'}
            onPress={() => void submit()}
            disabled={command.trim().length === 0}
            loading={addCommand.isPending || updateCommand.isPending}
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
            title="Noch keine Kommandos"
            body="Schreib oben rein, worauf der Hund hört — dann benutzt ihr beide dasselbe Wort, und der Hundesitter auch."
          />
        }
        renderItem={({ item }) => (
          <CommandRow
            item={item}
            editing={editingId === item.id}
            swipeGroup={swipeGroup}
            styles={styles}
            onEdit={() => startEditing(item)}
            onDelete={() => confirmDelete(item.id, item.command)}
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
function CommandRow({
  item,
  editing,
  swipeGroup,
  styles,
  onEdit,
  onDelete,
}: {
  item: DogCommandRow;
  editing: boolean;
  swipeGroup: SwipeRowGroup;
  styles: ReturnType<typeof dogCommandsStyles>;
  onEdit: () => void;
  onDelete: () => void;
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
            accessibilityLabel: `${item.command} löschen`,
            onPress: onDelete,
          },
        ]}
      >
        <View style={[styles.row, editing && styles.rowEditing]}>
          <Ionicons name="paw" size={18} color={colors.primary} />

          <Pressable
            onPress={onEdit}
            onPressIn={editPress.onPressIn}
            onPressOut={editPress.onPressOut}
            style={[styles.rowText, editPress.pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`${item.command} bearbeiten`}
          >
            <Text style={styles.command}>{item.command}</Text>
            {item.description ? (
              <Text style={styles.description}>{item.description}</Text>
            ) : (
              <Text style={styles.missing}>Noch ohne Beschreibung</Text>
            )}
          </Pressable>
        </View>
      </SwipeRow>
    </View>
  );
}
