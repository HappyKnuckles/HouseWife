import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { LoadingState, Screen } from '../../components/Screen';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  emptyTaskValues,
  TaskForm,
  type TaskFormValues,
} from '../../features/cleaning/components/TaskForm';
import { useCreateTask } from '../../features/cleaning/hooks';
import { useMembers } from '../../features/household/hooks';
import { Alert } from '../../lib/alert';
import { errorMessage } from '../../lib/errors';

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
        errorMessage(err),
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
