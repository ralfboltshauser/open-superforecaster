import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { scoreBinaryForecast } from "../packages/evals/src/index";
import { inspectSmithersRun, launchSmithersDetached, readSmithersNodeOutput } from "../packages/backend/src/index";

type BenchmarkCase = {
  externalId: string;
  question: string;
  resolutionCriteria: string;
  presentDate: string;
  cutoffDate: string;
  fixedEvidence: string;
  baselineProbability: number;
  resolved: boolean;
  resolutionNote: string;
};

type Args = {
  dryRun: boolean;
  label: string;
  limit: number | null;
  caseIds: string[];
  timeoutMs: number;
  pollMs: number;
  outputDir: string;
  continueOnError: boolean;
};

type CaseReport = {
  externalId: string;
  runId: string;
  status: "completed" | "failed" | "planned";
  question: string;
  resolved: boolean;
  baselineProbability: number;
  probability: number | null;
  brier: number | null;
  log: number | null;
  baselineBrier: number;
  baselineLog: number;
  baselineDeltaBrier: number | null;
  output: Record<string, unknown> | null;
  attempts: Array<Record<string, unknown>>;
  error: string | null;
};

class CaseRunError extends Error {
  constructor(
    message: string,
    readonly runId: string,
  ) {
    super(message);
    this.name = "CaseRunError";
  }
}

