import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
// Gesture-handler's Pressable, not React Native's — see the comment in
// components/Card.tsx. Rows here sit inside a SwipeRow.
import { Pressable } from 'react-native-gesture-handler';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/Card';
import { ErrorState, LoadingState, Screen, ScreenHeader } from '../../components/Screen';
import { SwipeRow, useSwipeRowGroup } from '../../components/SwipeRow';
import { TextField } from '../../components/TextField';
import { useMemberMap } from '../../features/household/hooks';
import {
  useAddTodo,
  useClearCompleted,
  useDeleteTodo,
  useSetQuantity,
  useShoppingSuggestions,
  useTodos,
  useToggleTodo,
  useUpdateTodo,
} from '../../features/todos/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';
import { formatQuantity } from '../../lib/format';
import { radius, shadow, spacing, typography } from '../../lib/theme';
import { useAppTheme, useThemedStyles } from '../../lib/theme-context';

/** How many quick-add chips fit before the row stops being scannable. */
const SUGGESTION_LIMIT = 12;

/**
 * Einkaufsliste — the same machinery as the to-do list over the same table,
 * filtered to `list = 'shopping'` (migration 0024).
 *
 * What makes it its own screen rather than a section on the to-dos: this is
 * the one the app writes to by itself. Every staple that falls to its restock
 * threshold appears here within the same second the stock changes, so the list
 * is already right by the time you are standing in the shop — and those rows
 * carry a link back to the product, which a hand-written line cannot.
 *
 * No assignee, unlike the to-do list. Whoever is at the shop buys the whole
 * list; "Milch — für Nico" would be a rule about who may pick up the milk,
 * which is not a thing anyone means. The face on a row is the *author*
 * instead — the answer to "was heißt hier Käse", which is the question a
 * shared list actually raises.
 */
