export type EducationOption = {
  label: string
  explanation: string
}

export type EducationExercise = {
  prompt: string
  options: readonly EducationOption[]
  correctIndex: number
}

export type OnboardingStep = {
  id: string
  number: string
  eyebrow: string
  title: string
  summary: string
  principles: readonly string[]
  fieldNote: {
    label: string
    title: string
    body: string
  }
  exercise: EducationExercise
}

export type CourseLesson = {
  id: string
  chapter: string
  duration: string
  title: string
  promise: string
  mentalModel: string
  concepts: readonly {
    title: string
    body: string
  }[]
  workedExample: {
    question: string
    steps: readonly string[]
    conclusion: string
  }
  exercise: EducationExercise
  fieldChecklist: readonly string[]
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "bounded-foresight",
    number: "01",
    eyebrow: "Start with the boundary",
    title: "A forecast is a disciplined estimate, not a prophecy.",
    summary:
      "Forecasting works best on specific, resolvable events over bounded horizons. Some prompts need research or scenarios before they deserve a probability.",
    principles: [
      "Forecasts estimate an outcome under a named information boundary.",
      "Research asks what is true; forecasting asks what will happen.",
      "Decisions add goals, costs, and consequences after the probability is estimated.",
    ],
    fieldNote: {
      label: "The optimistic skeptic",
      title: "The future is partly predictable.",
      body: "Reject both extremes: perfect foresight is impossible, but careful estimates can still beat vague intuition on well-formed questions.",
    },
    exercise: {
      prompt: "Which request is ready for a probability forecast?",
      correctIndex: 1,
      options: [
        {
          label: "How will artificial intelligence change society?",
          explanation: "This is valuable scenario analysis, but it has no single outcome, horizon, or resolution rule.",
        },
        {
          label: "Will the EU AI Act general-purpose AI code be published by 31 December 2026, according to the European Commission?",
          explanation: "This names an event, a deadline, and an authoritative resolver. Edge cases can now be made explicit.",
        },
        {
          label: "Should my company hire more engineers?",
          explanation: "This is a decision. It needs forecasts, but also costs, goals, and alternatives.",
        },
      ],
    },
  },
  {
    id: "question-contract",
    number: "02",
    eyebrow: "Make the target exact",
    title: "Write a contract two independent resolvers would interpret the same way.",
    summary:
      "A good question fixes the target before anyone researches it. Precise boundaries prevent hindsight from quietly changing what was predicted.",
    principles: [
      "Name the outcome, deadline, timezone, and authoritative source.",
      "Operationalize vague words such as comparable, significant, or launched.",
      "State postponement, cancellation, and unavailable-data rules when they matter.",
    ],
    fieldNote: {
      label: "Resolution contract",
      title: "Wording is part of the measurement.",
      body: "If reasonable people can disagree about the final outcome after reading the rules, the forecast cannot be scored cleanly.",
    },
    exercise: {
      prompt: "What is the most important missing element in: “Will Model X beat Model Y this year?”",
      correctIndex: 2,
      options: [
        {
          label: "A longer explanation of why Model X is impressive",
          explanation: "Background may help research, but it does not define the outcome.",
        },
        {
          label: "The forecaster’s confidence in their analysis",
          explanation: "Confidence in reasoning is different from defining what counts as winning.",
        },
        {
          label: "A named benchmark, score rule, deadline, and source",
          explanation: "These turn “beat” and “this year” into a resolvable measurement contract.",
        },
      ],
    },
  },
  {
    id: "probability-language",
    number: "03",
    eyebrow: "Think in probabilities",
    title: "Seventy percent is not a promise that this event will happen.",
    summary:
      "A probability describes uncertainty across comparable forecasts. Calibration can only be judged over a track record, never from one dramatic result.",
    principles: [
      "A well-made 70% forecast should still be wrong roughly three times in ten.",
      "Event probability and confidence in the quality of your reasoning are separate.",
      "Useful forecasts both calibrate and distinguish more-likely from less-likely events.",
    ],
    fieldNote: {
      label: "Keep score fairly",
      title: "Outcome is not process quality.",
      body: "A 20% event sometimes happens. That does not prove the forecast was foolish; only a repeated, properly scored record can tell us.",
    },
    exercise: {
      prompt: "Ten genuinely similar events were each forecast at 70%. What result is most consistent with good calibration?",
      correctIndex: 1,
      options: [
        {
          label: "All ten happen",
          explanation: "Possible, but not the long-run pattern implied by 70%.",
        },
        {
          label: "About seven happen",
          explanation: "Calibration means observed frequencies roughly match stated probabilities across enough comparable cases.",
        },
        {
          label: "Exactly five happen",
          explanation: "That would trend below the stated probability if repeated over a larger sample.",
        },
      ],
    },
  },
  {
    id: "outside-inside",
    number: "04",
    eyebrow: "Anchor, then adjust",
    title: "Start outside the story before moving inside the case.",
    summary:
      "Reference classes stop a vivid narrative from becoming the entire forecast. Begin with comparable cases, then adjust for concrete differences in the present one.",
    principles: [
      "Ask how often similar events happen before studying this case’s special story.",
      "Use more than one plausible reference class when the analogy is fragile.",
      "Make each adjustment directional and tied to evidence.",
    ],
    fieldNote: {
      label: "Outside + inside view",
      title: "Base rates are anchors, not handcuffs.",
      body: "The right forecast rarely stops at the base rate. It explains why current evidence should move above or below it—and by how much.",
    },
    exercise: {
      prompt: "A startup says its product will launch on time. What should you examine first?",
      correctIndex: 0,
      options: [
        {
          label: "The on-time rate for comparable launches",
          explanation: "This establishes an outside-view anchor before the startup’s own narrative influences you.",
        },
        {
          label: "The founder’s confidence and charisma",
          explanation: "These are vivid but weakly diagnostic unless tied to a measured reference class.",
        },
        {
          label: "The most exciting feature in the launch",
          explanation: "Product appeal does not directly answer whether delivery will be on time.",
        },
      ],
    },
  },
  {
    id: "decompose-opposition",
    number: "05",
    eyebrow: "See the moving parts",
    title: "Break the problem apart—and make the opposite case strong.",
    summary:
      "Decomposition makes a hard question tractable. Premortems and opposing arguments expose assumptions that a coherent story would otherwise hide.",
    principles: [
      "Map actors, incentives, constraints, pathways, and timing.",
      "Do not multiply branches as if they were independent when they share a cause.",
      "Ask: if I am wrong, what is the most likely reason I missed?",
    ],
    fieldNote: {
      label: "Fox-like thinking",
      title: "Use many small models, lightly held.",
      body: "A flexible forecast survives contact with new evidence better than a single grand theory that explains everything after the fact.",
    },
    exercise: {
      prompt: "Which pair is most likely to double-count the same underlying factor?",
      correctIndex: 2,
      options: [
        {
          label: "Regulatory approval and manufacturing readiness",
          explanation: "These can be materially distinct constraints, although their dependence should still be checked.",
        },
        {
          label: "Funding runway and customer demand",
          explanation: "These may interact, but usually represent different evidence streams.",
        },
        {
          label: "Three news articles and the press release they all repeat",
          explanation: "The articles look like multiple sources but inherit the same underlying claim.",
        },
      ],
    },
  },
  {
    id: "diagnostic-updates",
    number: "06",
    eyebrow: "Move for a reason",
    title: "Update in proportion to diagnostic evidence, not drama.",
    summary:
      "Good forecasters change their minds often in small, traceable steps. New information matters when it is more likely under one outcome than another.",
    principles: [
      "Ask what you expected to observe under each outcome before seeing the news.",
      "Repeated coverage of one fact is not repeated independent evidence.",
      "The absence of an expected signal can also justify an update.",
    ],
    fieldNote: {
      label: "Belief updates",
      title: "Every movement should leave a receipt.",
      body: "Record what changed, which factor it affects, the old probability, the new probability, and why that size of movement is justified.",
    },
    exercise: {
      prompt: "Which development should usually move a forecast the most?",
      correctIndex: 1,
      options: [
        {
          label: "Five outlets repeat the same anonymous report",
          explanation: "Volume is not independence. These may all trace back to one uncertain observation.",
        },
        {
          label: "The named resolver publishes primary data that directly tests the key condition",
          explanation: "Primary evidence tied directly to the resolution rule is strongly diagnostic.",
        },
        {
          label: "A prominent commentator expresses strong confidence",
          explanation: "Confidence and status do not automatically make a claim diagnostic.",
        },
      ],
    },
  },
  {
    id: "learning-loop",
    number: "07",
    eyebrow: "Stay in perpetual beta",
    title: "Resolve, score, review, and carry forward only earned lessons.",
    summary:
      "The purpose of a forecast is not to look prescient. It is to create a falsifiable record that makes tomorrow’s reasoning better than today’s.",
    principles: [
      "Freeze your own estimate before seeing the system or crowd forecast.",
      "Review good process with bad outcomes—and bad process with lucky outcomes.",
      "Generalize a lesson only after it helps on later, genuinely new cases.",
    ],
    fieldNote: {
      label: "Deliberate practice",
      title: "A scoreboard is a mirror, not a verdict.",
      body: "Proper scores reveal patterns across time. Postmortems explain which parts of the process are worth changing next.",
    },
    exercise: {
      prompt: "You predicted 30%, the event happened, and your reasoning used a sound base rate and all available evidence. What is the best conclusion?",
      correctIndex: 2,
      options: [
        {
          label: "The forecast was definitely bad because the event happened",
          explanation: "A 30% event is expected to happen sometimes. One outcome cannot establish process quality.",
        },
        {
          label: "Change the original estimate to 70% in the record",
          explanation: "Rewriting the forecast destroys the feedback loop and introduces hindsight bias.",
        },
        {
          label: "Keep the loss, inspect the process, and look for a repeatable error",
          explanation: "The score should remain. Change the method only when the postmortem and later cases support a real lesson.",
        },
      ],
    },
  },
]

