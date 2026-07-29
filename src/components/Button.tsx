import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';

import { radius, spacing, typography } from '../lib/theme';
import { useAppTheme, useThemedStyles } from '../lib/theme-context';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  haptic?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  icon,
  haptic = true,
  style,
}: ButtonProps) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    base: {
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      minHeight: 46,
    },
    lg: { paddingVertical: spacing.lg, minHeight: 54 },
    content: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    label: { ...typography.bodyStrong },
    pressed: { opacity: 0.75 },
    disabled: { opacity: 0.45 },

    primary: { backgroundColor: c.primary },
    primaryLabel: { color: c.textInverse },

    secondary: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    secondaryLabel: { color: c.text },

    ghost: { backgroundColor: 'transparent' },
    ghostLabel: { color: c.primary },

    danger: { backgroundColor: c.danger },
    dangerLabel: { color: c.textInverse },
  }));

  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.lg,
        styles[variant],
        pressed && !inactive && styles.pressed,
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'danger' ? colors.textInverse : colors.text}
        />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}
