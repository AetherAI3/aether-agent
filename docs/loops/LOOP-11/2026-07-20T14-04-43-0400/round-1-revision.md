# Round 1 revision

- Scanned every workflow line containing `npm ci`, including block scalars, and required `--ignore-scripts` on that line.
- Generalized installer/README validation across `npm install`, `npm i`, quoted `aether-agents@...` specs, and npx execution.
- Added negative regression fixtures for block-scalar CI, quoted installer specs, and npx.
- Corrected both installer update messages to report the requested release.

Verification: TypeScript strict typecheck, 7 targeted production-hardening tests, and isolated package production verification all passed.
