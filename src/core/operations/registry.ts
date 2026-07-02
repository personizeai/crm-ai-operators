import type { OperationEntry } from "./types.js";
import { setupApply } from "./impl/setup-apply.js";
import { setupVerify } from "./impl/setup-verify.js";
import { setupDiff } from "./impl/setup-diff.js";
import { crmSyncCore } from "./impl/crm-sync-core.js";
import { syncPushProperties } from "./impl/sync-push-properties.js";
import { syncPullEngagements } from "./impl/sync-pull-engagements.js";
import { researchAccountDeepDive } from "./impl/research-account-deep-dive.js";
import { researchContactBackground } from "./impl/research-contact-background.js";
import { scoreIcpFit } from "./impl/score-icp-fit.js";
import { scoreLeadQuality } from "./impl/score-lead-quality.js";
import { generateOutreachSequence } from "./impl/generate-outreach-sequence.js";
import { generateMeetingBrief } from "./impl/generate-meeting-brief.js";
import { generateProposal } from "./impl/generate-proposal.js";
import { generateWinBackSequence } from "./impl/generate-win-back-sequence.js";
import { analyzeReplySentiment } from "./impl/analyze-reply-sentiment.js";
import { analyzeBuyingStage } from "./impl/analyze-buying-stage.js";
import { actNotifyRepHandoff } from "./impl/act-notify-rep-handoff.js";
import { actDailyDigest } from "./impl/act-daily-digest.js";
import { optimizeReviewRuns } from "./impl/optimize-review-runs.js";
import { optimizeRefineIcp } from "./impl/optimize-refine-icp.js";
import { analyzeCallSummary } from "./impl/analyze-call-summary.js";
import { analyzeDeduplication } from "./impl/analyze-deduplication.js";
import { reportPipelineHealth } from "./impl/report-pipeline-health.js";
import { reportWinLoss } from "./impl/report-win-loss.js";
import { generateMutualActionPlan } from "./impl/generate-mutual-action-plan.js";
import { syncNormalizeLifecycle } from "./impl/sync-normalize-lifecycle.js";
import { syncCallTranscriptsBulk } from "./impl/sync-call-transcripts-bulk.js";

const ALL: OperationEntry[] = [
  // setup
  setupApply,
  setupVerify,
  setupDiff,
  // sync
  crmSyncCore,
  syncPushProperties,
  syncPullEngagements,
  syncNormalizeLifecycle,
  syncCallTranscriptsBulk,
  // research
  researchAccountDeepDive,
  researchContactBackground,
  // score
  scoreIcpFit,
  scoreLeadQuality,
  // generate
  generateOutreachSequence,
  generateMeetingBrief,
  generateProposal,
  generateWinBackSequence,
  generateMutualActionPlan,
  // analyze
  analyzeReplySentiment,
  analyzeBuyingStage,
  analyzeCallSummary,
  analyzeDeduplication,
  // act
  actNotifyRepHandoff,
  actDailyDigest,
  // report
  reportPipelineHealth,
  reportWinLoss,
  // optimize
  optimizeReviewRuns,
  optimizeRefineIcp,
];

export const OPERATIONS: Record<string, OperationEntry> = Object.fromEntries(
  ALL.map((op) => [op.name, op]),
);

export const OPERATION_NAMES = Object.keys(OPERATIONS).sort();

/** True when every capability the operation requires is available on the active backend. */
export function isOperationAvailable(
  op: OperationEntry,
  hasCapability: (cap: string) => boolean,
): boolean {
  return (op.requires ?? []).every((cap) => hasCapability(cap));
}

/** Names of operations whose backend requirements the active deployment can't meet. */
export function unavailableOperations(hasCapability: (cap: string) => boolean): string[] {
  return ALL.filter((op) => !isOperationAvailable(op, hasCapability))
    .map((op) => op.name)
    .sort();
}
