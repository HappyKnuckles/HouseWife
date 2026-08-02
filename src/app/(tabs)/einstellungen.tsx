import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ScrollView, Share, Switch, Text, View } from 'react-native';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Chip, Segmented } from '../../components/Segmented';
import { Screen, ScreenHeader } from '../../components/Screen';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  useCreateInvite,
  useHousehold,
  useLastHeartbeat,
  useMembers,
  useUpdateHousehold,
} from '../../features/household/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, relativeTime } from '../../lib/format';
import { pushStatusMessage, registerPushToken, type PushRegistrationResult } from '../../lib/notifications';
import { radius, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles, type ThemePreference } from '../../lib/theme-context';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Hell' },
  { value: 'dark', label: 'Dunkel' },
];

export default function SettingsScreen() {
  const { profile, householdId, signOut } = useAuth();
  const { colors, preference, setPreference } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
    sectionTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginLeft: spacing.xs,
      marginTop: spacing.sm,
    },
    card: { gap: spacing.md },
    memberRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    memberText: { flex: 1, gap: 2 },
    memberName: { ...typography.bodyStrong, color: c.text },
    memberMeta: { ...typography.caption, color: c.textMuted },
    codeBox: {
      backgroundColor: c.primarySoft,
      borderRadius: radius.md,
      padding: spacing.lg,
      alignItems: 'center' as const,
      gap: 4,
    },
    codeLabel: { ...typography.micro, color: c.primary, textTransform: 'uppercase' as const },
    code: { ...typography.display, letterSpacing: 6, color: c.primary },
    codeHint: { ...typography.caption, color: c.primary },
    switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    statusRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: spacing.md },
    switchText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.bodyStrong, color: c.text },
    rowHint: { ...typography.caption, color: c.textMuted },
    divider: { height: 1, backgroundColor: c.border },
    field: { gap: spacing.sm },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  }));
  const { data: household } = useHousehold();
  const { data: members } = useMembers();
  const { data: heartbeat } = useLastHeartbeat();
  const createInvite = useCreateInvite();
  const updateHousehold = useUpdateHousehold();

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [push, setPush] = useState<PushRegistrationResult | null>(null);

  const canInvite = (members?.length ?? 0) < (household?.max_members ?? 2);

  async function invite() {
    try {
      const code = await createInvite.mutateAsync();
      setInviteCode(code);
      await Share.share({
        message: `Tritt unserem Haushalt bei! Code: ${code}`,
      });
    } catch (err) {
      Alert.alert('Fehlgeschlagen', errorMessage(err));
    }
  }

  async function enablePush() {
    if (!householdId || !profile) return;
    const result = await registerPushToken(householdId, profile.id);
    setPush(result);

    if (result.status !== 'registered') {
      Alert.alert('Push nicht aktiviert', pushStatusMessage[result.status]);
    }
  }

  // Older than two hours means the cron is not running — which also means the
  // free-tier keep-alive is not running.
  const heartbeatStale =
    !heartbeat || Date.now() - new Date(heartbeat.ran_at).getTime() > 2 * 60 * 60 * 1000;

  /**
   * Over-the-air updates.
   *
   * expo-updates already downloads a new bundle on launch by itself; this card
   * exists so that "hat sie die neue Version?" is answerable without guessing,
   * and so a waiting update can be applied now instead of on the next cold
   * start. Everything here is inert in Expo Go and in dev builds — Updates.
   * isEnabled is false there — so the card says so rather than offering a
   * button that cannot work.
   */
  const { currentlyRunning, isUpdatePending, isChecking, isDownloading } = Updates.useUpdates();
  const updateBusy = isChecking || isDownloading;

  async function checkForUpdate() {
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        Alert.alert('Alles aktuell', 'Ihr habt schon die neueste Version.');
        return;
      }
      // useUpdates() flips isUpdatePending once this resolves, which turns the
      // button below into "Jetzt neu starten".
      await Updates.fetchUpdateAsync();
    } catch (err) {
      Alert.alert('Update fehlgeschlagen', errorMessage(err));
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Einstellungen" subtitle={household?.name ?? ''} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Darstellung</Text>
        <Card style={styles.card}>
          <Segmented options={THEME_OPTIONS} value={preference} onChange={setPreference} />
          <Text style={styles.rowHint}>
            Gilt nur für dieses Gerät — dein Partner kann unabhängig davon hell oder dunkel wählen.
          </Text>
        </Card>

        <Text style={styles.sectionTitle}>Haushalt</Text>
        <Card style={styles.card}>
          {(members ?? []).map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <Avatar name={member.display_name} color={member.color} size={34} />
              <View style={styles.memberText}>
                <Text style={styles.memberName}>{member.display_name}</Text>
                {member.id === profile?.id ? <Text style={styles.memberMeta}>Das bist du</Text> : null}
              </View>
            </View>
          ))}

          {canInvite ? (
            <>
              <Button
                label="Partner einladen"
                variant="secondary"
                onPress={() => void invite()}
                loading={createInvite.isPending}
              />
              {inviteCode ? (
                <View style={styles.codeBox}>
                  <Text style={styles.codeLabel}>Einladungscode</Text>
                  <Text style={styles.code}>{inviteCode}</Text>
                  <Text style={styles.codeHint}>Gültig für 7 Tage, einmal verwendbar.</Text>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.memberMeta}>Der Haushalt ist vollständig.</Text>
          )}
        </Card>

        <Text style={styles.sectionTitle}>Erinnerungen</Text>
        <Card style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>Push auf diesem Gerät</Text>
              <Text style={styles.rowHint}>
                {push ? pushStatusMessage[push.status] : 'Noch nicht registriert.'}
              </Text>
            </View>
            <Button label="Aktivieren" variant="secondary" onPress={() => void enablePush()} />
          </View>

          <View style={styles.divider} />

          <View style={styles.field}>
            <Text style={styles.rowTitle}>Uhrzeit der Erinnerung</Text>
            <Text style={styles.rowHint}>
              Der Server prüft stündlich und schickt zur gewählten Stunde eurer Zeitzone.
            </Text>
            <View style={styles.chipRow}>
              {[8, 12, 16, 18, 20].map((hour) => (
                <Chip
                  key={hour}
                  label={`${hour}:00`}
                  active={household?.reminder_hour === hour}
                  onPress={() => void updateHousehold.mutateAsync({ reminder_hour: hour })}
                />
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>Beide bei Überfälligkeit</Text>
              <Text style={styles.rowHint}>
                Wenn eine Aufgabe überfällig ist, bekommt ihr beide eine Erinnerung.
              </Text>
            </View>
            <Switch
              value={household?.notify_both_on_overdue ?? true}
              onValueChange={(value) => void updateHousehold.mutateAsync({ notify_both_on_overdue: value })}
              trackColor={{ true: colors.primary }}
            />
          </View>
        </Card>

        {/*
          Cron health. The scheduled function is also the keep-alive that stops
          a free-tier project pausing after 7 idle days, so "when did it last
          run" is worth being able to check without opening the dashboard.
        */}
        <Text style={styles.sectionTitle}>Server-Status</Text>
        <Card style={styles.card}>
          <View style={styles.statusRow}>
            <Ionicons
              name={heartbeatStale ? 'alert-circle' : 'checkmark-circle'}
              size={20}
              color={heartbeatStale ? colors.warning : colors.success}
            />
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>
                {heartbeat ? `Letzter Lauf ${relativeTime(heartbeat.ran_at)}` : 'Noch kein Lauf'}
              </Text>
              <Text style={styles.rowHint}>
                {heartbeatStale
                  ? 'Der stündliche Job läuft nicht — Erinnerungen bleiben aus und das Projekt kann pausiert werden.'
                  : `${heartbeat?.notifications_sent ?? 0} Erinnerung(en) im letzten Lauf verschickt.`}
              </Text>
            </View>
          </View>
        </Card>

        <Text style={styles.sectionTitle}>App-Version</Text>
        <Card style={styles.card}>
          <View style={styles.statusRow}>
            <Ionicons
              name={isUpdatePending ? 'arrow-down-circle' : 'phone-portrait-outline'}
              size={20}
              color={isUpdatePending ? colors.primary : colors.textMuted}
            />
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>
                {isUpdatePending
                  ? 'Update bereit'
                  : currentlyRunning.isEmbeddedLaunch
                    ? 'Stand der Installation'
                    : 'Aktualisiert'}
              </Text>
              <Text style={styles.rowHint}>
                {!Updates.isEnabled
                  ? 'Updates gibt es nur in der installierten App, nicht hier in der Entwicklung.'
                  : isUpdatePending
                    ? 'Neu starten, um die neue Version zu laden.'
                    : currentlyRunning.createdAt
                      ? `Version vom ${formatDateTime(currentlyRunning.createdAt)}.`
                      : 'Die Version, die mit der Installation kam.'}
              </Text>
            </View>
          </View>

          {Updates.isEnabled ? (
            <Button
              label={isUpdatePending ? 'Jetzt neu starten' : 'Nach Updates suchen'}
              variant="secondary"
              loading={updateBusy}
              onPress={() =>
                isUpdatePending ? void Updates.reloadAsync() : void checkForUpdate()
              }
            />
          ) : null}
        </Card>

        <Button label="Abmelden" variant="ghost" onPress={() => void signOut()} />
      </ScrollView>
    </Screen>
  );
}
