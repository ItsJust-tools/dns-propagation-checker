import { DEFAULT_STATE, RESOLVERS, type RecordType, type ToolState } from './types';

export const RECORD_TYPES: { value: RecordType; label: string; hint: string }[] = [
  { value: 'A', label: 'A', hint: 'IPv4 addresses' },
  { value: 'AAAA', label: 'AAAA', hint: 'IPv6 addresses' },
  { value: 'CNAME', label: 'CNAME', hint: 'canonical name alias' },
  { value: 'MX', label: 'MX', hint: 'mail servers' },
  { value: 'TXT', label: 'TXT', hint: 'text records (SPF, DKIM...)' },
  { value: 'NS', label: 'NS', hint: 'nameservers' },
  { value: 'SOA', label: 'SOA', hint: 'start of authority' },
  { value: 'CAA', label: 'CAA', hint: 'certificate authority authorization' },
];

export { DEFAULT_STATE, RESOLVERS };
export type { ToolState };
