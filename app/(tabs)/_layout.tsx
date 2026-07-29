import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { typography } from '../../src/lib/theme';
import { useAppTheme } from '../../src/lib/theme-context';

export default function TabsLayout() {
  const { colors } = useAppTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { ...typography.micro, textTransform: 'none' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      {/* Putzplan is the default tab — it is the screen that gets opened most. */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Putzplan',
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="ausgaben"
        options={{
          title: 'Ausgaben',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="todos"
        options={{
          title: 'To-dos',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inventar"
        options={{
          title: 'Inventar',
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="einstellungen"
        options={{
          title: 'Mehr',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
