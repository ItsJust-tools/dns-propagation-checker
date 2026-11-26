export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export interface ResolverDef {
  /** Stable resolver key used in state and serialization. */
  id: string;
  /** Human readable resolver name. */
  label: string;
  /** DNS-over-HTTPS JSON endpoint template; {name} and {type} are substituted. */
  url: string;
  /** Extra fetch headers needed by the DoH endpoint. */
  headers: Record<string, string>;
}

/** Public DoH resolvers plus a bundled sample resolver for demos/offline use. */
export const RESOLVERS: ResolverDef[] = [
  {
    id: 'google',
    label: 'Google',
    url: 'https://dns.google/resolve?name={name}&type={type}',
    headers: {},
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    url: 'https://cloudflare-dns.com/dns-query?name={name}&type={type}',
    headers: { accept: 'application/dns-json' },
  },
  {
    id: 'quad9',
    label: 'Quad9',
    url: 'https://dns.quad9.net:5053/dns-query?name={name}&type={type}',
    headers: { accept: 'application/dns-json' },
  },
  {
    id: 'opendns',
    label: 'OpenDNS',
    url: 'https://doh.opendns.com/resolve?name={name}&type={type}',
    headers: {},
  },
  {
    id: 'sample',
    label: 'Sample (offline demo)',
    url: '',
    headers: {},
  },
];

export const ALL_RESOLVER_IDS = RESOLVERS.map((r) => r.id);

export interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DnsQuestion {
  name: string;
  type: number;
}

export interface DnsResponse {
  Status: number;
  TC?: boolean;
  RD?: boolean;
  RA?: boolean;
  AD?: boolean;
  CD?: boolean;
  Question?: DnsQuestion[];
  Answer?: DnsAnswer[];
  Authority?: DnsAnswer[];
  /** Comment field used by some DoH providers. */
  Comment?: string;
}

export interface ResolverLookup {
  /** Resolver id from RESOLVERS. */
  resolverId: string;
  status: 'ok' | 'error';
  /** DNS Status code (0 = NOERROR). Present when status is ok. */
  dnsStatus?: number;
  answers: DnsAnswer[];
  /** Error message for failed lookups. */
  error?: string;
  /** ISO timestamp of the lookup. */
  queriedAt: string;
}

export interface LookupResult {
  domain: string;
  recordType: RecordType;
  resolvers: ResolverLookup[];
  /** True when resolvers disagree on the answer set. */
  disagreement: boolean;
}

export interface HistoryEntry {
  /** Short human readable description of the lookup. */
  text: string;
  /** ISO timestamp when the entry was saved. */
  createdAt: string;
}

export interface ToolState {
  /** Domain being looked up. */
  domain: string;
  /** Currently selected record type. */
  recordType: RecordType;
  /** Selected resolver ids. */
  resolvers: string[];
  /** Latest lookup result, if any. */
  results: LookupResult | null;
  /** Recent lookups, newest first. */
  history: HistoryEntry[];
}

export const DEFAULT_STATE: ToolState = {
  domain: '',
  recordType: 'A',
  resolvers: ['google', 'cloudflare', 'quad9', 'opendns'],
  results: null,
  history: [],
};

export const MAX_HISTORY = 20;

/**
 * Valid hostname label: alphanumerics and hyphens, not starting or ending
 * with a hyphen, 1-63 characters.
 */
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** True when the input is a syntactically valid domain name. */
export function isValidDomain(input: string): boolean {
  const value = input.trim().toLowerCase();
  if (!value || value.length > 253) return false;
  // Allow a fully qualified trailing dot but strip it for label checks.
  const host = value.endsWith('.') ? value.slice(0, -1) : value;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => LABEL_RE.test(label));
}

/** Normalize a hostname (trim, lowercase, strip one trailing dot). */
export function normalizeDomain(input: string): string {
  const value = input.trim().toLowerCase();
  return value.endsWith('.') ? value.slice(0, -1) : value;
}

