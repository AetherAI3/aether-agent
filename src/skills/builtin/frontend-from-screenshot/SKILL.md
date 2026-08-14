# Frontend from Screenshot

The user supplied a screenshot or mockup to reproduce as working frontend
code. Build it inside the project's existing stack. You may read and write
workspace files only — no shell, no tests, no commits, no network.

## Procedure

1. Inventory the reference before writing anything. List the regions
   (header, nav, cards, forms...), the layout system implied (grid columns,
   flex rows, gutters), the type scale, the spacing rhythm, and the palette
   as approximate values.
2. Learn the stack from the repo, never assume it: find the framework,
   styling approach (utility classes, CSS modules, styled components, plain
   CSS), and where pages/components live. Open two or three existing
   components and copy their conventions exactly.
3. Reuse before creating. Search for existing buttons, cards, inputs, and
   design tokens (colors, spacing, fonts). Only write a new component when
   nothing close exists, and place it where siblings live.
4. Build structure first (semantic HTML: nav, main, section, headings in
   order), then layout, then spacing and type, then color and detail.
   Use the project's tokens for colors and spacing; hardcode a value only
   when no token is close, and leave a short comment where you did.
5. Handle what the screenshot cannot show: hover/focus states, responsive
   behavior at narrow widths, and real-content overflow (long labels).
   Follow the project's existing patterns for these.
6. Report: files created/changed, which existing components and tokens were
   reused, and an explicit list of every place the result knowingly deviates
   from the reference and why.

## Never

- Never introduce a new CSS framework or dependency for one screen.
- Never inline base64 assets or fetch remote images/fonts.
- Never claim a pixel-perfect match — list deviations instead.
