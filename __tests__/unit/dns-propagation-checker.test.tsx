import { describe, it, expect, vi } from 'vitest';
import * as lzString from 'lz-string';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  isValidDomain,
  normalizeDomain,
  detectDisagreement,
  answerKeys,
  resultsToJson,
  resultsToTsv,
  ttlLabel,
  freshness,
  summaryText,
  sampleDohResponse,
  lookupOnResolver,
  buildResolverUrl,
  DEFAULT_STATE,
  MAX_HISTORY,
  RECORD_TYPES,
  RESOLVERS,
  TYPE_CODES,
  type DnsAnswer,
  type ResolverLookup,
  type ToolState,
  type LookupResult,
} from '@/tool/types';
import {
  serializeState,
  deserializeState,
  withHistory,
  roundTrips,
  domainOrEmpty,
  dnsPropagationCheckerTool,
} from '@/tool/tool-definition';
import { RECORD_TYPES as RECORD_TYPE_OPTIONS } from '@/tool/ui-shared';
import { Canvas } from '@/tool/components/Canvas';
import { Toolbar } from '@/tool/components/Toolbar';
import { Sidebar } from '@/tool/components/Sidebar';
import { RESOLVERS as SHARED_RESOLVERS } from '@/tool/ui-shared';

const state = (patch: Partial<ToolState> = {}): ToolState => ({ ...DEFAULT_STATE, ...patch });

const answer = (data: string, ttl = 300, type = 1): DnsAnswer => ({
  name: 'example.com',
  type,
  TTL: ttl,
  data,
});

const lookupErr = (resolverId: string, message: string): ResolverLookup => ({
  resolverId,
  status: 'error',
  answers: [],
  error: message,
  queriedAt: new Date().toISOString(),
});

const lookup = (
  resolverId: string,
  answers: DnsAnswer[],
  status: 'ok' | 'error' = 'ok'
): ResolverLookup => ({
  resolverId,
  status,
  dnsStatus: 0,
  answers,
  queriedAt: new Date().toISOString(),
});

const result = (lookups: ResolverLookup[], over: Partial<LookupResult> = {}): LookupResult => ({
  domain: 'example.com',
  recordType: 'A',
  resolvers: lookups,
  disagreement: detectDisagreement(lookups),
  ...over,
});

