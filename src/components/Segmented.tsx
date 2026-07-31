import { Pressable, Text, View } from 'react-native';

import { radius, spacing, typography } from '../lib/theme';
import { useAppTheme, useThemedStyles } from '../lib/theme-context';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const styles = useThemedStyles((colors) => ({
    track: {
      flexDirection: 'row' as const,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      padding: 3,
      gap: 3,
    },
    segment: {
      flex: 1,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.sm,
      alignItems: 'center' as const,
    },
    segmentActive: { backgroundColor: colors.surface },
    label: { ...typography.caption, color: colors.textMuted },
    labelActive: { ...typography.captionStrong, color: colors.text },
  }));

  return (
    <View style={styles.track}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, active && styles.segmentActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  active,
  color,
  disabled,
  onPress,
}: {
  label: string;
  active?: boolean;
  color?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    chipLabel: { ...typography.caption, color: c.textMuted },
  }));

  const accent = color ?? colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        active && { backgroundColor: accent + '1F', borderColor: accent },
        disabled && { opacity: 0.4 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
    >
      <Text style={[styles.chipLabel, active && { color: accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}
