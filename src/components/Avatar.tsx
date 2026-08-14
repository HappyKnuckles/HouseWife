import { Text, View } from 'react-native';

import { readableTextOn } from '../lib/color';
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
  accessibilityLabel,
}: {
  name: string | null | undefined;
  color?: string | null;
  size?: number;
  /**
   * What the colour means here. Two initials in a coloured circle is a rebus,
   * not a label — where the avatar is the *only* thing carrying a fact (who
   * wrote this line), a screen reader needs the fact spelled out.
   */
  accessibilityLabel?: string;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(() => ({
    avatar: { alignItems: 'center' as const, justifyContent: 'center' as const },
    label: { ...typography.captionStrong },
  }));

  const label = name ? initials(name) : '–';
  const background = color ?? colors.surfaceMuted;

  // Measured against the background rather than hard-coded white. It used to
  // be white unconditionally, which was safe only for as long as every color
  // arriving here was a saturated preset — a picker makes pale yellow
  // reachable, and white initials on it are simply gone. It also fixes the
  // case that was already broken: with no color at all the circle is
  // surfaceMuted, a near-white, and the "–" placeholder was invisible on it.
  const ink = readableTextOn(background);

  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: radius.pill, backgroundColor: background },
      ]}
    >
      <Text style={[styles.label, { fontSize: size * 0.38, color: ink }]}>{label}</Text>
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
