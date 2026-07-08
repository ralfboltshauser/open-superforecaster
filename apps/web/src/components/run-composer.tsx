import { useForm } from "@tanstack/react-form";
import { FileUp, Play, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ClassificationPreview = {
  mode: string;
  forecastType?: string;
  confidence: number;
  requiresTable: boolean;
  rationale: string;
  suggestedEffort: "low" | "medium" | "high";
  workflow: string;
};

type PreviewStatus = "idle" | "loading" | "ready" | "error";
type PreviewInput = {
  prompt: string;
  mode: string;
  forecastType: string;
};

export function RunComposer({ onLaunch }: { onLaunch?: () => Promise<void> | void }) {
  const [csvText, setCsvText] = useState("");
  const [previewInput, setPreviewInput] = useState<PreviewInput>({
    prompt: "",
    mode: "auto",
    forecastType: "auto",
  });
  const [preview, setPreview] = useState<ClassificationPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const parsedRows = useMemo(() => parseCsvRows(csvText), [csvText]);
  const form = useForm({
    defaultValues: {
      prompt: "",
      mode: "auto",
      forecastType: "auto",
      effort: "medium",
    },
    onSubmit: async ({ value }) => {
      const tableRows = parsedRows.slice(0, 50);
      const isTableMode = ["agent_map", "rank", "classify", "dedupe"].includes(value.mode);
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: value.mode,
          forecastType: value.forecastType === "auto" ? undefined : value.forecastType,
          effort: value.effort,
          prompt: value.prompt,
          ...(isTableMode && tableRows.length ? { rows: tableRows } : {}),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text);
      }

      await onLaunch?.();
      setCsvText("");
    },
  });

  useEffect(() => {
    const prompt = previewInput.prompt.trim();
    const hasOverride = previewInput.mode !== "auto" || previewInput.forecastType !== "auto";
    if (!prompt && !hasOverride) {
      setPreview(null);
      setPreviewStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreviewStatus("loading");
      void fetch("/api/classify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          mode: previewInput.mode,
          forecastType: previewInput.forecastType === "auto" ? undefined : previewInput.forecastType,
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(await response.text());
          }
          return response.json() as Promise<{ classification?: unknown }>;
        })
        .then((payload) => {
          if (!isClassificationPreview(payload.classification)) {
            throw new Error("Classifier response is missing required fields.");
          }
          setPreview(payload.classification);
          setPreviewStatus("ready");
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          setPreviewStatus("error");
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [previewInput]);

  const updatePreviewInput = <Key extends keyof PreviewInput>(key: Key, value: PreviewInput[Key]) => {
    setPreviewInput((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="composer-row">
        <form.Field name="prompt">
          {(field) => (
            <textarea
              aria-label="Research or forecast prompt"
              placeholder="Ask a forecasting, research, or table-agent question..."
              value={field.state.value}
              onChange={(event) => {
                field.handleChange(event.target.value);
                updatePreviewInput("prompt", event.target.value);
              }}
            />
          )}
        </form.Field>
      </div>
      <div className="table-input">
        <label className="file-control">
          <FileUp size={16} />
          <span>CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              void file.text().then(setCsvText);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <textarea
          aria-label="CSV rows"
          placeholder="rowId,name,domain&#10;row-1,OpenAI,openai.com&#10;row-2,Anthropic,anthropic.com"
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
        />
        {csvText ? (
          <div className="table-preview">
            <span>{parsedRows.length} row{parsedRows.length === 1 ? "" : "s"}</span>
            <span>{parsedRows[0] ? Object.keys(parsedRows[0]).length : 0} columns</span>
          </div>
        ) : null}
      </div>
      <ClassificationPreviewPanel preview={preview} status={previewStatus} />
      <div className="composer-controls">
        <form.Field name="mode">
          {(field) => (
            <label>
              <SlidersHorizontal size={16} />
              <select
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  updatePreviewInput("mode", event.target.value);
                }}
              >
                <option value="auto">Auto</option>
                <option value="forecast">Forecast</option>
                <option value="multi_agent">Deep research</option>
                <option value="agent_map">Agent map</option>
                <option value="rank">Rank</option>
                <option value="classify">Classify</option>
                <option value="merge">Merge</option>
                <option value="dedupe">Dedupe</option>
              </select>
            </label>
          )}
        </form.Field>
        <form.Field name="forecastType">
          {(field) => (
            <label>
              Forecast
              <select
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  updatePreviewInput("forecastType", event.target.value);
                }}
              >
                <option value="auto">Auto type</option>
                <option value="binary">Binary</option>
                <option value="date">Date</option>
                <option value="numeric">Numeric</option>
                <option value="categorical">Categorical</option>
                <option value="thresholded">Thresholded</option>
                <option value="conditional">Conditional</option>
              </select>
            </label>
          )}
        </form.Field>
        <form.Field name="effort">
          {(field) => (
            <label>
              Effort
              <select value={field.state.value} onChange={(event) => field.handleChange(event.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          )}
        </form.Field>
        <button type="submit" disabled={form.state.isSubmitting}>
          <Play size={16} />
          {form.state.isSubmitting ? "Queueing" : "Queue run"}
        </button>
      </div>
    </form>
  );
}

function ClassificationPreviewPanel({ preview, status }: { preview: ClassificationPreview | null; status: PreviewStatus }) {
  const confidence = preview ? `${Math.round(preview.confidence * 100)}%` : "Auto";
  const rationale = status === "error" ? "Classifier unavailable" : preview?.rationale ?? "Awaiting input";

  return (
    <div className="classification-preview" aria-live="polite">
      <div>
        <span>Workflow</span>
        <strong>{status === "loading" ? "Classifying" : (preview?.workflow ?? "Auto")}</strong>
      </div>
      <div>
        <span>Mode</span>
        <strong>{formatMode(preview?.mode)}</strong>
      </div>
      <div>
        <span>Forecast</span>
        <strong>{preview?.forecastType ? formatMode(preview.forecastType) : "N/A"}</strong>
      </div>
      <div>
        <span>Table</span>
        <strong>{preview?.requiresTable ? "Required" : "No"}</strong>
      </div>
      <div>
        <span>Confidence</span>
        <strong>{confidence}</strong>
      </div>
      <div>
        <span>Effort</span>
        <strong>{preview ? formatMode(preview.suggestedEffort) : "Medium"}</strong>
      </div>
      <p>{rationale}</p>
    </div>
  );
}

function formatMode(value: string | undefined) {
  if (!value) {
    return "Auto";
  }
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function isClassificationPreview(value: unknown): value is ClassificationPreview {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.mode === "string" &&
    typeof record.confidence === "number" &&
    typeof record.requiresTable === "boolean" &&
    typeof record.rationale === "string" &&
    typeof record.suggestedEffort === "string" &&
    typeof record.workflow === "string" &&
    (record.forecastType === undefined || typeof record.forecastType === "string")
  );
}

function parseCsvRows(value: string) {
  const rows = parseCsv(value.trim());
  if (rows.length < 2) {
    return [];
  }
  const headers = rows[0].map((header) => header.trim()).filter(Boolean);
  if (headers.length === 0) {
    return [];
  }
  return rows.slice(1)
    .map((columns, index) => {
      const row = Object.fromEntries(headers.map((header, headerIndex) => [header, columns[headerIndex]?.trim() ?? ""]));
      return {
        ...row,
        rowId: row.rowId || row.id || `row-${index + 1}`,
      };
    })
    .filter((row) => Object.entries(row).some(([key, cell]) => key !== "rowId" && String(cell).trim().length > 0));
}

function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}
