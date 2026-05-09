import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { createSqliteSessionTranscriptLocator, isSqliteSessionTranscriptLocator } from "./paths.js";
import { getSessionEntry, upsertSessionEntry } from "./store.js";
import type { SessionEntry } from "./types.js";

export async function resolveAndPersistSessionTranscriptLocator(params: {
  sessionId: string;
  sessionKey: string;
  sessionEntry?: SessionEntry;
  agentId?: string;
  fallbackTranscriptLocator?: string;
}): Promise<{ transcriptLocator: string; sessionEntry: SessionEntry }> {
  const { sessionId, sessionKey } = params;
  const now = Date.now();
  const agentId = params.agentId ?? resolveAgentIdFromSessionKey(sessionKey);
  if (!agentId) {
    throw new Error(`Session stores are SQLite-only; cannot resolve agent for ${sessionKey}`);
  }
  const baseEntry = params.sessionEntry ??
    getSessionEntry({ agentId, sessionKey }) ?? {
      sessionId,
      updatedAt: now,
      sessionStartedAt: now,
    };
  const persistedTranscriptLocator = baseEntry.transcriptLocator?.trim();
  const shouldReusePersistedTranscriptLocator =
    baseEntry.sessionId === sessionId &&
    isSqliteSessionTranscriptLocator(persistedTranscriptLocator);
  const fallbackTranscriptLocator = params.fallbackTranscriptLocator?.trim();
  const transcriptLocator = shouldReusePersistedTranscriptLocator
    ? persistedTranscriptLocator!
    : fallbackTranscriptLocator && isSqliteSessionTranscriptLocator(fallbackTranscriptLocator)
      ? fallbackTranscriptLocator
      : createSqliteSessionTranscriptLocator({ agentId, sessionId });
  const persistedEntry: SessionEntry = {
    ...baseEntry,
    sessionId,
    updatedAt: now,
    sessionStartedAt: baseEntry.sessionId === sessionId ? (baseEntry.sessionStartedAt ?? now) : now,
    transcriptLocator,
  };
  if (baseEntry.sessionId !== sessionId || baseEntry.transcriptLocator !== transcriptLocator) {
    upsertSessionEntry({
      agentId,
      sessionKey,
      entry: persistedEntry,
    });
    return { transcriptLocator, sessionEntry: persistedEntry };
  }
  return { transcriptLocator, sessionEntry: persistedEntry };
}
