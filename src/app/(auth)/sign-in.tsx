import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../features/auth/AuthProvider';
import { hasEmbeddedPasswords, people } from '../../lib/credentials';
import { errorMessage } from '../../lib/errors';
import { spacing, typography } from '../../lib/theme';
import { useThemedStyles } from '../../lib/theme-context';

/**
 * Two front doors, because the two builds are exposed to different people.
 *
 * On a phone the app has the passwords compiled into it (lib/credentials.ts),
 * so the screen is a picker: tap your card and you are in. No sign-up, no
 * typing. The binary is installed on two phones and there is nobody else to
 * keep out.
 *
 * On the web there is. The bundle sits behind a public URL, so it ships with
 * nothing about the accounts in it at all (lib/credentials.web.ts) — no
 * password, and no address either, because a picker would hand over half of
 * every guess and reduce the whole thing to finding one password for a
 * username it had just supplied. So the web build asks for both, like any
 * other login, and Supabase decides.
 *
 * Which means the password is the only thing between the URL and the
 * household. Make it a real one.
 */
export default function SignInScreen() {
  const { signIn } = useAuth();
  const styles = useThemedStyles((c) => ({
    flex: { flex: 1 as const },
    content: {
      flexGrow: 1,
      justifyContent: 'center' as const,
      padding: spacing.xl,
      gap: spacing.xxl,
    },
    hero: { gap: spacing.sm },
    title: { ...typography.display, fontSize: 34, color: c.text },
    subtitle: { ...typography.body, color: c.textMuted },

    form: { gap: spacing.md },
    people: { gap: spacing.md },
    person: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    name: { ...typography.heading, color: c.text, flex: 1 as const },

    error: { ...typography.caption, color: c.danger, textAlign: 'center' as const },
  }));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  /** The address being signed in, so the right card shows the spinner. */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(address: string, secret: string) {
    setError(null);
    setPending(address);
    try {
      await signIn(address, secret);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  if (!hasEmbeddedPasswords) {
    const ready = email.trim().length > 0 && password.length > 0;

    return (
      <Screen edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.hero}>
              <Text style={styles.title}>Haushalt</Text>
              <Text style={styles.subtitle}>Anmelden</Text>
            </View>

            <View style={styles.form}>
              <TextField
                label="E-Mail"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                // The iOS/Android password managers only offer to fill — and to
                // save — when they can tell which field is which.
                autoComplete="email"
                textContentType="username"
                returnKeyType="next"
              />
              <TextField
                label="Passwort"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (ready) void submit(email.trim(), password);
                }}
              />
              <Button
                label="Anmelden"
                onPress={() => void submit(email.trim(), password)}
                loading={pending !== null}
                disabled={!ready}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.title}>Haushalt</Text>
          <Text style={styles.subtitle}>Wer bist du?</Text>
        </View>

        <View style={styles.people}>
          {people.map((person) => (
            <Card
              key={person.email}
              onPress={() => void submit(person.email, person.password)}
            >
              <View style={styles.person}>
                <Avatar name={person.name} size={44} />
                <Text style={styles.name}>{person.name}</Text>
                {pending === person.email ? <ActivityIndicator /> : null}
              </View>
            </Card>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </Screen>
  );
}
