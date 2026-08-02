/**
 * Database types.
 *
 * Hand-written to match supabase/migrations exactly. Regenerate against your
 * own project at any time — it is the same shape, just more verbose:
 *
 *   npx supabase link --project-ref <ref>
 *   npm run gen:types
 *
 * Insert/Update are derived rather than spelled out: columns that are NOT NULL
 * and have no default are required on insert, everything else is optional.
 * The `Generated` parameter lists the NOT NULL columns that do have a default.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T];

type Insertable<Row, Generated extends keyof Row = never> =
  & Omit<Row, NullableKeys<Row> | Generated>
  & Partial<Pick<Row, NullableKeys<Row> | Generated>>;

type Table<Row, Generated extends keyof Row = never> = {
  Row: Row;
  Insert: Insertable<Row, Generated>;
  Update: Partial<Row>;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

/** Common bookkeeping columns that always have a default. */
type Stamps = 'id' | 'created_at' | 'updated_at';

// ---------------------------------------------------------------------------
// Domain unions — the text + CHECK constraints from the schema.
// ---------------------------------------------------------------------------
export type SplitType = 'equal' | 'shares' | 'items';
export type ExpenseStatus = 'open' | 'settled';
export type SettlementMethod = 'cash' | 'transfer' | 'paypal' | 'other';
export type OcrStatus = 'pending' | 'processing' | 'done' | 'failed' | 'skipped';
export type RecurrenceUnit = 'day' | 'week' | 'month';
/** Fixed costs repeat monthly or weekly; a daily rent makes no sense. */
export type RecurringExpenseUnit = 'week' | 'month';
export type ScheduleMode = 'fixed' | 'after_completion';
export type AssignmentMode = 'fixed' | 'rotating';
export type AgendaStatus = 'overdue' | 'due_today' | 'due_soon' | 'upcoming';
/**
 * Free text since migration 0022 — the CHECK is only a length bound now.
 * The listed values are the ones with their own icon; `(string & {})` keeps
 * them as autocomplete suggestions without closing the set.
 */
export type LocationKind =
  | 'room'
  | 'shelf'
  | 'box'
  | 'fridge'
  | 'freezer'
  | 'cabinet'
  | 'other'
  | (string & {});
export type ProductUnit = 'piece' | 'g' | 'kg' | 'ml' | 'l' | 'pack';
export type MovementReason = 'scan_in' | 'manual_adjust' | 'consume' | 'move' | 'correction' | 'initial';
export type NotificationKind = 'due' | 'overdue' | 'digest' | 'restock' | 'event';
/** 'restock' rows are written by generate_restock_todos(), not by a person. */
export type TodoSource = 'manual' | 'restock';
/** The two lists `todos` carries. Restock rows are always on the shopping one. */
export type TodoList = 'todo' | 'shopping';
/** A Jahrestag or Geburtstag is an event that must repeat yearly. */
export type EventKind = 'event' | 'anniversary' | 'birthday';
export type Platform = 'ios' | 'android';

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export type HouseholdRow = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  reminder_hour: number;
  notify_both_on_overdue: boolean;
  max_members: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProfileRow = {
  id: string;
  household_id: string | null;
  display_name: string;
  avatar_url: string | null;
  color: string;
  created_at: string;
  updated_at: string;
}

export type HouseholdInviteRow = {
  id: string;
  household_id: string;
  code: string;
  created_by: string | null;
  expires_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  created_at: string;
}