export default function ShoppingListScreen() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    clear: { ...typography.caption, color: c.primary, textAlign: 'center' as const },
    footer: {
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
      backgroundColor: c.surface,
    },
    composer: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
    list: { paddingBottom: spacing.xxl * 2 },
    // See the matching comment in todos.tsx: the shadow has to live outside
    // SwipeRow, which clips its own bounds to hide the delete action.
    rowWrap: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      ...shadow.card,
    },
    swipeContainer: { borderRadius: radius.md },
    row: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    // Fading `row` itself let the swipe action's color bleed through a
    // bought item's card even before swiping (an opaque background stops
    // being opaque at 55%) — so the fade lives on the content instead, and
    // `row` stays a solid card no matter what sits behind it.
    rowContent: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    rowDone: { opacity: 0.55 },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      borderWidth: 2,
      borderColor: c.borderStrong,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    checkboxDone: { backgroundColor: c.success, borderColor: c.success },
    rowEditing: { borderWidth: 1, borderColor: c.primary },
    rowText: { flex: 1, gap: 2 },
    rowTitle: { ...typography.body, color: c.text },
    rowTitleDone: { textDecorationLine: 'line-through' as const, color: c.textMuted },
    rowMeta: { ...typography.caption, color: c.textFaint },
    metaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    stepper: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      backgroundColor: c.surfaceMuted,
      borderRadius: radius.pill,
      paddingHorizontal: 2,
    },
    stepperButton: {
      width: 28,
      height: 28,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    stepperValue: {
      ...typography.captionStrong,
      color: c.text,
      minWidth: 22,
      textAlign: 'center' as const,
    },
    composerActions: { flexDirection: 'row' as const, gap: spacing.md },
    flex: { flex: 1 },
    suggestionsLabel: {
      ...typography.micro,
      color: c.textMuted,
      textTransform: 'uppercase' as const,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xs,
    },
    // A horizontal ScrollView defaults to flexGrow: 1, so it claims the space
    // between the composer and the list — and its row content container
    // stretches every chip to that height. Both halves need saying: flexGrow 0
    // so the strip is only as tall as a chip, alignItems so a chip is only as
    // tall as its text.
    suggestionsScroll: { flexGrow: 0 },
    suggestions: {
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
      paddingBottom: spacing.md,
      alignItems: 'center' as const,
    },
    suggestion: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    suggestionDue: { borderColor: c.dueToday, backgroundColor: c.dueTodaySoft },
    suggestionLabel: { ...typography.caption, color: c.text },
    suggestionMeta: { ...typography.caption, color: c.textFaint },
    suggestionMetaDue: { color: c.dueToday },
  }));

  const { data: items, isLoading, isRefetching, refetch, error } = useTodos('shopping');
  const { data: suggestions } = useShoppingSuggestions();
  const memberMap = useMemberMap();

  const router = useRouter();
  const addItem = useAddTodo('shopping');
  const updateItem = useUpdateTodo();
  const toggleItem = useToggleTodo('shopping');
  const deleteItem = useDeleteTodo('shopping');
  const clearBought = useClearCompleted('shopping');
  const setQuantity = useSetQuantity('shopping');
  const swipeGroup = useSwipeRowGroup();

  const [title, setTitle] = useState('');
  /** Which entry the composer is currently editing; null = writing a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const open = useMemo(() => (items ?? []).filter((t) => !t.is_done), [items]);
  const bought = useMemo(() => (items ?? []).filter((t) => t.is_done), [items]);

  /**
   * What to offer for one tap: the things this household buys, minus whatever
   * is already on the list, with the ones whose usual interval has elapsed
   * first. Most of a weekly shop is the same twenty items, and typing them out
   * again every week is the whole reason shopping lists get abandoned.
   */
  const quickAdd = useMemo(() => {
    const onList = new Set((items ?? []).map((t) => t.title.trim().toLowerCase()));

    return (suggestions ?? [])
      .filter((s) => !onList.has(s.item_key))
      .sort((a, b) => {
        if (!!a.is_due !== !!b.is_due) return a.is_due ? -1 : 1;
        return b.times_bought + b.times_paid - (a.times_bought + a.times_paid);
      })
      .slice(0, SUGGESTION_LIMIT);
  }, [suggestions, items]);

  if (isLoading) return <LoadingState label="Einkaufsliste wird geladen…" />;
  if (error) return <ErrorState error={error} />;

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;

    const id = editingId;
    setTitle('');
    setEditingId(null);

    try {
      if (id) await updateItem.mutateAsync({ id, patch: { title: trimmed } });
      else await addItem.mutateAsync({ title: trimmed });
    } catch (err) {
      Alert.alert('Konnte nicht gespeichert werden', errorMessage(err));
    }
  }

  function startEditing(item: { id: string; title: string }) {
    setEditingId(item.id);
    setTitle(item.title);
  }

  function cancelEditing() {
    setEditingId(null);
    setTitle('');
  }

  function confirmDelete(id: string, title: string) {
    Alert.alert(`${title} löschen?`, 'Das lässt sich nicht rückgängig machen.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: () => void deleteItem.mutateAsync(id) },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader
        title="Einkaufsliste"
        subtitle={open.length === 0 ? 'Nichts zu holen' : `${open.length} auf der Liste`}
        right={
          <Pressable
            onPress={() => router.push('/einkauf/historie')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Einkaufshistorie"
          >
            <Ionicons name="time-outline" size={20} color={colors.text} />
          </Pressable>
        }
      />

      <View style={styles.composer}>
        <TextField
          value={title}
          onChangeText={setTitle}
          placeholder={editingId ? 'Eintrag ändern…' : 'Was fehlt? z. B. Milch'}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        {editingId ? (
          <View style={styles.composerActions}>
            <Button label="Abbrechen" variant="secondary" onPress={cancelEditing} style={styles.flex} />
            <Button
              label="Speichern"
              onPress={() => void submit()}
              disabled={title.trim().length === 0}
              loading={updateItem.isPending}
              style={styles.flex}
            />
          </View>
        ) : null}
      </View>

      {quickAdd.length > 0 && !editingId ? (
        <>
          <Text style={styles.suggestionsLabel}>Oft gekauft</Text>
          {/* Horizontal, so a long memory costs one row of screen instead of
              pushing the actual list below the fold. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.suggestionsScroll}
            contentContainerStyle={styles.suggestions}
            keyboardShouldPersistTaps="handled"
          >
            {quickAdd.map((item) => (
              <Pressable
                key={item.item_key}
                onPress={() => {
                  void Haptics.selectionAsync();
                  void addItem.mutateAsync({ title: item.name });
                }}
                style={[styles.suggestion, item.is_due && styles.suggestionDue]}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} auf die Liste setzen`}
              >
                <Ionicons
                  name={item.is_due ? 'refresh' : 'add'}
                  size={13}
                  color={item.is_due ? colors.dueToday : colors.textFaint}
                />
                <Text style={styles.suggestionLabel}>{item.name}</Text>
                {/* Only "seit N Tagen", never a price: the chip is a button for
                    putting something on the list, and what it cost last time
                    changes nothing about whether you need it now. */}
                {item.is_due && item.days_since_bought !== null ? (
                  <Text style={[styles.suggestionMeta, styles.suggestionMetaDue]}>
                    seit {item.days_since_bought} T.
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      <FlatList
        data={[...open, ...bought]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState
            title="Nichts zu holen"
            body="Was ihr aufschreibt steht sofort auf beiden Handys — und was im Inventar zur Neige geht, landet von selbst hier."
          />
        }
        renderItem={({ item }) => {
          // NULL for a generated row: nobody wrote it, and the trigger in
          // migration 0027 keeps it that way rather than crediting whoever
          // happened to use up the last of the stock.
          const author = item.created_by ? memberMap[item.created_by] : null;
          const fromInventory = item.source === 'restock';

          return (
            <View style={styles.rowWrap}>
              <SwipeRow
                id={item.id}
                group={swipeGroup}
                containerStyle={styles.swipeContainer}
                rightActions={[
                  {
                    key: 'delete',
                    icon: 'trash-outline',
                    label: 'Löschen',
                    tone: 'danger',
                    accessibilityLabel: `${item.title} löschen`,
                    onPress: () => confirmDelete(item.id, item.title),
                  },
                ]}
              >
                <View style={[styles.row, editingId === item.id && styles.rowEditing]}>
                  <View style={[styles.rowContent, item.is_done && styles.rowDone]}>
                    <Pressable
                      onPress={() => {
                        void Haptics.selectionAsync();
                        void toggleItem.mutateAsync({ id: item.id, isDone: !item.is_done });
                      }}
                      hitSlop={8}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: item.is_done }}
                      style={[styles.checkbox, item.is_done && styles.checkboxDone]}
                    >
                      {item.is_done ? (
                        <Ionicons name="checkmark" size={16} color={colors.textInverse} />
                      ) : null}
                    </Pressable>

                    <Pressable
                      onPress={() => startEditing(item)}
                      style={styles.rowText}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title} bearbeiten`}
                    >
                      <Text style={[styles.rowTitle, item.is_done && styles.rowTitleDone]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {/* The author moved down here from an avatar on the right: the
                          stepper needs that width more than a coloured circle did,
                          and "von Nico" says the same thing without decoding. */}
                      {fromInventory ? (
                        <View style={styles.metaRow}>
                          <Ionicons name="cube-outline" size={12} color={colors.textFaint} />
                          <Text style={styles.rowMeta}>Bestand niedrig</Text>
                        </View>
                      ) : author ? (
                        <Text style={styles.rowMeta}>von {author.display_name}</Text>
                      ) : null}
                    </Pressable>

                    {/* Only while it is still to be bought — once it is in the
                        trolley the number is history, and a stepper on a ticked row
                        invites changing what you already carried home. */}
                    {!item.is_done ? (
                      <View style={styles.stepper}>
                        <Pressable
                          onPress={() =>
                            void setQuantity.mutateAsync({
                              id: item.id,
                              quantity: Math.max(1, item.quantity - 1),
                            })
                          }
                          disabled={item.quantity <= 1}
                          hitSlop={4}
                          style={styles.stepperButton}
                          accessibilityRole="button"
                          accessibilityLabel="Eins weniger"
                        >
                          <Ionicons
                            name="remove"
                            size={16}
                            color={item.quantity <= 1 ? colors.border : colors.text}
                          />
                        </Pressable>

                        <Text style={styles.stepperValue}>{formatQuantity(item.quantity)}</Text>

                        <Pressable
                          onPress={() =>
                            void setQuantity.mutateAsync({ id: item.id, quantity: item.quantity + 1 })
                          }
                          hitSlop={4}
                          style={styles.stepperButton}
                          accessibilityRole="button"
                          accessibilityLabel="Eins mehr"
                        >
                          <Ionicons name="add" size={16} color={colors.text} />
                        </Pressable>
                      </View>
                    ) : null}

                    {fromInventory && item.product_id ? (
                      <Pressable
                        onPress={() => router.push(`/inventar/produkt/${item.product_id}`)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Produkt öffnen"
                      >
                        <Ionicons name="open-outline" size={18} color={colors.textFaint} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </SwipeRow>
            </View>
          );
        }}
      />

      {/* Abgehakt heißt gekauft, und gekauft ist der Moment, in dem drei
          Sachen gleichzeitig stimmen sollen: die Liste ist leer, das Geld ist
          gebucht, und der Bestand weiß Bescheid. Deshalb ist Abschließen die
          Hauptaktion und "nur wegnehmen" die kleine daneben. */}
      {bought.length > 0 ? (
        <View style={styles.footer}>
          <Button
            label={`Einkauf abschließen · ${bought.length}`}
            onPress={() => router.push('/einkauf/abschluss')}
          />
          <Pressable
            onPress={() => void clearBought.mutateAsync()}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.clear}>Nur von der Liste nehmen</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}
