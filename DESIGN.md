# TorobRent design system

TorobRent is a quiet, Persian-first rental catalog. The interface is a neutral gallery for Property
information: authorized photography carries visual weight, source claims remain explicit, and one
coral action per surface guides the renter or Submitter without turning the product into a booking
marketplace.

This document governs visual presentation. Product behavior and information architecture come from
the milestone issues and the domain language in `CONTEXT.md`.

## Principles

- **Persian first:** every surface is designed and reviewed in RTL with Persian content and digits.
- **Property before promotion:** cards communicate normalized Property facts and current Rental
  Terms; they do not rank, recommend, or manufacture urgency.
- **Sources stay visible:** a Property summary may show its Active Listing count, while individual
  Listing claims and disagreements remain separate on detail surfaces.
- **One clear action:** coral identifies at most one primary action per surface. Secondary actions
  use neutral fills or outlines.
- **Photography with permission:** use authorized, naturally treated Property media. When none is
  available, show the neutral building placeholder—never hotlink or copy source media.
- **State is content:** loading, empty, unavailable, validation, permission, confirmation, and
  recoverable-error states receive the same design attention as populated screens.

## Foundation

### Color tokens

| Token              | Light     | Dark      | Use                                        |
| ------------------ | --------- | --------- | ------------------------------------------ |
| `background`       | `#ffffff` | `#121214` | Page canvas                                |
| `card`             | `#ffffff` | `#1a1a1d` | Component surfaces                         |
| `popover`          | `#ffffff` | `#202024` | Menus, dialogs and sheets                  |
| `foreground`       | `#222222` | `#f5f5f6` | Primary text and icons                     |
| `muted`            | `#f7f7f7` | `#242429` | Quiet sections and placeholders            |
| `muted-foreground` | `#6a6a6a` | `#b3b3bd` | Metadata and helper text                   |
| `accent`           | `#f7f7f7` | `#2d2d33` | Hover and selected surfaces                |
| `border`           | `#ebebeb` | `#3a3a42` | Hairlines and component boundaries         |
| `input`            | `#dddddd` | `#666670` | Stronger control boundaries                |
| `primary`          | `#e00b41` | `#ff6b8e` | The single primary action and active state |
| `destructive`      | `#b42318` | `#f06a6a` | Errors and destructive actions only        |

The brighter reference coral `#ff385c` may appear in approved brand artwork, but interactive text
and controls use `#e00b41` to retain contrast on white.

### Theme preference

The display control exposes System, Light and Dark in both product and Operator navigation. System is
the default and follows operating-system changes live. An explicit preference is local to the current
browser profile, synchronizes across its open tabs and is restored before first paint without a
server cookie. If JavaScript or browser storage is unavailable, semantic colors continue to follow
`prefers-color-scheme`.

The dark palette is a restrained counterpart rather than a color inversion. Property photography
and sample listing imagery remain untreated inside neutral media frames; only first-party interface or
brand artwork may receive a theme-specific variant. Native controls and browser chrome follow the
resolved theme through `color-scheme` and theme-color metadata.

### Typography

Vazirmatn Variable is self-hosted through the frontend bundle and covers Persian and Latin text.
Tahoma, Arial, and a generic sans-serif are fallbacks. Body content defaults to 14–16px. Page titles
use 28–48px depending on viewport; section titles use 22–30px. Body and metadata use weights 400–600;
700 is reserved for compact brand or display emphasis.

### Spacing, shape, and elevation

- Use Tailwind's four-pixel spacing rhythm.
- The application shell is centered and capped at 1440px with 16px mobile, 24px tablet, and 40px
  desktop horizontal padding.
- Cards and media use 12–16px radii. Inputs use 8–12px. Primary and compact action controls may use
  full-pill radii.
- Interactive targets are at least 44px in both dimensions.
- Property cards remain flat. The search capsule uses `shadow-subtle`; dialogs and sheets may use
  stronger overlay elevation.
- Full-bleed media or horizontal rows are deliberate exceptions, not the default layout.

