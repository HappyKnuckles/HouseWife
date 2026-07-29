/**
 * household-tick — the scheduled heartbeat of the whole system.
 *
 * Runs hourly via pg_cron + pg_net (see README). Two jobs, in this order:
 *
 *   1. KEEP-ALIVE. A read and a write, both through PostgREST, executed before
 *      anything else and in their own try/catch. Supabase pauses free projects
 *      after ~7 days without activity; a pg_cron job that only runs SQL never
 *      leaves the database process, so it is not something to bet uptime on.
 *      An HTTP round-trip from this function to the project's own API
 *      unambiguously is activity. It happens on every run, whether or not any
 *      reminder is due, and even if every household's reminder logic throws.
 *
 *   2. REMINDERS. Push notifications for cleaning tasks that are due or
 *      overdue, so they fire with the app closed.
 *
 * Hourly rather than daily so each household is reminded at its own local
 * reminder_hour without any UTC/DST arithmetic — and so the keep-alive gets 24
 * chances a day instead of one.
 *
 * Deploy with --no-verify-jwt; authorisation is the x-cron-secret header.
 */
import { rejectUnauthorized, serviceClient } from '../_shared/supabase.ts';
import {
  type ExpoMessage,
  getPushReceipts,
  isDeadToken,
  sendPushNotifications,
} from '../_shared/expo-push.ts';

const ANDROID_CHANNEL = 'putzplan';
/** Expo needs a few minutes before a receipt is available. */
const RECEIPT_DELAY_MINUTES = 15;

interface Household {
  id: string;
  name: string;
  timezone: string;
  reminder_hour: number;
  notify_both_on_overdue: boolean;
}

interface Task {
  id: string;
  name: string;
  next_due_on: string;
  remind_days_before: number;
  assigned_to: string | null;
  cleaning_areas: { name: string } | null;
}

interface PendingNotification {
  household_id: string;
  task_id: string;
  profile_id: string;
  kind: 'due' | 'overdue';
  due_on: string;
  title: string;
  body: string;
}

/** "Now" in a household's own timezone, as a plain date plus the local hour. */
function localNow(timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    // Some runtimes render midnight as "24".
    hour: Number(p.hour) % 24,
  };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

function buildMessage(task: Task, kind: 'due' | 'overdue', today: string) {
  const area = task.cleaning_areas?.name;
  const suffix = area ? ` · ${area}` : '';

  if (kind === 'overdue') {
    const late = daysBetween(today, task.next_due_on);
    return {
      title: `⏰ ${task.name}${suffix}`,
      body: late === 1 ? 'Seit gestern überfällig.' : `Seit ${late} Tagen überfällig.`,
    };
  }

  const until = daysBetween(task.next_due_on, today);
  if (until <= 0) {
    return { title: `🧽 ${task.name}${suffix}`, body: 'Heute fällig.' };
  }
  return {
    title: `🧽 ${task.name}${suffix}`,
    body: until === 1 ? 'Morgen fällig.' : `In ${until} Tagen fällig.`,
  };
}

