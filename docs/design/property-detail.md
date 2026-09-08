# Property detail redesign

The detail page groups property facts, amenities, source offers, and price history into
separate sections. Approved source images appear in a gallery with source attribution;
missing or failed images fall back to a compact neutral property panel. Unknown amenities
remain distinct from absent ones. Contact and message eligibility still come from the API.

On mobile, the header links directly to offers and contact actions. Desktop offers occupy
a separate column. Persian copy, right-to-left layout, keyboard controls, and the app's
explicit light/dark theme are supported.

## Price history

Apply catalog migration `0017_listingpriceobservation` before serving the updated API
(`make migrate`). It records the current prices of existing published listings at migration
time, without assigning fictional historical dates. Normal Listing and RentalTerms saves
then record changed published price pairs. Unchanged prices and draft edits do not add
observations. Use the existing save-based catalog services for price changes; bulk SQL
updates bypass Django save signals.

Each offer has its own history. Both deposit and monthly rent are returned in toman through
the generated API contract. The UI renders two step charts with independent, zero-based
scales and a date/value table. It preserves zero-rent offers. Fewer than two observations
produce an explicit insufficient-history state rather than a fabricated trend.

## Visual checks

The four `screenshots/property-detail-{light,dark}-{desktop,mobile}.png` captures show the
fictional development property at 1440 and 390 pixels. The price charts were also checked
with synthetic observations in an isolated preview database; these observations are not
part of the production migration or development seed. The
`property-price-history-dark-example.png` image documents that synthetic chart example. Automated accessibility checks on
the detail content found no WCAG A/AA violations in either theme at either width.

## Property location map

A map section before price history centers the configured map provider on the public
Approximate Location and selects this property's marker. The header links directly to it.
The uncertainty area and accompanying Persian text distinguish approximate locations from
neighborhood-only positions; missing coordinates do not produce a guessed marker. A reset
button returns to the property's location, and provider failures offer a retry. No exact
coordinates or new API fields are exposed.

Map checks cover centering, marker selection, neighborhood zoom, missing coordinates, and
retry. The OpenStreetMap rendering engine was checked in the browser using local synthetic
tiles; the `property-location-local-test-{desktop,mobile}.png` screenshots record that
local-only check. Live public tile verification was blocked by automatic approval review and is not
claimed as completed.
