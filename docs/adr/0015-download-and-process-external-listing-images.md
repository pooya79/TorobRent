# Download and process External Listing Images

TorobRent downloads approved external image URLs instead of hotlinking them in renters' browsers.
The system restricts downloads to approved HTTPS Source or CDN hosts, applies network and content
limits, validates decoded images, strips metadata, and stores responsive first-party variants.
Images remain source-specific Listing Images unless an Operator accepts them as Property Images;
this avoids disclosing renter traffic to external hosts and preserves the catalog distinction
between advertisement media and reviewed Property media at the cost of storage and processing.
