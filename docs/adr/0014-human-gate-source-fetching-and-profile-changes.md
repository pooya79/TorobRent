# Human-gate Source fetching and profile changes

TorobRent performs no outbound fetch until an Operator validates the submitted URL. Source
Discovery then proposes one versioned Source Profile for the dominant supported page structure;
an Operator must approve that profile before use, and manual edits or explicitly requested,
field-bounded LLM repairs create a new version requiring approval. LLM calls and profile changes
are never automatic. This adds deliberate human gates around third-party access and changing
extraction behavior while still allowing an approved profile to publish valid results
automatically and route only exceptions to review.
