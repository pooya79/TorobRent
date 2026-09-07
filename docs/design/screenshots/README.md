# Product screenshots

Run `make dev` and `make seed-dev`, then run `cd frontend && pnpm capture:design` to regenerate the
Light and Dark records at mobile and desktop widths for the six canonical product surfaces. Files
use `<surface>-<theme>-<viewport>.png`. The browser-contract suite excludes these visual-only
captures, so routine CI asserts behavior without turning every pixel into a release gate.
