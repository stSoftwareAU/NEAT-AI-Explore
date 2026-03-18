## Summary

Styled the README documentation with emojis, badges, callouts, and improved
visual hierarchy to make it fun, informative, and visually scannable. Closes
#146.

### Changes

- **Emojis on section headers**: Added relevant emojis to all major sections
  (e.g. 🧠 NEAT-AI, 🚀 Try it now, 🧪 Testing, 🎮 Graph explorer, 📱
  Responsiveness)
- **Status badges**: Added Licence, GitHub Pages demo, Deno, and Version badges
  at the top of the README
- **Callout formatting**: Tips and warnings use blockquote styling with emoji
  prefixes (💡 Tip, ⚠️ Note)
- **Visual hierarchy**: Horizontal rules (`---`) between all major sections for
  clear separation
- **Code blocks**: Verified all code blocks already have appropriate language
  tags (`json`, `bash`, `mermaid`, `ts`)
- **Australian English audit**: Confirmed Australian English throughout (colour,
  behaviour, licence, organisation, artefacts); added a note that CSS property
  names like `prefers-color-scheme` retain American spelling as web standards

## Evidence

![Styled README rendered on GitHub](docs/evidence/readme-styled.png)

## Test Plan

- All 353 existing tests pass — `./quality.sh` is green
- No functional code changes; documentation-only styling update
- Verified `deno fmt --check`, `deno lint`, and `deno test -A` all pass