const root = resolve(import.meta.dir, "..");
const workflowPath = ".smithers/workflows/binary-forecast.tsx";
const cases: BenchmarkCase[] = [
  {
    externalId: "fixed-spacex-2024-100",
    question: "As of January 1, 2024, will SpaceX conduct at least 100 orbital launches in calendar year 2024?",
    resolutionCriteria: "Resolve true if SpaceX completed 100 or more orbital launches between 2024-01-01 and 2024-12-31 UTC.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "SpaceX completed 96 orbital launches in 2023 after 61 in 2022 and 31 in 2021. Most launches were Falcon 9 missions supporting Starlink. The company had publicly discussed very high launch cadence ambitions, and operational cadence was already near twice weekly by late 2023. Main risks were Falcon 9 grounding, range constraints, weather, pad limits, customer delays, and transition attention toward Starship. The threshold of 100 launches required only modest growth from 2023, but still required sustaining record cadence for another year.",
    baselineProbability: 74,
    resolved: true,
    resolutionNote: "SpaceX completed more than 100 orbital launches in 2024.",
  },
  {
    externalId: "fixed-uk-election-2024",
    question: "As of January 1, 2024, will the United Kingdom hold a general election in calendar year 2024?",
    resolutionCriteria: "Resolve true if a UK general election polling day occurred from 2024-01-01 through 2024-12-31.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "The UK Parliament elected in December 2019 had to face another general election by January 2025 under maximum term rules. The governing Conservatives were trailing Labour by a large margin in late-2023 polling. Prime Minister Rishi Sunak had discretion over election timing within the legal window. A 2024 election was broadly expected because waiting until January 2025 would leave little flexibility and could be politically risky. Possible months included spring, autumn, or very late 2024. A non-2024 outcome required using the latest possible timetable.",
    baselineProbability: 86,
    resolved: true,
    resolutionNote: "The UK general election polling day was 2024-07-04.",
  },
  {
    externalId: "fixed-foldable-iphone-2025",
    question: "As of January 1, 2025, will Apple release a foldable iPhone before January 1, 2026?",
    resolutionCriteria: "Resolve true only if Apple publicly released an iPhone model with a foldable display before 2026-01-01.",
    presentDate: "2025-01-01",
    cutoffDate: "2025-01-01",
    fixedEvidence:
      "By early 2025 Apple had not announced a foldable iPhone. Foldable phones had existed commercially for years, led by Samsung and Chinese vendors, but Apple had repeatedly delayed or avoided entering the category. Rumors and analyst notes pointed to exploratory work on foldable displays and hinges, with many reports discussing 2026 or later as a more plausible first launch window. Apple tends to wait for mature hardware categories and prioritizes display durability, crease quality, software polish, and margins. A release before January 2026 would require announcement and sale during the 2025 product cycle, despite no firm public launch signal at the start of 2025.",
    baselineProbability: 18,
    resolved: false,
    resolutionNote: "No foldable iPhone had been released before 2026-01-01.",
  },
  {
    externalId: "fixed-fed-cut-2024",
    question: "As of January 1, 2024, will the US Federal Reserve cut the federal funds target range at least once in calendar year 2024?",
    resolutionCriteria: "Resolve true if the FOMC lowered the federal funds target range at any scheduled or unscheduled meeting from 2024-01-01 through 2024-12-31.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "The federal funds target range was 5.25% to 5.50% after an aggressive 2022-2023 hiking cycle. Inflation had declined substantially from its 2022 peak but remained above the 2% target. December 2023 FOMC projections implied multiple rate cuts during 2024 if inflation kept cooling. Labor markets were still resilient, creating uncertainty about timing. Holding rates all year was possible if inflation reaccelerated, but market pricing and Fed communications had shifted toward cuts as a plausible base case.",
    baselineProbability: 78,
    resolved: true,
    resolutionNote: "The FOMC cut rates in September 2024 and again later in 2024.",
  },
  {
    externalId: "fixed-bitcoin-100k-2024",
    question: "As of January 1, 2024, will Bitcoin trade above $100,000 at any time before January 1, 2025?",
    resolutionCriteria: "Resolve true if a major USD spot market price for Bitcoin exceeded $100,000 before 2025-01-01.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "Bitcoin began 2024 near the mid-$40,000s after a strong 2023 recovery. US spot Bitcoin ETF approvals were widely anticipated but not yet complete. Bitcoin's next halving was expected in April 2024. Previous cycles had seen large post-halving and liquidity-driven rallies, but drawdowns and failed breakouts were common. A move above $100,000 required more than doubling from the start of the year, likely needing ETF inflows, macro support, and sustained risk appetite.",
    baselineProbability: 35,
    resolved: true,
    resolutionNote: "Bitcoin traded above $100,000 in December 2024.",
  },
  {
    externalId: "fixed-starliner-crew-return-2024",
    question: "As of January 1, 2024, will Boeing Starliner's first crewed flight return its crew to Earth before January 1, 2025?",
    resolutionCriteria: "Resolve true if Boeing Starliner's first crewed flight launched with astronauts and returned those astronauts to Earth before 2025-01-01.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "Boeing Starliner's crewed flight test had been delayed for years by software, valve, parachute, and certification issues. As of early 2024 NASA and Boeing were targeting a 2024 crewed launch to the ISS. The program had strong institutional pressure to complete certification, and most public planning assumed a crewed test would launch and return after a short mission. However, Starliner had accumulated technical surprises, and crew safety constraints could force schedule slips or altered return plans.",
    baselineProbability: 62,
    resolved: false,
    resolutionNote: "Starliner launched crew in 2024 but returned uncrewed; the astronauts did not return on Starliner before 2025-01-01.",
  },
  {
    externalId: "fixed-gpt5-2024",
    question: "As of January 1, 2024, will OpenAI publicly release a model called GPT-5 before January 1, 2025?",
    resolutionCriteria: "Resolve true only if OpenAI publicly released a generally available model explicitly called GPT-5 before 2025-01-01.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "GPT-4 had been released in March 2023, followed by GPT-4 Turbo later in 2023. OpenAI leadership discussed continued frontier model development but had not announced GPT-5 timing. Training, safety evaluation, productization, and regulatory scrutiny could delay a named successor. OpenAI also had incentives to release intermediate models and product updates without branding them GPT-5. A 2024 release was plausible but not clearly scheduled.",
    baselineProbability: 32,
    resolved: false,
    resolutionNote: "OpenAI did not publicly release a model called GPT-5 before 2025-01-01.",
  },
  {
    externalId: "fixed-tesla-2m-deliveries-2024",
    question: "As of January 1, 2024, will Tesla deliver more than 2 million vehicles in calendar year 2024?",
    resolutionCriteria: "Resolve true if Tesla reported more than 2,000,000 vehicle deliveries for calendar year 2024.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "Tesla delivered about 1.81 million vehicles in 2023 after several years of rapid growth. Reaching more than 2 million in 2024 required roughly 10% growth. Demand concerns, price cuts, high interest rates, and increasing EV competition were visible risks. The Model Y was strong, Cybertruck was beginning production but not expected to contribute huge volume immediately, and no new mass-market platform was ready. Manufacturing capacity existed, but demand and margin management were the central uncertainty.",
    baselineProbability: 48,
    resolved: false,
    resolutionNote: "Tesla reported fewer than 2 million vehicle deliveries in calendar year 2024.",
  },
  {
    externalId: "fixed-eu-ai-act-h1-2024",
    question: "As of January 1, 2024, will the European Union formally adopt the AI Act before July 1, 2024?",
    resolutionCriteria: "Resolve true if the EU AI Act received final formal adoption by EU institutions before 2024-07-01.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "EU negotiators reached a provisional political agreement on the AI Act in December 2023 after intensive trilogue negotiations. Formal legal-linguistic work, committee votes, Parliament approval, and Council adoption still had to occur. The file was politically salient and broadly expected to finish during the current institutional cycle, though lobbying and implementation details could cause delay. Formal adoption before July 2024 required the remaining procedural steps to proceed without major reopening.",
    baselineProbability: 82,
    resolved: true,
    resolutionNote: "The EU AI Act was formally adopted before 2024-07-01.",
  },
  {
    externalId: "fixed-us-mens-basketball-gold-2024",
    question: "As of January 1, 2024, will the United States win the men's basketball gold medal at the Paris 2024 Olympics?",
    resolutionCriteria: "Resolve true if the United States men's basketball team won the gold medal at the Paris 2024 Olympic Games.",
    presentDate: "2024-01-01",
    cutoffDate: "2024-01-01",
    fixedEvidence:
      "The United States had won men's Olympic basketball gold in 2008, 2012, 2016, and 2020. The talent pool remained the deepest in the world, but recent FIBA tournaments showed increased international parity and vulnerability when top US stars did not play. France, Serbia, Canada, Germany, and others had NBA-level talent. US gold probability depended heavily on roster commitment, health, and single-elimination variance. Early signals suggested a star-heavy US roster was likely for Paris after disappointment at the 2023 World Cup.",
    baselineProbability: 68,
    resolved: true,
    resolutionNote: "The United States won men's basketball gold at the Paris 2024 Olympics.",
  },
];

