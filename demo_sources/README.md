# Demo Source websites

These are four large, fictional Persian property websites for manually demonstrating TorobRent's
real Source Proposal and extraction workflow. They are not an automated test suite and are not
part of `make check`.

| Host prefix | Listings | Main extraction presentation |
| --- | ---: | --- |
| `jsonld` | 300 | JSON-LD plus visible facts |
| `legacy` | 250 | metadata, labels, and a property table |
| `javascript` | 150 | an initial JavaScript shell rendered in the browser fallback |
| `mixed` | 300 | a dominant structure with a 20% alternate structure |

All people, contact details, properties, prices, and images are fictional. Search indexing is
discouraged with `robots.txt`, page metadata, and the `X-Robots-Tag` response header. TorobRent's
named crawler remains allowed.

## Generate locally

Choose the real base domain that will serve the four exact hosts:

```bash
python3 demo_sources/generate.py --base-domain sources.example.com
python3 demo_sources/validate.py
```

Generated output is intentionally ignored by Git. Docker generates it again during the image build.
The generated `manifest.json` lists the exact Source Proposal and sitemap URLs.

## Preview locally

The Compose file requires a base domain because generated absolute JSON-LD and image URLs must
match the eventual public hosts. Configure the standalone demo in the repository's root `.env`:

```dotenv
DEMO_BASE_DOMAIN=sources.example.com
DEMO_HTTP_PORT=8088
```

The Make target explicitly passes that file to Compose:

```bash
make demo-sources-up
curl -H 'Host: jsonld.sources.example.com' http://127.0.0.1:8088/rentals/
```

For browser previews, open `http://jsonld.localhost:8088/rentals/`. The equivalent `legacy`,
`javascript`, and `mixed` subdomains are also routed locally.

Local preview verifies presentation only. TorobRent will reject a private or loopback destination,
so a genuine pipeline demonstration requires a public deployment.

## Serve publicly

1. Point these four DNS names at a public server:
   `jsonld`, `legacy`, `javascript`, and `mixed` under the chosen base domain.
2. Build with that exact `DEMO_BASE_DOMAIN`.
3. Run the container behind the server's HTTPS reverse proxy, preserving the incoming `Host`.
4. Confirm each `/robots.txt` and `/rentals/` URL from outside the server.
5. Submit `/rentals/` as the website URL in TorobRent. The optional sitemap URL is `/sitemap.xml`.

On a dedicated server, port 80 can be published directly:

```bash
export DEMO_BASE_DOMAIN=sources.example.com
docker compose -f demo_sources/compose.yaml up --build -d
```

For HTTPS, terminate TLS in the existing public reverse proxy and forward all four hostnames to
this container's port 80. Do not rewrite the `Host` header. Keep images on the same hostname so the
Source does not require a separately approved image host.

## Suggested live demonstration

Start with `https://jsonld.<base-domain>/rentals/`. An Operator-selected discovery target of 30–50
detail pages shows meaningful structural evidence without waiting for the complete 300-page
inventory. Later Extraction Requests remain bounded by TorobRent's own processing limits.

The transport scenario index is available at `/scenarios/transport/`. Nginx provides deterministic
410, 503, redirect, and robots-denied destinations for demonstrating exceptional outcomes.

After approving the `legacy` Source Profile, submit `/scenarios/extraction/` as a new Extraction
Request. It links to several valid listings plus listings with a missing deposit, conflicting floor
area, and structural drift. This produces a compact Operator-review demonstration without changing
the main fictional inventory.

For a reliable LLM-repair demonstration, create a manual draft profile version by replacing one
good field selector with a safe non-matching selector such as `.missing-demo-value`. Validation
will fall while the retained field observations remain available. Explicitly request smart repair
for that one field, inspect the new LLM-authored draft, and approve it. This demonstrates recovery
from a broken extraction rule without depending on a model to invent absent evidence.

The `mixed` source intentionally renders every fifth listing with an alternate DOM. Discovery should
select the dominant structure and retain the alternate pages as coverage evidence. The
`javascript` source returns real JavaScript shells whose inline scripts render the index and detail
content without third-party resources.
