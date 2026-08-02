import { Tabs } from 'expo-router';

import { TabBar } from '../../components/TabBar';
import { useAppTheme } from '../../lib/theme-context';

/**
 * Nine screens, five slots. Which four keep their own slot and which move
 * into the Mehr sheet is decided by the `TABS` list in the tab bar itself —
 * the navigator only has to know that the bar is ours.
 *
 * Putzplan stays the default tab: it is the screen that gets opened most.
 */
export default function TabsLayout() {
  const { colors } = useAppTheme();

  // sceneStyle paints the container a tab's screen mounts into. The root
  // ThemeProvider already answers for it, but a tab is mounted lazily on first
  // visit — the one moment an unpainted container is actually on screen — so
  // this says it where it applies rather than relying on it from three files up.
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
      tabBar={(props) => <TabBar {...props} />}
    />
  );
}