## Styling and component policy

React presentation uses Tailwind utilities and local shadcn component source as its primary
vocabulary.

- Add registry primitives to `frontend/src/components/ui/` with the shadcn CLI and import them via
  `@/components/ui/...`.
- Customize primitive variants centrally. Compose domain components such as `PropertyCard` outside
  the `ui` directory.
- Use named semantic utilities backed by `@theme`. Avoid scattered literal colors and arbitrary
  values when a stable token exists.
- Do not author semantic CSS class or ID selectors. `frontend/src/styles.css` is limited to Tailwind
  imports, theme declarations, base element rules, and accessibility media rules. CI runs the CSS
  selector guard.
- Native semantic HTML remains preferable when a shadcn primitive adds no behavior or consistency.
- This policy applies to the React frontend. Operator review remains a customized Django admin
  boundary; its prototype validates hierarchy and states rather than prescribing React in production.

## Application shell

Desktop uses a persistent RTL sidebar. Mobile uses a compact header and a focus-managed shadcn
Sheet. Primary destinations are Home, Search, Guide, Contact, Login, Add Listing, and the Submitter
Dashboard. The replaceable TorobRent wordmark uses a simple building icon; bespoke logo work is out
of scope. Backend health remains an accessible, visually demoted footer status.

## Core components

### Search capsule

The home-page hero is the search form: location autocomplete and Property type, followed by one
coral submit action. Booking dates, guest counts, experiences, and services are not TorobRent
concepts. On mobile, fields stack inside a rounded container; on wider screens they form a capsule.

### PropertyCard

A search card represents one normalized Property. It contains authorized media or the neutral
placeholder, location, normalized facts, Active Listing count, the freshest complete Rental Terms,
and freshness. The card has no wishlist or recommendation badge. Its name must never imply that it
represents a single Listing.

### Listing comparison

Property detail presents every Active Listing as a separate row with Source, Rental Terms,
freshness, and status. Disagreements receive explicit alert treatment. Contact details remain absent
until the renter activates the reveal action.

### Filters and pagination

Results use a persistent desktop filter sidebar and a focus-managed mobile Sheet. Applied filters
appear as removable chips and serialize into a shareable URL. Results are numbered in pages of 25;
horizontal vacation-style carousels do not replace the result list.

### Submission and status workflows

The guided Submission retains seven resumable steps, Persian validation, toman input boundaries,
and tri-state Feature States: present, absent, and unknown. Submitter and Operator surfaces expose
status, reason, history, and the next permitted action without relying on color alone.

## Required prototype surfaces

Issue #4 is the approval gate. Fixture-backed React Router routes cover:

1. Home
2. Results
3. Property Detail
4. Add Listing
5. Submitter Dashboard
6. Operator Review

Prototype data lives behind the prototype fixture boundary and must not be mistaken for live
inventory. Query-selectable states include loading, empty, unavailable, recoverable error,
validation, and permission denial.

## Accessibility and responsive review

Every representative surface must demonstrate correct RTL reading order, logical CSS positioning,
keyboard order, visible focus, Sheet/dialog focus management, 44px targets, WCAG 2.2 AA contrast,
reduced-motion behavior, and no page-level horizontal overflow in both Light and Dark. Text or
icons accompany status color. Public content remains meaningful in server-rendered HTML before
hydration, and an explicit device-local theme is applied before first paint.

## Visual records

Run `cd frontend && pnpm capture:design` to regenerate Light and Dark mobile and desktop screenshots
for all six prototype surfaces under `docs/design/screenshots/`. These are durable review artifacts;
default CI continues to assert behavior and accessibility without treating every pixel as a release
gate.

## Explicit exclusions

- Airbnb logos, navigation labels, booking semantics, proprietary fonts, and copied information
  architecture
- Favorites, wishlists, “guest favorite,” recommendations, best/cheapest claims, or urgency copy
- Hotlinked or copied source imagery
- Component-specific CSS selectors or a mixed legacy/new styling layer