export const COURSE_LESSONS: readonly CourseLesson[] = [
  {
    id: "forecastability",
    chapter: "Foundation 01",
    duration: "6 min",
    title: "Forecastability and the optimistic skeptic",
    promise: "Know when to forecast, when to clarify, and when to switch to scenarios.",
    mentalModel: "Forecast the island of order; map scenarios around the fog.",
    concepts: [
      {
        title: "Bound the claim",
        body: "Nearer, observable events with stable resolution rules are generally more forecastable than distant structural transformations.",
      },
      {
        title: "Use the right mode",
        body: "A research request asks for present facts. A forecast asks for a future outcome. A decision adds consequences. Deep uncertainty often calls for scenarios.",
      },
      {
        title: "Allow abstention",
        body: "Refusing false precision is a forecasting skill. Explain which missing boundary or mechanism prevents a useful estimate.",
      },
    ],
    workedExample: {
      question: "Will autonomous vehicles transform cities?",
      steps: [
        "Identify the undefined terms: transform, autonomous vehicles, cities, and horizon.",
        "Select a measurable precursor: commercial driverless passenger rides in a named region.",
        "Add a deadline, data source, and threshold.",
      ],
      conclusion: "The broad prompt becomes scenario context; its measurable precursor becomes the forecast.",
    },
    exercise: {
      prompt: "Which question is least suitable for a single probability?",
      correctIndex: 0,
      options: [
        {
          label: "What will the world economy look like in 2050?",
          explanation: "This contains many possible worlds and no single resolution boundary. Scenario analysis is more honest.",
        },
        {
          label: "Will Swiss annual CPI exceed 2% in December 2026 according to the FSO?",
          explanation: "This has a metric, threshold, period, and authoritative source.",
        },
        {
          label: "Will a named bill pass before the current parliamentary session ends?",
          explanation: "With clear definitions and a named source, this is a bounded event.",
        },
      ],
    },
    fieldChecklist: ["One future target", "Observable outcome", "Appropriate horizon", "Scenarios when precision is false"],
  },
  {
    id: "resolution-contracts",
    chapter: "Foundation 02",
    duration: "8 min",
    title: "Resolution contracts that survive reality",
    promise: "Turn an interesting prompt into a proposition that can be scored without hindsight.",
    mentalModel: "Write the verdict before hearing the case.",
    concepts: [
      {
        title: "Canonical wording",
        body: "Preserve the user’s intent, but freeze one exact proposition for research, forecasting, resolution, and scoring.",
      },
      {
        title: "Edge cases",
        body: "Address postponements, cancellations, revised datasets, unavailable sources, and ambiguous boundary timestamps before forecasting.",
      },
      {
        title: "Type-specific contracts",
        body: "Binary questions need YES/NO boundaries; numeric questions need units and dates; categories must be mutually exclusive and collectively exhaustive.",
      },
    ],
    workedExample: {
      question: "Will a new open model be as good as the best closed model this year?",
      steps: [
        "Replace “as good” with a named benchmark and minimum score difference.",
        "Define open weights and the eligible release date.",
        "Name the benchmark’s official results page and a UTC deadline.",
      ],
      conclusion: "A compelling debate becomes a falsifiable binary question.",
    },
    exercise: {
      prompt: "Two resolvers disagree because one uses revised GDP and one uses the first release. What failed?",
      correctIndex: 1,
      options: [
        {
          label: "The probability needed another decimal place",
          explanation: "Numerical precision cannot repair an ambiguous measurement rule.",
        },
        {
          label: "The contract did not name the data vintage",
          explanation: "The release vintage is part of the outcome definition and must be fixed in advance.",
        },
        {
          label: "The forecasters should have researched longer",
          explanation: "More research cannot tell us which unstated rule should count after the outcome is known.",
        },
      ],
    },
    fieldChecklist: ["Deadline + timezone", "Primary resolver", "Fallback rule", "Operationalized terms", "Annulment policy"],
  },
  {
    id: "probability-calibration",
    chapter: "Judgment 03",
    duration: "7 min",
    title: "Probability, calibration, and resolution",
    promise: "Interpret probabilistic claims without treating uncertainty as error.",
    mentalModel: "Probabilities are promises about frequencies, not individual outcomes.",
    concepts: [
      {
        title: "Calibration",
        body: "Across enough comparable forecasts, events assigned 70% should happen around 70% of the time. One case proves nothing.",
      },
      {
        title: "Resolution and discrimination",
        body: "Always predicting the base rate may calibrate while being unhelpful. Strong forecasts also separate events that happen from those that do not.",
      },
      {
        title: "Granularity without theater",
        body: "Use numbers precise enough to express a real distinction. Do not imply measurement quality the evidence cannot support.",
      },
    ],
    workedExample: {
      question: "A forecaster is 8/10 correct. Are they well calibrated?",
      steps: [
        "Inspect the probabilities, not just accuracy.",
        "Compare results within probability buckets.",
        "Check sample size, question difficulty, and whether cases were selected after the fact.",
      ],
      conclusion: "Accuracy alone cannot diagnose probabilistic forecasting skill.",
    },
    exercise: {
      prompt: "A forecaster assigns 55% to every question and gets 55% correct. What can we say?",
      correctIndex: 2,
      options: [
        {
          label: "They are definitely a superforecaster",
          explanation: "Calibration at one bucket does not establish discrimination, difficulty, or performance against baselines.",
        },
        {
          label: "Their forecasts are useless because 55% is close to 50%",
          explanation: "They may be useful, but we need baseline and resolution comparisons to know.",
        },
        {
          label: "They may be calibrated, but discrimination and baseline skill remain unknown",
          explanation: "This separates reliability from the ability to identify which individual events are more likely.",
        },
      ],
    },
    fieldChecklist: ["Explicit number", "Plain-language interpretation", "No single-case calibration claim", "Baseline comparison"],
  },
  {
    id: "outside-inside-views",
    chapter: "Judgment 04",
    duration: "8 min",
    title: "Reference classes and the inside view",
    promise: "Anchor on what usually happens, then adjust for what is genuinely different.",
    mentalModel: "First ask how this movie usually ends; then inspect this cast and script.",
    concepts: [
      {
        title: "Reference class",
        body: "Choose comparable cases using features known before their outcomes. Record the numerator, denominator, period, and source.",
      },
      {
        title: "Alternative classes",
        body: "Reference-class choice can dominate the answer. Test multiple defensible classes rather than selecting the one that supports your story.",
      },
      {
        title: "Evidence-based adjustment",
        body: "Move from the anchor through explicit factors, including direction, dependence, and approximate magnitude.",
      },
    ],
    workedExample: {
      question: "Will a software migration finish by its announced deadline?",
      steps: [
        "Estimate the on-time rate for comparable migrations.",
        "Adjust for project stage, staffing, dependency readiness, and remaining contingency.",
        "Challenge the class: are announced dates strategic rather than operational?",
      ],
      conclusion: "The final forecast is an auditable adjustment, not a reaction to management confidence.",
    },
    exercise: {
      prompt: "Which reference class is strongest?",
      correctIndex: 1,
      options: [
        {
          label: "Only the three famous successes everyone remembers",
          explanation: "This is selected on outcome and creates survivorship bias.",
        },
        {
          label: "All comparable cases selected by pre-outcome features and a fixed period",
          explanation: "Selection rules known before outcomes make the base rate reproducible and less biased.",
        },
        {
          label: "Whatever class produces the probability closest to your intuition",
          explanation: "That turns the outside view into a justification device rather than an independent anchor.",
        },
      ],
    },
    fieldChecklist: ["Selection rule", "Numerator / denominator", "Alternative class", "Explicit inside-view shifts"],
  },
  {
    id: "decomposition",
    chapter: "Judgment 05",
    duration: "9 min",
    title: "Fermi decomposition and fox-like thinking",
    promise: "Turn intimidating questions into a small number of estimable, causally meaningful parts.",
    mentalModel: "Divide until you can estimate; reconnect before you calculate.",
    concepts: [
      {
        title: "Causal pathways",
        body: "Map actors, incentives, capacity, constraints, timing, and the pathways that would produce each outcome.",
      },
      {
        title: "Dependence",
        body: "Components that share a cause or evidence source cannot be multiplied as if they were independent.",
      },
      {
        title: "Premortem",
        body: "Assume the forecast failed. Identify the most plausible missing mechanism, broken assumption, or wildcard.",
      },
    ],
    workedExample: {
      question: "Will a country adopt a policy by year end?",
      steps: [
        "Separate agenda placement, coalition support, administrative capacity, and remaining calendar time.",
        "Identify dependencies: coalition support may also determine agenda placement.",
        "Add rival pathways such as emergency procedure or judicial intervention.",
      ],
      conclusion: "The decomposition explains the forecast without pretending every branch is statistically independent.",
    },
    exercise: {
      prompt: "What is the best decomposition?",
      correctIndex: 0,
      options: [
        {
          label: "A few causal stages with explicit dependencies and observable signposts",
          explanation: "This makes assumptions inspectable while keeping the target event in view.",
        },
        {
          label: "Dozens of tiny factors multiplied together for precision",
          explanation: "False independence can make an elaborate model less accurate than a simpler judgment.",
        },
        {
          label: "One elegant theory that explains all actors",
          explanation: "Grand theories resist updating and often hide alternative mechanisms.",
        },
      ],
    },
    fieldChecklist: ["Causal stages", "Actors + incentives", "Dependence groups", "Opposite case", "Premortem"],
  },
  {
    id: "evidence-independence",
    chapter: "Research 06",
    duration: "8 min",
    title: "Evidence quality and correlated repetition",
    promise: "Distinguish five independent observations from five copies of one claim.",
    mentalModel: "Count roots, not headlines.",
    concepts: [
      {
        title: "Claim lineage",
        body: "Trace secondary articles to their underlying report, dataset, interview, or press release before treating them as separate support.",
      },
      {
        title: "Diagnosticity",
        body: "Evidence matters when it is appreciably more expected under one outcome than another—not merely because it is recent or vivid.",
      },
      {
        title: "Disconfirmation",
        body: "Search for the strongest evidence against the current view, not just more material that makes the rationale longer.",
      },
    ],
    workedExample: {
      question: "Do five articles confirm that an acquisition is imminent?",
      steps: [
        "Trace each story to its sources.",
        "Discover four cite the fifth, which cites one anonymous source.",
        "Treat the cluster as one uncertain claim and seek independent primary signals.",
      ],
      conclusion: "Source count falls from five to one evidence root.",
    },
    exercise: {
      prompt: "Which evidence adds the most independent information after a company press release?",
      correctIndex: 2,
      options: [
        {
          label: "A news summary quoting the release",
          explanation: "This restates the same evidence root.",
        },
        {
          label: "A social post linking to the news summary",
          explanation: "This adds another distribution channel, not an observation.",
        },
        {
          label: "A regulator’s independently filed record",
          explanation: "An independent institutional record can corroborate or contradict the company’s claim.",
        },
      ],
    },
    fieldChecklist: ["Primary source", "Underlying root", "For + against", "Cutoff respected", "Missing evidence named"],
  },
  {
    id: "updating",
    chapter: "Practice 07",
    duration: "8 min",
    title: "Diagnostic updating and signposts",
    promise: "Change your mind in traceable increments when the world—not the noise level—changes.",
    mentalModel: "Move the needle only when the likelihood ratio moves.",
    concepts: [
      {
        title: "Prior predictions",
        body: "Before new evidence arrives, write what you expect to observe under YES and under NO. This makes diagnosticity easier to judge.",
      },
      {
        title: "Typed signposts",
        body: "A useful trigger names a source, condition, affected factor, expected direction, and review cadence.",
      },
      {
        title: "No-event evidence",
        body: "If a precursor should have appeared by now and does not, the absence can justify an update—but only if the expectation was recorded in advance.",
      },
    ],
    workedExample: {
      question: "A launch forecast is 65%. A promised public beta does not appear by the internal milestone.",
      steps: [
        "Check whether the beta was a predeclared signpost.",
        "Assess whether both on-time and delayed worlds could plausibly omit it.",
        "Update the delivery-timing factor, record the delta, and set the next trigger.",
      ],
      conclusion: "The update is tied to a missed precursor rather than vague disappointment.",
    },
    exercise: {
      prompt: "A weakly diagnostic report arrives. What is the superforecasting move?",
      correctIndex: 1,
      options: [
        {
          label: "Do nothing because changing your mind shows weakness",
          explanation: "Belief revision is a feature, not an admission of failure.",
        },
        {
          label: "Make a small, documented update if it changes the evidence balance",
          explanation: "Update size should reflect diagnostic value, with a record of the affected factor.",
        },
        {
          label: "Make a dramatic update because the report is new",
          explanation: "Novelty and diagnosticity are different properties.",
        },
      ],
    },
    fieldChecklist: ["Predeclared signposts", "Old + new probability", "Evidence delta", "No-event signals", "Next review"],
  },
  {
    id: "teams-aggregation",
    chapter: "Teams 08",
    duration: "7 min",
    title: "Independent judgment and mechanical aggregation",
    promise: "Use groups without turning disagreement into conformity or theater.",
    mentalModel: "Think alone, share evidence, think again, then combine by rule.",
    concepts: [
      {
        title: "Private first estimate",
        body: "Judges should estimate independently before seeing peers, markets, or an authoritative synthesis.",
      },
      {
        title: "Real diversity",
        body: "Different names are not diversity. Measure different providers, search paths, evidence, reference classes, and forecast errors.",
      },
      {
        title: "Mechanical controls",
        body: "Simple mean and median are hard baselines. Complex synthesis must win matched out-of-time evaluation before replacing them.",
      },
    ],
    workedExample: {
      question: "Three judges give 38%, 42%, and 81%.",
      steps: [
        "Preserve all three independent estimates.",
        "Identify the 81% judge’s disputed fact or reference class.",
        "Research only that crux, privately reforecast, then aggregate mechanically.",
      ],
      conclusion: "Disagreement directs research; a supervisor does not simply pick the most persuasive answer.",
    },
    exercise: {
      prompt: "Which panel is most likely to add useful diversity?",
      correctIndex: 2,
      options: [
        {
          label: "Ten personas using the same model, search results, and prompt",
          explanation: "Persona labels may produce stylistic variation while errors remain highly correlated.",
        },
        {
          label: "One senior judge who sees everyone’s estimate first",
          explanation: "Authority and anchoring can erase independent information.",
        },
        {
          label: "Independent judges with meaningfully different evidence paths and private estimates",
          explanation: "Diversity in information and error structure is more valuable than diversity in labels.",
        },
      ],
    },
    fieldChecklist: ["Private first estimate", "Comparable judgment contract", "Measured overlap", "Mean + median retained"],
  },
  {
    id: "decisions-limits",
    chapter: "Limits 09",
    duration: "7 min",
    title: "Forecasts, decisions, and deep uncertainty",
    promise: "Use probabilities without confusing likely with desirable—or precision with control.",
    mentalModel: "Forecast the weather; decide whether to carry an umbrella in a separate step.",
    concepts: [
      {
        title: "Decision separation",
        body: "A forecast estimates what happens. A decision combines probabilities with payoffs, action costs, risk tolerance, and causal effects.",
      },
      {
        title: "Tail risk",
        body: "Low probability does not mean ignorable. Consequence severity can make robustness more important than the central estimate.",
      },
      {
        title: "Structural breaks",
        body: "Base rates can fail when institutions, technology, measurement, or incentives change. Name the assumption holding the class together.",
      },
    ],
    workedExample: {
      question: "There is a 12% chance a supplier fails. Should we pay for redundancy?",
      steps: [
        "Keep the 12% estimate independent of the desired procurement outcome.",
        "Estimate loss if failure occurs, redundancy cost, and alternatives.",
        "Stress-test the decision if the forecast is materially wrong.",
      ],
      conclusion: "The same forecast can support different decisions for organizations with different costs and risk tolerances.",
    },
    exercise: {
      prompt: "A 5% event would cause catastrophic harm. What follows?",
      correctIndex: 0,
      options: [
        {
          label: "Evaluate mitigations using probability, consequence, cost, and robustness",
          explanation: "Decision value depends on more than which outcome is most likely.",
        },
        {
          label: "Ignore it because it is unlikely",
          explanation: "Low probability can still dominate a decision when consequences are extreme.",
        },
        {
          label: "Change the probability upward until action feels justified",
          explanation: "Desired action must not contaminate the forecast itself.",
        },
      ],
    },
    fieldChecklist: ["Probability separate from preference", "Payoffs downstream", "Tail scenarios", "Robust action"],
  },
  {
    id: "scoring-perpetual-beta",
    chapter: "Learning 10",
    duration: "9 min",
    title: "Proper scoring, postmortems, and perpetual beta",
    promise: "Turn resolved forecasts into better future process without learning the wrong lesson.",
    mentalModel: "Keep the loss, inspect the cause, test the lesson forward.",
    concepts: [
      {
        title: "Proper scores",
        body: "Brier and log scores reward honest probabilities. Compare on the same questions and respect lead time and information cutoffs.",
      },
      {
        title: "Process × outcome",
        body: "Review four cells: good/right, good/wrong, bad/right, and bad/wrong. Lucky wins deserve scrutiny too.",
      },
      {
        title: "Forward validation",
        body: "A lesson from one memorable case is a hypothesis. It becomes policy only if it helps on later chronological cases.",
      },
    ],
    workedExample: {
      question: "A forecast missed because a late court order reversed the expected outcome.",
      steps: [
        "Preserve the original forecast and score.",
        "Ask whether judicial intervention was a known pathway, a neglected signpost, or an irreducible shock.",
        "Record a scoped lesson and test it on later cases involving similar institutions.",
      ],
      conclusion: "The postmortem improves a specific process without inventing hindsight certainty.",
    },
    exercise: {
      prompt: "When should a lesson from one failed forecast become a permanent forecasting rule?",
      correctIndex: 2,
      options: [
        {
          label: "Immediately, if the miss was emotionally memorable",
          explanation: "Salience encourages overfitting to one outcome.",
        },
        {
          label: "Whenever the explanation sounds coherent after resolution",
          explanation: "Hindsight makes many stories feel inevitable.",
        },
        {
          label: "After it is scoped, tested, and improves later chronological cases",
          explanation: "Forward validation distinguishes reusable process improvements from case-specific stories.",
        },
      ],
    },
    fieldChecklist: ["Immutable forecast", "Proper score", "Process/outcome review", "Scoped lesson", "Later validation"],
  },
]

export const FORECASTING_GLOSSARY = [
  ["Base rate", "How often an outcome occurs in a defined reference class."],
  ["Calibration", "How closely stated probabilities match observed frequencies across many forecasts."],
  ["Discrimination", "How well forecasts separate events that happen from events that do not."],
  ["Resolution", "The rule-governed determination of a forecast’s outcome."],
  ["Brier score", "For binary events, the squared distance between probability and outcome; lower is better."],
  ["Inside view", "Case-specific evidence about actors, mechanisms, constraints, and timing."],
  ["Outside view", "An estimate grounded in outcomes from comparable cases."],
  ["Diagnostic evidence", "Evidence that is meaningfully more expected under one outcome than another."],
  ["Signpost", "A predeclared observable condition that should prompt review or an update."],
  ["Premortem", "Assuming the forecast failed and asking what was most likely overlooked."],
  ["Proper scoring rule", "A scoring method designed to reward honest probability estimates."],
  ["Deep uncertainty", "A situation where outcomes, mechanisms, models, or probabilities cannot be specified reliably."],
] as const
