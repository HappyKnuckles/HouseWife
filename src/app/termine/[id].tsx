import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState, LoadingState, Screen } from '../../components/Screen';
import type { EventInput } from '../../features/events/api';
import { EventForm } from '../../features/events/components/EventForm';
import { EVENT_KIND_LABEL, eventIcon, eventWhen, relativeDays } from '../../features/events/format';
import { useDeleteEvent, useEvents, useUpdateEvent } from '../../features/events/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
    hero: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    icon: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: c.primarySoft,
    },
    heroText: { flex: 1, gap: 2 },
    title: { ...typography.title, color: c.text },
    meta: { ...typography.caption, color: c.textMuted },
    countdown: { ...typography.bodyStrong, color: c.primary },
    card: { gap: spacing.sm },
    label: { ...typography.micro, color: c.textMuted, textTransform: 'uppercase' as const },
    body: { ...typography.body, color: c.text },
  }));

  const { data: events, isLoading, error } = useEvents();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const [editing, setEditing] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} />;

  const event = (events ?? []).find((e) => e.id === id);
  if (!event) return <ErrorState error={new Error('Termin nicht gefunden')} />;

  async function save(values: EventInput) {
    try {
      await updateEvent.mutateAsync({ id, input: values });
      setEditing(false);
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  function confirmDelete() {
    Alert.alert('Termin löschen?', 'Das lässt sich nicht rückgängig machen.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await deleteEvent.mutateAsync(id);
          router.back();
        },
      },
    ]);
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: event.title }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? (
          <>
            <EventForm
              initial={{
                kind: event.kind,
                title: event.title,
                description: event.description,
                place: event.place,
                startsOn: event.starts_on,
                startsAt: event.starts_at,
                endsOn: event.ends_on,
                repeatYearly: event.repeat_yearly,
                remindDaysBefore: event.remind_days_before,
              }}
              submitLabel="Änderungen speichern"
              submitting={updateEvent.isPending}
              onSubmit={(values) => void save(values)}
            />
            <Button label="Abbrechen" variant="ghost" onPress={() => setEditing(false)} />
          </>
        ) : (
          <>
            <Card style={styles.hero}>
              <View style={styles.icon}>
                <Ionicons name={eventIcon(event.kind)} size={22} color={colors.primary} />
              </View>
              <View style={styles.heroText}>
                <Text style={styles.title}>{event.title}</Text>
                <Text style={styles.meta}>
                  {EVENT_KIND_LABEL[event.kind]} · {eventWhen(event)}
                </Text>
              </View>
              <Text style={styles.countdown}>{relativeDays(event.days_until)}</Text>
            </Card>

            {event.repeat_yearly ? (
              <Card style={styles.card}>
                <Text style={styles.label}>Seit dem {formatDate(event.starts_on)}</Text>
                <Text style={styles.body}>
                  {event.days_since_start.toLocaleString('de-DE')} Tage
                  {event.years ? ` · ${event.years}. Mal ${relativeDays(event.days_until)}` : ''}
                </Text>
              </Card>
            ) : null}

            {event.place ? (
              <Card style={styles.card}>
                <Text style={styles.label}>Wo</Text>
                <Text style={styles.body}>{event.place}</Text>
              </Card>
            ) : null}

            {event.description ? (
              <Card style={styles.card}>
                <Text style={styles.label}>Notiz</Text>
                <Text style={styles.body}>{event.description}</Text>
              </Card>
            ) : null}

            <Card style={styles.card}>
              <Text style={styles.label}>Erinnerung</Text>
              <Text style={styles.body}>
                {event.remind_days_before === 0
                  ? 'Am Tag selbst'
                  : event.remind_days_before === 1
                    ? '1 Tag vorher'
                    : `${event.remind_days_before} Tage vorher`}
              </Text>
            </Card>

            <Button label="Bearbeiten" variant="secondary" onPress={() => setEditing(true)} />
            <Button label="Löschen" variant="ghost" onPress={confirmDelete} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
