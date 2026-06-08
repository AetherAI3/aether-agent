# DRAFT — npm abuse / impersonation report (NOT FILED)

**Status:** parked. Do not file until Aether AI holds a registered or defensible
common-law trademark on "Aether" / "Aether AI". Without a mark, npm treats unscoped
names as first-come-first-served and this report has little leverage. Kept here as a
ready-to-send marker.

**File to:** https://www.npmjs.com/support → "Report a security/abuse issue" (or
security@npmjs.com). For trademark/dispute, follow npm's package-name-dispute policy:
https://docs.npmjs.com/policies/disputes

---

## Package reported

- Name: `aether-code`
- Latest: `0.12.0` (published 2026-05-18; package created 2026-05-08)
- Maintainer: `rivendaddy <dannyshtansky0161@gmail.com>`
- Repo: `https://github.com/dannyphantomx64/aether-code`
- Homepage: `https://trynoguard.com`

## Who we are

- Aether AI LLC — `https://aethersystems.net`
- Our product line: AetherCloud (desktop agent) and our terminal coding agent,
  published by us as **`aether-agent`**.
- Owner: Brandon Barrante.

## Grounds

1. **Brand impersonation.** The package is named `aether-code` and stuffs the keyword
   `aether` plus `claude-code-alternative` / `cursor-alternative`, trading on the
   "Aether" name we use commercially, while the package's actual product/brand is
   "NoGuard" (`trynoguard.com`). The "aether" naming appears chosen to capture our
   brand's search traffic, not to describe their product.
2. **Safety-relevant misdirection.** The package self-describes as an "Uncensored AI
   coding agent … No refusal layer" that "Reads code, writes files, runs commands" and
   drives IDA Pro / Wireshark / Blender, and on install launches a CLI that contacts
   `trynoguard.com`. Users searching for our `aether` tooling can install this instead
   and run an unvetted command-executing agent that phones a third-party host.
3. **User confusion, documented.** A user attempting to install our tool via the
   intuitive `npm i -g aether-code` received this package instead and reported it as
   suspected impersonation of our brand.

## Requested action

- Primary: review for impersonation / deceptive naming under npm acceptable-use policy.
- Secondary (only with trademark standing): name-dispute transfer of `aether-code`.

## What we have already done

- Published our tool under the clean, unambiguous name **`aether-agent`** and updated
  all of our install instructions, so we are not dependent on the disputed name.

---

*Attachments to include when filing: screenshot of the squatter's npm page, our LLC
registration, and (if available) trademark filing/registration number.*
