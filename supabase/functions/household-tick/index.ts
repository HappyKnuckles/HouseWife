/**
 * household-tick — the scheduled heartbeat of the whole system.
 *
 * Runs hourly via pg_cron + pg_net (see README). Four jobs, in this order:
 *
 *   1. KEEP-ALIVE. A read and a write, both through PostgREST, executed before
 *      anything else and in their own try/catch. Supabase pauses free projects
 *      after ~7 days without activity; a pg_cron job that only runs SQL never
 *      leaves the database process, so it is not something to bet uptime on.
 *      An HTTP round-trip from this function to the project's own API
 *      unambiguously is activity. It happens on every run, whether or not any
 *      reminder is due, and even if every household's reminder logic throws.
 *
 *   2. RECURRING EXPENSES. Turns any due recurring_expenses template (rent,
 *      Strom, …) into a real expense via generate_due_recurring_expenses().
 *      Also unconditional — a bill's due date does not depend on a
 *      household's chosen reminder hour.
 *
 *   3. RESTOCK TO-DOS. Keeps one open "X kaufen" to-do per staple that has
 *      fallen to its threshold, and removes it again once stock recovers.
 *      Unconditional too: the shopping list should be right whenever it is
 *      opened, not only after the household's reminder hour has passed.
 *
 *   4. REMINDERS, per household at its own local reminder_hour: staples that
 *      have fallen to or below their restock threshold, then cleaning tasks
 *      that are due or overdue. Both fire with the app closed.
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
  task_id?: string;
  product_id?: string;
  event_id?: string;
  profile_id: string;
  kind: 'due' | 'overdue' | 'restock' | 'event';
  due_on: string;
  title: string;
  body: string;
}

/** A row that survived the notification_log dedupe gate and is ready to send. */
interface InsertedNotification {
  id: string;
  profile_id: string;
  title: string;
  body: string;
  task_id: string | null;
  product_id: string | null;
  event_id: string | null;
}

interface DueEvent {
  id: string;
  kind: 'event' | 'anniversary' | 'birthday';
  title: string;
  place: string | null;
  starts_at: string | null;
  next_on: string;
  days_until: number;
  years: number | null;
  remind_days_before: number;
}

