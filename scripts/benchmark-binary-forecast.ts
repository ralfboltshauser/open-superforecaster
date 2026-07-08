import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  inspectSmithersRun,
  launchSmithersDetached,
  readSmithersNodeOutput,
} from "../packages/backend/src/index";
import { scoreBinaryForecast } from "../packages/evals/src/index";

type BenchmarkCase = {
  id: string;
  question: string;
  resolutionCriteria: string;
  background: string;
  fixedEvidence: string;
  presentDate: string;
  cutoffDate: string;
  resolved: boolean;
};

type AggregateOutput = {
  probability?: unknown;
  method?: unknown;
  attemptCount?: unknown;
  [key: string]: unknown;
};

type CaseResult = {
  id: string;
  runId: string;
  question: string;
  resolved: boolean;
  probability: number;
  method: string;
  attemptCount: number | null;
  brier: number;
  log: number;
};

const workflowPath = "packages/workflows/src/binary-forecast.workflow.tsx";

const benchmarkCases: BenchmarkCase[] = [
  {
    id: "trump-2024",
    question: "Will Donald Trump win the 2024 United States presidential election?",
    resolutionCriteria:
      "Resolve YES if Donald Trump is elected president in the 2024 US presidential election, based on certified Electoral College outcome.",
    presentDate: "2024-08-01",
    cutoffDate: "2024-11-05",
    resolved: true,
    background:
      "This is a retrospective benchmark. The forecaster must reason from the fixed evidence as of the present date, not from later knowledge.",
    fixedEvidence:
      "As of 2024-08-01, Joe Biden had withdrawn and Kamala Harris was the presumptive Democratic nominee. Donald Trump was the Republican nominee. National polling was close, battleground polling was close, and the Electoral College had recently favored Republicans relative to the national popular vote. Trump had survived an assassination attempt in July and the Republican convention had completed. Harris had consolidated Democratic support but had not yet selected a running mate.",
  },
  {
    id: "uk-labour-majority-2024",
    question: "Will Labour win an outright majority in the 2024 United Kingdom general election?",
    resolutionCriteria:
      "Resolve YES if Labour wins more than half of House of Commons seats in the 2024 UK general election.",
    presentDate: "2024-05-23",
    cutoffDate: "2024-07-04",
    resolved: true,
    background:
      "This is a retrospective benchmark. The forecaster must reason only from the election context available on the present date.",
    fixedEvidence:
      "As of 2024-05-23, Prime Minister Rishi Sunak had called a general election for 2024-07-04. Polls had shown Labour with a large and persistent national lead over the Conservatives for many months. UK first-past-the-post elections can amplify national polling leads into large seat majorities, though campaign shocks and tactical voting can still matter.",
  },
  {
    id: "fed-cut-by-sept-2024",
    question: "Will the US Federal Reserve cut the federal funds target range by 2024-09-30?",
    resolutionCriteria:
      "Resolve YES if the FOMC announces any reduction in the target federal funds range on or before 2024-09-30.",
    presentDate: "2024-01-15",
    cutoffDate: "2024-09-30",
    resolved: true,
    background:
      "This benchmark uses macroeconomic evidence available early in 2024 and resolves against FOMC decisions by the cutoff date.",
    fixedEvidence:
      "As of 2024-01-15, the target federal funds range was 5.25%-5.50%. Inflation had fallen materially from its 2022 peak but remained above the Fed's 2% target. The December 2023 Summary of Economic Projections showed policymakers expected rate cuts in 2024. Market pricing assigned meaningful probability to several cuts in 2024, though Fed officials cautioned against declaring victory too soon.",
  },
  {
    id: "bitcoin-100k-2024",
    question: "Will Bitcoin trade at or above 100,000 US dollars before the end of 2024?",
    resolutionCriteria:
      "Resolve YES if a major liquid USD exchange or widely used market index shows Bitcoin trading at or above $100,000 at any time through 2024-12-31 23:59 UTC.",
    presentDate: "2024-01-20",
    cutoffDate: "2024-12-31",
    resolved: true,
    background:
      "This is a retrospective market forecast benchmark. Use only evidence available on the present date.",
    fixedEvidence:
      "As of 2024-01-20, US spot Bitcoin ETFs had recently been approved and begun trading. Bitcoin was far below $100,000 but had rallied strongly in 2023. The next Bitcoin halving was expected in April 2024. Crypto markets had a history of extreme boom-bust cycles, reflexive flows, and large drawdowns after sharp rallies.",
  },
  {
    id: "boj-end-negative-rates-mar-2024",
    question: "Will the Bank of Japan end its negative interest rate policy by 2024-03-31?",
    resolutionCriteria:
      "Resolve YES if the Bank of Japan raises its short-term policy rate target to zero or above on or before 2024-03-31.",
    presentDate: "2024-01-10",
    cutoffDate: "2024-03-31",
    resolved: true,
    background:
      "This benchmark concerns a central-bank policy change and should be judged from the evidence available in early January 2024.",
    fixedEvidence:
      "As of 2024-01-10, the Bank of Japan still maintained a negative short-term policy rate. Japanese inflation had run above target for an extended period, wage negotiations were being watched closely, and officials had signaled that sustainable wage growth was a key condition for policy normalization. Markets debated whether the first hike would come in the first half of 2024.",
  },
  {
    id: "china-invades-taiwan-2024",
    question: "Will China launch a full-scale amphibious invasion of Taiwan before the end of 2024?",
    resolutionCriteria:
      "Resolve YES only if the People's Republic of China starts a large-scale military operation to seize and occupy Taiwan's main island by 2024-12-31. Blockades, exercises, cyberattacks, air incursions, or limited clashes alone do not count.",
    presentDate: "2024-01-15",
    cutoffDate: "2024-12-31",
    resolved: false,
    background:
      "This is a retrospective geopolitical benchmark. The resolution threshold is intentionally high.",
    fixedEvidence:
      "As of 2024-01-15, Taiwan had just held its presidential election. China objected to Taiwan's ruling-party politics and regularly conducted military pressure campaigns. A full-scale amphibious invasion would be extraordinarily costly, risky, visible in preparation, and likely provoke severe international consequences. Analysts generally treated near-term invasion risk as nonzero but low compared with lower-intensity coercion.",
  },
  {
    id: "apple-car-2024",
    question: "Will Apple release a consumer Apple-branded car before the end of 2024?",
    resolutionCriteria:
      "Resolve YES only if Apple commercially releases or begins customer deliveries of a consumer passenger car under Apple branding by 2024-12-31.",
    presentDate: "2024-01-15",
    cutoffDate: "2024-12-31",
    resolved: false,
    background:
      "This benchmark tests resistance to hype around a long-rumored product.",
    fixedEvidence:
      "As of 2024-01-15, Apple had long been rumored to work on an automotive project, but it had not publicly announced a car product, model, price, production partner, regulatory approvals, or customer delivery timeline. Car manufacturing requires long lead times, supply chains, crash testing, service infrastructure, and regulatory approval. Apple had historically kept products secret, but a 2024 customer car release would require substantial late-stage industrial evidence.",
  },
  {
    id: "cybertruck-100k-2024",
    question: "Will Tesla deliver at least 100,000 Cybertrucks during calendar year 2024?",
    resolutionCriteria:
      "Resolve YES if Tesla delivers 100,000 or more Cybertrucks to customers from 2024-01-01 through 2024-12-31.",
    presentDate: "2024-01-15",
    cutoffDate: "2024-12-31",
    resolved: false,
    background:
      "This benchmark tests production ramp forecasting for a difficult new vehicle.",
    fixedEvidence:
      "As of 2024-01-15, Tesla had begun Cybertruck deliveries only recently, with limited initial production. The Cybertruck used unusual materials and manufacturing processes, and Tesla executives had warned the ramp would be hard. Tesla had a history of eventually scaling production, but early ramps for new models often took many quarters. Public delivery counts for Cybertruck were not yet established.",
  },
  {
    id: "us-unemployment-5-dec-2024",
    question: "Will the US unemployment rate be at least 5.0% in December 2024?",
    resolutionCriteria:
      "Resolve YES if the official US BLS unemployment rate for December 2024 is 5.0% or higher in the initially released monthly Employment Situation report.",
    presentDate: "2024-01-15",
    cutoffDate: "2025-01-15",
    resolved: false,
    background:
      "This benchmark concerns macroeconomic recession/labor-market forecasting from early 2024 evidence.",
    fixedEvidence:
      "As of 2024-01-15, the US unemployment rate was below 4%. Inflation had eased, growth had remained resilient, and recession forecasts from 2023 had been repeatedly delayed or revised. Monetary policy was restrictive and could weaken labor demand with a lag. A rise to at least 5.0% by December would require a material labor-market deterioration within the year.",
  },
  {
    id: "fed-cut-by-mar-2024",
    question: "Will the US Federal Reserve cut the federal funds target range by 2024-03-31?",
    resolutionCriteria:
      "Resolve YES if the FOMC announces any reduction in the target federal funds range on or before 2024-03-31.",
    presentDate: "2024-01-15",
    cutoffDate: "2024-03-31",
    resolved: false,
    background:
      "This benchmark tests whether the workflow distinguishes likely-in-2024 from likely-by-the-first-quarter timing.",
    fixedEvidence:
      "As of 2024-01-15, inflation had declined from its peak but remained above target. The target federal funds range was 5.25%-5.50%. Markets debated early cuts, but Fed officials emphasized data dependence and caution. There were FOMC meetings scheduled before the end of March, but policymakers had not committed to a near-term cut.",
  },
];

