# Prototype screenshots

Run `cd frontend && pnpm capture:design` to regenerate the approved Light and Dark records at mobile
and desktop widths for the six fixture-backed milestone surfaces. Files use
`<surface>-<theme>-<viewport>.png`. The default end-to-end suite excludes these visual-only captures
so routine CI asserts behavior without turning every pixel into a release gate.
