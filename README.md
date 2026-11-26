# DNS Propagation Checker

Check DNS records across multiple public resolvers for any domain and record type, showing per-resolver results side by side.

**Live:** <https://dns-propagation-checker.itsjust.tools>

## Features

- Query any domain for `A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS`, `SOA` and `CAA` records
- Per-resolver result table: Google, Cloudflare, Quad9, OpenDNS (plus an offline sample resolver for demos)
- Resolver disagreement highlighting for propagation detection
- TTL display per record with a relative freshness indicator (fresh / aging / high TTL)
- Copy results as JSON or TSV
- Session history of recent lookups with a one-click re-check button
- Shareable URL encoding the domain, record type and latest results
- DNS lookups run from your browser via public DNS-over-HTTPS JSON APIs — no server-side lookups, nothing stored

## How it works

Each selected resolver is queried through its DNS-over-HTTPS JSON endpoint:

- Google: `https://dns.google/resolve`
- Cloudflare: `https://cloudflare-dns.com/dns-query` (`Accept: application/dns-json`)
- Quad9: `https://dns.quad9.net:5053/dns-query`
- OpenDNS: `https://doh.opendns.com/resolve`

Answers are compared across resolvers; when they differ the tool flags the domain as still propagating. Failed resolvers are shown per-row without breaking the whole check.

## Development

```bash
npm install
npm run build -w @itsjust/core   # build shared core first
npm run dev
npm test
```

## Deployment

```bash
docker build -t itsjust-dns-propagation-checker .
docker run -p 3000:3000 itsjust-dns-propagation-checker
```

## License

MIT
