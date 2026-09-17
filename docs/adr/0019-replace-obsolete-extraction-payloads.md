---
status: accepted
---

# Replace obsolete extraction payloads

Successful extraction replaces the previous extraction payload for the same Source and listing URL,
removing obsolete values, evidence, and unused media while retaining compact run summaries and
Operator decisions; failed attempts retain the last successful result, and unvisited URLs remain
untouched. This deliberately gives up full historical extraction replay to bound retained payloads,
while published Listings and approved Source Profile definitions remain separate from that cleanup.
The [design discussion](../design/source-proposal-data-loading.md) records loading boundaries and
the approve/reject-only review policy and implementation status.
