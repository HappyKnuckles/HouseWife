import type { ReactNode } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';

import { radius, shadow, spacing, typography } from '../lib/theme';
import { useThemedStyles } from '../lib/theme-context';

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  const styles = useThemedStyles((colors) => ({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    pressed: { opacity: 0.85 },
  }));

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const styles = useThemedStyles((colors) => ({
    section: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    sectionTitle: { ...typography.micro, color: colors.textMuted, textTransform: 'uppercase' as const },
  }));

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const styles = useThemedStyles((colors) => ({
    empty: {
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      paddingVertical: spacing.xxl,
      paddingHorizontal: spacing.xl,
      gap: spacing.xs,
    },
    emptyTitle: { ...typography.bodyStrong, color: colors.text },
    emptyBody: { ...typography.caption, color: colors.textMuted, textAlign: 'center' as const },
  }));

  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}
