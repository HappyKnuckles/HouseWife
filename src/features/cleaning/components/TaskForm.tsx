import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';

import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { Chip, Segmented } from '../../../components/Segmented';
import { TextField } from '../../../components/TextField';
import type {
  AssignmentMode,
  CleaningTaskRow,
  RecurrenceUnit,
  ScheduleMode,
} from '../../../lib/database.types';
import { todayIso, weekdayShort } from '../../../lib/format';
import { radius, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';
import { useMembers } from '../../household/hooks';
import { useAreas } from '../hooks';

export interface TaskFormValues {
  name: string;
  description: string | null;
  area_id: string | null;
  estimated_minutes: number | null;
  recurrence_unit: RecurrenceUnit;
  recurrence_interval: number;
  weekdays: number[] | null;
  day_of_month: number | null;
  schedule_mode: ScheduleMode;
  assignment_mode: AssignmentMode;
  assigned_to: string | null;
  rotation_order: string[];
  next_due_on: string;
  reminder_enabled: boolean;
  remind_days_before: number;
}

export function emptyTaskValues(memberIds: string[], myId: string): TaskFormValues {
  return {
    name: '',
    description: null,
    area_id: null,
    estimated_minutes: null,
    recurrence_unit: 'week',
    recurrence_interval: 1,
    weekdays: null,
    day_of_month: null,
    schedule_mode: 'after_completion',
    assignment_mode: memberIds.length > 1 ? 'rotating' : 'fixed',
    assigned_to: myId,
    rotation_order: memberIds,
    next_due_on: todayIso(),
    reminder_enabled: true,
    remind_days_before: 0,
  };
}

export function taskToValues(task: CleaningTaskRow): TaskFormValues {
  return {
    name: task.name,
    description: task.description,
    area_id: task.area_id,
    estimated_minutes: task.estimated_minutes,
    recurrence_unit: task.recurrence_unit,
    recurrence_interval: task.recurrence_interval,
    weekdays: task.weekdays,
    day_of_month: task.day_of_month,
    schedule_mode: task.schedule_mode,
    assignment_mode: task.assignment_mode,
    assigned_to: task.assigned_to,
    rotation_order: task.rotation_order,
    next_due_on: task.next_due_on,
    reminder_enabled: task.reminder_enabled,
    remind_days_before: task.remind_days_before,
  };
}

const UNIT_OPTIONS = [
  { value: 'day' as const, label: 'Tage' },
  { value: 'week' as const, label: 'Wochen' },
  { value: 'month' as const, label: 'Monate' },
];

export function TaskForm({
  initial,
  submitLabel,
  onSubmit,
  submitting,
}: {
  initial: TaskFormValues;
  submitLabel: string;
  onSubmit: (values: TaskFormValues) => void;
  submitting?: boolean;
}) {
  const [values, setValues] = useState<TaskFormValues>(initial);
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
    field: { gap: spacing.sm },
    label: { ...typography.captionStrong, color: c.textMuted },
    help: { ...typography.caption, color: c.textFaint },
    groupTitle: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      marginTop: spacing.sm,
    },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    row: { flexDirection: 'row' as const, gap: spacing.md, alignItems: 'flex-start' as const },
    intervalField: { width: 90 },
    unitField: { flex: 1, gap: spacing.xs },
    personChipWrapper: {},
    rotationPreview: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
    switchRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    switchText: { flex: 1, gap: 2 },
    switchLabel: { ...typography.bodyStrong, color: c.text },
    submit: { marginTop: spacing.md },
  }));
  const { data: areas } = useAreas();
  const { data: members } = useMembers();

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const toggleWeekday = (day: number) => {
    const current = values.weekdays ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    set('weekdays', next.length > 0 ? next : null);
  };

  const canSubmit = values.name.trim().length > 0 && !submitting;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label="Was ist zu tun?"
        value={values.name}
        onChangeText={(t) => set('name', t)}
        placeholder="z. B. Bad putzen"
      />

      <View style={styles.field}>
        <Text style={styles.label}>Bereich</Text>
        <View style={styles.chipRow}>
          <Chip label="Ohne" active={!values.area_id} onPress={() => set('area_id', null)} />
          {(areas ?? []).map((area) => (
            <Chip
              key={area.id}
              label={area.name}
              color={area.color}
              active={values.area_id === area.id}
              onPress={() => set('area_id', area.id)}
            />
          ))}
        </View>
      </View>

      {/* ---------------------------------------------------------------- */}
      <Text style={styles.groupTitle}>Rhythmus</Text>

      <View style={styles.row}>
        <View style={styles.intervalField}>
          <TextField
            label="Alle"
            value={String(values.recurrence_interval)}
            onChangeText={(t) => set('recurrence_interval', Math.max(1, Number(t.replace(/\D/g, '')) || 1))}
            keyboardType="number-pad"
            maxLength={3}
          />
        </View>
        <View style={styles.unitField}>
          <Text style={styles.label}> </Text>
          <Segmented
            options={UNIT_OPTIONS}
            value={values.recurrence_unit}
            onChange={(unit) => {
              set('recurrence_unit', unit);
              if (unit !== 'week') set('weekdays', null);
              if (unit !== 'month') set('day_of_month', null);
            }}
          />
        </View>
      </View>

      {values.recurrence_unit === 'week' ? (
        <View style={styles.field}>
          <Text style={styles.label}>An welchen Tagen? (optional)</Text>
          <View style={styles.chipRow}>
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <Chip
                key={day}
                label={weekdayShort(day)}
                active={values.weekdays?.includes(day)}
                onPress={() => toggleWeekday(day)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {values.recurrence_unit === 'month' ? (
        <TextField
          label="Am Tag des Monats (optional)"
          value={values.day_of_month ? String(values.day_of_month) : ''}
          onChangeText={(t) => {
            const n = Number(t.replace(/\D/g, ''));
            set('day_of_month', n >= 1 && n <= 31 ? n : null);
          }}
          keyboardType="number-pad"
          maxLength={2}
          placeholder="z. B. 1"
        />
      ) : null}

      {/*
        The distinction that makes a Putzplan match reality. Spelled out in the
        UI because picking the wrong one silently produces a schedule that
        drifts — and nobody would connect that to a setting they chose once.
      */}
      <View style={styles.field}>
        <Text style={styles.label}>Wann zählt der nächste Termin?</Text>
        <Segmented
          options={[
            { value: 'after_completion', label: 'Nach Erledigung' },
            { value: 'fixed', label: 'Fester Termin' },
          ]}
          value={values.schedule_mode}
          onChange={(mode) => set('schedule_mode', mode)}
        />
        <Text style={styles.help}>
          {values.schedule_mode === 'after_completion'
            ? 'Der nächste Termin zählt ab dem Tag, an dem die Aufgabe erledigt wurde. Passend für „alle 7 Tage saugen“.'
            : 'Der Termin bleibt im Kalender stehen, auch wenn du später putzt. Passend für „jeden Samstag“.'}
        </Text>
      </View>

      <TextField
        label="Nächster Termin"
        value={values.next_due_on}
        onChangeText={(t) => set('next_due_on', t)}
        placeholder="JJJJ-MM-TT"
        autoCapitalize="none"
      />
      <View style={styles.chipRow}>
        <Chip label="Heute" onPress={() => set('next_due_on', todayIso())} />
        <Chip label="Morgen" onPress={() => set('next_due_on', shiftIso(1))} />
        <Chip label="In einer Woche" onPress={() => set('next_due_on', shiftIso(7))} />
      </View>

      {/* ---------------------------------------------------------------- */}
      <Text style={styles.groupTitle}>Zuständigkeit</Text>

      <Segmented
        options={[
          { value: 'rotating', label: 'Im Wechsel' },
          { value: 'fixed', label: 'Feste Person' },
        ]}
        value={values.assignment_mode}
        onChange={(mode) => {
          set('assignment_mode', mode);
          if (mode === 'rotating' && values.rotation_order.length === 0) {
            set('rotation_order', (members ?? []).map((m) => m.id));
          }
        }}
      />

      <View style={styles.field}>
        <Text style={styles.label}>
          {values.assignment_mode === 'rotating' ? 'Wer fängt an?' : 'Wer ist zuständig?'}
        </Text>
        <View style={styles.chipRow}>
          {(members ?? []).map((member) => {
            const active = values.assigned_to === member.id;
            return (
              <View key={member.id} style={styles.personChipWrapper}>
                <Chip
                  label={member.display_name}
                  color={member.color}
                  active={active}
                  onPress={() => set('assigned_to', member.id)}
                />
              </View>
            );
          })}
        </View>
        {values.assignment_mode === 'rotating' && (members?.length ?? 0) > 1 ? (
          <View style={styles.rotationPreview}>
            <Text style={styles.help}>Reihenfolge:</Text>
            {values.rotation_order.map((id) => {
              const member = members?.find((m) => m.id === id);
              return <Avatar key={id} name={member?.display_name} color={member?.color} size={22} />;
            })}
          </View>
        ) : null}
      </View>

      {/* ---------------------------------------------------------------- */}
      <Text style={styles.groupTitle}>Erinnerung</Text>

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchLabel}>Push-Erinnerung</Text>
          <Text style={styles.help}>Wird serverseitig verschickt, auch wenn die App zu ist.</Text>
        </View>
        <Switch
          value={values.reminder_enabled}
          onValueChange={(v) => set('reminder_enabled', v)}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {values.reminder_enabled ? (
        <View style={styles.field}>
          <Text style={styles.label}>Vorlauf</Text>
          <View style={styles.chipRow}>
            {[0, 1, 2, 3].map((days) => (
              <Chip
                key={days}
                label={days === 0 ? 'Am Tag selbst' : `${days} Tag${days > 1 ? 'e' : ''} vorher`}
                active={values.remind_days_before === days}
                onPress={() => set('remind_days_before', days)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <TextField
        label="Geschätzte Dauer in Minuten (optional)"
        value={values.estimated_minutes ? String(values.estimated_minutes) : ''}
        onChangeText={(t) => {
          const n = Number(t.replace(/\D/g, ''));
          set('estimated_minutes', n > 0 ? n : null);
        }}
        keyboardType="number-pad"
        maxLength={3}
      />

      <Button
        label={submitLabel}
        onPress={() => onSubmit({ ...values, name: values.name.trim() })}
        disabled={!canSubmit}
        loading={submitting}
        size="lg"
        style={styles.submit}
      />
    </ScrollView>
  );
}

function shiftIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
