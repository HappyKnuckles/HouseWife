import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { Avatar } from '../../components/Avatar';
import { Screen } from '../../components/Screen';
import { Card } from '../../components/Card';
import { useAuth } from '../../features/auth/AuthProvider';
import { env } from '../../lib/env';
import { errorMessage } from '../../lib/errors';
import { spacing, typography } from '../../lib/theme';
import { useThemedStyles } from '../../lib/theme-context';

const PEOPLE = [env.userA, env.userB];

/**
 * No sign-up, no typed email, no password field — the app has exactly two
 * accounts (provisioned once via `npm run seed:users`), so signing in is
 * just picking which one you are.
 */
export default function SignInScreen() {
  const { signIn } = useAuth();
  const styles = useThemedStyles((colors) => ({
    content: { flex: 1 as const, justifyContent: 'center' as const, padding: spacing.xl, gap: spacing.xxl },
    hero: { gap: spacing.sm },
    title: { ...typography.display, fontSize: 34, color: colors.text },
    subtitle: { ...typography.body, color: colors.textMuted },
    people: { gap: spacing.md },
    person: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    name: { ...typography.heading, color: colors.text, flex: 1 as const },
    error: { ...typography.caption, color: colors.danger, textAlign: 'center' as const },
  }));

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(person: (typeof PEOPLE)[number]) {
    setError(null);
    setPending(person.email);
    try {
      await signIn(person.email, person.password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.title}>Haushalt</Text>
          <Text style={styles.subtitle}>Wer bist du?</Text>
        </View>

        <View style={styles.people}>
          {PEOPLE.map((person) => (
            <Card key={person.email} onPress={() => void pick(person)}>
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
