import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Chip } from '../../../components/Segmented';
import { TextField } from '../../../components/TextField';
import { Alert } from '../../../lib/alert';
import type { StorageLocationRow } from '../../../lib/database.types';
import { errorMessage } from '../../../lib/errors';
import { radius, spacing, typography } from '../../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../../lib/theme-context';
import { useCreateLocations, useLocations } from '../hooks';
import {
  LOCATION_KINDS,
  MAX_LOCATIONS_PER_BATCH,
  expandLocationNames,
  hasRefusedRange,
} from '../locations';

/**
 * Create-a-location form: name, Art (the chips plus the free-text field that
 * makes `kind` genuinely open), and an optional parent.
 *
 * Shared by the Orte list and the scan sheet so a shelf invented mid-scan gets
 * exactly the same vocabulary as one created deliberately — including custom
 * Arten, which is the whole point of the free-text field being here rather
 * than only on the dedicated screen.
 *
 * The Name field takes a list ("Schub 1-3", "Regal, Kommode"), and after a
 * single location is created the form stays open pointed *inside* it. Those
 * two together are what makes entering a cabinet and its five drawers one
 * sitting instead of six.
 *
 * Owns its draft state: mounting is what resets the form, so callers just
 * toggle it and react to `onCreated`.
 */
export function LocationComposer({
  onCreated,
}: {
  onCreated?: (locations: StorageLocationRow[]) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    fields: { gap: spacing.sm },
    label: { ...typography.captionStrong, color: c.textMuted },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
    done: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: spacing.sm,
      backgroundColor: c.successSoft,
      borderRadius: radius.md,
      padding: spacing.md,
    },
    doneText: { ...typography.caption, color: c.success, flex: 1 },
  }));

  const { data: locations } = useLocations();
  const createLocations = useCreateLocations();

  const [name, setName] = useState('');
  const [kind, setKind] = useState('room');
  /** Anything typed here wins over the chips — `kind` is free text now. */
  const [customKind, setCustomKind] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  /** The last batch, kept only to confirm what just happened. */
  const [created, setCreated] = useState<StorageLocationRow[]>([]);

  const names = expandLocationNames(name);

  async function submit() {
    if (names.length === 0) return;

    try {
      const rows = await createLocations.mutateAsync({
        names,
        kind: customKind.trim() || kind,
        parentId,
      });

      setName('');
      setCreated(rows);
      // One new place is usually a container you are about to fill, so the
      // next thing you type belongs inside it. Several at once are siblings —
      // "Schub 1-3" does not mean Schub 3 is inside Schub 2.
      if (rows.length === 1) setParentId(rows[0].id);
      onCreated?.(rows);
    } catch (err) {
      Alert.alert('Konnte nicht angelegt werden', errorMessage(err));
    }
  }

  function chooseParent(id: string | null) {
    setParentId(id);
    // The confirmation says where the next one lands, so it stops being true
    // the moment the parent is picked by hand.
    setCreated([]);
  }

  return (
    <View style={styles.fields}>
      {created.length > 0 ? (
        <View style={styles.done}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={styles.doneText}>
            {created.length === 1
              ? `„${created[0].name}“ angelegt — der nächste Ort landet darin.`
              : `${created.length} Orte angelegt: ${created.map((row) => row.name).join(', ')}`}
          </Text>
        </View>
      ) : null}

      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="z. B. Schrank oder Schub 1-3"
        error={
          hasRefusedRange(names)
            ? `Bereiche zählen aufwärts und höchstens ${MAX_LOCATIONS_PER_BATCH} auf einmal — so wird daraus ein einzelner Ort mit diesem Namen.`
            : null
        }
        hint={
          names.length > 1
            ? `Legt an: ${names.join(', ')}`
            : 'Mehrere auf einmal: „Schub 1-3“ oder mit Komma getrennt.'
        }
        autoFocus
      />

      <Text style={styles.label}>Art</Text>
      <View style={styles.chipRow}>
        {LOCATION_KINDS.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            active={kind === option.value && customKind.trim() === ''}
            onPress={() => {
              setKind(option.value);
              setCustomKind('');
            }}
          />
        ))}
      </View>
      <TextField
        value={customKind}
        onChangeText={setCustomKind}
        placeholder="oder eigene Art, z. B. Speisekammer"
        hint="Eigene Arten bekommen ein neutrales Symbol."
      />

      <Text style={styles.label}>Übergeordneter Ort (optional)</Text>
      <View style={styles.chipRow}>
        <Chip label="Kein übergeordneter Ort" active={!parentId} onPress={() => chooseParent(null)} />
        {(locations ?? []).map((location) => (
          <Chip
            key={location.id}
            label={location.path}
            active={parentId === location.id}
            onPress={() => chooseParent(location.id)}
          />
        ))}
      </View>

      <Button
        label={names.length > 1 ? `${names.length} Orte anlegen` : 'Ort anlegen'}
        onPress={() => void submit()}
        disabled={names.length === 0}
        loading={createLocations.isPending}
      />
    </View>
  );
}
