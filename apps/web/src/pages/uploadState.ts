const priority: Record<string, number> = {
  WAITING: 0,
  RESERVING: 0,
  CREATED: 0,
  SENDING: 1,
  RECEIVING: 1,
  QUEUED: 2,
  PROCESSING: 3,
  CANCEL_REQUESTED: 4,
  COMPLETED: 5,
  FAILED: 5,
  CANCELLED: 5,
};

const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function isTerminalUploadStatus(status: string) {
  return terminal.has(status);
}

export function mergeUploadStatus(current: string, incoming: string) {
  if (terminal.has(current)) return current;
  const currentPriority = priority[current] ?? -1;
  const incomingPriority = priority[incoming] ?? -1;
  return incomingPriority >= currentPriority ? incoming : current;
}
