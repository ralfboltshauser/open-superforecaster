/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexStructuredAgent } from "./agents";

const { Workflow, smithers, outputs } = createSmithers({
  smoke: z.object({
    ok: z.boolean(),
    summary: z.string(),
  }),
});

export default smithers(() => (
  <Workflow name="codex-smoke">
    <Task id="codex-smoke" output={outputs.smoke} agent={codexStructuredAgent}>
      Return a tiny JSON result proving structured output works. Set ok to true
      and summarize this as an Open Superforecaster CodexAgent smoke test.
    </Task>
  </Workflow>
));
