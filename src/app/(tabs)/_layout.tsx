import { Tabs } from 'expo-router';

import { TabBar } from '../../components/TabBar';

/**
 * Seven screens, five slots. Which four keep their own slot and which move
 * into the Mehr sheet is decided by the `TABS` list in the tab bar itself —
 * the navigator only has to know that the bar is ours.
 *
 * Putzplan stays the default tab: it is the screen that gets opened most.
 */
export default function TabsLayout() {
  return <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />} />;
}
