import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { radius, spacing, typography } from '../lib/theme';
import { useAppTheme, useThemedStyles } from '../lib/theme-context';

interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
}

export function TextField({ label, error, hint, style, ...rest }: TextFieldProps) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    wrapper: { gap: spacing.xs },
    label: { ...typography.captionStrong, color: c.textMuted },
    input: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      ...typography.body,
      color: c.text,
      minHeight: 46,
    },
    inputError: { borderColor: c.danger },
    error: { ...typography.caption, color: c.danger },
    hint: { ...typography.caption, color: c.textFaint },
  }));

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        style={[styles.input, !!error && styles.inputError, style]}
        {...rest}
      />
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(() => ({
    row: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'flex-end' as const },
  }));
  return <View style={styles.row}>{children}</View>;
}
