# Repository Guidance

Before changing forecasting architecture, evidence collection, aggregation,
calibration, live updating, benchmark evaluation, or promotion policy, read
[`docs/agentic-superforecasting.md`](docs/agentic-superforecasting.md) and
[`docs/agentic-superforecasting-implementation.md`](docs/agentic-superforecasting-implementation.md)
completely.

The research memo distinguishes verified findings, preliminary or vendor
evidence, and proposed changes. The implementation guide records the operational
contract, file map, current limitations, and recovery checklist. Verify current
behavior in code because both documents are dated snapshots.

Preserve raw mean and median baselines, provenance, chronological holdouts, and
autonomous-versus-crowd-assisted distinctions in forecasting experiments.
