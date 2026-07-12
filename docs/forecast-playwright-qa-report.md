# Forecast Playwright QA report

Date: 2026-07-12

## Scope

The local web app was exercised through the in-app Playwright browser against the Docker Compose stack. The matrix covered binary, numeric, date, categorical, thresholded, and conditional forecasts. Each prompt was verified in the browser before submission, then checked in the server's persisted launch configuration. Completion required both a terminal task status and a committed forecast ledger.

## Issues found and fixed

1. **Agent authentication mounted from the wrong path.** App and worker health returned 503 because the ignored local `.env` still pointed `CODEX_HOME` at `/home/bun/.codex`. The Compose runtime now uses the provisioned subscription-auth profile at `/agent-auth/codex/default`; `/api/health` reports all checks healthy.
2. **Next development origin blocked browser HMR.** Requests from `127.0.0.1` were rejected and form state could reset before launch. `allowedDevOrigins` now includes both `127.0.0.1` and `localhost`.
3. **Duplicate React keys flooded client and server logs.** The decision brief combined the same stream event twice and keyed rows by event text. Events are deduplicated and keyed by position plus value.
4. **Run polling caused overlapping Smithers CLI reconciliation.** Multiple tabs created overlapping inspect/output processes, reaching roughly 1,224 PIDs and 8 GiB. Reconciliation is now single-flight, SSE ticks cannot overlap, full-workspace polling was removed, and disconnected fallback polling is slower. A clean completed-run session settles at 48 PIDs and about 1.1 GiB.
5. **Terminal trace bursts caused one run-detail request per trace event.** Client trace refreshes are debounced, reducing a completed-run load to three initial detail requests rather than dozens of concurrent requests.
6. **Transient Smithers history reads could fail completed work.** `No Smithers run history found` is retryable during the launch grace period. A committed forecast ledger can no longer be downgraded to failed, and committed ledgers are recovered to completed.
7. **Binary resolution clauses were misclassified as conditional.** A bare `if` in `Resolve Yes if ...` no longer implies a conditional forecast. Bare-if conditional detection is limited to a leading condition followed by a forecast question.
8. **Numeric and date wording was under-classified.** Numeric value/index-point wording and `what calendar date` wording now route to their respective workflows.
9. **Threshold extraction included resolution dates.** `31` and `2026` from `July 31, 2026` were incorrectly added to a Bitcoin threshold curve. Common date forms and standalone years are removed before threshold extraction.
10. **Categorical prompts had no frozen option contract.** Explicit colon-separated options are now extracted, canonicalized, and `another ...` is mapped to `Other`, preventing synonymous model-generated categories from expanding the aggregate.
11. **Small percentage-point values were displayed as fractions.** A categorical value of `0.7` was rendered as `70%`, and the same ambiguity affected threshold curves. Categorical and thresholded reports now format their documented 0-100 percentage-point contract directly.
12. **Browser-log page-hide requests could be truncated.** The beacon now sends a serialized string instead of a streamed Blob. Malformed batches remain bounded and rejected with 400 instead of affecting the application.
13. **The above-the-fold logo emitted an LCP warning on every page.** The shared logo image now loads eagerly.
14. **Lint scanned generated production bundles.** The web ESLint configuration now ignores `dist`, so lint evaluates source rather than minified generated code. The Next Turbopack root is also explicit, removing the multiple-lockfile build warning.

## Final forecast matrix

| Type | Run id | Result |
| --- | --- | --- |
| Binary | `3caff551-3be8-4e63-819a-a32c798145b8` | completed, ledger committed, 41% aggregate rendered |
| Numeric | `c5af7351-a577-4a5b-b4ed-60d36a06b841` | completed, ledger committed, quantiles and 14 sources rendered |
| Date | `3c9073d3-f37f-4dae-8fc7-84cfdd3a707d` | completed, ledger committed, date quantiles rendered |
| Categorical retest | `4949913a-08a2-4a82-bb15-2edfdb2d7999` | completed, ledger committed, five frozen categories sum to 100.0% |
| Thresholded retest | `e556a97e-8c50-4096-a6e9-1918c8457855` | completed, ledger committed, only three requested thresholds rendered |
| Conditional | `7619d3ac-e8cd-4553-9953-e80b64b5d7d2` | completed, ledger committed, both conditional branches rendered |

The browser also exercised overview, results, sources, and debug panels. The final clean-session log window contained no forwarded browser warning/error, server exception, or HTTP 500.

## Automated verification

- `bun test`: 139 passed, 0 failed.
- Repository TypeScript check: passed after restoring the frozen workspace dependencies.
- ESLint: passed with no findings.
- Web and marketing production builds: passed.
- Exact classifier regression matrix: 7 passed.
- Run-input extraction regressions: 2 passed.
- Compose `app` and `smithers`: healthy after final restart.
