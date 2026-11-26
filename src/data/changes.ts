/** Change notifications between storage, sync and the screens. */

type Listener = (path: string) => void;

function channel() {
  const listeners = new Set<Listener>();
  return {
    on(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(path: string): void {
      listeners.forEach((listener) => listener(path));
    },
  };
}

/** A file was changed on this device and needs syncing. */
export const localChanges = channel();

/** A file was changed by sync (from another device); screens showing it should reload. */
export const remoteChanges = channel();
