import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, Segmented } from '../../../components/Segmented';
import { TextField } from '../../../components/TextField';
import type { ExpenseItemInput, ProfileRow, SplitType } from '../../../lib/database.types';
import {
  dateIso,
  dateIsoToTimestamp,
  formatCents,
  formatDate,
  parseAmountToCents,
  parseGermanDate,
  shiftDays,
  todayIso,
} from '../../../lib/format';
import { spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';
import { EXPENSE_CATEGORIES, categoryMeta } from '../categories';
import { useUsedCategories } from '../hooks';
import { computeSplit, validateSplit } from '../split';

interface DraftItem {
  key: string;
  name: string;
  amount: string;
  paidFor: string | null;
}

export interface ExpenseFormValues {
  title: string;
  totalCents: number;
  paidBy: string;
  category: string | null;
  splitType: SplitType;
  /** timestamptz. Defaults to today, but a shop is often booked days later. */
  purchasedAt: string;
  items: ExpenseItemInput[];
  shares: { profile_id: string; share_cents: number }[] | null;
}

export interface ExpenseFormInitial {
  title?: string;
  /** Cents; rendered into the amount field as German decimal text. */
  totalCents?: number;
  paidBy?: string | null;
  category?: string | null;
  splitType?: SplitType;
  /** timestamptz or a bare `YYYY-MM-DD`; only the day is ever shown. */
  purchasedAt?: string;
  items?: { name: string; total_cents: number; paid_for: string | null }[];
  /** Cents per profile, for splitType 'shares'. */
  shares?: Record<string, number>;
}

/**
 * What to store for the day the form is showing.
 *
 * A date left alone keeps the exact timestamp it arrived with — editing the
 * title of an expense should not quietly move when it happened. That only
 * applies to a real timestamptz, though: a bare `YYYY-MM-DD` (what the Einkauf
 * checkout hands over) has no time of day to preserve and would be read as
 * midnight UTC, so it goes through dateIsoToTimestamp() like anything else.
 */
function timestampFor(dayIso: string, initial: string | undefined): string {
  const unchanged = !!initial && dateIso(initial) === dayIso;
  const carriesTime = !!initial && !/^\d{4}-\d{2}-\d{2}$/.test(initial);

  return unchanged && carriesTime ? initial : dateIsoToTimestamp(dayIso);
}

/**
 * The expense form, shared by "neue Ausgabe" and "Ausgabe bearbeiten".
 *
 * One component rather than two screens with the same fields: the split
 * preview has to agree with apply_expense_split() cent for cent, and a second
 * copy of the item editor and the shares validation is exactly the kind of
 * thing that drifts silently — you would only notice when the two screens
 * disagreed about who owes what.
 *
 * The parent owns everything that genuinely differs: the submit handler, the
 * button label, and whatever it renders through `children` (the create screen
 * puts its receipt picker there; the edit screen does not have one).
 */
export function ExpenseForm({
  members,
  initial,
  submitLabel,
  submitting,
  onSubmit,
  children,
}: {
  members: ProfileRow[];
  initial?: ExpenseFormInitial;
  submitLabel: string;
  submitting: boolean;
  onSubmit: (values: ExpenseFormValues) => void;
  children?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    field: { gap: spacing.sm },
    label: { ...typography.captionStrong, color: c.textMuted },
    help: { ...typography.caption, color: c.textFaint },
    error: { ...typography.caption, color: c.danger },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    itemCard: { gap: spacing.sm, padding: spacing.md },
    itemRow: { flexDirection: 'row' as const, gap: spacing.sm, alignItems: 'center' as const },
    itemName: { flex: 2 },
    itemAmount: { flex: 1 },
    itemDelete: { paddingTop: 2 },
    preview: { gap: spacing.sm },
    previewRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    previewName: { ...typography.body, color: c.text, flex: 1 },
    previewAmount: { ...typography.bodyStrong, color: c.text },
  }));

  const [title, setTitle] = useState(initial?.title ?? '');
  const [amount, setAmount] = useState(
    initial?.totalCents != null ? (initial.totalCents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [paidBy, setPaidBy] = useState<string | null>(initial?.paidBy ?? null);
  // Held as typed text, not as a date: a half-finished "4.8." has to survive
  // being on screen, and there is no Date that means that.
  const [purchasedOn, setPurchasedOn] = useState(() =>
    formatDate(initial?.purchasedAt ? dateIso(initial.purchasedAt) : todayIso()),
  );
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  const [splitType, setSplitType] = useState<SplitType>(initial?.splitType ?? 'equal');
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');

  const { data: usedCategories } = useUsedCategories();

  // The built-in set first, then anything this household invented, then the
  // one currently on this expense — which may be neither, if it was typed
  // before and every trace of it has since been edited away.
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of [
      ...EXPENSE_CATEGORIES.map((c) => c.value),
      ...(usedCategories ?? []),
      ...(category ? [category] : []),
    ]) {
      if (value && value !== 'Sonstiges' && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
    return out;
  }, [usedCategories, category]);

  function applyCustomCategory() {
    const trimmed = custom.trim();
    if (trimmed.length > 0) setCategory(trimmed);
    setCustom('');
    setCustomOpen(false);
  }
  const [items, setItems] = useState<DraftItem[]>(
    (initial?.items ?? []).map((item, index) => ({
      key: `initial-${index}`,
      name: item.name,
      amount: (item.total_cents / 100).toFixed(2).replace('.', ','),
      paidFor: item.paid_for,
    })),
  );
  const [customShares, setCustomShares] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(initial?.shares ?? {}).map(([id, cents]) => [
        id,
        (cents / 100).toFixed(2).replace('.', ','),
      ]),
    ),
  );

  const totalCents = parseAmountToCents(amount) ?? 0;
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const payer = paidBy ?? memberIds[0] ?? '';

  const itemInputs = useMemo<ExpenseItemInput[]>(
    () =>
      items
        .map((item, index) => ({
          name: item.name.trim() || `Posten ${index + 1}`,
          total_cents: parseAmountToCents(item.amount) ?? 0,
          paid_for: item.paidFor,
          position: index,
        }))
        .filter((item) => item.total_cents > 0),
    [items],
  );

  const shares = useMemo(
    () =>
      computeSplit({
        totalCents,
        memberIds,
        payerId: payer,
        splitType,
        items: itemInputs,
        customShares: Object.fromEntries(
          Object.entries(customShares).map(([id, value]) => [id, parseAmountToCents(value) ?? 0]),
        ),
      }),
    [totalCents, memberIds, payer, splitType, itemInputs, customShares],
  );

  const splitError = totalCents > 0 && splitType === 'shares' ? validateSplit(totalCents, shares) : null;
  const purchasedIso = parseGermanDate(purchasedOn);
  const canSave =
    title.trim().length > 0 && totalCents > 0 && !!payer && !!purchasedIso && !splitError && !submitting;

  function submit() {
    if (!purchasedIso) return;

    onSubmit({
      title: title.trim(),
      totalCents,
      paidBy: payer,
      category,
      splitType,
      purchasedAt: timestampFor(purchasedIso, initial?.purchasedAt),
      items: splitType === 'items' ? itemInputs : [],
      shares:
        splitType === 'shares'
          ? memberIds.map((id) => ({ profile_id: id, share_cents: shares[id] ?? 0 }))
          : null,
    });
  }

  return (
    <>
      <TextField label="Wofür?" value={title} onChangeText={setTitle} placeholder="z. B. Wocheneinkauf" />

      <TextField
        label="Betrag"
        value={amount}
        onChangeText={setAmount}
        placeholder="0,00"
        keyboardType="decimal-pad"
        hint="Komma oder Punkt, beides geht."
      />

      {/* Backdating, which is the normal case rather than the exception: the
          shop happens on Saturday and gets typed in on Tuesday. Without this
          the expense lands in whatever month it was entered, which is invisible
          until it straddles a month end and the Statistik goes wrong. */}
      <View style={styles.field}>
        <TextField
          label="Wann"
          value={purchasedOn}
          onChangeText={setPurchasedOn}
          placeholder="TT.MM.JJJJ"
          keyboardType="numbers-and-punctuation"
          error={purchasedOn.trim().length > 0 && !purchasedIso ? 'Bitte als TT.MM.JJJJ eingeben.' : null}
        />
        {/* Backwards only — you cannot have already paid for next Tuesday. */}
        <View style={styles.chipRow}>
          <Chip label="Heute" onPress={() => setPurchasedOn(formatDate(todayIso()))} />
          <Chip label="Gestern" onPress={() => setPurchasedOn(formatDate(shiftDays(todayIso(), -1)))} />
          <Chip
            label="Vorgestern"
            onPress={() => setPurchasedOn(formatDate(shiftDays(todayIso(), -2)))}
          />
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Wer hat bezahlt?</Text>
        <View style={styles.chipRow}>
          {members.map((member) => (
            <Chip
              key={member.id}
              label={member.display_name}
              color={member.color}
              active={payer === member.id}
              onPress={() => setPaidBy(member.id)}
            />
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Kategorie</Text>
        <View style={styles.chipRow}>
          {categoryOptions.map((option) => (
            <Chip
              key={option}
              label={option}
              color={categoryMeta(option).color}
              active={category === option}
              // Tapping the active chip clears it — a category is optional,
              // and there is no other way back to "none".
              onPress={() => setCategory((prev) => (prev === option ? null : option))}
            />
          ))}
          <Chip
            label={customOpen ? 'Abbrechen' : '+ Eigene'}
            active={customOpen}
            onPress={() => {
              setCustomOpen((open) => !open);
              setCustom('');
            }}
          />
        </View>

        {customOpen ? (
          <TextField
            value={custom}
            onChangeText={setCustom}
            placeholder="z. B. Tierarzt"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={applyCustomCategory}
            onBlur={applyCustomCategory}
            hint="Wird gespeichert und steht beim nächsten Mal als Chip bereit."
          />
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Aufteilung</Text>
        <Segmented
          options={[
            { value: 'equal', label: '50 / 50' },
            { value: 'shares', label: 'Anteile' },
            { value: 'items', label: 'Pro Posten' },
          ]}
          value={splitType}
          onChange={setSplitType}
        />
      </View>

      {splitType === 'shares' ? (
        <View style={styles.field}>
          {members.map((member) => (
            <TextField
              key={member.id}
              label={member.display_name}
              value={customShares[member.id] ?? ''}
              onChangeText={(t) => setCustomShares((prev) => ({ ...prev, [member.id]: t }))}
              placeholder="0,00"
              keyboardType="decimal-pad"
            />
          ))}
          {splitError ? <Text style={styles.error}>{splitError}</Text> : null}
        </View>
      ) : null}

      {splitType === 'items' ? (
        <View style={styles.field}>
          <Text style={styles.label}>Posten</Text>
          <Text style={styles.help}>Nicht zugeordnete Posten und der Rest zur Summe werden geteilt.</Text>

          {items.map((item, index) => (
            <Card key={item.key} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <View style={styles.itemName}>
                  <TextField
                    value={item.name}
                    onChangeText={(t) =>
                      setItems((prev) => prev.map((i, n) => (n === index ? { ...i, name: t } : i)))
                    }
                    placeholder="Artikel"
                  />
                </View>
                <View style={styles.itemAmount}>
                  <TextField
                    value={item.amount}
                    onChangeText={(t) =>
                      setItems((prev) => prev.map((i, n) => (n === index ? { ...i, amount: t } : i)))
                    }
                    placeholder="0,00"
                    keyboardType="decimal-pad"
                  />
                </View>
                <Pressable
                  onPress={() => setItems((prev) => prev.filter((_, n) => n !== index))}
                  hitSlop={8}
                  style={styles.itemDelete}
                >
                  <Ionicons name="close-circle" size={22} color={colors.textFaint} />
                </Pressable>
              </View>

              <View style={styles.chipRow}>
                <Chip
                  label="Geteilt"
                  active={!item.paidFor}
                  onPress={() =>
                    setItems((prev) => prev.map((i, n) => (n === index ? { ...i, paidFor: null } : i)))
                  }
                />
                {members.map((member) => (
                  <Chip
                    key={member.id}
                    label={`nur ${member.display_name}`}
                    color={member.color}
                    active={item.paidFor === member.id}
                    onPress={() =>
                      setItems((prev) =>
                        prev.map((i, n) => (n === index ? { ...i, paidFor: member.id } : i)),
                      )
                    }
                  />
                ))}
              </View>
            </Card>
          ))}

          <Button
            label="Posten hinzufügen"
            variant="secondary"
            onPress={() =>
              setItems((prev) => [
                ...prev,
                { key: `${Date.now()}-${prev.length}`, name: '', amount: '', paidFor: null },
              ])
            }
          />
        </View>
      ) : null}

      {/* Live preview so the split is understood before saving, not after. */}
      {totalCents > 0 ? (
        <Card style={styles.preview}>
          <Text style={styles.label}>Aufteilung</Text>
          {members.map((member) => (
            <View key={member.id} style={styles.previewRow}>
              <Avatar name={member.display_name} color={member.color} size={26} />
              <Text style={styles.previewName}>{member.display_name}</Text>
              <Text style={styles.previewAmount}>{formatCents(shares[member.id] ?? 0)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      {children}

      <Button label={submitLabel} onPress={submit} disabled={!canSave} loading={submitting} size="lg" />
    </>
  );
}
