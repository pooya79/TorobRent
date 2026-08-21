import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

import postcss from "postcss";

const forbidden = [];

for (const stylesheet of globSync("src/**/*.css")) {
  const root = postcss.parse(readFileSync(stylesheet, "utf8"), {
    from: stylesheet,
  });
  root.walkRules((rule) => {
    if (/[.#][A-Za-z_-]/.test(rule.selector)) {
      forbidden.push(
        `${stylesheet}:${rule.source.start?.line ?? 1}: ${rule.selector}`,
      );
    }
  });
}

if (forbidden.length > 0) {
  console.error(
    "Authored class or ID selectors are not allowed:\n" + forbidden.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("CSS selector guard passed.");
}
