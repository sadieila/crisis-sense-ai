import dotenv from "dotenv";
import { createHash } from "crypto";
import { analyzeReport, type AnalysisMode } from "../services/aiService";
import {
  buildRagContext,
  createTextEmbedding,
  ensureDocumentEmbeddings,
  EMBEDDING_MODEL,
} from "../services/embeddingService";
import { supabase } from "../services/supabaseClient";
import { isAnalysisResult } from "../types/analysis";
import { getPositiveIntEnv, validateRuntimeEnv } from "../utils/env";
import {
  applyConfidencePenalty,
  applyLightAnalysisGuardrails,
  deriveDeterministicSignals,
  inferReportCategory,
  type DeterministicSignals,
} from "../utils/analysisGovernance";
import {
  deriveDashboardView,
  deriveEvaluationTags,
} from "../utils/dashboardContract";

dotenv.config({ quiet: true });
validateRuntimeEnv("worker");

const POLL_INTERVAL_MS = getPositiveIntEnv("REPORT_PROCESSOR_POLL_MS", 5000);
const REPORT_BATCH_SIZE = getPositiveIntEnv("REPORT_PROCESSOR_BATCH_SIZE", 5);
const DOCUMENT_EMBEDDING_BATCH_SIZE = getPositiveIntEnv(
  "DOCUMENT_EMBEDDING_BATCH_SIZE",
  20,
);
const MIN_REPORT_CONTENT_CHARS = getPositiveIntEnv("MIN_REPORT_CONTENT_CHARS", 40);
const DUPLICATE_LOOKBACK_LIMIT = getPositiveIntEnv("DUPLICATE_LOOKBACK_LIMIT", 200);
const RAG_MAX_CONTEXT_TOKENS = getPositiveIntEnv("RAG_MAX_CONTEXT_TOKENS", 1200);
const ENABLE_STAGE0_PREFILTER =
  (process.env.ENABLE_STAGE0_PREFILTER?.trim().toLowerCase() ?? "true") !== "false";
const ENABLE_LIGHT_ANALYSIS =
  (process.env.ENABLE_LIGHT_ANALYSIS?.trim().toLowerCase() ?? "true") !== "false";
const ENABLE_DEEP_ANALYSIS =
  (process.env.ENABLE_DEEP_ANALYSIS?.trim().toLowerCase() ?? "true") !== "false";
const DEEP_ANALYSIS_MIN_CHARS = getPositiveIntEnv("DEEP_ANALYSIS_MIN_CHARS", 900);
const ENABLE_AI_OBSERVABILITY =
  (process.env.ENABLE_AI_OBSERVABILITY?.trim().toLowerCase() ?? "true") !== "false";
const ENABLE_HUMAN_REVIEW_GATE =
  (process.env.ENABLE_HUMAN_REVIEW_GATE?.trim().toLowerCase() ?? "true") !== "false";
const ENABLE_DETERMINISTIC_SIGNALS =
  (process.env.ENABLE_DETERMINISTIC_SIGNALS?.trim().toLowerCase() ?? "true") !== "false";
const CATEGORY_SIGNAL_WINDOW_MINUTES = getPositiveIntEnv(
  "CATEGORY_SIGNAL_WINDOW_MINUTES",
  60,
);
const CATEGORY_SIGNAL_BURST_THRESHOLD = getPositiveIntEnv(
  "CATEGORY_SIGNAL_BURST_THRESHOLD",
  2,
);
const CATEGORY_SIGNAL_LOOKBACK_LIMIT = getPositiveIntEnv(
  "CATEGORY_SIGNAL_LOOKBACK_LIMIT",
  120,
);
const ENABLE_CONFIDENCE_DEGRADATION =
  (process.env.ENABLE_CONFIDENCE_DEGRADATION?.trim().toLowerCase() ?? "true") !== "false";
const ENABLE_LIGHT_ANALYSIS_GUARDRAILS =
  (process.env.ENABLE_LIGHT_ANALYSIS_GUARDRAILS?.trim().toLowerCase() ?? "true") !== "false";
