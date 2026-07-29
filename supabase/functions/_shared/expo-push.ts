/**
 * Minimal Expo Push client.
 *
 * Deliberately not the expo-server-sdk npm package: this is ~60 lines of fetch,
 * and pulling a Node-oriented SDK into Deno costs more than it saves.
 *
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_SEND = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo rejects requests with more than 100 messages. */
const CHUNK_SIZE = 100;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  badge?: number;
}

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

export type ExpoReceipt =
  | { status: 'ok' }
  | { status: 'error'; message: string; details?: { error?: string } };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Sends messages and returns one ticket per message, in the same order.
 *
 * A failed chunk yields error tickets rather than throwing, so one bad batch
 * cannot stop the rest of the run — a cron job that dies halfway through is
 * worse than one that reports partial failure.
 */
export async function sendPushNotifications(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];

  for (const batch of chunk(messages, CHUNK_SIZE)) {
    try {
      const res = await fetch(EXPO_SEND, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const text = await res.text();
        for (const _ of batch) {
          tickets.push({ status: 'error', message: `Expo HTTP ${res.status}: ${text.slice(0, 200)}` });
        }
        continue;
      }

      const json = await res.json() as { data?: ExpoTicket[] };
      const data = json.data ?? [];

      for (let i = 0; i < batch.length; i++) {
        tickets.push(data[i] ?? { status: 'error', message: 'no ticket returned' });
      }
    } catch (err) {
      for (const _ of batch) {
        tickets.push({ status: 'error', message: String(err) });
      }
    }
  }

  return tickets;
}

/** Looks up delivery receipts for previously issued ticket ids. */
export async function getPushReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
  const out: Record<string, ExpoReceipt> = {};

  for (const batch of chunk(ids, CHUNK_SIZE)) {
    try {
      const res = await fetch(EXPO_RECEIPTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: batch }),
      });

      if (!res.ok) continue;

      const json = await res.json() as { data?: Record<string, ExpoReceipt> };
      Object.assign(out, json.data ?? {});
    } catch {
      // Leave these unchecked; the next run picks them up again.
    }
  }

  return out;
}

/**
 * Expo's signal that a token is dead — the app was uninstalled, or the token
 * was rotated. The only correct response is to stop using it.
 */
export function isDeadToken(t: { details?: { error?: string } }): boolean {
  return t.details?.error === 'DeviceNotRegistered';
}
