export type TaskStopReason = 'task' | 'new-thread' | 'settings' | 'quit';

export interface InterruptibleRuntime {
  interrupt(): Promise<void>;
  shutdown(): Promise<void>;
}

export async function stopTaskRuntime(
  runtime: InterruptibleRuntime | undefined,
  reason: TaskStopReason,
  timeoutMs = 1200,
): Promise<boolean> {
  if (!runtime) return false;

  let interrupted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    runtime.interrupt().then(() => { interrupted = true; }, () => {}),
    new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); }),
  ]).finally(() => clearTimeout(timer));

  const shouldShutdown = reason !== 'task' || !interrupted;
  if (shouldShutdown) await runtime.shutdown();
  return shouldShutdown;
}
