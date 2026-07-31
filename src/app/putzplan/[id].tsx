import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar, Badge } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState, LoadingState, Screen } from '../../components/Screen';
import { TaskForm, taskToValues, type TaskFormValues } from '../../features/cleaning/components/TaskForm';
import {
  useCompleteTask,
  useCompletions,
  useDeleteTask,
  useTask,
  useUndoCompletion,
  useUpdateTask,
} from '../../features/cleaning/hooks';
import { useMemberMap } from '../../features/household/hooks';
import { Alert } from '../../lib/alert';
import type { CleaningTaskRow } from '../../lib/database.types';
import { dueLabel, formatDate, recurrenceLabel, relativeTime } from '../../lib/format';
import { getStatusColor, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    headerAction: { ...typography.body, color: c.primary },
    hero: { gap: spacing.sm },
    heroTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    areaChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
    areaDot: { width: 8, height: 8, borderRadius: 4 },
    areaLabel: { ...typography.caption, color: c.textMuted },
    dueBig: { ...typography.display, color: c.text, marginTop: spacing.sm },
    dueDate: { ...typography.caption, color: c.textMuted },
    doneButton: { marginTop: spacing.md },
    section: { gap: 0, paddingVertical: spacing.sm },
    sectionTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginLeft: spacing.xs,
    },
    historyRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.md },
    historyText: { flex: 1, gap: 1 },
    historyName: { ...typography.bodyStrong, color: c.text },
    historyMeta: { ...typography.caption, color: c.textMuted },
    undoLink: { ...typography.captionStrong, color: c.primary },
    empty: { ...typography.caption, color: c.textFaint, paddingVertical: spacing.md },
    divider: { height: 1, backgroundColor: c.border, marginLeft: 36 },
  }));

  const { data: task, isLoading, error } = useTask(id);
  const { data: completions } = useCompletions(id);
  const members = useMemberMap();

  const completeTask = useCompleteTask();
  const undoCompletion = useUndoCompletion();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const [editing, setEditing] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;
  if (!task) return <ErrorState error={new Error('Aufgabe nicht gefunden')} />;

  const status = getStatusColor(colors)[task.status];

  async function save(values: TaskFormValues) {
    try {
      await updateTask.mutateAsync({ taskId: id, patch: values });
      setEditing(false);
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', err instanceof Error ? err.message : String(err));
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Aufgabe löschen?',
      'Die Aufgabe und ihre gesamte Historie werden entfernt.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await deleteTask.mutateAsync(id);
            router.back();
          },
        },
      ],
    );
  }

  /**
   * Only the most recent completion can be undone: undo_cleaning_completion()
   * restores the next_due_on / assigned_to that were true right before it,
   * which is only a meaningful state to go back to for the last entry — an
   * older one has already been superseded by what happened after it.
   */
  function confirmUndo(completionId: string) {
    Alert.alert(
      'Erledigung rückgängig machen?',
      'Der Termin und die Zuständigkeit werden auf den Stand davor zurückgesetzt.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Rückgängig machen',
          style: 'destructive',
          onPress: () => void undoCompletion.mutateAsync(completionId),
        },
      ],
    );
  }

  if (editing) {
    return (
      <Screen edges={[]}>
        <Stack.Screen options={{ title: 'Bearbeiten' }} />
        <TaskForm
          // The agenda view carries every column of cleaning_tasks, so it can
          // be fed straight into the editor.
          initial={taskToValues(task as unknown as CleaningTaskRow)}
          submitLabel="Änderungen speichern"
          onSubmit={(values) => void save(values)}
          submitting={updateTask.isPending}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          title: task.name,
          headerRight: () => (
            <Pressable onPress={() => setEditing(true)} hitSlop={8}>
              <Text style={styles.headerAction}>Bearbeiten</Text>
            </Pressable>
          ),
        }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <Badge label={status.label} fg={status.fg} bg={status.bg} />
            {task.area_name ? (
              <View style={styles.areaChip}>
                <View style={[styles.areaDot, { backgroundColor: task.area_color ?? colors.primary }]} />
                <Text style={styles.areaLabel}>{task.area_name}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.dueBig}>{dueLabel(task.days_until)}</Text>
          <Text style={styles.dueDate}>Fällig am {formatDate(task.next_due_on, {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
          })}</Text>

          <Button
            label="Als erledigt markieren"
            onPress={() => void completeTask.mutateAsync({ taskId: id })}
            loading={completeTask.isPending}
            size="lg"
            style={styles.doneButton}
          />
        </Card>

        <Card style={styles.section}>
          <Row
            icon="repeat"
            label="Rhythmus"
            value={recurrenceLabel(task)}
            hint={
              task.schedule_mode === 'fixed'
                ? 'Fester Termin — verschiebt sich nicht, wenn später erledigt wird.'
                : 'Zählt ab dem Tag der Erledigung.'
            }
          />
          <View style={styles.divider} />
          <Row
            icon="person"
            label="Zuständig"
            value={task.assignee_name ?? 'Niemand'}
            hint={task.assignment_mode === 'rotating' ? 'Wechselt nach jeder Erledigung' : 'Feste Zuordnung'}
            accessory={<Avatar name={task.assignee_name} color={task.assignee_color} size={28} />}
          />
          {task.estimated_minutes ? (
            <>
              <View style={styles.divider} />
              <Row icon="time" label="Dauer" value={`ca. ${task.estimated_minutes} Minuten`} />
            </>
          ) : null}
          <View style={styles.divider} />
          <Row
            icon="notifications"
            label="Erinnerung"
            value={task.reminder_enabled ? 'Aktiv' : 'Aus'}
            hint={
              task.reminder_enabled
                ? task.remind_days_before > 0
                  ? `${task.remind_days_before} Tag(e) vorher`
                  : 'Am Tag der Fälligkeit'
                : undefined
            }
          />
        </Card>

        <Text style={styles.sectionTitle}>Verlauf</Text>
        <Card style={styles.section}>
          {(completions ?? []).length === 0 ? (
            <Text style={styles.empty}>Noch nie erledigt.</Text>
          ) : (
            (completions ?? []).map((completion, index) => {
              const person = completion.completed_by ? members[completion.completed_by] : null;
              const lateDays = Math.round(
                (new Date(completion.completed_at).setHours(0, 0, 0, 0) -
                  new Date(`${completion.due_on}T00:00:00`).getTime()) /
                  86_400_000,
              );

              return (
                <View key={completion.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.historyRow}>
                    <Avatar name={person?.display_name} color={person?.color} size={28} />
                    <View style={styles.historyText}>
                      <Text style={styles.historyName}>{person?.display_name ?? 'Unbekannt'}</Text>
                      <Text style={styles.historyMeta}>
                        {relativeTime(completion.completed_at)}
                        {lateDays > 0 ? ` · ${lateDays} Tag(e) zu spät` : ''}
                      </Text>
                    </View>
                    {/* Only the latest completion can be undone — see confirmUndo(). */}
                    {index === 0 ? (
                      <Pressable
                        onPress={() => confirmUndo(completion.id)}
                        hitSlop={8}
                        disabled={undoCompletion.isPending}
                        accessibilityRole="button"
                        accessibilityLabel="Diese Erledigung rückgängig machen"
                      >
                        <Text style={styles.undoLink}>Rückgängig</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </Card>

        <Button label="Aufgabe löschen" variant="ghost" onPress={confirmDelete} />
      </ScrollView>
    </Screen>
  );
}

function Row({
  icon,
  label,
  value,
  hint,
  accessory,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  hint?: string;
  accessory?: React.ReactNode;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingVertical: spacing.md },
    rowIcon: { width: 20 },
    rowText: { flex: 1, gap: 1 },
    rowLabel: { ...typography.micro, color: c.textFaint, textTransform: 'uppercase' as const },
    rowValue: { ...typography.bodyStrong, color: c.text },
    rowHint: { ...typography.caption, color: c.textMuted },
  }));

  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={colors.textFaint} style={styles.rowIcon} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {accessory}
    </View>
  );
}
