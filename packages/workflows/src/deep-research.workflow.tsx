/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const researchBrief = z.object({
  direction: z.string(),
  summary: z.string(),
  keyFindings: z.array(z.string()).default([]),
  uncertaintyNotes: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const researchReport = z.object({
  reportType: z.literal("deep_research"),
  answer: z.string(),
  keyFindings: z.array(z.string()).default([]),
  uncertaintyNotes: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const { Workflow, smithers, outputs } = createSmithers({
  researchBrief,
  researchReport,
});

const directions = [
  {
    id: "landscape",
    label: "landscape researcher",
    instruction: "Map the domain, key entities, definitions, and current state. Prefer primary or high-quality sources.",
  },
  {
    id: "evidence",
    label: "evidence researcher",
    instruction: "Find concrete evidence, data points, counterexamples, and source-backed claims.",
  },
  {
    id: "skeptic",
    label: "skeptical researcher",
    instruction: "Look for weak assumptions, conflicting evidence, missing context, and ways a concise answer could mislead.",
  },
];

export default smithers((ctx) => {
  const input = (ctx.input ?? {}) as {
    question?: unknown;
    prompt?: unknown;
    background?: unknown;
  };
  const question = String(input.question ?? input.prompt ?? "");
  const background = String(input.background ?? "");
  const briefIds = directions.map((direction) => `research-${direction.id}`);
  const briefNeeds = Object.fromEntries(briefIds.map((id) => [id, id]));
  const briefs = ctx.outputs.researchBrief ?? [];
  const keyFindings = briefs.flatMap((brief) => brief.keyFindings ?? []);
  const uncertaintyNotes = briefs.flatMap((brief) => brief.uncertaintyNotes ?? []);
  const citedSources = briefs.flatMap((brief) => brief.citedSources ?? []);
  const answer = briefs.length
    ? briefs.map((brief) => `${brief.direction}: ${brief.summary}`).join("\n\n")
    : "No research briefs were available; this fallback should only appear in graph rendering.";

  return (
    <Workflow name="deep-research">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {directions.map((direction) => (
            <Task
              key={direction.id}
              id={`research-${direction.id}`}
              output={outputs.researchBrief}
              agent={codexResearchAgent}
            >
              {`You are the ${direction.label} for Open Superforecaster.

Question:
${question}

Background:
${background || "No extra background provided."}

Research direction:
${direction.instruction}

Return a concise research brief. Set direction to "${direction.label}". Include key findings, uncertainty notes, and cited sources when available.`}
            </Task>
          ))}
        </Parallel>

        <Task id="synthesis" output={outputs.researchReport} needs={briefNeeds}>
          {{
            reportType: "deep_research",
            answer,
            keyFindings,
            uncertaintyNotes,
            citedSources,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