const LIGHT_CONFIDENCE_THRESHOLD = Number.parseFloat(
  process.env.LIGHT_CONFIDENCE_THRESHOLD?.trim() ?? "0.6",
);
const ENABLE_DASHBOARD_VIEW_METADATA =
  (process.env.ENABLE_DASHBOARD_VIEW_METADATA?.trim().toLowerCase() ?? "true") !== "false";
const ENABLE_EVALUATION_TAGS =
  (process.env.ENABLE_EVALUATION_TAGS?.trim().toLowerCase() ?? "true") !== "false";
const EVALUATION_VAGUE_INPUT_MIN_WORDS = getPositiveIntEnv(
  "EVALUATION_VAGUE_INPUT_MIN_WORDS",
  18,
);
const CONFIDENCE_SHORT_CONTENT_THRESHOLD = getPositiveIntEnv(
  "CONFIDENCE_SHORT_CONTENT_THRESHOLD",
  220,
);
const CONFIDENCE_PENALTY_MISSING_REFERENCE = Number.parseFloat(
  process.env.CONFIDENCE_PENALTY_MISSING_REFERENCE?.trim() ?? "0.12",
);
const CONFIDENCE_PENALTY_SHORT_CONTENT = Number.parseFloat(
  process.env.CONFIDENCE_PENALTY_SHORT_CONTENT?.trim() ?? "0.08",
);
const HUMAN_REVIEW_MIN_CONFIDENCE = Number.parseFloat(
  process.env.HUMAN_REVIEW_MIN_CONFIDENCE?.trim() ?? "0.45",
);
const HUMAN_REVIEW_HIGH_SEVERITY_THRESHOLD = Number.parseFloat(
  process.env.HUMAN_REVIEW_HIGH_SEVERITY_THRESHOLD?.trim() ?? "7",
);
const DEEP_ANALYSIS_SIGNAL_REGEX =
  /\b(multi(?:ple)?\s+casualt|evacuat|critical\s+infrastructure|chemical|explosion|wildfire|earthquake|outbreak|collapse)\b/i;
const ENTITY_SIGNAL_REGEX =
  /\b(hospital|school|bridge|airport|station|district|city|highway|shelter|substation|pipeline)\b/i;

const REPORT_STATUS_PENDING = "pending";
const REPORT_STATUS_PROCESSING = "processing";
const REPORT_STATUS_ANALYZED = "analyzed";
const REPORT_STATUS_FAILED = "failed";

type ReportIdRow = {
  id: number;
};

type ClaimedReport = {
  id: number;
  content: string | null;
};

type ReusableAnalysisCandidate = {
  id: number;
  content: string | null;
  analysis_result: unknown;
};

type CategorySignalCandidate = {
  id: number;
  title: string | null;
  content: string | null;
};

type ReusableAnalysisMatch = {
  sourceReportId: number;
  analysisResult: unknown;
};

type AnalysisLogPayload = {
  report_id: number;
  analysis_mode: "skipped" | AnalysisMode;
  reused: boolean;
  rag_used: boolean;
  confidence: number | null;
  overall_severity: number | null;
  prompt_version: string;
  needs_human_review?: boolean;
};

type DashboardAndEvaluationInput = {
  payload: Record<string, unknown>;
  averageConfidence: number | null;
  overallSeverity: number | null;
  needsHumanReview: boolean;
  informationalOnly: boolean;
  normalizedContent: string;
  repeatedReport: boolean;
  deterministicSignals: DeterministicSignals;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

function trimErrorReason(message: string): string {
  const normalized = normalizeContent(message);
  return normalized.slice(0, 500);
}

function safePenalty(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getAverageConfidenceFromAnalysis(analysis: unknown): number | null {
  if (typeof analysis !== "object" || analysis === null || Array.isArray(analysis)) {
    return null;
  }

  const recommendations = (analysis as Record<string, unknown>).recommendations;

  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    return null;
  }

  let sum = 0;
  let count = 0;

  for (const item of recommendations) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }

    const confidence = asFiniteNumber((item as Record<string, unknown>).confidence);

    if (confidence === null) {
      continue;
    }

    sum += confidence;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  return Number((sum / count).toFixed(4));
}

function getOverallSeverityFromAnalysis(analysis: unknown): number | null {
  if (typeof analysis !== "object" || analysis === null || Array.isArray(analysis)) {
    return null;
  }

  return asFiniteNumber((analysis as Record<string, unknown>).overall_severity);
}

