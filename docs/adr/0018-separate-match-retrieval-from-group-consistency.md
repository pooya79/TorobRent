---
status: accepted
---

# Separate match retrieval from grouped-Property consistency

Property Match Suggestions use bounded, indexed candidate retrieval followed by deterministic
comparison, and Properties in different known Cities are ineligible before detailed comparison.
Candidate paths rank focused work by evidence closeness while complete backfills retain UUID-keyset
ordering; an unchanged Property pair reuses its existing scoring-version evaluation.

Group Consistency Measurements keep the opposite recall boundary: every Listing pair in a changed
group is assessed because dissimilar evidence can reveal an incorrect grouping. A Property points
to its current measurement, scoring-evidence mutations invalidate that pointer, and unchanged
groups reuse it; the Operator list filters, orders, and paginates this current state in PostgreSQL
before loading page evidence. This trades a small denormalized-current-state seam for bounded reads
and repeat work while preserving exhaustive audits where contradictions matter.
