import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, Text, View } from 'react-native';

import { radius, spacing, typography } from '../lib/theme';
import { useAppTheme, useThemedStyles } from '../lib/theme-context';

interface TabDefinition {
  /** Route name — the file under `src/app/(tabs)`, minus the extension. */
  name: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/**
 * Every tab, in bar order. The first `PRIMARY_COUNT` get their own slot; the
 * rest live in the Mehr sheet. Reordering the app's navigation is moving a
 * line in this list — which is the whole reason the titles and icons are here
 * rather than spread across seven `Tabs.Screen` declarations.
 */
const TABS: TabDefinition[] = [
  { name: 'index', title: 'Putzplan', icon: 'sparkles' },
  { name: 'todos', title: 'To-dos', icon: 'checkbox' },
  // Einkauf and Inventar are one errand seen from two ends — what is missing
  // and what is there — so they sit next to each other and ahead of Ausgaben,
  // which is the screen you open once a week while sitting down.
  { name: 'einkaufsliste', title: 'Einkauf', icon: 'cart' },
  { name: 'inventar', title: 'Inventar', icon: 'cube' },
  { name: 'ausgaben', title: 'Ausgaben', icon: 'wallet' },
  { name: 'termine', title: 'Termine', icon: 'calendar' },
  { name: 'regeln', title: 'Regeln', icon: 'book' },
  { name: 'hunde', title: 'Hund', icon: 'paw' },
  { name: 'einstellungen', title: 'Einstellungen', icon: 'settings' },
];

/**
 * Four plus Mehr. Five 60pt-wide slots is about what fits on a phone before
 * the labels start truncating, and a bar you cannot read is not navigation.
 */
const PRIMARY_COUNT = 4;

/** Out is quicker than in: dismissing should feel like it already happened. */
const OPEN_MS = 220;
const CLOSE_MS = 160;

/**
 * Transform and opacity are both native-driver safe, and moving them off the
 * JS thread keeps the sheet smooth while a tab's screen mounts behind it.
 * react-native-web has no native animated module and warns when asked for one.
 */
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * The app's tab bar: four fixed tabs and a Mehr slot that opens a sheet with
 * everything else.
 *
 * The Mehr slot is not a tab of its own — when the screen you are on lives in
 * the sheet, the slot takes on that screen's icon, label and active tint. So
 * "where am I" stays answerable from the bar even for the screens that did not
 * make the cut, which is the thing a plain overflow menu gets wrong.
 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    bar: {
      flexDirection: 'row' as const,
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: spacing.sm,
    },
    slot: { flex: 1, alignItems: 'center' as const, gap: 2, paddingHorizontal: spacing.xs },
    slotLabel: { ...typography.micro, textTransform: 'none' as const },
    overlay: { flex: 1, justifyContent: 'flex-end' as const },
    dim: {
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    // A sibling of the sheet, not its parent: a Pressable with role="button"
    // is a real <button> on web, and a <button> around the sheet's rows nests
    // buttons, which React refuses. Rendered first, so the sheet paints — and
    // takes taps — on top of it.
    backdrop: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
    sheet: {
      backgroundColor: c.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.md,
      paddingHorizontal: spacing.lg,
      gap: spacing.xs,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.borderStrong,
      alignSelf: 'center' as const,
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
    },
    rowActive: { backgroundColor: c.primarySoft },
    rowLabel: { ...typography.body, color: c.text, flex: 1 },
    rowLabelActive: { ...typography.bodyStrong, color: c.primary },
  }));

  const [sheetOpen, setSheetOpen] = useState(false);
  /** 0 = fully dismissed, 1 = fully open. Drives both the dim and the slide. */
  const progress = useRef(new Animated.Value(0)).current;
  /** Measured, so the sheet always starts exactly its own height below. */
  const [sheetHeight, setSheetHeight] = useState(280);

  const focusedName = state.routes[state.index]?.name;
  // A tab whose file was renamed or removed would otherwise render a slot that
  // navigates nowhere.
  const known = TABS.filter((tab) => state.routes.some((route) => route.name === tab.name));
  const primary = known.slice(0, PRIMARY_COUNT);
  const overflow = known.slice(PRIMARY_COUNT);
  const activeOverflow = overflow.find((tab) => tab.name === focusedName);

  // Started here rather than from an effect on `sheetOpen`, so tapping Mehr
  // again mid-dismissal reverses the animation from wherever it got to
  // instead of doing nothing (the state is already `true` at that point).
  function openSheet() {
    setSheetOpen(true);
    Animated.timing(progress, {
      toValue: 1,
      duration: OPEN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }

  function closeSheet() {
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
      // Unmount only once it is actually gone — and not at all if the
      // animation was interrupted by it being opened again.
    }).start(({ finished }) => {
      if (finished) setSheetOpen(false);
    });
  }

  function go(name: string) {
    if (sheetOpen) closeSheet();
    const route = state.routes.find((candidate) => candidate.name === name);
    if (!route) return;

    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (name !== focusedName && !event.defaultPrevented) navigation.navigate(name);
  }

  const bottomInset = Math.max(insets.bottom, spacing.sm);

  return (
    <>
      <View style={[styles.bar, { paddingBottom: bottomInset }]}>
        {primary.map((tab) => {
          const focused = tab.name === focusedName;
          const color = focused ? colors.primary : colors.textFaint;
          return (
            <Pressable
              key={tab.name}
              onPress={() => go(tab.name)}
              style={styles.slot}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.title}
            >
              <Ionicons name={tab.icon} size={24} color={color} />
              <Text style={[styles.slotLabel, { color }]} numberOfLines={1}>
                {tab.title}
              </Text>
            </Pressable>
          );
        })}

        {overflow.length > 0 ? (
          <Pressable
            onPress={openSheet}
            style={styles.slot}
            accessibilityRole="button"
            accessibilityState={{ selected: !!activeOverflow, expanded: sheetOpen }}
            accessibilityLabel={
              activeOverflow ? `${activeOverflow.title} — weitere Bereiche öffnen` : 'Mehr'
            }
          >
            <Ionicons
              name={activeOverflow?.icon ?? 'ellipsis-horizontal'}
              size={24}
              color={activeOverflow ? colors.primary : colors.textFaint}
            />
            <Text
              style={[
                styles.slotLabel,
                { color: activeOverflow ? colors.primary : colors.textFaint },
              ]}
              numberOfLines={1}
            >
              {activeOverflow?.title ?? 'Mehr'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* animationType="none": the Modal only mounts: the dim and the slide
          below are the animation, and letting both run double-animates it. */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <View style={styles.overlay}>
          <Animated.View style={[styles.dim, { opacity: progress }]} pointerEvents="none" />
          <Pressable
            style={styles.backdrop}
            onPress={closeSheet}
            accessibilityRole="button"
            accessibilityLabel="Schließen"
          />

          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: bottomInset + spacing.lg,
                transform: [
                  {
                    translateY: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [sheetHeight, 0],
                    }),
                  },
                ],
              },
            ]}
            onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
            // Claims the touch so tapping the sheet's own padding does not
            // fall through to the backdrop lying behind it. A Pressable would
            // do the same job and put a <button> back around the rows.
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.handle} />

            {overflow.map((tab) => {
              const focused = tab.name === focusedName;
              return (
                <Pressable
                  key={tab.name}
                  onPress={() => go(tab.name)}
                  style={[styles.row, focused && styles.rowActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: focused }}
                >
                  <Ionicons
                    name={tab.icon}
                    size={20}
                    color={focused ? colors.primary : colors.textMuted}
                  />
                  <Text style={[styles.rowLabel, focused && styles.rowLabelActive]}>
                    {tab.title}
                  </Text>
                  {focused ? (
                    <Ionicons name="checkmark" size={18} color={colors.primary} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                  )}
                </Pressable>
              );
            })}
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}