const args = parseArgs(process.argv.slice(2));
const root = process.cwd();
const label = String(args.label ?? `benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const limit = args.limit ? Number(args.limit) : undefined;
const selectedCaseId = args.case ? String(args.case) : undefined;
const timeoutMs = args.timeoutMs ? Number(args.timeoutMs) : 20 * 60 * 1000;
const pollMs = args.pollMs ? Number(args.pollMs) : 5_000;
const concurrency = Math.max(1, Number(args.concurrency ?? 1));

const selectedCases = benchmarkCases
  .filter((benchmarkCase) => !selectedCaseId || benchmarkCase.id === selectedCaseId)
  .slice(0, limit ?? benchmarkCases.length);

if (selectedCases.length === 0) {
  throw new Error(`No benchmark cases selected. case=${selectedCaseId ?? "(none)"}`);
}

const results = await runPool(selectedCases, concurrency, runCase);
const summary = summarize(results);
const outputDir = resolve(root, "data/evals/binary-forecast-benchmarks", safeId(label));
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "results.json"), `${JSON.stringify({ label, summary, results }, null, 2)}\n`);
await writeFile(resolve(outputDir, "report.md"), renderMarkdown(label, summary, results));

console.log(JSON.stringify({ label, outputDir, summary, results }, null, 2));

async function runCase(benchmarkCase: BenchmarkCase): Promise<CaseResult> {
  const runId = makeRunId(label, benchmarkCase.id);
  console.error(`Launching ${benchmarkCase.id} as ${runId}`);
  await launchSmithersDetached({
    workflowPath,
    runId,
    root,
    input: {
      question: benchmarkCase.question,
      resolutionCriteria: benchmarkCase.resolutionCriteria,
      background: benchmarkCase.background,
      fixedEvidence: benchmarkCase.fixedEvidence,
      presentDate: benchmarkCase.presentDate,
      cutoffDate: benchmarkCase.cutoffDate,
    },
  });

  await waitForRun(runId);
  const rawOutput = await readSmithersNodeOutput<AggregateOutput>(runId, "aggregate", root);
  const aggregate = unwrapAggregate(rawOutput);
  const probability = Number(aggregate.probability);

  if (!Number.isFinite(probability)) {
    throw new Error(`Run ${runId} did not produce a numeric probability: ${JSON.stringify(rawOutput)}`);
  }

  const score = scoreBinaryForecast({ probability, resolved: benchmarkCase.resolved });
  return {
    id: benchmarkCase.id,
    runId,
    question: benchmarkCase.question,
    resolved: benchmarkCase.resolved,
    probability,
    method: getString(aggregate, "method"),
    attemptCount: getNumberOrNull(aggregate, "attemptCount", "attempt_count"),
    brier: score.brier,
    log: score.log,
  };
}

async function waitForRun(runId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const inspected = await inspectSmithersRun(runId, root);
      const status = String(inspected.run?.status ?? inspected.runState?.state ?? "").toLowerCase();

      if (["completed", "complete", "finished", "succeeded", "success", "done"].includes(status)) {
        return;
      }

      if (["failed", "error", "cancelled", "canceled"].includes(status)) {
        throw new Error(`Run ${runId} ended with status ${status}`);
      }

      console.error(`Waiting for ${runId}; status=${status || "unknown"}`);
    } catch (error) {
      if (String(error).includes("ended with status")) {
        throw error;
      }
      console.error(`Waiting for ${runId}; inspect not ready: ${error instanceof Error ? error.message : String(error)}`);
    }

    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for ${runId} after ${timeoutMs}ms`);
}

