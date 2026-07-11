# LOOP-01 node 6 - logging and error handling

- The client generally converts failures to user-facing messages and uses bounded diagnostics; no raw stack trace path was proven in the inspected backend seams.
- Correlation/request IDs are not threaded by `ApiClient`; this is a distributed tracing gap and likely server/API contract work.
- Several catch blocks intentionally fail soft or redact content. Low-confidence silent-catch classifications are recorded as unknown rather than treated as bugs.
- Plain-text CLI output is expected for human mode; JSON mode is used for machine consumers. A future pass should standardize structured event fields without exposing credentials.

Status: no safe additional mutation selected in this run.