Deno.serve(async (req) => {
  const unauthorized = rejectUnauthorized(req);
  if (unauthorized) return unauthorized;

  const startedAt = Date.now();
  const supabase = serviceClient();

  // `force` ignores reminder_hour so a run can be tested on demand.
  let force = new URL(req.url).searchParams.get('force') === 'true';
  try {
    const body = await req.json();
    if (body?.force === true) force = true;
  } catch {
    // No body, or not JSON — the normal cron case.
  }

  // --------------------------------------------------------------------------
  // 1. KEEP-ALIVE — always, first, and isolated from everything below.
  // --------------------------------------------------------------------------
  let heartbeatId: number | null = null;
  try {
    const { data, error } = await supabase
      .from('system_heartbeat')
      .insert({ run_kind: force ? 'manual' : 'cron' })
      .select('id')
      .single();

    if (error) throw error;
    heartbeatId = data.id;
  } catch (err) {
    console.error('keep-alive write failed:', err);
  }

  let householdsScanned = 0;
  let tasksDue = 0;
  let notificationsSent = 0;
  let runError: string | null = null;

  try {
    // The keep-alive read. Needed by the reminder logic anyway, which is what
    // makes it a real query rather than a token `select 1`.
    const { data: households, error: hErr } = await supabase
      .from('households')
      .select('id, name, timezone, reminder_hour, notify_both_on_overdue')
      .returns<Household[]>();

    if (hErr) throw hErr;

    // ------------------------------------------------------------------------
    // 2. REMINDERS
    // ------------------------------------------------------------------------
    for (const household of households ?? []) {
      householdsScanned++;

      const { date: today, hour } = localNow(household.timezone ?? 'Europe/Berlin');
      if (!force && hour !== household.reminder_hour) continue;

      // Over-fetch by the maximum lead time, then filter per task — each task
      // has its own remind_days_before.
      const { data: tasks, error: tErr } = await supabase
        .from('cleaning_tasks')
        .select('id, name, next_due_on, remind_days_before, assigned_to, cleaning_areas(name)')
        .eq('household_id', household.id)
        .eq('is_active', true)
        .eq('reminder_enabled', true)
        .lte('next_due_on', addDays(today, 14))
        .returns<Task[]>();

      if (tErr) throw tErr;

      const relevant = (tasks ?? []).filter(
        (t) => t.next_due_on <= addDays(today, t.remind_days_before ?? 0),
      );
      if (relevant.length === 0) continue;
      tasksDue += relevant.length;

      const { data: members, error: mErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('household_id', household.id);

      if (mErr) throw mErr;
      const memberIds = (members ?? []).map((m) => m.id as string);

      const pending: PendingNotification[] = [];

      for (const task of relevant) {
        const kind: 'due' | 'overdue' = task.next_due_on < today ? 'overdue' : 'due';

        // Normally only the responsible person. Once a chore is overdue, the
        // household setting can pull the other person in too — an unassigned
        // task would otherwise never remind anyone.
        let recipients: string[] = task.assigned_to ? [task.assigned_to] : memberIds;
        if (kind === 'overdue' && household.notify_both_on_overdue) {
          recipients = memberIds;
        }

        const { title, body } = buildMessage(task, kind, today);

        for (const profileId of new Set(recipients)) {
          pending.push({
            household_id: household.id,
            task_id: task.id,
            profile_id: profileId,
            kind,
            due_on: task.next_due_on,
            title,
            body,
          });
        }
      }

      if (pending.length === 0) continue;

      // The dedupe gate. ON CONFLICT DO NOTHING against the unique index
      // (task_id, profile_id, kind, due_on); only rows that actually inserted
      // come back, and only those get pushed. This is what makes the whole
      // function safe to re-run, and safe to crash halfway through.
      const { data: inserted, error: nErr } = await supabase
        .from('notification_log')
        .upsert(pending, {
          onConflict: 'task_id,profile_id,kind,due_on',
          ignoreDuplicates: true,
        })
        .select('id, task_id, profile_id, title, body');

      if (nErr) throw nErr;
      if (!inserted || inserted.length === 0) continue;

      const profileIds = [...new Set(inserted.map((n) => n.profile_id as string))];

      const { data: tokens, error: tokErr } = await supabase
        .from('push_tokens')
        .select('id, profile_id, token')
        .in('profile_id', profileIds)
        .is('disabled_at', null);

      if (tokErr) throw tokErr;
      if (!tokens || tokens.length === 0) continue;

      const messages: ExpoMessage[] = [];
      const meta: { notificationId: string; tokenId: string }[] = [];

      for (const n of inserted) {
        for (const tok of tokens.filter((t) => t.profile_id === n.profile_id)) {
          messages.push({
            to: tok.token as string,
            title: n.title as string,
            body: n.body as string,
            sound: 'default',
            priority: 'high',
            channelId: ANDROID_CHANNEL,
            data: { type: 'cleaning_task', taskId: n.task_id, notificationId: n.id },
          });
          meta.push({ notificationId: n.id as string, tokenId: tok.id as string });
        }
      }

      if (messages.length === 0) continue;

      const tickets = await sendPushNotifications(messages);

      const receiptRows: Record<string, unknown>[] = [];
      const deadTokenIds: string[] = [];
      const ticketByNotification = new Map<string, string>();

      tickets.forEach((ticket, i) => {
        const { notificationId, tokenId } = meta[i];

        if (ticket.status === 'ok') {
          notificationsSent++;
          receiptRows.push({ ticket_id: ticket.id, notification_id: notificationId, token_id: tokenId });
          if (!ticketByNotification.has(notificationId)) {
            ticketByNotification.set(notificationId, ticket.id);
          }
          return;
        }

        console.error('push ticket error:', ticket.message);
        // Expo often reports a dead token straight away; no need to wait for
        // the receipt pass to stop using it.
        if (isDeadToken(ticket)) deadTokenIds.push(tokenId);
      });

      if (receiptRows.length > 0) {
        await supabase.from('push_receipts').insert(receiptRows);
      }

      for (const [notificationId, ticketId] of ticketByNotification) {
        await supabase
          .from('notification_log')
          .update({ expo_ticket_id: ticketId })
          .eq('id', notificationId);
      }

      if (deadTokenIds.length > 0) {
        await supabase
          .from('push_tokens')
          .update({ disabled_at: new Date().toISOString() })
          .in('id', deadTokenIds);
      }
    }

    // ------------------------------------------------------------------------
    // 3. Receipt sweep — self-healing for tokens Expo only rejects later.
    // ------------------------------------------------------------------------
    const cutoff = new Date(Date.now() - RECEIPT_DELAY_MINUTES * 60_000).toISOString();

    const { data: awaiting } = await supabase
      .from('push_receipts')
      .select('ticket_id, token_id, notification_id')
      .is('checked_at', null)
      .lt('created_at', cutoff)
      .limit(300);

    if (awaiting && awaiting.length > 0) {
      const receipts = await getPushReceipts(awaiting.map((r) => r.ticket_id as string));
      const now = new Date().toISOString();
      const deadTokens = new Set<string>();

      for (const row of awaiting) {
        const receipt = receipts[row.ticket_id as string];
        if (!receipt) continue;

        const failed = receipt.status === 'error';
        if (failed && isDeadToken(receipt)) deadTokens.add(row.token_id as string);

        await supabase
          .from('push_receipts')
          .update({
            status: failed ? 'error' : 'ok',
            error_code: failed ? (receipt.details?.error ?? 'unknown') : null,
            checked_at: now,
          })
          .eq('ticket_id', row.ticket_id);

        if (row.notification_id) {
          await supabase
            .from('notification_log')
            .update({
              expo_receipt_status: failed ? 'error' : 'ok',
              error: failed ? receipt.message : null,
            })
            .eq('id', row.notification_id);
        }
      }

      if (deadTokens.size > 0) {
        await supabase
          .from('push_tokens')
          .update({ disabled_at: now })
          .in('id', [...deadTokens]);
      }
    }
  } catch (err) {
    runError = String(err);
    console.error('household-tick failed:', err);
  }

  const durationMs = Date.now() - startedAt;

  if (heartbeatId !== null) {
    await supabase
      .from('system_heartbeat')
      .update({
        households_scanned: householdsScanned,
        tasks_due: tasksDue,
        notifications_sent: notificationsSent,
        duration_ms: durationMs,
        error: runError,
      })
      .eq('id', heartbeatId);
  }

  return new Response(
    JSON.stringify({
      ok: runError === null,
      households_scanned: householdsScanned,
      tasks_due: tasksDue,
      notifications_sent: notificationsSent,
      duration_ms: durationMs,
      error: runError,
    }),
    {
      // 200 even on partial failure: pg_net has no retry, and a non-2xx here
      // would only make the run look worse without changing anything. The
      // heartbeat row carries the real status.
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
});
