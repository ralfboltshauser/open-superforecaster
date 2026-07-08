# Open Superforecaster Examples

Small seed inputs for local smoke runs. They are intentionally compact so a new
user can verify each workflow family without preparing their own dataset.

Plan or execute the bundled samples through the live app API:

```bash
bun run workflow:samples
bun run workflow:samples -- --probe
bun run workflow:samples -- --execute --suite quick
bun run workflow:samples -- --execute --suite all
```

The default is a plan-only run. `--execute` launches real Smithers/CodexAgent
work, waits for terminal status, and verifies persisted artifacts, forecast
ledgers, table row ledgers, benchmark scorecards, and replay links.

## Forecast And Research Prompts

`questions.jsonl` contains one JSON object per sample prompt:

- binary forecast
- date forecast
- numeric forecast
- categorical forecast
- thresholded forecast
- conditional forecast
- deep research

Run one by copying the `body` field into:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d @examples/request-binary-forecast.json
```

## Table Workflows

Use the CSV files in the web composer by selecting the relevant mode and
uploading or pasting the CSV:

- `companies.csv`: classify/rank/agent-map seed rows.
- `merge-left.csv` and `merge-right.csv`: small merge seed rows.
- `dedupe-companies.csv`: small dedupe seed rows.

Equivalent JSON API requests are in:

- `request-classify-companies.json`
- `request-agent-map-companies.json`
- `request-rank-companies.json`
- `request-merge-companies.json`
- `request-dedupe-companies.json`

Run them with:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d @examples/request-classify-companies.json
```

After a run finishes, inspect `/runs/<task-id>` and export artifact rows with
`/api/artifacts/<artifact-id>/csv`.