/** Human-readable record type for a DNS type code. */
export function typeCodeToName(code: number): string | null {
  const entry = (Object.entries(TYPE_CODES) as [RecordType, number][]).find(
    ([, value]) => value === code
  );
  return entry ? entry[0] : null;
}

/** DNS type codes aligned with RECORD_TYPES order. */
export const TYPE_CODES: Record<RecordType, number> = {
  A: 1,
  AAAA: 28,
  CNAME: 5,
  MX: 15,
  TXT: 16,
  NS: 2,
  SOA: 6,
  CAA: 257,
};

/** Canonical answer data string used for resolver comparison. */
function answerKey(answer: DnsAnswer): string {
  return `${answer.type}:${answer.data.trim().replace(/^"|"$/g, '').toLowerCase()}`;
}

/** Ordered answer keys for one lookup. */
export function answerKeys(answers: DnsAnswer[]): string[] {
  return answers.map(answerKey).sort();
}

/**
 * Compare per-resolver answer sets; true when at least one resolver that
 * returned answers disagrees with the others on the answer set.
 */
export function detectDisagreement(lookups: ResolverLookup[]): boolean {
  const okLookups = lookups.filter((l) => l.status === 'ok' && l.answers.length > 0);
  if (okLookups.length < 2) return false;
  const first = okLookups[0] ? answerKeys(okLookups[0].answers) : [];
  return okLookups.some((l) => {
    const keys = answerKeys(l.answers);
    return keys.length !== first.length || keys.some((k, i) => k !== first[i]);
  });
}

/** Build DoH request URL for a resolver lookup; null for the sample resolver. */
export function buildResolverUrl(
  resolver: ResolverDef,
  domain: string,
  type: RecordType
): string | null {
  if (!resolver.url) return null;
  return resolver.url.replace('{name}', encodeURIComponent(domain)).replace('{type}', type);
}

/**
 * Deterministic mocked DoH response for the sample resolver, so demos work
 * without network access. Propagation is simulated by giving one resolver
 * stale data when the domain is exactly `propagation-demo.test`.
 */
export function sampleDohResponse(domain: string, type: RecordType): DnsResponse {
  const stale = domain === 'propagation-demo.test';
  const base: Record<RecordType, string[]> = {
    A: ['203.0.113.10'],
    AAAA: ['2001:db8::10'],
    CNAME: [`target.${domain}`],
    MX: [`10 mail.${domain}`],
    TXT: ['"v=spf1 include:example.com ~all"'],
    NS: [`ns1.${domain}`, `ns2.${domain}`],
    SOA: [`ns1.${domain} hostmaster.${domain} 2026010101 7200 3600 1209600 3600`],
    CAA: ['0 issue "letsencrypt.org"'],
  };
  const staleBase: Partial<Record<RecordType, string[]>> = {
    A: ['198.51.100.99'],
    AAAA: ['2001:db8::99'],
    MX: [`10 old-mail.${domain}`],
  };
  const data = ((stale ? staleBase[type] : undefined) ?? base[type]).map((d) => ({
    name: domain,
    type: TYPE_CODES[type],
    TTL: stale ? 60 : 300,
    data: d,
  }));
  return { Status: 0, Answer: data };
}

