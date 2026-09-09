"""Validate a generated demo source tree without fetching the network."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

EXPECTED_COUNTS = {"jsonld": 300, "legacy": 250, "javascript": 150, "mixed": 300}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "path", nargs="?", type=Path, default=Path(__file__).parent / "generated"
    )
    arguments = parser.parse_args()
    root = arguments.path.resolve()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["listing_count"] == sum(EXPECTED_COUNTS.values())
    for site in manifest["sites"]:
        key = site["site"]
        site_root = root / key
        pages = list((site_root / "property").glob("*/index.html"))
        assert len(pages) == EXPECTED_COUNTS[key], (key, len(pages))
        assert (site_root / "rentals" / "index.html").is_file()
        assert (site_root / "robots.txt").is_file()
        assert (site_root / "sitemap.xml").is_file()
        sample = pages[0].read_text(encoding="utf-8")
        assert "اجاره ماهانه" in sample
        assert "رهن" in sample
        assert "تماس" in sample
        assert not re.search(r"هٔ|ۀ", sample)
        if key == "jsonld":
            assert 'type="application/ld+json"' in sample
        if key == "javascript":
            assert 'id="root"' in sample and "innerHTML" in sample
    print(
        f"Validated {manifest['listing_count']:,} generated listings across four websites."
    )


if __name__ == "__main__":
    main()
