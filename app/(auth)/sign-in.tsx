import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { TextField } from '../../src/components/TextField';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { spacing, typography } from '../../src/lib/theme';
import { useThemedStyles } from '../../src/lib/theme-context';

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const styles = useThemedStyles((colors) => ({
    flex: { flex: 1 as const },
    content: { flexGrow: 1 as const, justifyContent: 'center' as const, padding: spacing.xl, gap: spacing.xxl },
    hero: { gap: spacing.sm },
    title: { ...typography.display, fontSize: 34, color: colors.text },
    subtitle: { ...typography.body, color: colors.textMuted },
    form: { gap: spacing.md },
    notice: { ...typography.caption, color: colors.success },
  }));
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignUp = mode === 'sign-up';
  const canSubmit = email.includes('@') && password.length >= 6 && (!isSignUp || displayName.trim().length > 0);

  async function submit() {
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      if (isSignUp) {
        await signUp(email, password, displayName);
        // With email confirmation on, there is no session yet and the router
        // will not move — say so instead of leaving a dead button.
        setNotice('Konto erstellt. Falls E-Mail-Bestätigung aktiv ist, bestätige zuerst den Link.');
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.title}>Haushalt</Text>
            <Text style={styles.subtitle}>
              Putzplan, Ausgaben, To-dos und Vorräte — für euch beide, in Echtzeit.
            </Text>
          </View>

          <View style={styles.form}>
            {isSignUp ? (
              <TextField
                label="Name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Nico"
                autoCapitalize="words"
                textContentType="name"
              />
            ) : null}

            <TextField
              label="E-Mail"
              value={email}
              onChangeText={setEmail}
              placeholder="du@beispiel.de"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />

            <TextField
              label="Passwort"
              value={password}
              onChangeText={setPassword}
              placeholder="Mindestens 6 Zeichen"
              secureTextEntry
              textContentType={isSignUp ? 'newPassword' : 'password'}
              error={error}
            />

            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Button
              label={isSignUp ? 'Konto erstellen' : 'Anmelden'}
              onPress={submit}
              disabled={!canSubmit}
              loading={busy}
              size="lg"
            />

            <Button
              label={isSignUp ? 'Ich habe schon ein Konto' : 'Neues Konto erstellen'}
              variant="ghost"
              onPress={() => {
                setMode(isSignUp ? 'sign-in' : 'sign-up');
                setError(null);
                setNotice(null);
              }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