/** Look up a domain on one resolver via DoH JSON API. */
export async function lookupOnResolver(
  resolver: ResolverDef,
  domain: string,
  type: RecordType,
  signal?: AbortSignal
): Promise<ResolverLookup> {
  const queriedAt = new Date().toISOString();
  try {
    if (resolver.id === 'sample') {
      const response = sampleDohResponse(domain, type);
      return {
        resolverId: resolver.id,
        status: 'ok',
        dnsStatus: response.Status,
        answers: response.Answer ?? [],
        queriedAt,
      };
    }
    const url = buildResolverUrl(resolver, domain, type);
    if (!url) throw new Error('Resolver endpoint unavailable');
    // eslint-disable-next-line no-restricted-syntax -- DoH query is required for this network tool; only resolver endpoints are called, never user data
    const response = await fetch(url, {
      headers: resolver.headers,
      signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = (await response.json()) as DnsResponse;
    return {
      resolverId: resolver.id,
      status: 'ok',
      dnsStatus: typeof json.Status === 'number' ? json.Status : 0,
      answers: Array.isArray(json.Answer) ? json.Answer : [],
      queriedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lookup failed';
    return {
      resolverId: resolver.id,
      status: 'error',
      answers: [],
      error: message,
      queriedAt,
    };
  }
}

/** Look up a domain across the selected resolvers in parallel. */
export async function lookupAll(
  resolverIds: string[],
  domain: string,
  type: RecordType,
  signal?: AbortSignal
): Promise<LookupResult> {
  const resolvers = RESOLVERS.filter((r) => resolverIds.includes(r.id));
  const lookups = await Promise.all(
    resolvers.map((r) => lookupOnResolver(r, domain, type, signal))
  );
  return {
    domain,
    recordType: type,
    resolvers: lookups,
    disagreement: detectDisagreement(lookups),
  };
}

/** Per-record relative freshness label from a TTL. */
export function ttlLabel(ttl: number): string {
  if (ttl >= 3600) {
    const hours = Math.round(ttl / 3600);
    return `${hours}h`;
  }
  if (ttl >= 60) return `${Math.round(ttl / 60)}m`;
  return `${ttl}s`;
}

/** Relative freshness category used for indicator styling. */
export function freshness(ttl: number): 'fresh' | 'medium' | 'stale' {
  if (ttl <= 300) return 'fresh';
  if (ttl <= 3600) return 'medium';
  return 'stale';
}

/** Serialize results as pretty JSON for copy/export. */
export function resultsToJson(results: LookupResult): string {
  return JSON.stringify(
    {
      domain: results.domain,
      recordType: results.recordType,
      disagreement: results.disagreement,
      resolvers: results.resolvers.map((r) => ({
        resolver: r.resolverId,
        status: r.status,
        dnsStatus: r.dnsStatus,
        error: r.error,
        answers: r.answers.map((a) => ({ name: a.name, TTL: a.TTL, data: a.data })),
      })),
    },
    null,
    2
  );
}

const TSV_COLUMNS = ['domain', 'recordType', 'resolver', 'status', 'ttl', 'data'] as const;

/** Serialize results as TSV for copy/export (tab-separated, one row per answer). */
export function resultsToTsv(results: LookupResult): string {
  const rows: string[][] = [TSV_COLUMNS.slice()];
  for (const lookup of results.resolvers) {
    if (lookup.status === 'error') {
      rows.push([
        results.domain,
        results.recordType,
        lookup.resolverId,
        'error',
        '',
        lookup.error ?? '',
      ]);
      continue;
    }
    if (lookup.answers.length === 0) {
      rows.push([results.domain, results.recordType, lookup.resolverId, 'ok', '', '']);
      continue;
    }
    for (const answer of lookup.answers) {
      rows.push([
        results.domain,
        results.recordType,
        lookup.resolverId,
        'ok',
        String(answer.TTL),
        answer.data,
      ]);
    }
  }
  return rows
    .map((row) => row.map((cell) => cell.replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'))
    .join('\n');
}

/** Compact summary for the status bar. */
export function summaryText(state: ToolState): string {
  if (!state.domain) return 'Enter a domain to check';
  if (!isValidDomain(state.domain)) return 'Invalid domain';
  if (!state.results) return `${state.domain} ${state.recordType}: not checked yet`;
  const okCount = state.results.resolvers.filter((r) => r.status === 'ok').length;
  const total = state.results.resolvers.length;
  return `${state.domain} ${state.recordType}: ${okCount}/${total} ok${state.results.disagreement ? ' · propagating' : ' · consistent'}`;
}
