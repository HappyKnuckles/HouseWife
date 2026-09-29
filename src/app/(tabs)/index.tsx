import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';

import { EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { useSwipeRowGroup } from '../../components/SwipeRow';
import { fetchLatestCompletion } from '../../features/cleaning/api';
import { TaskCard } from '../../features/cleaning/components/TaskCard';
import { useAgenda, useCompleteTask, useDeleteTask, useUndoCompletion } from '../../features/cleaning/hooks';
import { Alert } from '../../lib/alert';
import type { CleaningAgendaRow } from '../../lib/database.types';
import { errorMessage } from '../../lib/errors';
import { getStatusColor, radius, shadow, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

interface Section {
  title: string;
  accent: string;
  data: CleaningAgendaRow[];
}

export default function PutzplanScreen() {
  const router = useRouter();
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
    list: { paddingBottom: spacing.xxl * 2 },
    sectionHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    sectionDot: { width: 8, height: 8, borderRadius: 4 },
    sectionTitle: { ...typography.micro, color: c.textMuted, textTransform: 'uppercase' as const, flex: 1 },
    sectionCount: { ...typography.micro, color: c.textFaint },
    snackbar: {
      position: 'absolute' as const,
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.lg,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      ...shadow.card,
    },
    snackbarText: { ...typography.caption, color: c.text, flex: 1 },
    snackbarAction: { ...typography.captionStrong, color: c.primary },
  }));

  const { data, isLoading, isRefetching, refetch, error } = useAgenda();
  const completeTask = useCompleteTask();
  const undoCompletion = useUndoCompletion();
  const deleteTask = useDeleteTask();
  const swipeGroup = useSwipeRowGroup();

  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ completionId: string; taskName: string } | null>(null);

  const tasks = useMemo(() => data ?? [], [data]);

  const sections = useMemo<Section[]>(() => {
    const groups: Section[] = [
      { title: 'Überfällig', accent: colors.overdue, data: tasks.filter((t) => t.status === 'overdue') },
      { title: 'Heute', accent: colors.dueToday, data: tasks.filter((t) => t.status === 'due_today') },
      { title: 'Diese Tage', accent: colors.dueSoon, data: tasks.filter((t) => t.status === 'due_soon') },
      { title: 'Später', accent: colors.upcoming, data: tasks.filter((t) => t.status === 'upcoming') },
    ];
    return groups.filter((g) => g.data.length > 0);
  }, [tasks, colors]);

  const overdueCount = tasks.filter((t) => t.status === 'overdue').length;
  const todayCount = tasks.filter((t) => t.status === 'due_today').length;

  const handleComplete = useCallback(
    async (task: CleaningAgendaRow) => {
      setPendingTaskId(task.id);
      try {
        await completeTask.mutateAsync({ taskId: task.id });
        // Offer an exact undo — the completion row carries the schedule state
        // it replaced, so restoring it is not a recomputation.
        const completion = await fetchLatestCompletion(task.id);
        if (completion) setUndo({ completionId: completion.id, taskName: task.name });
      } finally {
        setPendingTaskId(null);
      }
    },
    [completeTask],
  );

  function confirmDelete(task: CleaningAgendaRow) {
    Alert.alert('Aufgabe löschen?', 'Die Aufgabe und ihre gesamte Historie werden entfernt.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTask.mutateAsync(task.id);
          } catch (err) {
            Alert.alert('Konnte nicht gelöscht werden', errorMessage(err));
          }
        },
      },
    ]);
  }

  if (isLoading) return <LoadingState label="Putzplan wird geladen…" />;
  if (error) return <ErrorState error={error} />;

  return (
    <Screen>
      <ScreenHeader
        title="Putzplan"
        subtitle={summaryLine(overdueCount, todayCount, tasks.length)}
        right={
          <Pressable
            onPress={() => router.push('/putzplan/neu')}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Neue Aufgabe"
          >
            <Ionicons name="add" size={22} color={colors.textInverse} />
          </Pressable>
        }
      />

      {tasks.length > 0 ? <SummaryStrip overdue={overdueCount} today={todayCount} /> : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionDot, { backgroundColor: (section as Section).accent }]} />
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            busy={pendingTaskId === item.id}
            onComplete={() => void handleComplete(item)}
            onPress={() => router.push(`/putzplan/${item.id}`)}
            onDelete={() => confirmDelete(item)}
            swipeGroup={swipeGroup}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            title="Noch keine Aufgaben"
            body="Lege eure erste wiederkehrende Aufgabe an — z. B. „Bad putzen“ jeden Samstag."
          />
        }
      />

      {undo ? (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText} numberOfLines={1}>
            „{undo.taskName}“ erledigt
          </Text>
          <Pressable
            onPress={async () => {
              await undoCompletion.mutateAsync(undo.completionId);
              setUndo(null);
            }}
            hitSlop={8}
          >
            <Text style={styles.snackbarAction}>Rückgängig</Text>
          </Pressable>
          <Pressable onPress={() => setUndo(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textFaint} />
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

function summaryLine(overdue: number, today: number, total: number): string {
  if (total === 0) return 'Noch nichts geplant';
  if (overdue > 0) return `${overdue} überfällig · ${today} heute fällig`;
  if (today > 0) return `${today} heute fällig · alles andere im Plan`;
  return 'Alles im Plan 🎉';
}

function SummaryStrip({ overdue, today }: { overdue: number; today: number }) {
  const { colors } = useAppTheme();
  const status = getStatusColor(colors);
  const styles = useThemedStyles(() => ({
    strip: {
      flexDirection: 'row' as const,
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },
  }));

  return (
    <View style={styles.strip}>
      <StatTile value={overdue} label="überfällig" fg={status.overdue.fg} bg={status.overdue.bg} />
      <StatTile value={today} label="heute" fg={status.due_today.fg} bg={status.due_today.bg} />
    </View>
  );
}

function StatTile({ value, label, fg, bg }: { value: number; label: string; fg: string; bg: string }) {
  const styles = useThemedStyles(() => ({
    tile: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
    tileValue: { ...typography.display, fontSize: 26 },
    tileLabel: { ...typography.micro },
  }));

  return (
    <View style={[styles.tile, { backgroundColor: bg }]}>
      <Text style={[styles.tileValue, { color: fg }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}
