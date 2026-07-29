import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { TextField } from '../src/components/TextField';
import { useAuth } from '../src/features/auth/AuthProvider';
import { useAcceptInvite, useCreateHousehold } from '../src/features/household/hooks';
import { spacing, typography } from '../src/lib/theme';
import { useThemedStyles } from '../src/lib/theme-context';

export default function OnboardingScreen() {
  const { profile, signOut } = useAuth();
  const createHousehold = useCreateHousehold();
  const acceptInvite = useAcceptInvite();
  const styles = useThemedStyles((colors) => ({
    flex: { flex: 1 as const },
    content: { flexGrow: 1 as const, justifyContent: 'center' as const, padding: spacing.lg, gap: spacing.lg },
    hero: { gap: spacing.sm, paddingHorizontal: spacing.xs },
    title: { ...typography.display, color: colors.text },
    subtitle: { ...typography.body, color: colors.textMuted },
    card: { gap: spacing.md },
    cardTitle: { ...typography.heading, color: colors.text },
    cardBody: { ...typography.caption, color: colors.textMuted },
    code: { fontSize: 22, letterSpacing: 8, textAlign: 'center' as const, fontWeight: '700' as const },
    divider: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    line: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerLabel: { ...typography.caption, color: colors.textFaint },
    error: { ...typography.caption, color: colors.danger, textAlign: 'center' as const },
  }));

  const [name, setName] = useState('Zuhause');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const busy = createHousehold.isPending || acceptInvite.isPending;

  async function create() {
    setError(null);
    try {
      await createHousehold.mutateAsync({ name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function join() {
    setError(null);
    try {
      await acceptInvite.mutateAsync(code.trim());
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes('invalid or expired')
          ? 'Dieser Code ist ungültig oder abgelaufen.'
          : String(err),
      );
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.title}>Hallo {profile?.display_name || ''} 👋</Text>
            <Text style={styles.subtitle}>
              Erstelle euren Haushalt — oder tritt mit dem Code bei, den dein Partner dir gegeben hat.
            </Text>
          </View>

          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Neuen Haushalt erstellen</Text>
            <Text style={styles.cardBody}>
              Du bekommst direkt einen Putzplan mit typischen Aufgaben, den du anpassen kannst.
            </Text>
            <TextField label="Name" value={name} onChangeText={setName} placeholder="Zuhause" />
            <Button
              label="Haushalt erstellen"
              onPress={create}
              disabled={busy || name.trim().length === 0}
              loading={createHousehold.isPending}
            />
          </Card>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerLabel}>oder</Text>
            <View style={styles.line} />
          </View>

          <Card style={styles.card}>
            <Text style={styles.cardTitle}>Einem Haushalt beitreten</Text>
            <TextField
              label="Einladungscode"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              style={styles.code}
            />
            <Button
              label="Beitreten"
              variant="secondary"
              onPress={join}
              disabled={busy || code.trim().length !== 6}
              loading={acceptInvite.isPending}
            />
          </Card>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button label="Abmelden" variant="ghost" onPress={() => void signOut()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
