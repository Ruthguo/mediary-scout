import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { runAcquisitionV2Workflow } from "../src/acquisition-v2/workflow-v2.js";
import { FakeStorageExecutor } from "../src/fakes.js";
import type { ResourceProvider } from "../src/ports.js";
import type { ResourceSnapshot } from "../src/domain.js";

const USAGE = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
} as const;

function emptyProvider(): ResourceProvider {
  return {
    search: async ({ keyword }): Promise<ResourceSnapshot> => ({
      id: "snap_empty",
      provider: "pansou",
      keyword,
      candidates: [],
      createdAt: "2026-06-14T00:00:00.000Z",
    }),
  };
}

function providerAheadProvider(): ResourceProvider {
  return {
    search: async ({ keyword }): Promise<ResourceSnapshot> => ({
      id: "snap_ahead",
      provider: "pansou",
      keyword,
      candidates: [
        {
          id: "candidate_ahead",
          snapshotId: "snap_ahead",
          index: 0,
          title: "Show 更至6集",
          type: "quark",
          source: "pansou",
          providerPayload: { url: "https://example.invalid/ahead" },
        },
      ],
      createdAt: "2026-06-14T00:00:00.000Z",
    }),
  };
}

/** Model that searches once then honestly reports no coverage. */
function searchThenReportModel() {
  let i = 0;
  const tool = (name: string, input: unknown) => ({
    content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: name, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
    usage: USAGE,
    warnings: [],
  });
  return new MockLanguageModelV3({
    doGenerate: async () => {
      i += 1;
      if (i === 1) return tool("searchResources", { keyword: "show" });
      if (i === 2) return tool("reportNoCoverage", { reason: "no candidates" });
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

function providerAheadProbeModel(promptSink: { value: string }) {
  let i = 0;
  const tool = (name: string, input: unknown) => ({
    content: [{ type: "tool-call" as const, toolCallId: `ahead-${i}`, toolName: name, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
    usage: USAGE,
    warnings: [],
  });
  return new MockLanguageModelV3({
    doGenerate: async (options: unknown) => {
      i += 1;
      if (i === 1) {
        promptSink.value = JSON.stringify((options as { prompt?: unknown }).prompt ?? "");
        return tool("inspectTargetDir", { season: 1 });
      }
      if (i === 2) return tool("viewResourceSnapshot", {});
      if (i === 3) return tool("transferCandidate", { snapshotId: "snap_ahead", candidateId: "candidate_ahead" });
      if (i === 4) return tool("moveToSeason", { moves: [{ season: 1, fileIds: ["file_e05", "file_e06"] }] });
      if (i === 5) return tool("inspectTargetDir", { season: 1 });
      if (i === 6) return tool("markObtained", { codes: ["S01E05", "S01E06"] });
      if (i === 7) return tool("discardStaging", {});
      if (i === 8) return tool("finish", {});
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

function marksWithoutFilesProbeModel() {
  let i = 0;
  const tool = (name: string, input: unknown) => ({
    content: [{ type: "tool-call" as const, toolCallId: `unverified-${i}`, toolName: name, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
    usage: USAGE,
    warnings: [],
  });
  return new MockLanguageModelV3({
    doGenerate: async () => {
      i += 1;
      if (i === 1) return tool("inspectTargetDir", { season: 1 });
      if (i === 2) return tool("viewResourceSnapshot", {});
      if (i === 3) return tool("markObtained", { codes: ["S01E05", "S01E06"] });
      if (i === 4) return tool("finish", {});
      return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
    },
  });
}

describe("runAcquisitionV2Workflow — outer orchestration (dirs → sync → agent → reconcile)", () => {
  it("ensures dirs, computes the cross-season need, runs the agent, reconciles", async () => {
    const executor = new FakeStorageExecutor();
    const result = await runAcquisitionV2Workflow({
      provider: emptyProvider(),
      executor,
      model: searchThenReportModel(),
      workflowRunId: "run-1",
      title: { name: "Show", year: 2024, aliases: [], tmdbId: 42 },
      categoryParentId: "tv_root",
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 3 }],
      qualityPreference: "1080p",
    });

    // directory tree was verify-or-created
    expect(result.directories.seasonDirectoryIds[1]).toBeDefined();
    expect(result.directories.stagingDirectoryId).toContain(result.directories.showDirectoryId);
    // the need was computed from empty storage (all three aired episodes missing)
    expect(result.missingBefore).toEqual(["S01E01", "S01E02", "S01E03"]);
    // nothing covered them → still missing after reconcile (honest gap)
    expect(result.stillMissing).toEqual(["S01E01", "S01E02", "S01E03"]);
    expect(result.outcome.transferAttempts).toEqual([]);
  });

  it("no-op when nothing is missing: the agent (model) is never invoked", async () => {
    const executor = new FakeStorageExecutor();
    let modelCalled = false;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        modelCalled = true;
        throw new Error("model should not be called on a no-op run");
      },
    });
    const result = await runAcquisitionV2Workflow({
      provider: emptyProvider(),
      executor,
      model,
      workflowRunId: "run-2",
      title: { name: "Show", year: 2024, aliases: [], tmdbId: 42 },
      categoryParentId: "tv_root",
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 0 }], // nothing aired → nothing missing
      qualityPreference: "1080p",
    });

    expect(modelCalled).toBe(false);
    expect(result.missingBefore).toEqual([]);
    expect(result.outcome.transferAttempts).toEqual([]);
  });

  it("type3 provider-ahead probe lands and persists real episodes beyond the TMDB cursor", async () => {
    const prompt = { value: "" };
    const executor = new FakeStorageExecutor({
      transferOutcomes: {
        candidate_ahead: {
          status: "succeeded",
          providerMessage: "ok",
          files: [
            { id: "file_e05", storageDirectoryId: "", name: "Show.S01E05.mkv", sizeBytes: 5_000_000_000, episodeCode: "S01E05", providerFileId: "file_e05" },
            { id: "file_e06", storageDirectoryId: "", name: "Show.S01E06.mkv", sizeBytes: 5_000_000_000, episodeCode: "S01E06", providerFileId: "file_e06" },
          ],
        },
      },
    });
    const result = await runAcquisitionV2Workflow({
      provider: providerAheadProvider(),
      executor,
      model: providerAheadProbeModel(prompt),
      workflowRunId: "run-ahead",
      title: { name: "Show", year: 2024, aliases: [], tmdbId: 42 },
      categoryParentId: "tv_root",
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 4, totalEpisodes: 16 }],
      priorObtained: ["S01E01", "S01E02", "S01E03", "S01E04"],
      probeProviderAhead: true,
      qualityPreference: "1080p",
    });

    expect(result.missingBefore).toEqual([]);
    expect(result.providerAhead).toEqual(["S01E05", "S01E06"]);
    expect(result.obtained).toEqual(["S01E01", "S01E02", "S01E03", "S01E04"]);
    expect(result.outcome.transferAttempts).toHaveLength(1);
    expect(prompt.value).toContain("NO currently-aired missing episodes");
    expect(prompt.value).toContain("TMDB aired through E04");
    expect(prompt.value).toContain("real episode files landed");
  });

  it("ignores dishonest provider-ahead marks, including episodes beyond the season total", async () => {
    const result = await runAcquisitionV2Workflow({
      provider: providerAheadProvider(),
      executor: new FakeStorageExecutor(),
      model: marksWithoutFilesProbeModel(),
      workflowRunId: "run-unverified-ahead",
      title: { name: "Show", year: 2024, aliases: [], tmdbId: 42 },
      categoryParentId: "tv_root",
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 4, totalEpisodes: 16 }],
      priorObtained: ["S01E01", "S01E02", "S01E03", "S01E04"],
      probeProviderAhead: true,
      qualityPreference: "1080p",
    });

    expect(result.providerAhead).toEqual([]);
    expect(result.obtained).toEqual(["S01E01", "S01E02", "S01E03", "S01E04"]);
    expect(result.outcome.transferAttempts).toEqual([]);
  });

  it("ignores provider-ahead marks when no real episode files landed", async () => {
    let step = 0;
    const tool = (name: string, input: unknown) => ({
      content: [{ type: "tool-call" as const, toolCallId: `false-${step}`, toolName: name, input: JSON.stringify(input) }],
      finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const },
      usage: USAGE,
      warnings: [],
    });
    const dishonestModel = new MockLanguageModelV3({
      doGenerate: async () => {
        step += 1;
        if (step === 1) return tool("markObtained", { codes: ["S01E05", "S01E06", "S01E99"] });
        if (step === 2) return tool("finish", {});
        return { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
      },
    });
    const result = await runAcquisitionV2Workflow({
      provider: providerAheadProvider(),
      executor: new FakeStorageExecutor(),
      model: dishonestModel,
      workflowRunId: "run-ahead-no-files",
      title: { name: "Show", year: 2024, aliases: [], tmdbId: 42 },
      categoryParentId: "tv_root",
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 4, totalEpisodes: 16 }],
      priorObtained: ["S01E01", "S01E02", "S01E03", "S01E04"],
      probeProviderAhead: true,
      qualityPreference: "1080p",
    });

    expect(result.providerAhead).toEqual([]);
    expect(result.obtained).toEqual(["S01E01", "S01E02", "S01E03", "S01E04"]);
  });

  it("实有 comes from the DB marks (priorObtained), NOT a 115 scan — it narrows the need and drives obtained", async () => {
    const executor = new FakeStorageExecutor();
    const result = await runAcquisitionV2Workflow({
      provider: emptyProvider(),
      executor,
      model: searchThenReportModel(), // finds no new coverage this run
      workflowRunId: "run-3",
      title: { name: "Show", year: 2024, aliases: [], tmdbId: 42 },
      categoryParentId: "tv_root",
      seasons: [{ seasonNumber: 1, latestAiredEpisode: 3 }],
      qualityPreference: "1080p",
      priorObtained: ["S01E01"], // the DB already has E01 (agent marked it before)
    });

    // The need is aired − DB实有 = {E02,E03}; E01 is NOT re-needed (the old code
    // scanned an empty 115 and would have re-needed all three).
    expect(result.missingBefore).toEqual(["S01E02", "S01E03"]);
    // obtained reflects the DB mark; stillMissing is the rest.
    expect(result.obtained).toEqual(["S01E01"]);
    expect(result.stillMissing).toEqual(["S01E02", "S01E03"]);
  });
});
