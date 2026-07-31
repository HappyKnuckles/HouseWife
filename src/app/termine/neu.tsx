import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';

import { Screen } from '../../components/Screen';
import type { EventInput } from '../../features/events/api';
import { EventForm } from '../../features/events/components/EventForm';
import { useCreateEvent } from '../../features/events/hooks';
import { Alert } from '../../lib/alert';
import { spacing } from '../../lib/theme';
import { useThemedStyles } from '../../lib/theme-context';

export default function NewEventScreen() {
  const router = useRouter();
  const createEvent = useCreateEvent();
  const styles = useThemedStyles(() => ({
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  }));

  async function save(values: EventInput) {
    try {
      await createEvent.mutateAsync(values);
      router.back();
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <EventForm
          submitLabel="Termin speichern"
          submitting={createEvent.isPending}
          onSubmit={(values) => void save(values)}
        />
      </ScrollView>
    </Screen>
  );
}
