import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { spacing, typography, type ThemeColors } from '../lib/theme';
import { useAppTheme, useThemedStyles } from '../lib/theme-context';

function screenStyles(colors: ThemeColors) {
  return {
    screen: { flex: 1 as const, backgroundColor: colors.background },
    padded: { paddingHorizontal: spacing.lg },
  };
}

interface ScreenProps {
  children: ReactNode;
  edges?: readonly Edge[];
  style?: ViewStyle;
  padded?: boolean;
}

export function Screen({ children, edges = ['top'], style, padded = false }: ScreenProps) {
  const styles = useThemedStyles(screenStyles);
  return (
    <SafeAreaView style={[styles.screen, padded && styles.padded, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const styles = useThemedStyles((colors) => ({
    header: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      gap: spacing.md,
    },
    headerText: { flex: 1 as const, gap: 2 },
    headerTitle: { ...typography.display, color: colors.text },
    headerSubtitle: { ...typography.caption, color: colors.textMuted },
  }));

  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function LoadingState({ label = 'Lädt…' }: { label?: string }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(centeredStyles);
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.centeredText}>{label}</Text>
    </View>
  );
}

export function ErrorState({ error, hint }: { error: unknown; hint?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  const styles = useThemedStyles(centeredStyles);
  return (
    <View style={styles.centered}>
      <Text style={styles.errorTitle}>Etwas ist schiefgelaufen</Text>
      <Text style={styles.centeredText}>{message}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function centeredStyles(colors: ThemeColors) {
  return {
    centered: {
      flex: 1 as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      padding: spacing.xl,
      gap: spacing.sm,
    },
    centeredText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' as const },
    errorTitle: { ...typography.heading, color: colors.text },
    hint: { ...typography.caption, color: colors.textFaint, textAlign: 'center' as const },
  };
}
