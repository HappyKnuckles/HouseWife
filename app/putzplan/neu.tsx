import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert } from 'react-native';

import { LoadingState, Screen } from '../../src/components/Screen';
import { useAuth } from '../../src/features/auth/AuthProvider';
import {
  emptyTaskValues,
  TaskForm,
  type TaskFormValues,
} from '../../src/features/cleaning/components/TaskForm';
import { useCreateTask } from '../../src/features/cleaning/hooks';
import { useMembers } from '../../src/features/household/hooks';

export default function NewTaskScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { data: members, isLoading } = useMembers();
  const createTask = useCreateTask();

  const initial = useMemo(
    () => emptyTaskValues((members ?? []).map((m) => m.id), profile?.id ?? ''),
    [members, profile?.id],
  );

  if (isLoading) return <LoadingState />;

  async function submit(values: TaskFormValues) {
    try {
      await createTask.mutateAsync({
        ...values,
        // A rotating task with an empty rotation list would never rotate; the
        // DB has a CHECK for this, so fall back to every member.
        rotation_order:
          values.assignment_mode === 'rotating' && values.rotation_order.length === 0
            ? (members ?? []).map((m) => m.id)
            : values.rotation_order,
        created_by: profile?.id ?? null,
      });
      router.back();
    } catch (err) {
      Alert.alert(
        'Konnte nicht gespeichert werden',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <Screen edges={[]}>
      <TaskForm
        initial={initial}
        submitLabel="Aufgabe anlegen"
        onSubmit={(values) => void submit(values)}
        submitting={createTask.isPending}
      />
    </Screen>
  );
}
