import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text, View } from 'react-native';
// Gesture-handler's Pressable, not React Native's — see the comment in
// components/Card.tsx. This card sits inside a SwipeRow.
import { Pressable } from 'react-native-gesture-handler';

import { Avatar } from '../../../components/Avatar';
import { SwipeRow, type SwipeRowGroup } from '../../../components/SwipeRow';
import type { CleaningAgendaRow } from '../../../lib/database.types';
import { dueLabel, recurrenceLabel } from '../../../lib/format';
import { getStatusColor, radius, shadow, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';
import { usePressDim } from '../../../lib/usePressDim';

interface TaskCardProps {
  task: CleaningAgendaRow;
  onComplete: () => void;
  onPress: () => void;
  busy?: boolean;
  /** Swiping left reveals "Löschen" when given; omitted, the card has no swipe action. */
  onDelete?: () => void;
  /** Coordinates this card with the rest of the list so opening one closes another. */
  swipeGroup?: SwipeRowGroup;
}

export function TaskCard({ task, onComplete, onPress, busy, onDelete, swipeGroup }: TaskCardProps) {
  const { colors } = useAppTheme();
  const status = getStatusColor(colors)[task.status];

  const styles = useThemedStyles((c) => ({
    // Shadow and margin live out here rather than on `card`: SwipeRow clips
    // its own bounds to hide the delete action off-screen, and overflow:
    // hidden on an ancestor clips a shadow drawn inside it just the same as
    // it clips content.
    wrap: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      borderRadius: radius.lg,
      ...shadow.card,
    },
    swipeContainer: { borderRadius: radius.lg },
    card: {
      flexDirection: 'row' as const,
      alignItems: 'stretch' as const,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      overflow: 'hidden' as const,
    },
    mainPressable: { flex: 1, flexDirection: 'row' as const, minWidth: 0 },
    pressed: { opacity: 0.9 },
    rail: { width: 4, alignSelf: 'stretch' as const },
    body: {
      flex: 1,
      minWidth: 0,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      gap: 6,
    },
    headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    name: { ...typography.heading, color: c.text, flexShrink: 1 },
    minutes: { ...typography.caption, color: c.textFaint },
    metaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, minWidth: 0 },
    areaChip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      flexShrink: 0,
    },
    areaDot: { width: 6, height: 6, borderRadius: 3 },
    areaLabel: { ...typography.micro, color: c.text },
    recurrence: { ...typography.caption, color: c.textMuted, flexShrink: 1 },
    footerRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.sm,
      minWidth: 0,
    },
    assignee: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flex: 1, minWidth: 0 },
    assigneeName: { ...typography.caption, color: c.textMuted, flexShrink: 1 },
    due: { ...typography.captionStrong, flexShrink: 0 },
    checkArea: { width: 64, alignItems: 'center' as const, justifyContent: 'center' as const },
    checkButton: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      borderWidth: 2,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    checkBusy: { opacity: 0.4 },
  }));
  // Not Pressable's own `pressed` render-prop: this card sits inside a
  // SwipeRow, and that fires the instant a finger lands — including the
  // first moment of a swipe drag — see the comment on usePressDim.
  const mainPress = usePressDim();
  const checkPress = usePressDim();

  return (
    <View style={styles.wrap}>
      <SwipeRow
        id={task.id}
        group={swipeGroup}
        containerStyle={styles.swipeContainer}
        rightActions={
          onDelete
            ? [
                {
                  key: 'delete',
                  icon: 'trash-outline',
                  label: 'Löschen',
                  tone: 'danger',
                  accessibilityLabel: `${task.name} löschen`,
                  onPress: onDelete,
                },
              ]
            : undefined
        }
      >
        <View style={styles.card}>
          {/* LEFT / MAIN CARD PRESS TARGET */}
          <Pressable
            onPress={onPress}
            onPressIn={mainPress.onPressIn}
            onPressOut={mainPress.onPressOut}
            style={[styles.mainPressable, mainPress.pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${task.name}, ${dueLabel(task.days_until)}`}
          >
            <View style={[styles.rail, { backgroundColor: status.fg }]} />

            <View style={styles.body}>
              {/* Title */}
              <View style={styles.headerRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {task.name}
                </Text>

                {task.estimated_minutes ? (
                  <Text style={styles.minutes}>{task.estimated_minutes} Min.</Text>
                ) : null}
              </View>

              {/* Area + recurrence */}
              <View style={styles.metaRow}>
                {task.area_name ? (
                  <View
                    style={[
                      styles.areaChip,
                      { backgroundColor: (task.area_color ?? colors.primary) + '1A' },
                    ]}
                  >
                    <View
                      style={[styles.areaDot, { backgroundColor: task.area_color ?? colors.primary }]}
                    />

                    <Text style={styles.areaLabel}>{task.area_name}</Text>
                  </View>
                ) : null}

                <Text style={styles.recurrence} numberOfLines={1}>
                  {recurrenceLabel(task)}
                </Text>
              </View>

              {/* Assignee + due */}
              <View style={styles.footerRow}>
                <View style={styles.assignee}>
                  <Avatar name={task.assignee_name} color={task.assignee_color} size={22} />

                  <Text style={styles.assigneeName} numberOfLines={1}>
                    {task.assignee_name ?? 'Niemand zugewiesen'}
                    {task.assignment_mode === 'rotating' ? ' · im Wechsel' : ''}
                  </Text>
                </View>

                <Text style={[styles.due, { color: status.fg }]}>{dueLabel(task.days_until)}</Text>
              </View>
            </View>
          </Pressable>

          {/* RIGHT / CHECK PRESS TARGET */}
          <View style={styles.checkArea}>
            <Pressable
              onPress={() => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onComplete();
              }}
              onPressIn={checkPress.onPressIn}
              onPressOut={checkPress.onPressOut}
              disabled={busy}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${task.name} als erledigt markieren`}
              style={[
                styles.checkButton,
                { borderColor: status.fg },
                checkPress.pressed && { backgroundColor: status.bg },
                busy && styles.checkBusy,
              ]}
            >
              <Ionicons name="checkmark" size={20} color={status.fg} />
            </Pressable>
          </View>
        </View>
      </SwipeRow>
    </View>
  );
}