const args = parseArgs(Bun.argv.slice(2));
const selectedCases = selectCases(cases, args);
const startedAt = new Date();
const runLabel = args.label || timestampLabel(startedAt);

if (selectedCases.length === 0) {
  throw new Error("No benchmark cases selected.");
}

console.log(`${args.dryRun ? "Planning" : "Running"} binary-forecast benchmark: ${selectedCases.length} case(s), label=${runLabel}`);

const reports: CaseReport[] = [];
for (const benchmarkCase of selectedCases) {
  if (args.dryRun) {
    reports.push(plannedReport(benchmarkCase, runLabel));
    continue;
  }

  try {
    reports.push(await runCase(benchmarkCase, runLabel));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const runId = error instanceof CaseRunError ? error.runId : `failed-${slug(runLabel)}-${slug(benchmarkCase.externalId)}`;
    reports.push(failedReport(benchmarkCase, runId, message));
    if (!args.continueOnError) {
      break;
    }
  }
}

const summary = summarize(reports);
const report = {
  benchmarkType: "binary-forecast-fixed-evidence",
  workflowPath,
  label: runLabel,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  dryRun: args.dryRun,
  summary,
  cases: reports,
};

await mkdir(resolve(root, args.outputDir), { recursive: true });
const reportPath = resolve(root, args.outputDir, `${runLabel}.json`);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${reportPath}`);
console.log(JSON.stringify(summary, null, 2));

async function runCase(benchmarkCase: BenchmarkCase, label: string): Promise<CaseReport> {
  const runId = `osf-bb-${slug(label).slice(0, 12)}-${slug(benchmarkCase.externalId).slice(0, 32)}-${randomUUID().slice(0, 8)}`;
  console.log(`CASE ${benchmarkCase.externalId}: launch ${runId}`);
  try {
    await launchSmithersDetached({
      root,
      workflowPath,
      runId,
      input: {
        source: "binary-forecast-fixed-evidence-benchmark",
        benchmarkCaseId: benchmarkCase.externalId,
        question: benchmarkCase.question,
        resolutionCriteria: benchmarkCase.resolutionCriteria,
        presentDate: benchmarkCase.presentDate,
        cutoffDate: benchmarkCase.cutoffDate,
        fixedEvidence: benchmarkCase.fixedEvidence,
        background: fixedEvidenceBackground(benchmarkCase),
      },
    });

    await waitForRun(runId);
    const output = await readSmithersNodeOutput<Record<string, unknown>>(runId, "aggregate", root);
    const attempts = await readAttempts(runId);
    return completedReport(benchmarkCase, runId, output, attempts);
  } catch (error) {
    throw new CaseRunError(error instanceof Error ? error.message : String(error), runId);
  }
}

async function waitForRun(runId: string) {
  const deadline = Date.now() + args.timeoutMs;
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    let inspect;
    try {
      inspect = await inspectSmithersRun(runId, root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("RUN_NOT_FOUND") || message.includes("Run not found")) {
        lastStatus = "waiting_for_smithers_state";
        await sleep(args.pollMs);
        continue;
      }
      throw error;
    }
    lastStatus = inspect.runState?.state ?? inspect.run?.status ?? "unknown";
    if (inspect.run?.status === "finished" || inspect.runState?.state === "succeeded") {
      return;
    }
    if (inspect.run?.status === "failed" || inspect.runState?.state === "failed") {
      throw new Error(`Smithers run ${runId} failed.`);
    }
    await sleep(args.pollMs);
  }
  throw new Error(`Smithers run ${runId} timed out after ${args.timeoutMs}ms; latest status=${lastStatus}`);
}

async function readAttempts(runId: string) {
  const nodeIds = ["attempt-base-rate", "attempt-inside-view", "attempt-skeptic"];
  const attempts = [];
  for (const nodeId of nodeIds) {
    try {
      attempts.push(await readSmithersNodeOutput<Record<string, unknown>>(runId, nodeId, root));
    } catch {
      // Keep the aggregate score usable even if a renamed attempt node is absent.
    }
  }
  return attempts;
}

function completedReport(
  benchmarkCase: BenchmarkCase,
  runId: string,
  output: Record<string, unknown>,
  attempts: Array<Record<string, unknown>>,
): CaseReport {
  const probability = readProbability(output);
  const scores = probability === null ? null : scoreBinaryForecast({ probability, resolved: benchmarkCase.resolved });
  const baselineScores = scoreBinaryForecast({
    probability: benchmarkCase.baselineProbability,
    resolved: benchmarkCase.resolved,
  });
  return {
    externalId: benchmarkCase.externalId,
    runId,
    status: "completed",
    question: benchmarkCase.question,
    resolved: benchmarkCase.resolved,
    baselineProbability: benchmarkCase.baselineProbability,
    probability,
    brier: scores?.brier ?? null,
    log: scores?.log ?? null,
    baselineBrier: baselineScores.brier,
    baselineLog: baselineScores.log,
    baselineDeltaBrier: scores ? scores.brier - baselineScores.brier : null,
    output,
    attempts,
    error: probability === null ? "missing_probability" : null,
  };
}

function plannedReport(benchmarkCase: BenchmarkCase, label: string): CaseReport {
  const baselineScores = scoreBinaryForecast({
    probability: benchmarkCase.baselineProbability,
    resolved: benchmarkCase.resolved,
  });
  return {
    externalId: benchmarkCase.externalId,
    runId: `planned-${slug(label)}-${slug(benchmarkCase.externalId)}`,
    status: "planned",
    question: benchmarkCase.question,
    resolved: benchmarkCase.resolved,
    baselineProbability: benchmarkCase.baselineProbability,
    probability: null,
    brier: null,
    log: null,
    baselineBrier: baselineScores.brier,
    baselineLog: baselineScores.log,
    baselineDeltaBrier: null,
    output: null,
    attempts: [],
    error: null,
  };
}

function failedReport(benchmarkCase: BenchmarkCase, runId: string, error: string): CaseReport {
  const baselineScores = scoreBinaryForecast({
    probability: benchmarkCase.baselineProbability,
    resolved: benchmarkCase.resolved,
  });
  return {
    externalId: benchmarkCase.externalId,
    runId,
    status: "failed",
    question: benchmarkCase.question,
    resolved: benchmarkCase.resolved,
    baselineProbability: benchmarkCase.baselineProbability,
    probability: null,
    brier: null,
    log: null,
    baselineBrier: baselineScores.brier,
    baselineLog: baselineScores.log,
    baselineDeltaBrier: null,
    output: null,
    attempts: [],
    error,
  };
}

function summarize(reports: CaseReport[]) {
  const completed = reports.filter((report) => report.status === "completed" && report.brier !== null && report.log !== null);
  const baselineCompleted = reports.filter((report) => report.status !== "failed");
  return {
    caseCount: reports.length,
    completedCases: completed.length,
    failedCases: reports.filter((report) => report.status === "failed").length,
    meanBrier: mean(completed.map((report) => report.brier)),
    meanLog: mean(completed.map((report) => report.log)),
    meanBaselineBrier: mean(baselineCompleted.map((report) => report.baselineBrier)),
    meanBaselineLog: mean(baselineCompleted.map((report) => report.baselineLog)),
    meanBaselineDeltaBrier: mean(completed.map((report) => report.baselineDeltaBrier)),
    casesBetterThanBaseline: completed.filter((report) => typeof report.baselineDeltaBrier === "number" && report.baselineDeltaBrier < 0).length,
    casesWorseThanBaseline: completed.filter((report) => typeof report.baselineDeltaBrier === "number" && report.baselineDeltaBrier > 0).length,
  };
}

function fixedEvidenceBackground(benchmarkCase: BenchmarkCase) {
  return [
    "Benchmark fixed-evidence mode for a binary forecast workflow.",
    "Use only the evidence packet below. Do not use web search, file reads, shell commands, memory, or external information.",
    `Assume the present date is ${benchmarkCase.presentDate}; no information after cutoff ${benchmarkCase.cutoffDate} is available.`,
    "The resolution is intentionally hidden from the forecasting workflow.",
    "",
    "Fixed evidence packet:",
    benchmarkCase.fixedEvidence,
  ].join("\n");
}

function parseArgs(values: string[]): Args {
  return {
    dryRun: values.includes("--dry-run"),
    label: readArgValue(values, "--label") ?? "",
    limit: readNumberArg(values, "--limit"),
    caseIds: readArgValues(values, "--case"),
    timeoutMs: readNumberArg(values, "--timeout-ms") ?? 20 * 60 * 1000,
    pollMs: readNumberArg(values, "--poll-ms") ?? 5_000,
    outputDir: readArgValue(values, "--output-dir") ?? "data/benchmarks/binary-forecast",
    continueOnError: values.includes("--continue-on-error"),
  };
}

function selectCases(allCases: BenchmarkCase[], input: Args) {
  const filtered = input.caseIds.length
    ? allCases.filter((benchmarkCase) => input.caseIds.includes(benchmarkCase.externalId))
    : allCases;
  return input.limit === null ? filtered : filtered.slice(0, input.limit);
}

function readArgValue(values: string[], key: string) {
  const index = values.indexOf(key);
  return index === -1 ? null : values[index + 1] ?? null;
}

function readArgValues(values: string[], key: string) {
  const results: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === key && values[index + 1]) {
      results.push(values[index + 1]);
    }
  }
  return results;
}

function readNumberArg(values: string[], key: string) {
  const raw = readArgValue(values, key);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readProbability(output: Record<string, unknown>) {
  const value = output.probability;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values: Array<number | null>) {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) {
    return null;
  }
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
}

function timestampLabel(date: Date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
