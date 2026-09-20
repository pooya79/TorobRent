# README screenshot gallery

Eight screenshots captured from the running development application with **Playwright CLI** on
2026-09-20. These use local demo accounts and catalog data. The search and estimator captures use
the real OpenStreetMap adapter with loaded tiles, rather than the browser tests' fake map.

## Original captures

| #   | Surface                          | Theme | Original                                    |
| --- | -------------------------------- | ----- | ------------------------------------------- |
| 01  | Home and city discovery          | Light | [Screenshot](screenshots/01-home.png)       |
| 02  | Rental search and Tehran map     | Light | [Screenshot](screenshots/02-search.png)     |
| 03  | Property photos and rental terms | Light | [Screenshot](screenshots/03-property.png)   |
| 04  | Monthly cost estimator           | Light | [Screenshot](screenshots/04-estimator.png)  |
| 05  | Submitter dashboard              | Light | [Screenshot](screenshots/05-dashboard.png)  |
| 06  | Existing draft's final review    | Light | [Screenshot](screenshots/06-submission.png) |
| 07  | Demo listing conversation        | Dark  | [Screenshot](screenshots/07-messages.png)   |
| 08  | Operator source review queue     | Dark  | [Screenshot](screenshots/08-sources.png)    |

The originals retain the UI exactly as captured, including honest missing-photo placeholders in
some demo records. No map tiles, property photos, or application content were painted into the
screenshots. The composites only resize and arrange the captures with editorial labels.

## Refresh the gallery

Run the application with the OpenStreetMap adapter and suitable local demo data. Use a dedicated
Playwright CLI browser session, so existing browser sessions remain untouched:

```bash
playwright-cli -s=readme open http://localhost:5173
playwright-cli -s=readme resize 1440 1000
playwright-cli -s=readme goto http://localhost:5173/search
playwright-cli -s=readme snapshot
```

Navigate with the CLI, using the demo personas documented in
[development.md](../development.md#development-seed-personas). Open existing records instead of
publishing submissions or starting extraction jobs just for a screenshot. The home capture uses
1440×1120 to include the complete city cards; the other captures use 1440×1000.

Before each capture, wait for the destination's actual content, fonts, images, and map tiles.
Network idle alone does not guarantee that a React navigation has finished rendering. Inspect the
saved screenshot before accepting it. Use `run-code` for Playwright waits and theme emulation:

```bash
playwright-cli -s=readme run-code "async page => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}"
playwright-cli -s=readme screenshot --filename=docs/readme/screenshots/02-search.png
playwright-cli -s=readme close
```

The dark captures use `colorScheme: 'dark'` with the app's theme preference set to System.
Do not include real users' private messages, contact information, or credentials in new captures.

Rebuild both 2×2 sheets with Pillow and DejaVu Sans installed:

```bash
python3 docs/readme/compose_gallery.py
```

Set `FONT_DIR` if DejaVu Sans is installed somewhere other than
`/usr/share/fonts/truetype/dejavu`. The script preserves screenshot aspect ratios and writes
[discover.webp](discover.webp) and [manage.webp](manage.webp). Only the compact WebP sheets are
embedded in the root README; the full-resolution PNGs are linked here for closer inspection.