function logAnalysisObservability(payload: AnalysisLogPayload): void {
  if (!ENABLE_AI_OBSERVABILITY) {
    return;
  }

  console.log(`[analysis_observability] ${JSON.stringify(payload)}`);
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function shouldSkipAiForShortOrEmptyContent(content: string): boolean {
  return content.length < MIN_REPORT_CONTENT_CHARS;
}

function requiresDeepAnalysis(content: string): boolean {
  if (!ENABLE_DEEP_ANALYSIS) {
    return false;
  }

  if (!ENABLE_LIGHT_ANALYSIS) {
    return true;
  }

  return content.length >= DEEP_ANALYSIS_MIN_CHARS || DEEP_ANALYSIS_SIGNAL_REGEX.test(content);
}

function containsEntitySignals(content: string): boolean {
  return ENTITY_SIGNAL_REGEX.test(content);
}

function resolveAnalysisMode(content: string): AnalysisMode | null {
  if (!ENABLE_LIGHT_ANALYSIS && !ENABLE_DEEP_ANALYSIS) {
    return null;
  }

  return requiresDeepAnalysis(content) ? "deep" : "light";
}

function buildSkippedAnalysisResult(
  reason: string,
  baseAnalysis?: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  if (typeof baseAnalysis === "object" && baseAnalysis !== null && !Array.isArray(baseAnalysis)) {
    return {
      ...(baseAnalysis as Record<string, unknown>),
      ai_skipped: true,
      skip_reason: reason,
      ...extra,
    };
  }

  return {
    summary:
      reason === "short_or_empty_content"
        ? "Report content is too short for reliable AI analysis."
        : "AI analysis was safely skipped.",
    risks: [],
    recommendations: [],
    overall_severity: 0,
    ai_skipped: true,
    skip_reason: reason,
    ...extra,
  };
}

function appendGovernanceMetadata(
  payload: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const existing =
    typeof payload.governance_metadata === "object" &&
    payload.governance_metadata !== null &&
    !Array.isArray(payload.governance_metadata)
      ? (payload.governance_metadata as Record<string, unknown>)
      : {};

  return {
    ...payload,
    governance_metadata: {
      ...existing,
      ...metadata,
    },
  };
}

function appendDashboardAndEvaluationMetadata(
  input: DashboardAndEvaluationInput,
): Record<string, unknown> {
  let nextPayload = input.payload;

  if (ENABLE_DASHBOARD_VIEW_METADATA) {
    nextPayload = appendGovernanceMetadata(nextPayload, {
      dashboard_view: deriveDashboardView({
        overallSeverity: input.overallSeverity,
        averageConfidence: input.averageConfidence,
        needsHumanReview: input.needsHumanReview,
        informationalOnly: input.informationalOnly,
      }),
    });
  }

  if (ENABLE_EVALUATION_TAGS) {
    nextPayload = appendGovernanceMetadata(nextPayload, {
      evaluation_tags: deriveEvaluationTags({
        content: input.normalizedContent,
        isRepeated: input.repeatedReport,
        overallSeverity: input.overallSeverity,
        deterministicSignals: input.deterministicSignals,
        shortInputThreshold: CONFIDENCE_SHORT_CONTENT_THRESHOLD,
        vagueInputMinWords: EVALUATION_VAGUE_INPUT_MIN_WORDS,
      }),
    });
  }

  return nextPayload;
}

async function countRecentCategoryReports(
  reportId: number,
  category: string,
): Promise<number> {
  if (!ENABLE_DETERMINISTIC_SIGNALS || category === "uncategorized") {
    return 0;
  }

  const since = new Date(
    Date.now() - CATEGORY_SIGNAL_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("reports")
    .select("id, title, content")
    .gte("created_at", since)
    .neq("id", reportId)
    .limit(CATEGORY_SIGNAL_LOOKBACK_LIMIT);

  if (error) {
    throw new Error(`Failed to evaluate category burst signal: ${error.message}`);
  }

  const candidates = (data ?? []) as CategorySignalCandidate[];
  let count = 0;

  for (const candidate of candidates) {
    const candidateText = normalizeContent(
      `${candidate.title ?? ""} ${candidate.content ?? ""}`,
    );

    if (!candidateText) {
      continue;
    }

    if (inferReportCategory(candidateText) === category) {
      count += 1;
    }
  }

  return count;
}

async function findReusableAnalysisByHash(
  reportId: number,
  normalizedContent: string,
): Promise<ReusableAnalysisMatch | null> {
  const targetHash = hashContent(normalizedContent);

  const { data, error } = await supabase
    .from("reports")
    .select("id, content, analysis_result")
    .eq("status", REPORT_STATUS_ANALYZED)
    .not("analysis_result", "is", null)
    .not("content", "is", null)
    .neq("id", reportId)
    .order("id", { ascending: false })
    .limit(DUPLICATE_LOOKBACK_LIMIT);

  if (error) {
    throw new Error(`Failed to check duplicate reports: ${error.message}`);
  }

  const candidates = (data ?? []) as ReusableAnalysisCandidate[];

  for (const candidate of candidates) {
    if (typeof candidate.content !== "string") {
      continue;
    }

    const candidateHash = hashContent(normalizeContent(candidate.content));

    if (candidateHash === targetHash) {
      return {
        sourceReportId: candidate.id,
        analysisResult: candidate.analysis_result,
      };
    }
  }

  return null;
}

async function updateReportWithOptionalErrorReason(
  reportId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("reports").update(payload).eq("id", reportId);

  if (!error) {
    return;
  }

  const lowerMessage = error.message.toLowerCase();

  if (!lowerMessage.includes("error_reason")) {
    throw new Error(`Failed to update report ${reportId}: ${error.message}`);
  }

  const fallbackPayload = { ...payload };
  delete fallbackPayload.error_reason;

  const { error: fallbackError } = await supabase
    .from("reports")
    .update(fallbackPayload)
    .eq("id", reportId);

  if (fallbackError) {
    throw new Error(
      `Failed to update report ${reportId} after fallback: ${fallbackError.message}`,
    );
  }
}

async function setReportFailed(reportId: number, reason: string): Promise<void> {
  const safeReason = trimErrorReason(reason);

  try {
    await updateReportWithOptionalErrorReason(reportId, {
      status: REPORT_STATUS_FAILED,
      error_reason: safeReason,
      analysis_result: {
        error: safeReason,
      },
    });
  } catch (error) {
    console.error(`[worker] failed to persist failure state for report ${reportId}:`, error);
  }
}

async function setReportAnalyzed(
  reportId: number,
  analysisResult: unknown,
): Promise<void> {
  await updateReportWithOptionalErrorReason(reportId, {
    status: REPORT_STATUS_ANALYZED,
    analysis_result: analysisResult,
    error_reason: null,
  });
}

async function listPendingReportIds(limit: number): Promise<number[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("id")
    .eq("status", REPORT_STATUS_PENDING)
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load pending reports: ${error.message}`);
  }

  return ((data ?? []) as ReportIdRow[]).map((row) => row.id);
}

async function claimPendingReport(reportId: number): Promise<ClaimedReport | null> {
  const { data, error } = await supabase
    .from("reports")
    .update({ status: REPORT_STATUS_PROCESSING })
    .eq("id", reportId)
    .eq("status", REPORT_STATUS_PENDING)
    .select("id, content")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim report ${reportId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return data as ClaimedReport;
}

async function processClaimedReport(report: ClaimedReport): Promise<void> {
  const startMs = Date.now();
  console.log(`[worker] report ${report.id} processing started at ${new Date(startMs).toISOString()}`);

  try {
    const { data: latestReport, error: latestReportError } = await supabase
      .from("reports")
      .select("status, analysis_result")
      .eq("id", report.id)
      .maybeSingle();

    if (latestReportError) {
      throw new Error(
        `Failed to verify report state for ${report.id}: ${latestReportError.message}`,
      );
    }

    if (!latestReport) {
      console.warn(`[worker] report ${report.id} disappeared before processing`);
      return;
    }

    if (latestReport.status === REPORT_STATUS_ANALYZED || latestReport.analysis_result) {
      console.log(`[worker] report ${report.id} already analyzed, skipping`);
      return;
    }

    if (latestReport.status !== REPORT_STATUS_PROCESSING) {
      console.log(
        `[worker] report ${report.id} status changed to ${latestReport.status}, skipping`,
      );
      return;
    }

    const normalizedReportContent =
      typeof report.content === "string" ? normalizeContent(report.content) : "";
    let recentCategoryReports = 0;

    if (ENABLE_DETERMINISTIC_SIGNALS && normalizedReportContent) {
      try {
        const inferredCategory = inferReportCategory(normalizedReportContent);
        recentCategoryReports = await countRecentCategoryReports(
          report.id,
          inferredCategory,
        );
      } catch (signalError) {
        console.warn(
          `[worker] report ${report.id} deterministic signal lookup failed:`,
          signalError,
        );
      }
    }

    const deterministicSignals: DeterministicSignals = deriveDeterministicSignals(
      normalizedReportContent,
      recentCategoryReports,
      CATEGORY_SIGNAL_WINDOW_MINUTES,
      CATEGORY_SIGNAL_BURST_THRESHOLD,
    );

    if (ENABLE_STAGE0_PREFILTER) {
      if (shouldSkipAiForShortOrEmptyContent(normalizedReportContent)) {
        const skippedAnalysisWithGovernance = appendGovernanceMetadata(
          buildSkippedAnalysisResult("short_or_empty_content", undefined, {
            content_length: normalizedReportContent.length,
          }),
          {
            analysis_mode: "skipped",
            prompt_version: "skipped",
            deterministic_signals: deterministicSignals,
          },
        );
        const skippedAnalysis = appendDashboardAndEvaluationMetadata({
          payload: skippedAnalysisWithGovernance,
          averageConfidence: getAverageConfidenceFromAnalysis(skippedAnalysisWithGovernance),
          overallSeverity: getOverallSeverityFromAnalysis(skippedAnalysisWithGovernance),
          needsHumanReview: false,
          informationalOnly: true,
          normalizedContent: normalizedReportContent,
          repeatedReport: false,
          deterministicSignals,
        });
        await setReportAnalyzed(
          report.id,
          skippedAnalysis,
        );
        logAnalysisObservability({
          report_id: report.id,
          analysis_mode: "skipped",
          reused: false,
          rag_used: false,
          confidence: getAverageConfidenceFromAnalysis(skippedAnalysis),
          overall_severity: getOverallSeverityFromAnalysis(skippedAnalysis),
          prompt_version: "skipped",
        });
        console.log(`[worker] report ${report.id} skipped AI due to short/empty content`);
        return;
      }

      const duplicate = await findReusableAnalysisByHash(report.id, normalizedReportContent);

      if (duplicate) {
        const reusedAnalysisWithGovernance = appendGovernanceMetadata(
          buildSkippedAnalysisResult(
            "duplicate_report",
            duplicate.analysisResult,
            {
              reused_from_report_id: duplicate.sourceReportId,
            },
          ),
          {
            analysis_mode: "skipped",
            prompt_version: "skipped",
            deterministic_signals: deterministicSignals,
          },
        );
        const reusedAnalysis = appendDashboardAndEvaluationMetadata({
          payload: reusedAnalysisWithGovernance,
          averageConfidence: getAverageConfidenceFromAnalysis(reusedAnalysisWithGovernance),
          overallSeverity: getOverallSeverityFromAnalysis(reusedAnalysisWithGovernance),
          needsHumanReview: false,
          informationalOnly: true,
          normalizedContent: normalizedReportContent,
          repeatedReport: true,
          deterministicSignals,
        });
        await setReportAnalyzed(
          report.id,
          reusedAnalysis,
        );
        logAnalysisObservability({
          report_id: report.id,
          analysis_mode: "skipped",
          reused: true,
          rag_used: false,
          confidence: getAverageConfidenceFromAnalysis(reusedAnalysis),
          overall_severity: getOverallSeverityFromAnalysis(reusedAnalysis),
          prompt_version: "skipped",
        });
        console.log(
          `[worker] report ${report.id} reused analysis from report ${duplicate.sourceReportId}`,
        );
        return;
      }
    }

    const analysisMode = resolveAnalysisMode(normalizedReportContent);

    if (!analysisMode) {
      const skippedAnalysisWithGovernance = appendGovernanceMetadata(
        buildSkippedAnalysisResult(
          "analysis_disabled_by_configuration",
        ),
        {
          analysis_mode: "skipped",
          prompt_version: "skipped",
          deterministic_signals: deterministicSignals,
        },
      );
      const skippedAnalysis = appendDashboardAndEvaluationMetadata({
        payload: skippedAnalysisWithGovernance,
        averageConfidence: getAverageConfidenceFromAnalysis(skippedAnalysisWithGovernance),
        overallSeverity: getOverallSeverityFromAnalysis(skippedAnalysisWithGovernance),
        needsHumanReview: false,
        informationalOnly: true,
        normalizedContent: normalizedReportContent,
        repeatedReport: false,
        deterministicSignals,
      });
      await setReportAnalyzed(
        report.id,
        skippedAnalysis,
      );
      logAnalysisObservability({
        report_id: report.id,
        analysis_mode: "skipped",
        reused: false,
        rag_used: false,
        confidence: getAverageConfidenceFromAnalysis(skippedAnalysis),
        overall_severity: getOverallSeverityFromAnalysis(skippedAnalysis),
        prompt_version: "skipped",
      });
      console.log(`[worker] report ${report.id} skipped AI because analysis is disabled`);
      return;
    }

    let context = "";
    let documentsCount = 0;

    if (analysisMode === "deep") {
      try {
        const reportEmbedding = await createTextEmbedding(normalizedReportContent);
        const { error: reportEmbeddingError } = await supabase
          .from("reports")
          .update({ embedding: reportEmbedding })
          .eq("id", report.id);

        if (reportEmbeddingError) {
          throw new Error(
            `Failed to store report embedding for ${report.id}: ${reportEmbeddingError.message}`,
          );
        }

        if (containsEntitySignals(normalizedReportContent)) {
          const rag = await buildRagContext(reportEmbedding, 5, RAG_MAX_CONTEXT_TOKENS);
          context = rag.context;
          documentsCount = rag.documents.length;
        }
      } catch (embeddingError) {
        // Embedding or retrieval failure should not block AI analysis.
        console.error(
          `[worker] report ${report.id} embedding/rag failed; continuing with empty context:`,
          embeddingError,
        );
      }
    }

    if (analysisMode === "light") {
      context = "";
      documentsCount = 0;
    }

    const { analysis, modelUsed, promptVersion } = await analyzeReport({
      reportContent: normalizedReportContent,
      context,
      mode: analysisMode,
    });

    if (!isAnalysisResult(analysis)) {
      throw new Error("Analysis output failed final schema validation");
    }

    const confidencePenalty = ENABLE_CONFIDENCE_DEGRADATION
      ? applyConfidencePenalty(analysis, normalizedReportContent, {
          shortContentThreshold: CONFIDENCE_SHORT_CONTENT_THRESHOLD,
          missingReferencePenalty: safePenalty(CONFIDENCE_PENALTY_MISSING_REFERENCE),
          shortContentPenalty: safePenalty(CONFIDENCE_PENALTY_SHORT_CONTENT),
        })
      : {
          analysis,
          totalPenalty: 0,
          missingLocationOrTime: false,
          shortContent: false,
        };

    const lightGuardrails =
      analysisMode === "light" && ENABLE_LIGHT_ANALYSIS_GUARDRAILS
        ? applyLightAnalysisGuardrails(
            confidencePenalty.analysis,
            Number.isFinite(LIGHT_CONFIDENCE_THRESHOLD)
              ? LIGHT_CONFIDENCE_THRESHOLD
              : 0.6,
          )
        : {
            analysis: confidencePenalty.analysis,
            averageConfidence: getAverageConfidenceFromAnalysis(confidencePenalty.analysis),
            informationalOnly: false,
          };

    if (!isAnalysisResult(lightGuardrails.analysis)) {
      throw new Error("Governed analysis output failed final schema validation");
    }

    const averageConfidence = lightGuardrails.averageConfidence;
    const overallSeverity = lightGuardrails.analysis.overall_severity;
    const needsHumanReview =
      ENABLE_HUMAN_REVIEW_GATE &&
      averageConfidence !== null &&
      Number.isFinite(HUMAN_REVIEW_MIN_CONFIDENCE) &&
      Number.isFinite(HUMAN_REVIEW_HIGH_SEVERITY_THRESHOLD) &&
      overallSeverity >= HUMAN_REVIEW_HIGH_SEVERITY_THRESHOLD &&
      averageConfidence < HUMAN_REVIEW_MIN_CONFIDENCE;

    const baseAnalysisToStore = {
      ...lightGuardrails.analysis,
      ...(analysisMode === "light" ? { analysis_mode: "light" } : {}),
      ...(lightGuardrails.informationalOnly ? { informational_only: true } : {}),
      ...(needsHumanReview ? { needs_human_review: true } : {}),
    };

    const analysisWithGovernanceMetadata = appendGovernanceMetadata(baseAnalysisToStore, {
      analysis_mode: analysisMode,
      prompt_version: promptVersion,
      deterministic_signals: deterministicSignals,
      confidence_penalty: {
        total: confidencePenalty.totalPenalty,
        missing_location_or_time: confidencePenalty.missingLocationOrTime,
        short_content: confidencePenalty.shortContent,
      },
      informational_only: lightGuardrails.informationalOnly,
    });
    const analysisToStore = appendDashboardAndEvaluationMetadata({
      payload: analysisWithGovernanceMetadata,
      averageConfidence,
      overallSeverity,
      needsHumanReview,
      informationalOnly: lightGuardrails.informationalOnly,
      normalizedContent: normalizedReportContent,
      repeatedReport: false,
      deterministicSignals,
    });

    await setReportAnalyzed(report.id, analysisToStore);
    logAnalysisObservability({
      report_id: report.id,
      analysis_mode: analysisMode,
      reused: false,
      rag_used: documentsCount > 0,
      confidence: averageConfidence,
      overall_severity: overallSeverity,
      prompt_version: promptVersion,
      ...(lightGuardrails.informationalOnly ? { informational_only: true } : {}),
      ...(needsHumanReview ? { needs_human_review: true } : {}),
    });

    const durationMs = Date.now() - startMs;
    console.log(
      `[worker] report ${report.id} analyzed in ${durationMs}ms with mode=${analysisMode}, model=${modelUsed}, embedding_model=${EMBEDDING_MODEL}, context_docs=${documentsCount}`,
    );
  } catch (error) {
    const message = errorMessage(error);
    console.error(`[worker] report ${report.id} failed: ${message}`);
    await setReportFailed(report.id, message);
  }
}

async function runCycle(): Promise<void> {
  try {
    const embeddedDocs = await ensureDocumentEmbeddings(DOCUMENT_EMBEDDING_BATCH_SIZE);

    if (embeddedDocs > 0) {
      console.log(`[worker] generated embeddings for ${embeddedDocs} context documents`);
    }
  } catch (error) {
    // Document enrichment should not block report processing.
    console.error("[worker] document embedding sync failed; continuing report processing:", error);
  }

  const pendingIds = await listPendingReportIds(REPORT_BATCH_SIZE);

  if (pendingIds.length === 0) {
    return;
  }

  for (const reportId of pendingIds) {
    const claimed = await claimPendingReport(reportId);

    if (!claimed) {
      continue;
    }

    await processClaimedReport(claimed);
  }
}

export function startReportProcessor(): void {
  let cycleInFlight = false;

  const runSafely = async (): Promise<void> => {
    if (cycleInFlight) {
      return;
    }

    cycleInFlight = true;

    try {
      await runCycle();
    } catch (error) {
      console.error("[worker] cycle failed:", error);
    } finally {
      cycleInFlight = false;
    }
  };

  console.log(
    `[worker] started with poll interval ${POLL_INTERVAL_MS}ms and batch size ${REPORT_BATCH_SIZE}`,
  );

  void runSafely();

  const interval = setInterval(() => {
    void runSafely();
  }, POLL_INTERVAL_MS);

  const shutdown = (signal: string): void => {
    console.log(`[worker] received ${signal}, shutting down`);
    clearInterval(interval);
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) {
  startReportProcessor();
}
