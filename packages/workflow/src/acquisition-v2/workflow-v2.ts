import type { LanguageModel } from "ai";
import type { ResourceProvider, StorageExecutor } from "../ports.js";
import { episodePartsFromCode, type AuditEvent } from "../domain.js";
import {
  ensureSeasonAcquisitionDirectories,
  withStagingCleanup,
  type AcquisitionDirectories,
} from "./directory-lifecycle.js";
import type { DeadLinkStore } from "./dead-links.js";
import { readLandedSize } from "./landed-size.js";
import type { AgentToolEvent } from "./activity.js";
import { runAcquisitionV2, type AcquisitionV2Outcome } from "./orchestrator.js";
import { episodeUpperBoundHint } from "../episode-range.js";
import { syncSeasonNeed } from "./sync-need.js";
import type { SearchProfile } from "./search-profile.js";

/**
 * Phase 7c — the outer workflow orchestration (TV/anime). It is the same
 * resource-sync shape for every situation (init / ongoing / patrol): ensure the
 * directory tree (verify-or-create), sync the need (应有 vs 实有 → cross-season
 * missing), run the strong agent over the sandbox if anything is missing, then
 * reconcile by re-reading storage. Returns facts; persistence/notification is the
 * caller's (runner's) job. No live side effects beyond the injected executor.
 */
export interface V2WorkflowSeason {
  seasonNumber: number;
  /** Aired up to this episode (should-exist = E01..latestAiredEpisode). */
  latestAiredEpisode: number;
  /** Optional metadata ceiling used only to constrain provider-ahead probes. */
  totalEpisodes?: number;
}

export interface RunAcquisitionV2WorkflowRequest {
  provider: ResourceProvider;
  executor: StorageExecutor;
  model: LanguageModel;
  workflowRunId: string;
  title: { name: string; year: number; aliases: string[]; tmdbId: number };
  /** Library category parent (Movies/TV/Anime), chosen by title.type upstream. */
  categoryParentId: string;
  seasons: V2WorkflowSeason[];
  qualityPreference: string;
  /** 实有 = the DB obtained marks for this title (the agent's prior markObtained).
   *  Empty for a first acquisition; the type-3 patrol passes the DB's obtained
   *  episode codes so the need = aired − 实有 (NOT a 115 scan). */
  priorObtained?: string[];
  /** Type-3 only: run a conservative availability probe even when aired need is empty. */
  probeProviderAhead?: boolean;
  searchBudget?: number;
  maxSteps?: number;
  preferredLanguage?: string;
  /** TMDB origin_country of the title — when it includes CN the TV/anime prompt skips
   *  the 中文 subtitle floor (国产剧/动漫 natively Chinese-spoken). */
  originCountries?: string[];
  searchHints?: string;
  qualityGuidance?: string;
  /** The task's fine-grained search profile — enables the anime taboo-keyword
   *  validator (warnings only, never blocking). 病2b。 */
  searchProfile?: SearchProfile;
  /** The run's drive brand ("pan115" | "quark") — selects brand-specific skill. */
  storageProvider?: string;
  /** assrt token (Settings → 字幕来源). Undefined = 字幕流程不触发。 */
  assrtToken?: string;
  deadLinkStore?: DeadLinkStore;
  onProgress?: (event: AgentToolEvent) => void;
}

export interface RunAcquisitionV2WorkflowResult {
  directories: AcquisitionDirectories;
  /** The missing set computed before the agent ran. */
  missingBefore: string[];
  outcome: AcquisitionV2Outcome;
  agentText: string;
  /** Re-synced from real storage after the agent: what is still missing / obtained. */
  stillMissing: string[];
  obtained: string[];
  providerAhead: string[];
  /** Real landed video files across the season dirs (best-effort, post-run); fuels
   *  the notification's true per-episode size. Absent when the read failed/empty. */
  landedFileCount?: number;
  landedBytes?: number;
  auditEvents: AuditEvent[];
}

const EMPTY_OUTCOME: AcquisitionV2Outcome = { resourceSnapshots: [], decisions: [], transferAttempts: [] };

async function hasProviderAheadHint(request: RunAcquisitionV2WorkflowRequest): Promise<boolean> {
  try {
    const snapshot = await request.provider.search({
      keyword: request.title.name,
      workflowRunId: request.workflowRunId,
    });
    return request.seasons.some((season) =>
      snapshot.candidates.some((candidate) => {
        const hinted = episodeUpperBoundHint(candidate.title, season.seasonNumber);
        return (
          hinted !== null &&
          hinted > season.latestAiredEpisode &&
          (season.totalEpisodes === undefined || hinted <= season.totalEpisodes)
        );
      }),
    );
  } catch {
    // Availability probing is opportunistic. A provider outage must not turn an
    // already-current season into a failed patrol; the next sweep tries again.
    return false;
  }
}

async function verifiedProviderAheadCodes(
  request: RunAcquisitionV2WorkflowRequest,
  directories: AcquisitionDirectories,
): Promise<string[]> {
  const verified = new Set<string>();
  for (const season of request.seasons) {
    const directoryId = directories.seasonDirectoryIds[season.seasonNumber];
    if (!directoryId) continue;
    let files: Awaited<ReturnType<StorageExecutor["listVideoFiles"]>>;
    try {
      files = await request.executor.listVideoFiles(directoryId);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.episodeCode) continue;
      let parts: ReturnType<typeof episodePartsFromCode>;
      try {
        parts = episodePartsFromCode(file.episodeCode);
      } catch {
        continue;
      }
      if (
        parts.seasonNumber === season.seasonNumber &&
        parts.episodeNumber > season.latestAiredEpisode &&
        (season.totalEpisodes === undefined || parts.episodeNumber <= season.totalEpisodes)
      ) {
        verified.add(file.episodeCode);
      }
    }
  }
  return [...verified];
}

