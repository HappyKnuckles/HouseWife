/**
 * Cross-platform Alert.
 *
 * react-native-web ships `class Alert { static alert() {} }` — a literal no-op.
 * Every confirmation dialog in this app therefore silently did nothing in the
 * browser: the button looked like it worked, the callback never ran. This is a
 * drop-in replacement, so call sites only change their import.
 *
 * On web the mapping is deliberately narrow because every call site in this app
 * is either a one-button notice or a [cancel, action] confirm:
 *   - fewer than two buttons  → window.alert, then the button's onPress
 *   - two or more            → window.confirm; OK runs the first non-cancel
 *                              button, Cancel runs the cancel button
 * A three-way choice would need a real modal; there isn't one, and adding a
 * silent wrong answer for a case that does not exist would be worse.
 */
import { Alert as RNAlert, Platform, type AlertButton, type AlertOptions } from 'react-native';

function alert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
): void {
  if (Platform.OS !== 'web') {
    RNAlert.alert(title, message, buttons, options);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];

  if (list.length < 2) {
    window.alert(text);
    list[0]?.onPress?.();
    return;
  }

  const cancel = list.find((b) => b.style === 'cancel');
  const confirm = list.find((b) => b.style !== 'cancel') ?? list[list.length - 1];

  if (window.confirm(text)) confirm?.onPress?.();
  else cancel?.onPress?.();
}

export const Alert = { alert };
