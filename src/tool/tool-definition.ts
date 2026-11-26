import type { Tool, DeserializeResult } from '@itsjust/core';
import toolConfig from './tool.config';
import {
  ALL_RESOLVER_IDS,
  DEFAULT_STATE,
  MAX_HISTORY,
  isValidDomain,
  summaryText,
  normalizeDomain,
  RECORD_TYPES,
  RESOLVERS,
  type HistoryEntry,
  type RecordType,
  type ResolverLookup,
  type ToolState,
} from './types';

const VALID_RECORD_TYPES: RecordType[] = [...RECORD_TYPES];
const VALID_RESOLVER_IDS = new Set(ALL_RESOLVER_IDS);
const DEFAULT_RESOLVER_IDS = [...DEFAULT_STATE.resolvers];

/** Serialize tool state into a compact JSON string for share/import. */
export function serializeState(state: ToolState): string {
  return JSON.stringify({
    domain: state.domain,
    recordType: state.recordType,
    resolvers: state.resolvers,
    results: state.results,
    history: state.history,
  });
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function recordTypeOr(value: unknown, fallback: RecordType): RecordType {
  return VALID_RECORD_TYPES.includes(value as RecordType) ? (value as RecordType) : fallback;
}

function resolverIdsOr(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_RESOLVER_IDS];
  const ids = value.filter(
    (id): id is string => typeof id === 'string' && VALID_RESOLVER_IDS.has(id)
  );
  return ids.length > 0 ? [...new Set(ids)] : [...DEFAULT_RESOLVER_IDS];
}

function validHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is HistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as HistoryEntry).text === 'string' &&
        typeof (entry as HistoryEntry).createdAt === 'string'
    )
    .slice(0, MAX_HISTORY);
}

function validLookup(value: unknown): ResolverLookup | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Partial<ResolverLookup>;
  if (typeof v.resolverId !== 'string' || !VALID_RESOLVER_IDS.has(v.resolverId)) return null;
  if (v.status !== 'ok' && v.status !== 'error') return null;
  const answers = Array.isArray(v.answers)
    ? v.answers.filter(
        (a): a is ResolverLookup['answers'][number] =>
          typeof a === 'object' &&
          a !== null &&
          typeof (a as ResolverLookup['answers'][number]).data === 'string'
      )
    : [];
  return {
    resolverId: v.resolverId,
    status: v.status,
    dnsStatus: typeof v.dnsStatus === 'number' ? v.dnsStatus : undefined,
    answers,
    error: typeof v.error === 'string' ? v.error : undefined,
    queriedAt: typeof v.queriedAt === 'string' ? v.queriedAt : new Date().toISOString(),
  };
}

function validResults(value: unknown): ToolState['results'] {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.domain !== 'string' || !VALID_RECORD_TYPES.includes(v.recordType as RecordType)) {
    return null;
  }
  if (!Array.isArray(v.resolvers)) return null;
  const lookups = v.resolvers.map(validLookup).filter((l): l is ResolverLookup => l !== null);
  return {
    domain: v.domain,
    recordType: v.recordType as RecordType,
    resolvers: lookups,
    disagreement:
      lookups.length > 1
        ? lookups.some((l) => l.status === 'ok') && v.disagreement === true
        : false,
  };
}

/** Validate and recover tool state from an arbitrary payload. */
export function deserializeState(data: unknown): DeserializeResult<ToolState> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      success: false,
      error: 'Invalid data format: expected DNS propagation checker state object',
    };
  }
  const v = data as Record<string, unknown>;
  const domain = stringOr(v.domain, DEFAULT_STATE.domain);
  const state: ToolState = {
    domain,
    recordType: recordTypeOr(v.recordType, DEFAULT_STATE.recordType),
    resolvers: resolverIdsOr(v.resolvers),
    results: validResults(v.results),
    history: validHistory(v.history),
  };
  return { success: true, data: state };
}

/** Append a history entry to state, capped at MAX_HISTORY, newest first. */
export function withHistory(state: ToolState, text: string, now = new Date()): ToolState {
  const entry: HistoryEntry = { text, createdAt: now.toISOString() };
  return { ...state, history: [entry, ...state.history].slice(0, MAX_HISTORY) };
}

/** True when a serialized string round-trips back to the same state. */
export function roundTrips(state: ToolState): boolean {
  try {
    const restored = deserializeState(JSON.parse(serializeState(state)));
    return restored.success && JSON.stringify(restored.data) === JSON.stringify(state);
  } catch {
    return false;
  }
}

/** Domain from a user input string, or '' when invalid. */
export function domainOrEmpty(value: string): string {
  return isValidDomain(value) ? normalizeDomain(value) : '';
}

export const dnsPropagationCheckerTool: Tool<ToolState> = {
  id: toolConfig.id,
  name: toolConfig.name,
  version: toolConfig.version,
  config: toolConfig,
  initialState: { ...DEFAULT_STATE },
  serialize: serializeState,
  deserialize: deserializeState,
  exporters: [
    { format: 'png', loader: () => import('./exporters/png') },
    { format: 'jpeg', loader: () => import('./exporters/jpeg') },
    { format: 'webp', loader: () => import('./exporters/webp') },
    { format: 'pdf', loader: () => import('./exporters/pdf') },
  ],
};

export { isValidDomain, normalizeDomain, summaryText, RECORD_TYPES, RESOLVERS };
