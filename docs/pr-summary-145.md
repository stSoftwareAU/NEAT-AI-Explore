## Summary

Add five Mermaid diagrams to README.md to visually explain key concepts in the
NEAT-AI Explore project. Closes #145.

Diagrams added:

1. **Architecture / repo structure** — shows the `docs/` PWA layout, shared
   modules, graph explorer, tests, and their relationships
2. **Data flow / direction terminology** — illustrates the opposite directions
   of network computation (inputs to outputs) vs explorer navigation (outputs to
   inputs)
3. **Snapshot loading flow** — shows the four snapshot source paths (file
   picker, URL param, base64 URL, auto-load default) flowing through
   `snapshot_loader.js` with security checks and gzip handling
4. **Testing pipeline** — visualises the `quality.sh` gate: `deno fmt` to
   `deno lint` to `deno test`
5. **Snapshot JSON structure** — a class diagram showing the top-level shape
   (`meta`, `creature`, `recording`, `derived`) and their key fields

All diagrams use Australian English spelling, colour styling where Mermaid
supports it, and render correctly on GitHub (which natively supports Mermaid in
markdown).

## Evidence

This is a documentation-only change (Mermaid diagrams in markdown). No UI code
was modified. Mermaid diagrams render natively on GitHub — no local rendering
needed.

## Test Plan

- `./quality.sh` passes cleanly (353 tests, formatting, linting all green)
- No code changes — only README.md documentation updated
- Diagrams can be verified by viewing README.md on GitHub, which natively
  renders Mermaid code blocks