export type ExpenseRow = {
  id: string;
  household_id: string;
  paid_by: string;
  title: string;
  note: string | null;
  category: string | null;
  total_cents: number;
  currency: string;
  purchased_at: string;
  split_type: SplitType;
  status: ExpenseStatus;
  settled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ExpenseItemRow = {
  id: string;
  household_id: string;
  expense_id: string;
  position: number;
  name: string;
  quantity: number;
  unit_price_cents: number | null;
  total_cents: number;
  paid_for: string | null;
  source: 'manual' | 'ocr';
  created_at: string;
  updated_at: string;
}

export type ExpenseShareRow = {
  id: string;
  household_id: string;
  expense_id: string;
  profile_id: string;
  share_cents: number;
  share_ratio: number | null;
  created_at: string;
}

export type ReceiptRow = {
  id: string;
  household_id: string;
  expense_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  uploaded_by: string | null;
  ocr_status: OcrStatus;
  ocr_provider: string | null;
  ocr_raw: Json | null;
  ocr_parsed: Json | null;
  ocr_error: string | null;
  ocr_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SettlementRow = {
  id: string;
  household_id: string;
  from_profile: string;
  to_profile: string;
  amount_cents: number;
  currency: string;
  method: SettlementMethod;
  note: string | null;
  settled_at: string;
  created_by: string | null;
  created_at: string;
}

export type SettlementExpenseRow = {
  settlement_id: string;
  expense_id: string;
  household_id: string;
}

export type TodoRow = {
  id: string;
  household_id: string;
  title: string;
  notes: string | null;
  assignee_id: string | null;
  due_date: string | null;
  is_done: boolean;
  done_at: string | null;
  done_by: string | null;
  position: number;
  product_id: string | null;
  source: TodoSource;
  list: TodoList;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EventRow = {
  id: string;
  household_id: string;
  kind: EventKind;
  title: string;
  description: string | null;
  place: string | null;
  starts_on: string;
  /** NULL = ganztägig. Display only; reminders fire on the day. */
  starts_at: string | null;
  ends_on: string | null;
  repeat_yearly: boolean;
  remind_days_before: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** v_event_agenda: the row plus its next occurrence and the counters. */
export type EventAgendaRow = Omit<EventRow, 'created_at' | 'updated_at'> & {
  next_on: string;
  days_until: number;
  /** Which anniversary the next occurrence is; null for one-offs. */
  years: number | null;
  days_since_start: number;
}

export type HouseRuleRow = {
  id: string;
  household_id: string;
  text: string;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One entry of the household's shared dog vocabulary. */
export type DogCommandRow = {
  id: string;
  household_id: string;
  command: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CleaningAreaRow = {
  id: string;
  household_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type CleaningTaskRow = {
  id: string;
  household_id: string;
  area_id: string | null;
  name: string;
  description: string | null;
  estimated_minutes: number | null;
  recurrence_unit: RecurrenceUnit;
  recurrence_interval: number;
  /** ISO weekday numbers, 1 = Montag … 7 = Sonntag. */
  weekdays: number[] | null;
  day_of_month: number | null;
  schedule_mode: ScheduleMode;
  assignment_mode: AssignmentMode;
  assigned_to: string | null;
  rotation_order: string[];
  next_due_on: string;
  last_completed_at: string | null;
  last_completed_by: string | null;
  reminder_enabled: boolean;
  remind_days_before: number;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CleaningCompletionRow = {
  id: string;
  household_id: string;
  task_id: string;
  completed_by: string | null;
  completed_at: string;
  due_on: string;
  duration_minutes: number | null;
  note: string | null;
  previous_next_due_on: string;
  previous_assigned_to: string | null;
  created_at: string;
}

export type StorageLocationRow = {
  id: string;
  household_id: string;
  parent_id: string | null;
  name: string;
  kind: LocationKind;
  sort_order: number;
  /** App-generated code, rendered as a QR code to print/stick on the shelf. */
  barcode: string | null;
  created_at: string;
  updated_at: string;
}

export type ProductRow = {
  id: string;
  household_id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  unit: ProductUnit;
  net_quantity: number | null;
  image_url: string | null;
  default_location_id: string | null;
  notes: string | null;
  /**
   * Staple threshold. NULL = not tracked. Otherwise household-tick reminds
   * once a day while the total across all lots is at or below this. Lives on
   * the product rather than the lot because an emptied lot is deleted — see
   * migration 0015.
   */
  restock_min_quantity: number | null;
  source: 'manual' | 'scan' | 'external';
  external_provider: string | null;
  external_id: string | null;
  external_payload: Json | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProductLookupCacheRow = {
  barcode: string;
  provider: string;
  found: boolean;
  payload: Json | null;
  hit_count: number;
  fetched_at: string;
}

export type InventoryItemRow = {
  id: string;
  household_id: string;
  product_id: string;
  location_id: string | null;
  quantity: number;
  unit: ProductUnit;
  min_quantity: number | null;
  expires_on: string | null;
  opened_at: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type InventoryMovementRow = {
  id: string;
  household_id: string;
  item_id: string | null;
  product_id: string | null;
  delta: number;
  reason: MovementReason;
  from_location_id: string | null;
  to_location_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export type PushTokenRow = {
  id: string;
  household_id: string;
  profile_id: string;
  token: string;
  platform: Platform;
  device_name: string | null;
  last_seen_at: string;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NotificationLogRow = {
  id: string;
  household_id: string;
  /** Set for cleaning reminders; null for restock ones. */
  task_id: string | null;
  /** Set for restock reminders; null for cleaning ones. */
  product_id: string | null;
  profile_id: string;
  kind: NotificationKind;
  due_on: string;
  title: string | null;
  body: string | null;
  sent_at: string;
  expo_ticket_id: string | null;
  expo_receipt_status: 'ok' | 'error' | null;
  error: string | null;
}

export type SystemHeartbeatRow = {
  id: number;
  ran_at: string;
  run_kind: 'cron' | 'manual' | 'keepalive';
  households_scanned: number;
  tasks_due: number;
  notifications_sent: number;
  restock_notifications_sent: number;
  recurring_expenses_generated: number;
  restock_todos_synced: number;
  event_notifications_sent: number;
  duration_ms: number | null;
  error: string | null;
}

/**
 * A fixed cost (Miete, Strom, …). This is a *template* — the hourly cron
 * materialises it into a real ExpenseRow on next_due_on, so the money itself
 * always lives in `expenses` and nothing here has to be double-counted.
 */
export type RecurringExpenseRow = {
  id: string;
  household_id: string;
  name: string;
  category: string | null;
  amount_cents: number;
  currency: string;
  paid_by: string;
  recurrence_unit: RecurringExpenseUnit;
  recurrence_interval: number;
  /** Monthly only, clamped for short months. */
  day_of_month: number | null;
  next_due_on: string;
  last_generated_expense_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// View rows
// ---------------------------------------------------------------------------
export type HouseholdBalanceRow = {
  household_id: string;
  profile_id: string;
  display_name: string;
  color: string;
  paid_cents: number;
  owed_cents: number;
  /** Positive = this person is owed money. The two rows always sum to zero. */
  net_cents: number;
}

export type CleaningAgendaRow = {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  area_id: string | null;
  area_name: string | null;
  area_color: string | null;
  area_icon: string | null;
  estimated_minutes: number | null;
  recurrence_unit: RecurrenceUnit;
  recurrence_interval: number;
  weekdays: number[] | null;
  day_of_month: number | null;
  schedule_mode: ScheduleMode;
  assignment_mode: AssignmentMode;
  assigned_to: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  rotation_order: string[];
  next_due_on: string;
  last_completed_at: string | null;
  last_completed_by: string | null;
  reminder_enabled: boolean;
  remind_days_before: number;
  is_active: boolean;
  sort_order: number;
  /** Negative when overdue. */
  days_until: number;
  status: AgendaStatus;
}

export type CleaningStatsRow = {
  household_id: string;
  profile_id: string;
  display_name: string;
  color: string;
  month: string;
  completions: number;
  minutes: number;
  late_completions: number;
}

export type LocationPathRow = {
  id: string;
  household_id: string;
  parent_id: string | null;
  name: string;
  kind: LocationKind;
  sort_order: number;
  /** e.g. "Keller › Regal 2 › Kiste A" */
  path: string;
  depth: number;
  barcode: string | null;
}

export type ExpenseCategoryMonthRow = {
  household_id: string;
  /** NULL categories are folded into 'Sonstiges' by the view. */
  category: string;
  /** First of the month, as a date string. */
  month: string;
  expense_count: number;
  total_cents: number;
}

export type ItemPurchaseFrequencyRow = {
  household_id: string;
  /** Lower-cased and trimmed by the view, so it is a grouping key, not a label. */
  item_name: string;
  purchase_count: number;
  total_cents: number;
  last_purchased_at: string;
}

export type InventoryTotalRow = {
  household_id: string;
  product_id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  category: string | null;
  image_url: string | null;
  unit: ProductUnit;
  total_quantity: number;
  location_count: number;
  next_expiry: string | null;
  /** True when restock_min_quantity is set and total_quantity has reached it. */
  is_low: boolean | null;
  restock_min_quantity: number | null;
}

// ---------------------------------------------------------------------------
// RPC payloads
// ---------------------------------------------------------------------------
export type ExpenseItemInput = {
  name: string;
  total_cents: number;
  quantity?: number;
  unit_price_cents?: number | null;
  /** null / omitted = shared line, split equally. */
  paid_for?: string | null;
  position?: number;
  source?: 'manual' | 'ocr';
}

export type ExpenseShareInput = {
  profile_id: string;
  share_cents: number;
}

export type Database = {
  public: {
    Tables: {
      households: Table<HouseholdRow, Stamps | 'timezone' | 'currency' | 'reminder_hour' | 'notify_both_on_overdue' | 'max_members'>;
      profiles: Table<ProfileRow, 'created_at' | 'updated_at' | 'display_name' | 'color'>;
      household_invites: Table<HouseholdInviteRow, 'id' | 'created_at' | 'expires_at'>;
      expenses: Table<ExpenseRow, Stamps | 'currency' | 'purchased_at' | 'split_type' | 'status'>;
      expense_items: Table<ExpenseItemRow, Stamps | 'position' | 'quantity' | 'source'>;
      expense_shares: Table<ExpenseShareRow, 'id' | 'created_at'>;
      receipts: Table<ReceiptRow, Stamps | 'mime_type' | 'ocr_status'>;
      settlements: Table<SettlementRow, 'id' | 'created_at' | 'currency' | 'method' | 'settled_at'>;
      settlement_expenses: Table<SettlementExpenseRow>;
      recurring_expenses: Table<
        RecurringExpenseRow,
        Stamps | 'currency' | 'recurrence_unit' | 'recurrence_interval' | 'next_due_on' | 'is_active'
      >;
      todos: Table<TodoRow, Stamps | 'is_done' | 'position' | 'source' | 'list' | 'product_id'>;
      house_rules: Table<HouseRuleRow, Stamps | 'position'>;
      dog_commands: Table<DogCommandRow, Stamps>;
      events: Table<EventRow, Stamps | 'kind' | 'repeat_yearly' | 'remind_days_before'>;
      cleaning_areas: Table<CleaningAreaRow, Stamps | 'icon' | 'color' | 'sort_order'>;
      cleaning_tasks: Table<
        CleaningTaskRow,
        | Stamps
        | 'recurrence_unit'
        | 'recurrence_interval'
        | 'schedule_mode'
        | 'assignment_mode'
        | 'rotation_order'
        | 'next_due_on'
        | 'reminder_enabled'
        | 'remind_days_before'
        | 'is_active'
        | 'sort_order'
      >;
      cleaning_completions: Table<CleaningCompletionRow, 'id' | 'created_at' | 'completed_at'>;
      storage_locations: Table<StorageLocationRow, Stamps | 'kind' | 'sort_order'>;
      products: Table<ProductRow, Stamps | 'unit' | 'source'>;
      product_lookup_cache: Table<ProductLookupCacheRow, 'found' | 'hit_count' | 'fetched_at'>;
      inventory_items: Table<InventoryItemRow, Stamps | 'quantity' | 'unit'>;
      inventory_movements: Table<InventoryMovementRow, 'id' | 'created_at'>;
      push_tokens: Table<PushTokenRow, Stamps | 'last_seen_at'>;
      notification_log: Table<NotificationLogRow, 'id' | 'sent_at'>;
      system_heartbeat: Table<
        SystemHeartbeatRow,
        | 'id'
        | 'ran_at'
        | 'run_kind'
        | 'households_scanned'
        | 'tasks_due'
        | 'notifications_sent'
        | 'restock_notifications_sent'
        | 'recurring_expenses_generated'
        | 'restock_todos_synced'
        | 'event_notifications_sent'
      >;
    };
    Views: {
      v_household_balances: View<HouseholdBalanceRow>;
      v_cleaning_agenda: View<CleaningAgendaRow>;
      v_event_agenda: View<EventAgendaRow>;
      v_cleaning_stats: View<CleaningStatsRow>;
      v_location_paths: View<LocationPathRow>;
      v_inventory_totals: View<InventoryTotalRow>;
      v_expense_category_month: View<ExpenseCategoryMonthRow>;
      v_item_purchase_frequency: View<ItemPurchaseFrequencyRow>;
    };
    Functions: {
      current_household_id: { Args: Record<string, never>; Returns: string | null };
      create_household: { Args: { p_name: string; p_timezone?: string }; Returns: string };
      create_invite: { Args: Record<string, never>; Returns: string };
      accept_invite: { Args: { p_code: string }; Returns: string };
      create_expense: {
        Args: {
          p_title: string;
          p_total_cents: number;
          p_paid_by?: string | null;
          p_split_type?: SplitType;
          p_purchased_at?: string;
          p_note?: string | null;
          p_category?: string | null;
          p_items?: ExpenseItemInput[];
          p_shares?: ExpenseShareInput[] | null;
        };
        Returns: ExpenseRow;
      };
      update_expense: {
        Args: {
          p_expense_id: string;
          p_title?: string | null;
          p_total_cents?: number | null;
          p_paid_by?: string | null;
          p_split_type?: SplitType | null;
          p_purchased_at?: string | null;
          p_note?: string | null;
          p_category?: string | null;
          p_items?: ExpenseItemInput[];
          p_shares?: ExpenseShareInput[] | null;
        };
        Returns: ExpenseRow;
      };
      settle_up: {
        Args: { p_expense_ids?: string[] | null; p_method?: SettlementMethod; p_note?: string | null };
        Returns: string | null;
      };
      complete_cleaning_task: {
        Args: {
          p_task_id: string;
          p_completed_at?: string;
          p_duration_minutes?: number | null;
          p_note?: string | null;
        };
        Returns: CleaningTaskRow;
      };
      undo_cleaning_completion: { Args: { p_completion_id: string }; Returns: CleaningTaskRow };
      inventory_scan_in: {
        Args: {
          p_barcode?: string | null;
          p_name?: string | null;
          p_location_id?: string | null;
          p_quantity?: number;
          p_unit?: ProductUnit;
          p_expires_on?: string | null;
          p_brand?: string | null;
          p_image_url?: string | null;
          p_external_provider?: string | null;
          p_external_payload?: Json | null;
        };
        Returns: InventoryItemRow;
      };
      inventory_adjust: {
        Args: { p_item_id: string; p_delta: number; p_reason?: MovementReason; p_note?: string | null };
        Returns: InventoryItemRow;
      };
      inventory_move: {
        /** `p_quantity` null moves the whole lot. */
        Args: { p_item_id: string; p_location_id?: string | null; p_quantity?: number | null };
        Returns: InventoryItemRow;
      };
      inventory_set_quantity: {
        /** `p_opened` null leaves opened_at alone; fractions are the point. */
        Args: { p_item_id: string; p_quantity: number; p_opened?: boolean | null; p_note?: string | null };
        Returns: InventoryItemRow;
      };
      update_location: {
        Args: {
          p_location_id: string;
          p_name?: string | null;
          p_kind?: string | null;
          p_parent_id?: string | null;
          p_clear_parent?: boolean;
        };
        Returns: StorageLocationRow;
      };
      house_rules_move: {
        Args: { p_rule_id: string; p_direction: 'up' | 'down' };
        Returns: undefined;
      };
      seed_starter_data: { Args: { p_household_id: string }; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
