'use client';

import React from 'react';
import {
  lookupAll,
  resultsToJson,
  resultsToTsv,
  ttlLabel,
  freshness,
  isValidDomain,
  normalizeDomain,
  summaryText,
  MAX_HISTORY,
  type LookupResult,
  type RecordType,
  type ToolState,
} from '../types';
import { RECORD_TYPES } from '../ui-shared';
import { RESOLVERS } from '../types';

interface CanvasProps {
  state: ToolState;
  onChange?: (state: ToolState) => void;
  onSaveHistory?: (text: string) => void;
}

function CopyButton({ value, testid, label }: { value: string; testid?: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; ignore
    }
  }, [value]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      data-testid={testid}
      className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
      aria-label={label ?? 'Copy results'}
    >
      {copied ? 'Copied!' : (label ?? 'Copy')}
    </button>
  );
}

const freshnessClass: Record<string, string> = {
  fresh: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  stale: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const freshnessText: Record<string, string> = {
  fresh: 'fresh',
  medium: 'aging',
  stale: 'high TTL',
};

function ResolverRows({ result }: { result: LookupResult }) {
  return (
    <div className="space-y-2" data-testid="resolver-results">
      {result.resolvers.map((lookup) => {
        const resolver = RESOLVERS.find((r) => r.id === lookup.resolverId);
        return (
          <div
            key={lookup.resolverId}
            data-testid={`resolver-row-${lookup.resolverId}`}
            className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {resolver?.label ?? lookup.resolverId}
              </span>
              {lookup.status === 'error' ? (
                <span
                  data-testid={`resolver-error-${lookup.resolverId}`}
                  className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200"
                >
                  error: {lookup.error ?? 'failed'}
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {lookup.answers.length} answer{lookup.answers.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {lookup.status === 'ok' && lookup.answers.length > 0 ? (
              <ul className="mt-2 space-y-1" data-testid={`answers-${lookup.resolverId}`}>
                {lookup.answers.map((answer, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300"
                  >
                    <span className="font-mono break-all">{answer.data}</span>
                    <span
                      data-testid={`ttl-${lookup.resolverId}-${i}`}
                      className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono ${freshnessClass[freshness(answer.TTL)]}`}
                      title={`TTL ${answer.TTL}s`}
                    >
                      TTL {ttlLabel(answer.TTL)} · {freshnessText[freshness(answer.TTL)]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {lookup.status === 'ok' && lookup.answers.length === 0 ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                No {result.recordType} records found (NXDOMAIN or empty).
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export const Canvas: React.FC<CanvasProps> = ({ state, onChange, onSaveHistory }) => {
  const update = (patch: Partial<ToolState>) => onChange?.({ ...state, ...patch });
  const [isChecking, setIsChecking] = React.useState(false);
  const checkToken = React.useRef(0);
  const domainValid = isValidDomain(state.domain);

  const toggleResolver = (id: string) => {
    const selected = state.resolvers.includes(id);
    const next = selected ? state.resolvers.filter((r) => r !== id) : [...state.resolvers, id];
    update({ resolvers: next.length > 0 ? next : state.resolvers });
  };

  const runCheck = React.useCallback(async () => {
    const domain = normalizeDomain(state.domain);
    if (!domainValid || state.resolvers.length === 0) return;
    const token = ++checkToken.current;
    setIsChecking(true);
    try {
      const result = await lookupAll(state.resolvers, domain, state.recordType);
      if (token !== checkToken.current) return;
      const text = `${domain} ${state.recordType}`;
      const historyEntry = { text, createdAt: new Date().toISOString() };
      const history = [historyEntry, ...state.history.filter((h) => h.text !== text)].slice(
        0,
        MAX_HISTORY
      );
      onChange?.({ ...state, results: result, history });
    } finally {
      if (token === checkToken.current) setIsChecking(false);
    }
  }, [state, domainValid, onChange]);

  const hasResults = state.results !== null;

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full" data-testid="dns-canvas">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Domain
          <input
            type="text"
            value={state.domain}
            onChange={(e) => update({ domain: e.target.value })}
            placeholder="example.com"
            data-testid="input-domain"
            className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100 ${
              state.domain && !domainValid
                ? 'border-red-500 dark:border-red-500'
                : 'border-gray-300 dark:border-gray-700'
            }`}
            aria-invalid={Boolean(state.domain) && !domainValid}
          />
        </label>
        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
          Record type
          <select
            value={state.recordType}
            onChange={(e) => update({ recordType: e.target.value as RecordType })}
            data-testid="select-record-type"
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            {RECORD_TYPES.map((rt) => (
              <option key={rt.value} value={rt.value}>
                {rt.label} — {rt.hint}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={!domainValid || isChecking || state.resolvers.length === 0}
          data-testid="btn-check"
          className="rounded-md bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
        >
          {isChecking ? 'Checking…' : 'Check'}
        </button>
      </div>

      {state.domain && !domainValid ? (
        <p className="text-xs text-red-600 dark:text-red-400" data-testid="domain-error">
          Invalid domain name. Use a hostname like example.com.
        </p>
      ) : null}

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Resolvers
        </h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Resolver selection">
          {RESOLVERS.map((resolver) => (
            <button
              key={resolver.id}
              type="button"
              role="tab"
              aria-selected={state.resolvers.includes(resolver.id)}
              data-testid={`resolver-toggle-${resolver.id}`}
              onClick={() => toggleResolver(resolver.id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                state.resolvers.includes(resolver.id)
                  ? 'border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-900/40 dark:text-violet-100'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'
              }`}
            >
              {resolver.label}
            </button>
          ))}
        </div>
      </div>

      {hasResults && state.results ? (
        <>
          {state.results.disagreement ? (
            <div
              data-testid="disagreement-banner"
              className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-200"
            >
              ⚠ Resolvers disagree — DNS propagation in progress or geo-split responses.
            </div>
          ) : (
            <div
              data-testid="consistency-banner"
              className="rounded-md border border-green-300 bg-green-50 p-3 text-xs text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-200"
            >
              ✓ All selected resolvers agree.
            </div>
          )}

          <ResolverRows result={state.results} />

          <div className="flex flex-wrap gap-2">
            <CopyButton
              value={resultsToJson(state.results)}
              testid="btn-copy-json"
              label="Copy JSON"
            />
            <CopyButton
              value={resultsToTsv(state.results)}
              testid="btn-copy-tsv"
              label="Copy TSV"
            />
            <button
              type="button"
              data-testid="btn-recheck"
              onClick={() => void runCheck()}
              disabled={isChecking}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Re-check
            </button>
          </div>
        </>
      ) : (
        <p
          className="text-center text-xs text-gray-500 dark:text-gray-400"
          data-testid="no-results"
        >
          {summaryText(state)}
        </p>
      )}

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Recent lookups
        </h3>
        {state.history.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="history-empty">
            No lookups yet in this session.
          </p>
        ) : (
          <ul className="space-y-1" data-testid="history-list">
            {state.history.map((entry, i) => {
              const [domain, type] = entry.text.split(' ');
              return (
                <li
                  key={`${entry.createdAt}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-xs dark:border-gray-800"
                >
                  <span className="text-gray-700 dark:text-gray-300">{entry.text}</span>
                  <button
                    type="button"
                    data-testid={`history-recheck-${i}`}
                    onClick={() => update({ domain, recordType: (type as RecordType) ?? 'A' })}
                    className="rounded border border-gray-300 px-2 py-0.5 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Re-check
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-center text-xs text-gray-500 dark:text-gray-400">
        DNS lookups run from your browser via public DNS-over-HTTPS resolvers; nothing is stored.
      </p>
    </div>
  );
};