export async function runAcquisitionV2Workflow(
  request: RunAcquisitionV2WorkflowRequest,
): Promise<RunAcquisitionV2WorkflowResult> {
  // 7a — verify-or-create the directory tree, get scoped handles.
  const directories = await ensureSeasonAcquisitionDirectories({
    executor: request.executor,
    categoryParentId: request.categoryParentId,
    showName: request.title.name,
    year: request.title.year,
    tmdbId: request.title.tmdbId,
    seasons: request.seasons.map((season) => season.seasonNumber),
    workflowRunId: request.workflowRunId,
  });

  // Harness-level leak guard: whatever the agent does (covers, fails, or
  // reportNoCoverage), the run's staging dir is discarded when this returns or
  // throws — the 斗破苍穹 335-file leak fix. The agent keeps its own discardStaging
  // (and normally calls it); this is the deterministic backstop.
  return await withStagingCleanup(
    { executor: request.executor, stagingDirectoryId: directories.stagingDirectoryId },
    async () => {
  const seasonsForSync = request.seasons.map((season) => ({
    seasonNumber: season.seasonNumber,
    latestAiredEpisode: season.latestAiredEpisode,
    ...(season.totalEpisodes === undefined ? {} : { totalEpisodes: season.totalEpisodes }),
  }));
  const priorObtained = request.priorObtained ?? [];

  // 7b — sync the need from the DB marks (应有 − 实有). No 115 scan, no parser.
  const before = syncSeasonNeed({ seasons: seasonsForSync, obtained: priorObtained });
  const providerAheadProbe =
    before.missing.length === 0 &&
    request.probeProviderAhead === true &&
    (await hasProviderAheadHint(request));
  if (before.missing.length === 0 && !providerAheadProbe) {
    // Already current — no agent run, no side effects (the type-3 no-op path).
    return {
      directories,
      missingBefore: [],
      outcome: EMPTY_OUTCOME,
      agentText: "",
      stillMissing: [],
      obtained: before.obtained,
      providerAhead: before.providerAhead,
      auditEvents: [],
    };
  }

  // Run the strong TV/anime agent over the sandbox.
  const v2 = await runAcquisitionV2({
    provider: request.provider,
    executor: request.executor,
    model: request.model,
    workflowRunId: request.workflowRunId,
    target: {
      kind: "tv",
      title: request.title.name,
      aliases: request.title.aliases,
      seasons: request.seasons.map((season) => season.seasonNumber),
      missingEpisodes: before.missing,
      ...(providerAheadProbe
        ? {
            providerAheadProbe: true,
            seasonBounds: request.seasons.map((season) => ({
              seasonNumber: season.seasonNumber,
              latestAiredEpisode: season.latestAiredEpisode,
              ...(season.totalEpisodes === undefined ? {} : { totalEpisodes: season.totalEpisodes }),
            })),
          }
        : {}),
      qualityPreference: request.qualityPreference,
    },
    stagingDirectoryId: directories.stagingDirectoryId,
    targetSeasonDirectoryIds: directories.seasonDirectoryIds,
    ...(request.searchBudget === undefined ? {} : { searchBudget: request.searchBudget }),
    ...(request.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
    ...(request.preferredLanguage === undefined ? {} : { preferredLanguage: request.preferredLanguage }),
    ...(request.originCountries === undefined ? {} : { originCountries: request.originCountries }),
    ...(request.searchHints === undefined ? {} : { searchHints: request.searchHints }),
    ...(request.qualityGuidance === undefined ? {} : { qualityGuidance: request.qualityGuidance }),
    ...(request.searchProfile === undefined ? {} : { searchProfile: request.searchProfile }),
    ...(request.storageProvider === undefined ? {} : { storageProvider: request.storageProvider }),
    ...(request.assrtToken === undefined ? {} : { assrtToken: request.assrtToken }),
    ...(request.deadLinkStore ? { deadLinkStore: request.deadLinkStore } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
  });

  // Reconcile from the AGENT'S coverage (its markObtained), NOT a 115 re-scan:
  // 实有 after = prior DB marks ∪ what the agent marked this run (§1.13/§7b).
  // A provider-ahead probe has no aired need, so agent marks are not themselves
  // evidence. Re-read the target directories and derive ahead codes only from
  // real, parseable video files within the tracked season/total bounds.
  const newlyVerified = providerAheadProbe
    ? await verifiedProviderAheadCodes(request, directories)
    : v2.coverage.obtained;
  const after = syncSeasonNeed({
    seasons: seasonsForSync,
    obtained: [...priorObtained, ...newlyVerified],
  });

  // Best-effort real landed size for the notification (true per-episode bytes,
  // not a claimed quality). Reads AFTER the acquisition succeeded; on the heavy
  // run where the 115 call budget is spent this returns undefined rather than
  // throwing, so the size is simply omitted — never failing a good run.
  const landed = await readLandedSize(
    request.executor,
    Object.values(directories.seasonDirectoryIds),
  );

  return {
    directories,
    missingBefore: before.missing,
    outcome: v2.outcome,
    agentText: v2.text,
    stillMissing: after.missing,
    obtained: after.obtained,
    providerAhead: after.providerAhead,
    auditEvents: v2.auditEvents,
    ...(landed ? { landedFileCount: landed.fileCount, landedBytes: landed.totalBytes } : {}),
  };
    },
  );
}
