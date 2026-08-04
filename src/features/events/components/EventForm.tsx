import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip, Segmented } from '../../../components/Segmented';
import { TextField } from '../../../components/TextField';
import type { EventKind } from '../../../lib/database.types';
import { formatDate, parseGermanDate, shiftDays, todayIso } from '../../../lib/format';
import { spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';
import type { EventInput } from '../api';

const KIND_OPTIONS: { value: EventKind; label: string }[] = [
  { value: 'event', label: 'Termin' },
  { value: 'anniversary', label: 'Jahrestag' },
  { value: 'birthday', label: 'Geburtstag' },
];

const REMIND_CHOICES = [0, 1, 3, 7, 14];

// Dates are typed as TT.MM.JJJJ and stored as ISO — parseGermanDate() in
// lib/format.ts explains why typing beats a picker here.
const toGerman = (iso: string) => formatDate(iso);
const shiftToday = (days: number) => shiftDays(todayIso(), days);

export interface EventFormInitial extends Partial<EventInput> {}

export function EventForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
}: {
  initial?: EventFormInitial;
  submitLabel: string;
  submitting?: boolean;
  onSubmit: (values: EventInput) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    card: { gap: spacing.md },
    label: { ...typography.captionStrong, color: c.textMuted },
    hint: { ...typography.caption, color: c.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    switchText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.bodyStrong, color: c.text },
  }));

  const [kind, setKind] = useState<EventKind>(initial?.kind ?? 'event');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [place, setPlace] = useState(initial?.place ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(toGerman(initial?.startsOn ?? todayIso()));
  const [endDate, setEndDate] = useState(initial?.endsOn ? toGerman(initial.endsOn) : '');
  const [time, setTime] = useState(initial?.startsAt?.slice(0, 5) ?? '');
  const [repeatYearly, setRepeatYearly] = useState(initial?.repeatYearly ?? false);
  const [remindDaysBefore, setRemindDaysBefore] = useState(initial?.remindDaysBefore ?? 1);

  const startsOn = parseGermanDate(date);
  const endsOn = endDate.trim() === '' ? null : parseGermanDate(endDate);
  const endInvalid = endDate.trim() !== '' && (endsOn === null || (startsOn !== null && endsOn < startsOn));
  const timeInvalid = time.trim() !== '' && !/^\d{1,2}:\d{2}$/.test(time.trim());

  const valid = title.trim().length > 0 && startsOn !== null && !endInvalid && !timeInvalid;
  // The CHECK constraint requires it, so the switch is not offered for them.
  const yearlyForced = kind !== 'event';

  function submit() {
    if (!valid || startsOn === null) return;
    onSubmit({
      kind,
      title,
      place,
      description,
      startsOn,
      startsAt: time.trim() === '' ? null : `${time.trim().padStart(5, '0')}:00`,
      endsOn,
      repeatYearly: yearlyForced || repeatYearly,
      remindDaysBefore,
    });
  }

  return (
    <>
      <Card style={styles.card}>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />

        <TextField
          label="Was"
          value={title}
          onChangeText={setTitle}
          placeholder={
            kind === 'birthday' ? 'z. B. Geburtstag Mama' : kind === 'anniversary' ? 'z. B. Zusammen' : 'z. B. Marie kommt vorbei'
          }
          autoFocus
        />

        <TextField
          label="Wann"
          value={date}
          onChangeText={setDate}
          placeholder="TT.MM.JJJJ"
          keyboardType="numbers-and-punctuation"
          error={date.trim().length > 0 && startsOn === null ? 'Bitte als TT.MM.JJJJ eingeben.' : null}
        />
        {kind === 'event' ? (
          <View style={styles.chipRow}>
            <Chip label="Heute" onPress={() => setDate(toGerman(todayIso()))} />
            <Chip label="Morgen" onPress={() => setDate(toGerman(shiftToday(1)))} />
            <Chip label="Nächste Woche" onPress={() => setDate(toGerman(shiftToday(7)))} />
          </View>
        ) : null}

        <TextField
          label="Uhrzeit (optional)"
          value={time}
          onChangeText={setTime}
          placeholder="ganztägig"
          keyboardType="numbers-and-punctuation"
          error={timeInvalid ? 'Bitte als HH:MM eingeben.' : null}
        />

        {kind === 'event' ? (
          <TextField
            label="Bis (optional)"
            value={endDate}
            onChangeText={setEndDate}
            placeholder="TT.MM.JJJJ"
            keyboardType="numbers-and-punctuation"
            error={endInvalid ? 'Muss nach dem Startdatum liegen.' : null}
          />
        ) : null}

        <TextField label="Wo (optional)" value={place} onChangeText={setPlace} placeholder="z. B. bei uns" />

        <TextField
          label="Notiz (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="Was man wissen sollte"
          multiline
        />
      </Card>

      <Card style={styles.card}>
        {kind === 'event' ? (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.rowTitle}>Jedes Jahr</Text>
              <Text style={styles.hint}>Kommt am selben Tag wieder.</Text>
            </View>
            <Switch
              value={repeatYearly}
              onValueChange={setRepeatYearly}
              trackColor={{ true: colors.primary }}
            />
          </View>
        ) : (
          <Text style={styles.hint}>
            {kind === 'anniversary'
              ? 'Zählt die Tage seit dem Datum und erinnert jedes Jahr.'
              : 'Wiederholt sich jedes Jahr.'}
          </Text>
        )}

        <Text style={styles.label}>Erinnerung</Text>
        <View style={styles.chipRow}>
          {REMIND_CHOICES.map((days) => (
            <Chip
              key={days}
              label={days === 0 ? 'Am Tag selbst' : days === 1 ? '1 Tag vorher' : `${days} Tage vorher`}
              active={remindDaysBefore === days}
              onPress={() => setRemindDaysBefore(days)}
            />
          ))}
        </View>
      </Card>

      <Button label={submitLabel} onPress={submit} disabled={!valid} loading={submitting} />
    </>
  );
}
