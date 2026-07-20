# LOOP-17 append-only findings/fix queue

| timestamp | author | entry | severity | class | status | evidence |
|---|---|---|---|---|---|---|
| 2026-07-20T13:58:40-04:00 | breaker | L17-001 release dispatch/main-ancestry bypass | HIGH | novel | OPEN | initial release workflow |
| 2026-07-20T13:59:10-04:00 | builder | L17-001 root-cause fix | HIGH | novel | RESOLVED at `3aa36f0` | ancestry check + event-only trigger + regression policy |
| 2026-07-20T13:59:30-04:00 | breaker | L17-002 YAML shorthand bypasses action pin scanner | HIGH | novel | OPEN | failing production-hardening test |
| 2026-07-20T14:00:00-04:00 | builder | L17-002 parser coverage fix | HIGH | novel | RESOLVED at `3aa36f0` | shorthand negative test passes |
| 2026-07-20T14:00:20-04:00 | breaker | L17-003 packed artifact was not install-smoked | HIGH | novel | OPEN | dry-run-only verifier path |
| 2026-07-20T14:01:00-04:00 | builder | L17-003 exact-tarball smoke | HIGH | novel | RESOLVED at `3aa36f0` | isolated install, version, help checks |
| 2026-07-20T14:01:20-04:00 | breaker | round 4 held | - | no finding | CLOSED | pinned actions and non-persisted credentials |
| 2026-07-20T14:01:40-04:00 | breaker | round 5 held | - | no finding | CLOSED | version/tag and main ancestry gates |
| 2026-07-20T14:02:00-04:00 | breaker | round 6 held | - | no finding | CLOSED | lifecycle scripts disabled |
| 2026-07-20T14:02:20-04:00 | breaker | round 7 held | - | no finding | CLOSED | package allowlist |
| 2026-07-20T14:02:40-04:00 | breaker | round 8 held | - | no finding | CLOSED | safe installer path |

Corrections, if any, must be appended below; prior rows are immutable.
