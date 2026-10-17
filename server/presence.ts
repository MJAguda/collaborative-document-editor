// In-memory "who has this document open" store. Fed by client heartbeats, so a crashed tab simply expires.
export const PRESENCE_TIMEOUT_MS = 25_000;

type Viewer = { id: number; name: string };

export function createPresence(now: () => number = Date.now) {
  const docs = new Map<number, Map<number, { name: string; seen: number }>>();

  // Runs on every call and covers all documents, so memory is bounded by the active viewers.
  const prune = () => {
    const cutoff = now() - PRESENCE_TIMEOUT_MS;
    for (const [docId, users] of docs) {
      for (const [userId, v] of users) if (v.seen < cutoff) users.delete(userId);
      if (users.size === 0) docs.delete(docId);
    }
  };

  return {
    touch(docId: number, user: Viewer) {
      prune();
      const users = docs.get(docId) ?? new Map();
      users.set(user.id, { name: user.name, seen: now() });
      docs.set(docId, users);
    },
    leave(docId: number, userId: number) {
      prune();
      docs.get(docId)?.delete(userId);
    },
    viewers(docId: number): Viewer[] {
      return [...(docs.get(docId) ?? [])].map(([id, v]) => ({ id, name: v.name }));
    },
    size: () => [...docs.values()].reduce((n, users) => n + users.size, 0),
  };
}

export type Presence = ReturnType<typeof createPresence>;
