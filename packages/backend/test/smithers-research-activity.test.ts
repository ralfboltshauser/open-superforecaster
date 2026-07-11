import { afterEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readCodexProviderObservedResearchActivity } from "../src/smithers-research-activity";

const temporaryHomes: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("exact Codex research activity", () => {
  test("selects the exact thread, deduplicates actions, and does not claim page content", async () => {
    const home = await temporaryCodexHome();
    const wanted = "019f4dd2-4f47-76b1-8b61-d1738329d633";
    const unrelated = "019f4dd2-ffff-76b1-8b61-d1738329d633";
    await writeRollout(home, unrelated, [sessionMeta(unrelated), webSearch("wrong", "unrelated query")]);
    await writeRollout(home, wanted, [
      sessionMeta(wanted),
      webSearch("call-1", "primary query"),
      webSearch("call-1", "primary query"),
      webOpen("call-2", "https://example.com/source"),
    ]);

    const activities = await readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted });

    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({
      threadId: wanted,
      callId: "call-1",
      activityType: "search",
      query: "primary query",
      contentObserved: false,
      provenanceMode: "provider_observed_activity",
    });
    expect(activities[1]).toMatchObject({
      activityType: "open_page",
      url: "https://example.com/source",
      contentObserved: false,
    });
    expect(JSON.stringify(activities)).not.toContain("unrelated query");
  });

  test("filters provider events to the inclusive Smithers execution window", async () => {
    const home = await temporaryCodexHome();
    const wanted = "019f4dd2-4f47-76b1-8b61-d1738329d633";
    await writeRollout(home, wanted, [
      sessionMeta(wanted),
      webSearch("before", "before", "2026-07-10T12:00:59.999Z"),
      webSearch("start", "at start", "2026-07-10T12:01:00.000Z"),
      webSearch("inside", "inside", "2026-07-10T12:01:30.000Z"),
      webOpen("finish", "https://example.com/finish", "2026-07-10T12:02:00.000Z"),
      webSearch("after", "after", "2026-07-10T12:02:00.001Z"),
    ]);

    const activities = await readCodexProviderObservedResearchActivity({
      codexHome: home,
      threadId: wanted,
      startedAtMs: Date.parse("2026-07-10T12:01:00.000Z"),
      finishedAtMs: Date.parse("2026-07-10T12:02:00.000Z"),
    });

    expect(activities.map((activity) => activity.callId)).toEqual(["start", "inside", "finish"]);
  });

  test("refreshes session discovery after a rollout moves into the archive", async () => {
    const home = await temporaryCodexHome();
    const wanted = "019f4dd2-4f47-76b1-8b61-d1738329d633";
    const original = await writeRollout(home, wanted, [sessionMeta(wanted), webSearch("call-1", "query")]);

    const first = await readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted });
    expect(first[0]?.sessionFile).toStartWith("sessions/");

    const archivedDirectory = join(home, "archived_sessions");
    const archived = join(archivedDirectory, basename(original));
    await mkdir(archivedDirectory, { recursive: true });
    await rename(original, archived);

    const second = await readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted });
    expect(second[0]?.sessionFile).toStartWith("archived_sessions/");
  });

  test("detects a duplicate rollout added after an exact path was already read", async () => {
    const home = await temporaryCodexHome();
    const wanted = "019f4dd2-4f47-76b1-8b61-d1738329d633";
    const original = await writeRollout(home, wanted, [sessionMeta(wanted), webSearch("call-1", "query")]);
    await readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted });

    const archivedDirectory = join(home, "archived_sessions");
    await mkdir(archivedDirectory, { recursive: true });
    await copyFile(original, join(archivedDirectory, basename(original)));

    await expect(readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted }))
      .rejects.toThrow("exact provenance is ambiguous");
  });

  test("marks malformed non-empty JSONL rows as an incomplete observation", async () => {
    const home = await temporaryCodexHome();
    const wanted = "019f4dd2-4f47-76b1-8b61-d1738329d633";
    await writeRollout(home, wanted, [sessionMeta(wanted), "malformed-json", webSearch("call-1", "query")]);

    await expect(readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted }))
      .rejects.toThrow("observation incomplete");
  });

  test("allows one trailing newline but rejects an additional empty JSONL row", async () => {
    const home = await temporaryCodexHome();
    const wanted = "019f4dd2-4f47-76b1-8b61-d1738329d633";
    await writeRollout(home, wanted, [sessionMeta(wanted)], 2);

    await expect(readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted }))
      .rejects.toThrow("unexpected empty JSONL row");
  });

  test("rejects a filename whose session metadata names another thread", async () => {
    const home = await temporaryCodexHome();
    const wanted = "019f4dd2-4f47-76b1-8b61-d1738329d633";
    await writeRollout(home, wanted, [sessionMeta("019f4dd2-wrong-76b1-8b61-d1738329d633")]);

    await expect(readCodexProviderObservedResearchActivity({ codexHome: home, threadId: wanted }))
      .rejects.toThrow("session metadata");
  });
});

async function temporaryCodexHome() {
  const home = await mkdtemp(join(tmpdir(), "osf-codex-activity-"));
  temporaryHomes.push(home);
  return home;
}

async function writeRollout(
  home: string,
  threadId: string,
  rows: Array<Record<string, unknown> | string>,
  trailingNewlines = 1,
) {
  const dir = join(home, "sessions", "2026", "07", "10");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `rollout-2026-07-10T12-00-00-${threadId}.jsonl`);
  await writeFile(
    path,
    `${rows.map((row) => typeof row === "string" ? row : JSON.stringify(row)).join("\n")}${"\n".repeat(trailingNewlines)}`,
  );
  return path;
}

function sessionMeta(threadId: string) {
  return { timestamp: "2026-07-10T12:00:00Z", type: "session_meta", payload: { id: threadId } };
}

function webSearch(callId: string, query: string, timestamp = "2026-07-10T12:01:00Z") {
  return {
    timestamp,
    type: "event_msg",
    payload: { type: "web_search_end", call_id: callId, query, action: { type: "search", queries: [query] } },
  };
}

function webOpen(callId: string, url: string, timestamp = "2026-07-10T12:02:00Z") {
  return {
    timestamp,
    type: "event_msg",
    payload: { type: "web_search_end", call_id: callId, query: url, action: { type: "open_page", url } },
  };
}
