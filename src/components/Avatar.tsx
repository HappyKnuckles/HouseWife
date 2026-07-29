import { Text, View } from 'react-native';

import { initials } from '../lib/format';
import { radius, typography } from '../lib/theme';
import { useAppTheme, useThemedStyles } from '../lib/theme-context';

/**
 * Person chip. The colour comes from profiles.color, which is why "who is
 * responsible" is readable at a glance across the Putzplan, the balance card
 * and the to-do list without reading a single name.
 */
export function Avatar({
  name,
  color,
  size = 32,
}: {
  name: string | null | undefined;
  color?: string | null;
  size?: number;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(() => ({
    avatar: { alignItems: 'center' as const, justifyContent: 'center' as const },
    // Always white: the avatar's own background is a saturated per-person
    // color regardless of theme, so the label never needs to invert.
    label: { ...typography.captionStrong, color: '#FFFFFF' },
  }));

  const label = name ? initials(name) : '–';
  const background = color ?? colors.surfaceMuted;

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: radius.pill, backgroundColor: background },
      ]}
    >
      <Text style={[styles.label, { fontSize: size * 0.38 }]}>{label}</Text>
    </View>
  );
}

export function Badge({
  label,
  fg,
  bg,
}: {
  label: string;
  fg: string;
  bg: string;
}) {
  const styles = useThemedStyles(() => ({
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
    badgeLabel: { ...typography.micro },
  }));

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}