describe('domain validation', () => {
  it('accepts valid hostnames', () => {
    expect(isValidDomain('example.com')).toBe(true);
    expect(isValidDomain(' EXAMPLE.com ')).toBe(true);
    expect(isValidDomain('sub.domain.example.co.uk')).toBe(true);
    expect(isValidDomain('example.com.')).toBe(true);
    expect(isValidDomain('a-b.example.io')).toBe(true);
    expect(isValidDomain('xn--80ak6aa92e.com')).toBe(true);
  });

  it('rejects invalid hostnames', () => {
    expect(isValidDomain('')).toBe(false);
    expect(isValidDomain('   ')).toBe(false);
    expect(isValidDomain('example')).toBe(false);
    expect(isValidDomain('-example.com')).toBe(false);
    expect(isValidDomain('example-.com')).toBe(false);
    expect(isValidDomain('exa mple.com')).toBe(false);
    expect(isValidDomain('example..com')).toBe(false);
    expect(isValidDomain('example.com/path')).toBe(false);
    expect(isValidDomain(`${'a'.repeat(64)}.com`)).toBe(false);
    expect(
      isValidDomain(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`)
    ).toBe(false);
  });

  it('normalizes domains', () => {
    expect(normalizeDomain('  EXAMPLE.COM. ')).toBe('example.com');
    expect(normalizeDomain('Example.com')).toBe('example.com');
    expect(domainOrEmpty('EXAMPLE.com')).toBe('example.com');
    expect(domainOrEmpty('not a domain')).toBe('');
  });
});

describe('record types', () => {
  it('exposes the expected record types', () => {
    expect([...RECORD_TYPES]).toEqual(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA']);
    expect(RECORD_TYPE_OPTIONS.map((r: { value: string }) => r.value)).toEqual([...RECORD_TYPES]);
  });

  it('selection only offers the available types and state keeps valid ones', () => {
    const deserialized = deserializeState({ recordType: 'BOGUS', domain: 'example.com' });
    expect(deserialized.success).toBe(true);
    if (deserialized.success) {
      expect(deserialized.data.recordType).toBe('A');
    }
    for (const rt of RECORD_TYPES) {
      const ok = deserializeState({ recordType: rt });
      expect(ok.success).toBe(true);
      if (ok.success) expect(ok.data.recordType).toBe(rt);
    }
  });

  it('maps type codes', () => {
    expect(TYPE_CODES.A).toBe(1);
    expect(TYPE_CODES.AAAA).toBe(28);
    expect(TYPE_CODES.CAA).toBe(257);
  });
});

describe('state round-trip through URL serialization', () => {
  it('round-trips a full state', () => {
    const full = state({
      domain: 'Example.COM',
      recordType: 'MX',
      resolvers: ['google', 'sample'],
      results: result([lookup('google', [answer('10 mail.example.com', 3600, 15)])]),
      history: [{ text: 'example.com MX', createdAt: '2026-11-26T10:00:00.000Z' }],
    });
    expect(roundTrips(full)).toBe(true);
  });

  it('round-trips through lz-string URL encoding', () => {
    const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = lzString;
    const full = state({ domain: 'example.com', recordType: 'TXT' });
    const encoded = compressToEncodedURIComponent(serializeState(full));
    const decoded = decompressFromEncodedURIComponent(encoded);
    const restored = deserializeState(JSON.parse(decoded));
    expect(restored.success).toBe(true);
    if (restored.success) {
      expect(restored.data).toEqual(full);
    }
  });

  it('rejects non-object payloads and repairs invalid fields', () => {
    expect(deserializeState('nonsense').success).toBe(false);
    expect(deserializeState(null).success).toBe(false);
    expect(deserializeState([1, 2]).success).toBe(false);

    const repaired = deserializeState({
      domain: 42,
      recordType: 'NOPE',
      resolvers: ['google', 'made-up', 'google'],
      results: { domain: 'x.com', recordType: 'A', resolvers: 'bad', disagreement: true },
      history: [{ text: 1 }, 'junk', { text: 'ok', createdAt: '2026-11-26T00:00:00.000Z' }],
    });
    expect(repaired.success).toBe(true);
    if (!repaired.success) throw new Error('unreachable');
    expect(repaired.data.domain).toBe('');
    expect(repaired.data.recordType).toBe('A');
    expect(repaired.data.resolvers).toEqual(['google']);
    expect(repaired.data.results).toBeNull();
    expect(repaired.data.history).toEqual([{ text: 'ok', createdAt: '2026-11-26T00:00:00.000Z' }]);
  });

  it('caps history and appends newest first', () => {
    let s = state();
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      s = withHistory(s, `lookup-${i}`, new Date(2026, 0, 1, 0, 0, i));
    }
    expect(s.history).toHaveLength(MAX_HISTORY);
    expect(s.history[0]?.text).toBe(`lookup-${MAX_HISTORY + 4}`);
  });

  it('tool serialize/deserialize use the same format', () => {
    const s = state({ domain: 'example.com' });
    const serialized = dnsPropagationCheckerTool.serialize(s);
    const restored = dnsPropagationCheckerTool.deserialize(JSON.parse(serialized));
    expect(restored.success).toBe(true);
    if (restored.success) expect(restored.data).toEqual(s);
  });
});

describe('copy/export output', () => {
  it('produces readable JSON for copy', () => {
    const json = resultsToJson(
      result([lookup('google', [answer('203.0.113.10', 300)])], { disagreement: false })
    );
    const parsed = JSON.parse(json) as {
      domain: string;
      recordType: string;
      resolvers: Array<{
        resolver: string;
        status: string;
        answers: Array<{ data: string; TTL: number }>;
      }>;
    };
    expect(parsed.domain).toBe('example.com');
    expect(parsed.recordType).toBe('A');
    const first = parsed.resolvers[0] ?? { answers: [{ data: '', TTL: 0 }] };
    void first;
    expect(parsed.resolvers[0]!.resolver).toBe('google');
    expect(parsed.resolvers[0]!.answers[0]!.data).toBe('203.0.113.10');
    expect(parsed.resolvers[0]!.answers[0]!.TTL).toBe(300);
  });

  it('produces TSV with header and one row per answer', () => {
    const tsv = resultsToTsv(
      result([
        lookup('google', [answer('203.0.113.10', 300), answer('203.0.113.11', 60)]),
        lookupErr('cloudflare', 'HTTP 503'),
        lookup('sample', []),
      ])
    );
    const lines = tsv.split('\n');
    expect(lines[0]).toBe('domain\trecordType\tresolver\tstatus\tttl\tdata');
    expect(lines[1]).toBe('example.com\tA\tgoogle\tok\t300\t203.0.113.10');
    expect(lines[2]).toBe('example.com\tA\tgoogle\tok\t60\t203.0.113.11');
    expect(lines[3]).toBe('example.com\tA\tcloudflare\terror\t\tHTTP 503');
    expect(lines[4]).toBe('example.com\tA\tsample\tok\t\t');
    expect(lines).toHaveLength(5);
  });
});

describe('disagreement detection', () => {
  it('detects differing answer sets between resolvers', () => {
    expect(
      detectDisagreement([
        lookup('google', [answer('203.0.113.10')]),
        lookup('cloudflare', [answer('198.51.100.99')]),
      ])
    ).toBe(true);
  });

  it('is consistent when all resolvers agree ignoring order and case', () => {
    expect(
      detectDisagreement([
        lookup('google', [answer('203.0.113.10'), answer('203.0.113.11')]),
        lookup('cloudflare', [answer('203.0.113.11'), answer('203.0.113.10')]),
      ])
    ).toBe(false);
  });

  it('ignores failed and empty resolvers', () => {
    expect(
      detectDisagreement([
        lookup('google', [answer('203.0.113.10')]),
        lookupErr('cloudflare', 'HTTP 503'),
      ])
    ).toBe(false);
    expect(
      detectDisagreement([lookup('google', [answer('203.0.113.10')]), lookup('cloudflare', [])])
    ).toBe(false);
    expect(detectDisagreement([lookup('google', [answer('203.0.113.10')])])).toBe(false);
  });

  it('answerKeys sorts and normalizes', () => {
    expect(answerKeys([answer('B'), answer('A')])).toEqual(answerKeys([answer('a'), answer('b')]));
  });
});

describe('TTL display', () => {
  it('formats relative TTL labels', () => {
    expect(ttlLabel(30)).toBe('30s');
    expect(ttlLabel(60)).toBe('1m');
    expect(ttlLabel(300)).toBe('5m');
    expect(ttlLabel(3600)).toBe('1h');
    expect(ttlLabel(86400)).toBe('24h');
  });

  it('categorizes freshness', () => {
    expect(freshness(60)).toBe('fresh');
    expect(freshness(300)).toBe('fresh');
    expect(freshness(3600)).toBe('medium');
    expect(freshness(86400)).toBe('stale');
  });
});

describe('sample resolver and DoH lookups', () => {
  it('builds resolver URLs with encoded domain', () => {
    const google = RESOLVERS.find((r) => r.id === 'google');
    expect(google).toBeDefined();
    expect(buildResolverUrl(google!, 'example.com', 'MX')).toBe(
      'https://dns.google/resolve?name=example.com&type=MX'
    );
    const sample = RESOLVERS.find((r) => r.id === 'sample');
    expect(buildResolverUrl(sample!, 'example.com', 'A')).toBeNull();
  });

  it('sample resolver returns deterministic answers', () => {
    const response = sampleDohResponse('example.com', 'A');
    expect(response.Status).toBe(0);
    expect(response.Answer![0]!.data).toBe('203.0.113.10');
    const stale = sampleDohResponse('propagation-demo.test', 'A');
    expect(stale.Answer![0]!.data).toBe('198.51.100.99');
  });

  it('performs a mocked network lookup on the sample resolver', async () => {
    const sample = RESOLVERS.find((r) => r.id === 'sample')!;
    const result = await lookupOnResolver(sample, 'example.com', 'NS');
    expect(result.status).toBe('ok');
    expect(result.answers.length).toBeGreaterThan(0);
  });

  it('handles fetch failure gracefully per resolver', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('HTTP 503')));
    const cloudflare = RESOLVERS.find((r) => r.id === 'cloudflare')!;
    const result = await lookupOnResolver(cloudflare, 'example.com', 'A');
    expect(result.status).toBe('error');
    expect(result.error).toBe('HTTP 503');
    expect(result.answers).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('uses accept header for cloudflare endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ Status: 0, Answer: [answer('203.0.113.10')] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const cloudflare = RESOLVERS.find((r) => r.id === 'cloudflare')!;
    const result = await lookupOnResolver(cloudflare, 'example.com', 'A');
    expect(result.status).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
      headers: { accept: 'application/dns-json' },
      signal: undefined,
    });
    vi.unstubAllGlobals();
  });
});

describe('summary text', () => {
  it('guides through domain entry and invalid state', () => {
    expect(summaryText(state())).toBe('Enter a domain to check');
    expect(summaryText(state({ domain: 'bad..domain' }))).toBe('Invalid domain');
    expect(summaryText(state({ domain: 'example.com' }))).toBe('example.com A: not checked yet');
    expect(
      summaryText(
        state({
          domain: 'example.com',
          results: result([
            lookup('google', [answer('1.2.3.4')]),
            lookup('cloudflare', [answer('5.6.7.8')]),
          ]),
        })
      )
    ).toBe('example.com A: 2/2 ok · propagating');
    expect(
      summaryText(
        state({
          domain: 'example.com',
          results: result([
            lookup('google', [answer('1.2.3.4')]),
            lookup('cloudflare', [answer('1.2.3.4')]),
          ]),
        })
      )
    ).toBe('example.com A: 2/2 ok · consistent');
  });
});

describe('canvas rendering', () => {
  it('renders resolver rows with TTL per answer and disagreement banner', async () => {
    const withResults = state({
      domain: 'example.com',
      results: result([
        lookup('google', [answer('203.0.113.10', 300)]),
        lookup('cloudflare', [answer('198.51.100.99', 7200)]),
      ]),
    });
    render(<Canvas state={withResults} onChange={() => {}} />);

    expect(screen.getByTestId('disagreement-banner')).toBeInTheDocument();
    expect(screen.getByTestId('resolver-row-google')).toBeInTheDocument();
    expect(screen.getByTestId('resolver-row-cloudflare')).toBeInTheDocument();
    expect(screen.getByTestId('ttl-google-0')).toHaveTextContent('TTL 5m');
    expect(screen.getByTestId('ttl-cloudflare-0')).toHaveTextContent('TTL 2h');
  });

  it('renders consistency banner and empty answers', () => {
    const withResults = state({
      domain: 'example.com',
      results: result([
        lookup('google', [answer('203.0.113.10', 60)]),
        lookup('cloudflare', [answer('203.0.113.10', 60)]),
        lookup('quad9', []),
      ]),
    });
    render(<Canvas state={withResults} onChange={() => {}} />);
    expect(screen.getByTestId('consistency-banner')).toBeInTheDocument();
    expect(screen.getByTestId('resolver-row-quad9')).toBeInTheDocument();
  });

  it('shows resolver error state', () => {
    const withResults = state({
      domain: 'example.com',
      results: result([
        lookup('google', [answer('203.0.113.10')]),
        lookupErr('opendns', 'connection refused'),
      ]),
    });
    render(<Canvas state={withResults} onChange={() => {}} />);
    expect(screen.getByTestId('resolver-error-opendns')).toHaveTextContent('error:');
  });

  it('rejects invalid domain input with a validation message', () => {
    render(<Canvas state={state({ domain: 'not a domain' })} onChange={() => {}} />);
    expect(screen.getByTestId('domain-error')).toBeInTheDocument();
    expect(screen.getByTestId('btn-check')).toBeDisabled();
  });

  it('valid domain enables check button and copy actions work', async () => {
    const onChange = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const withResults = state({
      domain: 'example.com',
      results: result([lookup('sample', [answer('203.0.113.10', 300)])]),
    });
    render(<Canvas state={withResults} onChange={onChange} />);

    expect(screen.getByTestId('btn-check')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('btn-copy-json'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('"domain": "example.com"')
      );
    });
    fireEvent.click(screen.getByTestId('btn-copy-tsv'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('domain\trecordType')
      );
    });
  });

  it('runs a check and updates state with history entry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ Status: 0, Answer: [answer('203.0.113.10')] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onChange = vi.fn();
    render(<Canvas state={state({ domain: 'example.com' })} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('btn-check'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const nextState = onChange.mock.calls[0]![0] as ToolState;
    expect(nextState.results?.disagreement).toBe(false);
    expect(nextState.history[0]?.text).toBe('example.com A');
    vi.unstubAllGlobals();
  });

  it('history re-check buttons populate inputs', () => {
    const onChange = vi.fn();
    const s = state({
      domain: 'other.org',
      history: [{ text: 'example.com MX', createdAt: new Date().toISOString() }],
    });
    render(<Canvas state={s} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('history-recheck-0'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'example.com', recordType: 'MX' })
    );
  });
});

describe('toolbar and sidebar', () => {
  it('clears history from toolbar and counts entries in sidebar', () => {
    const onChange = vi.fn();
    const s = state({
      domain: 'example.com',
      history: [{ text: 'example.com A', createdAt: new Date().toISOString() }],
    });
    render(<Toolbar state={s} onChange={onChange} onClear={() => {}} />);
    fireEvent.click(screen.getByTestId('btn-clear-history'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ history: [] }));

    render(<Sidebar state={s} onChange={() => {}} />);
    expect(screen.getByTestId('sidebar-history-count')).toHaveTextContent('1 entry');
    expect(screen.getByTestId('sidebar-resolver-sample')).toBeEnabled();
    expect(SHARED_RESOLVERS.map((r: { id: string }) => r.id)).toEqual(RESOLVERS.map((r) => r.id));
  });
});