async function runPool<T, R>(
  items: T[],
  poolSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(poolSize, items.length) }, runWorker));
  return results;
}

function summarize(results: CaseResult[]) {
  const meanBrier = mean(results.map((result) => result.brier));
  const meanLog = mean(results.map((result) => result.log));
  const trueCases = results.filter((result) => result.resolved);
  const falseCases = results.filter((result) => !result.resolved);

  return {
    caseCount: results.length,
    meanBrier,
    meanLog,
    trueMeanProbability: mean(trueCases.map((result) => result.probability)),
    falseMeanProbability: mean(falseCases.map((result) => result.probability)),
  };
}

function renderMarkdown(labelValue: string, summary: ReturnType<typeof summarize>, results: CaseResult[]) {
  const lines = [
    `# Binary Forecast Benchmark: ${labelValue}`,
    "",
    `- Cases: ${summary.caseCount}`,
    `- Mean Brier: ${formatNumber(summary.meanBrier)}`,
    `- Mean log loss: ${formatNumber(summary.meanLog)}`,
    `- Mean probability on true cases: ${formatNumber(summary.trueMeanProbability)}%`,
    `- Mean probability on false cases: ${formatNumber(summary.falseMeanProbability)}%`,
    "",
    "| Case | Resolved | Probability | Brier | Log loss | Attempts | Method | Run |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ...results.map((result) => [
      result.id,
      result.resolved ? "YES" : "NO",
      `${formatNumber(result.probability)}%`,
      formatNumber(result.brier),
      formatNumber(result.log),
      result.attemptCount ?? "",
      result.method,
      result.runId,
    ].join(" | ")).map((row) => `| ${row} |`),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function unwrapAggregate(output: AggregateOutput): AggregateOutput {
  if (Array.isArray(output)) {
    return unwrapAggregate(output[output.length - 1] as AggregateOutput);
  }

  if (output && typeof output === "object" && "output" in output) {
    return unwrapAggregate((output as { output: AggregateOutput }).output);
  }

  return output;
}

function getString(output: AggregateOutput, ...keys: string[]) {
  for (const key of keys) {
    const value = output[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function getNumberOrNull(output: AggregateOutput, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(output[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(4).replace(/\.?0+$/, "") : "n/a";
}

function makeRunId(labelValue: string, caseId: string) {
  const suffix = Date.now().toString(36);
  return `bench-${safeId(labelValue).slice(0, 14)}-${safeId(caseId).slice(0, 28)}-${suffix}`.slice(0, 63);
}

function safeId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseArgs(rawArgs: string[]) {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const raw = rawArgs[index];
    if (!raw.startsWith("--")) {
      continue;
    }

    const withoutPrefix = raw.slice(2);
    const [key, inlineValue] = withoutPrefix.split("=", 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }

    const next = rawArgs[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}
