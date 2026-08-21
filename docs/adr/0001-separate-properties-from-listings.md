# Separate properties from source listings

TorobRent represents a real-world rental unit as a Property and each source advertisement as a
separate Listing attached to that Property. This adds a deliberate boundary to the first milestone
so permanent manual and direct-submission workflows, and deferred crawler ingestion, can all feed
the same catalog without losing source-specific facts or preventing later comparison. Listings
retain their Source's claims when sources disagree, while Operators approve the normalized Property
facts used for search and filtering.