interface LowStockProduct {
  product_id: string;
  name: string;
  total_quantity: number;
  restock_min_quantity: number;
  unit: string;
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

/**
 * Sends already-logged notifications and reconciles the results.
 *
 * Shared by the cleaning and restock passes rather than written twice: the
 * ticket → receipt → dead-token handling is the fiddly part of Expo push, and
 * two copies would drift the moment one of them is fixed. Callers differ only
 * in the `data` payload, which is what the app taps through on.
 *
 * Returns how many pushes Expo accepted.
 */
async function deliver(
  supabase: ReturnType<typeof serviceClient>,
  inserted: InsertedNotification[],
  dataFor: (n: InsertedNotification) => Record<string, unknown>,
): Promise<number> {
  if (inserted.length === 0) return 0;

  const profileIds = [...new Set(inserted.map((n) => n.profile_id))];

  const { data: tokens, error: tokErr } = await supabase
    .from('push_tokens')
    .select('id, profile_id, token')
    .in('profile_id', profileIds)
    .is('disabled_at', null);

  if (tokErr) throw tokErr;
  if (!tokens || tokens.length === 0) return 0;

  const messages: ExpoMessage[] = [];
  const meta: { notificationId: string; tokenId: string }[] = [];

  for (const n of inserted) {
    for (const tok of tokens.filter((t) => t.profile_id === n.profile_id)) {
      messages.push({
        to: tok.token as string,
        title: n.title,
        body: n.body,
        sound: 'default',
        priority: 'high',
        channelId: ANDROID_CHANNEL,
        data: { ...dataFor(n), notificationId: n.id },
      });
      meta.push({ notificationId: n.id, tokenId: tok.id as string });
    }
  }

  if (messages.length === 0) return 0;

  const tickets = await sendPushNotifications(messages);

  const receiptRows: Record<string, unknown>[] = [];
  const deadTokenIds: string[] = [];
  const ticketByNotification = new Map<string, string>();
  let sent = 0;

  tickets.forEach((ticket, i) => {
    const { notificationId, tokenId } = meta[i];

    if (ticket.status === 'ok') {
      sent++;
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

  return sent;
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
  let restockNotificationsSent = 0;
  let recurringExpensesGenerated = 0;
  let restockTodosSynced = 0;
  let eventNotificationsSent = 0;
  let runError: string | null = null;

  // --------------------------------------------------------------------------
  // 1.5 RECURRING EXPENSES — also unconditional (not gated on reminder_hour):
  // a bill is due on its date regardless of which hour the household likes to
  // be reminded at. Isolated in its own try/catch, same reasoning as the
  // keep-alive: one household's broken template must not stop reminders for
  // everyone else.
  // --------------------------------------------------------------------------
  try {
    const { data, error } = await supabase.rpc('generate_due_recurring_expenses');
    if (error) throw error;
    recurringExpensesGenerated = data ?? 0;
  } catch (err) {
    console.error('recurring expense generation failed:', err);
  }

  // --------------------------------------------------------------------------
  // 1.6 RESTOCK TO-DOS — unconditional as well. The push in job 2a is a nudge
  // at the household's chosen hour; the list has to be right whenever someone
  // opens it, including at the shop at 9 in the morning. Own try/catch for the
  // same reason as the others.
  // --------------------------------------------------------------------------
  try {
    const { data, error } = await supabase.rpc('generate_restock_todos');
    if (error) throw error;
    restockTodosSynced = data ?? 0;
  } catch (err) {
    console.error('restock to-do sync failed:', err);
  }

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

      const { data: members, error: mErr } = await supabase
        .from('profiles')
        .select('id')
        .eq('household_id', household.id);

      if (mErr) throw mErr;
      const memberIds = (members ?? []).map((m) => m.id as string);

      // ----------------------------------------------------------------------
      // 2a. RESTOCK — staples at or below their threshold.
      //
      // Runs before the cleaning pass and shares none of its early exits, so a
      // household with no chores due still gets told it is out of toilet paper.
      // Always goes to both members: a staple belongs to the household, and
      // there is nobody it could be "assigned" to.
      // ----------------------------------------------------------------------
      const { data: lowStock, error: lowErr } = await supabase
        .from('v_inventory_totals')
        .select('product_id, name, total_quantity, restock_min_quantity, unit')
        .eq('household_id', household.id)
        .eq('is_low', true)
        .returns<LowStockProduct[]>();

      if (lowErr) throw lowErr;

      if (lowStock && lowStock.length > 0) {
        const restockPending: PendingNotification[] = lowStock.flatMap((p) => {
          const empty = Number(p.total_quantity) <= 0;
          const title = empty ? `🛒 ${p.name} ist alle` : `🛒 ${p.name} wird knapp`;
          const body = empty
            ? 'Nichts mehr da — auf die Einkaufsliste?'
            : `Nur noch ${Number(p.total_quantity)} ${p.unit} übrig.`;

          return memberIds.map((profileId) => ({
            household_id: household.id,
            product_id: p.product_id,
            profile_id: profileId,
            kind: 'restock' as const,
            // The household-local date, so a staple that stays empty nudges
            // at most once a day per person instead of every hour.
            due_on: today,
            title,
            body,
          }));
        });

        const { data: insertedRestock, error: rErr } = await supabase
          .from('notification_log')
          .upsert(restockPending, {
            onConflict: 'product_id,profile_id,kind,due_on',
            ignoreDuplicates: true,
          })
          .select('id, task_id, product_id, profile_id, title, body')
          .returns<InsertedNotification[]>();

        if (rErr) throw rErr;

        restockNotificationsSent += await deliver(supabase, insertedRestock ?? [], (n) => ({
          type: 'restock',
          productId: n.product_id,
        }));
      }

      // ----------------------------------------------------------------------
      // 2b. TERMINE — events whose next occurrence is within their lead time.
      //
      // The agenda view already resolved the next occurrence of a yearly event
      // against the server's current_date, so there is no date arithmetic to
      // repeat (or get wrong) here — only the comparison against each event's
      // own remind_days_before. Always both members: a Termin belongs to the
      // household, and a Jahrestag that reminded only one of you would be
      // worse than none.
      // ----------------------------------------------------------------------
      const { data: dueEvents, error: evErr } = await supabase
        .from('v_event_agenda')
        .select('id, kind, title, place, starts_at, next_on, days_until, years, remind_days_before')
        .eq('household_id', household.id)
        .gte('days_until', 0)
        .lte('days_until', 30)
        .returns<DueEvent[]>();

      if (evErr) throw evErr;

      const remindable = (dueEvents ?? []).filter((e) => e.days_until <= e.remind_days_before);

      if (remindable.length > 0) {
        const eventPending: PendingNotification[] = remindable.flatMap((e) => {
          const when = e.days_until === 0 ? 'heute' : e.days_until === 1 ? 'morgen' : `in ${e.days_until} Tagen`;
          const time = e.starts_at ? ` um ${e.starts_at.slice(0, 5)} Uhr` : '';
          const place = e.place ? ` · ${e.place}` : '';

          const title =
            e.kind === 'anniversary'
              ? `❤️ ${e.years}. ${e.title}-Jahrestag ${when}`
              : e.kind === 'birthday'
                ? `🎁 ${e.title} ${when}`
                : `📅 ${e.title} ${when}`;

          return memberIds.map((profileId) => ({
            household_id: household.id,
            event_id: e.id,
            profile_id: profileId,
            kind: 'event' as const,
            // The occurrence date, not today: that way one event reminds once
            // per person per occurrence, however many hours the cron runs in
            // the lead-time window.
            due_on: e.next_on,
            title,
            body: `${when.charAt(0).toUpperCase()}${when.slice(1)}${time}${place}.`,
          }));
        });

        const { data: insertedEvents, error: ieErr } = await supabase
          .from('notification_log')
          .upsert(eventPending, {
            onConflict: 'event_id,profile_id,kind,due_on',
            ignoreDuplicates: true,
          })
          .select('id, task_id, product_id, event_id, profile_id, title, body')
          .returns<InsertedNotification[]>();

        if (ieErr) throw ieErr;

        eventNotificationsSent += await deliver(supabase, insertedEvents ?? [], (n) => ({
          type: 'event',
          eventId: n.event_id,
        }));
      }

      // ----------------------------------------------------------------------
      // 2c. CLEANING
      // ----------------------------------------------------------------------
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
        .select('id, task_id, product_id, profile_id, title, body')
        .returns<InsertedNotification[]>();

      if (nErr) throw nErr;

      notificationsSent += await deliver(supabase, inserted ?? [], (n) => ({
        type: 'cleaning_task',
        taskId: n.task_id,
      }));
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
        restock_notifications_sent: restockNotificationsSent,
        recurring_expenses_generated: recurringExpensesGenerated,
        restock_todos_synced: restockTodosSynced,
        event_notifications_sent: eventNotificationsSent,
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
      restock_notifications_sent: restockNotificationsSent,
      recurring_expenses_generated: recurringExpensesGenerated,
      restock_todos_synced: restockTodosSynced,
      event_notifications_sent: eventNotificationsSent,
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
