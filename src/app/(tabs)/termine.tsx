import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { Card, EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { SwipeRow, useSwipeRowGroup } from '../../components/SwipeRow';
import { useDeleteEvent, useEvents } from '../../features/events/hooks';
import { eventIcon, eventWhen, relativeDays } from '../../features/events/format';
import { Alert } from '../../lib/alert';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

/**
 * Termine — one list for "wann kommt wer vorbei" and "seit wann sind wir
 * zusammen", because they are the same shape of thing: a named date with a
 * place and a note.
 *
 * Every number shown here is computed by v_event_agenda against the server's
 * current_date, so both phones agree and a wrong device clock cannot invent an
 * anniversary.
 */
export default function EventsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    addButton: {
      width: 38,
      height: 38,
      borderRadius: radius.pill,
      backgroundColor: c.primary,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    list: { paddingBottom: spacing.xxl * 2 },
    milestone: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: 2,
      backgroundColor: c.primarySoft,
    },
    milestoneLabel: { ...typography.micro, color: c.primary, textTransform: 'uppercase' as const },
    milestoneValue: { ...typography.display, fontSize: 30, color: c.primary },
    milestoneHint: { ...typography.caption, color: c.primary },
    sectionTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    // Card draws its own shadow, which SwipeRow would clip along with the
    // delete action it hides — so the margin and matching radius sit on
    // SwipeRow's container, outside that clip.
    rowWrap: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.lg },
    swipeContainer: { borderRadius: radius.lg },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    rowPast: { opacity: 0.55 },
    icon: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: c.surfaceMuted,
    },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.bodyStrong, color: c.text },
    rowMeta: { ...typography.caption, color: c.textMuted },
    countdown: { ...typography.captionStrong, color: c.primary },
  }));

  const { data: events, isLoading, isRefetching, refetch, error } = useEvents();
  const deleteEvent = useDeleteEvent();
  const swipeGroup = useSwipeRowGroup();

  if (isLoading) return <LoadingState label="Termine werden geladen…" />;
  if (error) return <ErrorState error={error} />;

  const list = events ?? [];

  function confirmDelete(id: string, title: string) {
    Alert.alert(`${title} löschen?`, 'Das lässt sich nicht rückgängig machen.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: () => void deleteEvent.mutateAsync(id) },
    ]);
  }
  // The headline card. An anniversary is the one kind whose *past* is the
  // point, so it gets the day counter rather than a countdown.
  const anniversary = list.find((e) => e.kind === 'anniversary') ?? null;
  const upcoming = list.filter((e) => e.days_until >= 0);
  const past = list.filter((e) => e.days_until < 0);

  return (
    <Screen>
      <ScreenHeader
        title="Termine"
        subtitle={upcoming.length === 0 ? 'Nichts geplant' : `${upcoming.length} anstehend`}
        right={
          <Pressable
            onPress={() => router.push('/termine/neu')}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Neuer Termin"
          >
            <Ionicons name="add" size={22} color={colors.textInverse} />
          </Pressable>
        }
      />

      <FlatList
        data={upcoming}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          anniversary ? (
            <Card
              style={styles.milestone}
              onPress={() => router.push(`/termine/${anniversary.id}`)}
            >
              <Text style={styles.milestoneLabel}>{anniversary.title}</Text>
              <Text style={styles.milestoneValue}>
                {anniversary.days_since_start.toLocaleString('de-DE')} Tage
              </Text>
              <Text style={styles.milestoneHint}>
                {anniversary.days_until === 0
                  ? `Heute ist euer ${anniversary.years}. Jahrestag 🎉`
                  : `${anniversary.years}. Jahrestag ${relativeDays(anniversary.days_until)}`}
              </Text>
            </Card>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            title="Keine Termine"
            body="Trag ein, wenn jemand vorbeikommt oder ihr etwas vorhabt — es steht sofort auf beiden Handys."
          />
        }
        renderItem={({ item }) => (
          <View style={styles.rowWrap}>
            <SwipeRow
              id={item.id}
              group={swipeGroup}
              containerStyle={styles.swipeContainer}
              rightActions={[
                {
                  key: 'delete',
                  icon: 'trash-outline',
                  label: 'Löschen',
                  tone: 'danger',
                  accessibilityLabel: `${item.title} löschen`,
                  onPress: () => confirmDelete(item.id, item.title),
                },
              ]}
            >
              <Card style={styles.row} onPress={() => router.push(`/termine/${item.id}`)}>
                <View style={styles.icon}>
                  <Ionicons name={eventIcon(item.kind)} size={18} color={colors.textMuted} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {eventWhen(item)}
                    {item.place ? ` · ${item.place}` : ''}
                  </Text>
                </View>
                <Text style={styles.countdown}>{relativeDays(item.days_until)}</Text>
              </Card>
            </SwipeRow>
          </View>
        )}
        ListFooterComponent={
          past.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Vorbei</Text>
              {past.map((item) => (
                <View key={item.id} style={styles.rowWrap}>
                  <SwipeRow
                    id={item.id}
                    group={swipeGroup}
                    containerStyle={styles.swipeContainer}
                    rightActions={[
                      {
                        key: 'delete',
                        icon: 'trash-outline',
                        label: 'Löschen',
                        tone: 'danger',
                        accessibilityLabel: `${item.title} löschen`,
                        onPress: () => confirmDelete(item.id, item.title),
                      },
                    ]}
                  >
                    <Card
                      style={[styles.row, styles.rowPast]}
                      onPress={() => router.push(`/termine/${item.id}`)}
                    >
                      <View style={styles.icon}>
                        <Ionicons name={eventIcon(item.kind)} size={18} color={colors.textFaint} />
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {eventWhen(item)}
                          {item.place ? ` · ${item.place}` : ''}
                        </Text>
                      </View>
                    </Card>
                  </SwipeRow>
                </View>
              ))}
            </>
          ) : null
        }
      />
    </Screen>
  );
}
