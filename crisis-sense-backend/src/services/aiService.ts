import dotenv from "dotenv";
import {
  ANALYSIS_JSON_SCHEMA,
  AnalysisResult,
  isAnalysisResult,
} from "../types/analysis";
import { retryWithExponentialBackoff } from "../utils/retry";
import { getRequiredEnv } from "../utils/env";
import {
  ALLOWED_ANTHROPIC_MODEL,
  assertAllowedAnthropicModel,
} from "../utils/modelPolicy";

dotenv.config({ quiet: true });

const ANTHROPIC_API_KEY = getRequiredEnv("ANTHROPIC_API_KEY");

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_TIMEOUT_MS = 45_000;

const ANALYSIS_MODEL = ALLOWED_ANTHROPIC_MODEL;
assertAllowedAnthropicModel(ANALYSIS_MODEL, "analysis");
console.log(`[analysis] using model: ${ANALYSIS_MODEL}`);

const ANALYSIS_SYSTEM_PROMPT = `You are the Crisis-Sense incident analysis engine.
Return one JSON object only, with no markdown and no extra text.
The JSON MUST match this exact schema and key names:
{
  "summary": string,
  "risks": [
    { "description": string, "severity": "low"|"medium"|"high", "reason": string }
  ],
  "recommendations": [
    { "action": string, "confidence": number, "priority": number }
  ],
  "overall_severity": number
}
Rules:
- Never output keys outside the schema.
- Do not invent facts or sources; if unsure, say so in the summary.
- Recommendations must be realistic and directly actionable.
- confidence must be between 0 and 1 and reflect uncertainty.
- overall_severity must be between 0 and 10.
- Base conclusions only on provided report and context.
- If context quality is low or empty, reduce confidence.
- If analysis_mode is "light", keep output concise and low-cost.
- Output valid JSON only.`;

type AnalyzeReportInput = {
  reportContent: string;
  context: string;
  mode: AnalysisMode;
};

type AnalyzeReportResult = {
  analysis: AnalysisResult;
  modelUsed: string;
  promptVersion: string;
};

export type AnalysisMode = "light" | "deep";

type AnthropicMessageResponse = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  stop_reason?: string | null;
};

type ContextQuality = "low" | "medium" | "high";

type ContextQualityStats = {
  quality: ContextQuality;
  maxSimilarity: number | null;
  averageSimilarity: number | null;
  hasContext: boolean;
};

const MAX_LIGHT_REPORT_CHARS = 1800;
const MAX_DEEP_REPORT_CHARS = 6000;
const MAX_DEEP_CONTEXT_CHARS = 3500;

const LIGHT_MAX_TOKENS = 500;
const LIGHT_RETRY_MAX_TOKENS = 320;
const DEEP_MAX_TOKENS = 1400;
const DEEP_RETRY_MAX_TOKENS = 900;
const PROMPT_VERSION_LIGHT = "v1.0-light";
const PROMPT_VERSION_DEEP = "v1.0-deep";

class AnthropicHttpError extends Error {
  status: number;

  body: string;

  retryable: boolean;

  constructor(status: number, body: string) {
    super(`Anthropic messages request failed with status ${status}: ${body}`);
    this.name = "AnthropicHttpError";
    this.status = status;
    this.body = body;
    this.retryable = status === 429 || status >= 500;
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxChars - 3))}...`;
}

function getPromptVersion(mode: AnalysisMode): string {
  return mode === "deep" ? PROMPT_VERSION_DEEP : PROMPT_VERSION_LIGHT;
}

function deriveContextQuality(context: string): ContextQualityStats {
  const trimmed = normalizeText(context);

  if (!trimmed) {
    return {
      quality: "low",
      maxSimilarity: null,
      averageSimilarity: null,
      hasContext: false,
    };
  }

  const matches = [...trimmed.matchAll(/similarity\s+([0-9]*\.?[0-9]+)/gi)];
  const values = matches
    .map((match) => Number.parseFloat(match[1]))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return {
      quality: "low",
      maxSimilarity: null,
      averageSimilarity: null,
      hasContext: true,
    };
  }

  const maxSimilarity = Math.max(...values);
  const averageSimilarity = values.reduce((sum, value) => sum + value, 0) / values.length;

  let quality: ContextQuality = "low";

  if (maxSimilarity >= 0.35) {
    quality = "high";
  } else if (maxSimilarity >= 0.2) {
    quality = "medium";
  }

  return {
    quality,
    maxSimilarity,
    averageSimilarity,
    hasContext: true,
  };
}

function enforceContextConfidencePolicy(
  analysis: AnalysisResult,
  quality: ContextQuality,
): AnalysisResult {
  if (quality === "high") {
    return analysis;
  }

  const maxConfidence = quality === "low" ? 0.45 : 0.75;
  const scale = quality === "low" ? 0.6 : 0.85;

  return {
    ...analysis,
    recommendations: analysis.recommendations.map((item) => ({
      ...item,
      confidence: clamp(item.confidence * scale, 0, maxConfidence),
    })),
  };
}

function extractModelErrorBody(error: unknown): string {
  if (!(error instanceof AnthropicHttpError)) {
    return "";
  }

  return error.body.toLowerCase();
}

function isModelUnavailableError(error: unknown): boolean {
  if (!(error instanceof AnthropicHttpError)) {
    return false;
  }

  const body = extractModelErrorBody(error);

  if (error.status === 404) {
    return true;
  }

  if (error.status !== 400) {
    return false;
  }

  return body.includes("model") && (body.includes("not found") || body.includes("unsupported"));
}

function extractResponseText(payload: AnthropicMessageResponse): string {
  if (!Array.isArray(payload.content)) {
    throw new Error("Anthropic response did not include content blocks");
  }

  const textParts = payload.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (textParts.length === 0) {
    throw new Error("Anthropic response content did not contain text output");
  }

  return textParts.join("\n").trim();
}

function parseJsonOutput(rawOutput: string): unknown {
  try {
    return JSON.parse(rawOutput);
  } catch {
    const start = rawOutput.indexOf("{");
    const end = rawOutput.lastIndexOf("}");

    if (start === -1 || end <= start) {
      throw new Error("Model output was not valid JSON");
    }

    return JSON.parse(rawOutput.slice(start, end + 1));
  }
}

async function requestAnalysis(
  model: string,
  reportContent: string,
  context: string,
  mode: AnalysisMode,
  contextStats: ContextQualityStats,
): Promise<AnalysisResult> {
  const userPayload = {
    report_content: reportContent,
    retrieved_context: context,
    analysis_mode: mode,
    context_quality: contextStats.quality,
    context_similarity_max: contextStats.maxSimilarity,
    context_similarity_avg: contextStats.averageSimilarity,
    context_available: contextStats.hasContext,
    output_schema: ANALYSIS_JSON_SCHEMA,
  };

  const responsePayload = await retryWithExponentialBackoff(
    async (attempt) => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), ANTHROPIC_TIMEOUT_MS);
      const maxTokens = mode === "light"
        ? attempt > 1
          ? LIGHT_RETRY_MAX_TOKENS
          : LIGHT_MAX_TOKENS
        : attempt > 1
          ? DEEP_RETRY_MAX_TOKENS
          : DEEP_MAX_TOKENS;

      try {
        const response = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature: 0,
            system: ANALYSIS_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: JSON.stringify(userPayload),
              },
            ],
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new AnthropicHttpError(response.status, body);
        }

        return (await response.json()) as AnthropicMessageResponse;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      maxAttempts: 4,
      onRetry: (error, attempt, delayMs) => {
        console.warn(
          `[analysis] retrying Anthropic request for model ${model} (attempt ${attempt + 1}) in ${delayMs}ms: ${String(
            error,
          )}`,
        );
      },
    },
  );

  const rawOutput = extractResponseText(responsePayload);
  const parsed = parseJsonOutput(rawOutput);

  if (!isAnalysisResult(parsed)) {
    throw new Error("Model returned JSON that does not match AnalysisResult schema");
  }

  return parsed;
}

export async function analyzeReport({
  reportContent,
  context,
  mode,
}: AnalyzeReportInput): Promise<AnalyzeReportResult> {
  const normalizedReport = normalizeText(reportContent);
  const normalizedContext = normalizeText(context);

  if (!normalizedReport) {
    throw new Error("Report content is empty after normalization");
  }

  const boundedReport = truncateText(
    normalizedReport,
    mode === "light" ? MAX_LIGHT_REPORT_CHARS : MAX_DEEP_REPORT_CHARS,
  );
  const boundedContext =
    mode === "deep" ? truncateText(normalizedContext, MAX_DEEP_CONTEXT_CHARS) : "";

  let lastError: unknown = null;

  const startMs = Date.now();
  console.log(`[analysis] starting model call: ${ANALYSIS_MODEL}, mode=${mode}`);
  const promptVersion = getPromptVersion(mode);

  try {
    const contextStats = deriveContextQuality(boundedContext);
    const analysis = await requestAnalysis(
      ANALYSIS_MODEL,
      boundedReport,
      boundedContext,
      mode,
      contextStats,
    );
    const hardened = enforceContextConfidencePolicy(analysis, contextStats.quality);

    if (!isAnalysisResult(hardened)) {
      throw new Error("Hardened analysis failed schema validation");
    }

    const durationMs = Date.now() - startMs;
    console.log(`[analysis] model ${ANALYSIS_MODEL} completed in ${durationMs}ms, mode=${mode}`);
    return { analysis: hardened, modelUsed: ANALYSIS_MODEL, promptVersion };
  } catch (error) {
    const durationMs = Date.now() - startMs;
    console.error(`[analysis] model ${ANALYSIS_MODEL} failed in ${durationMs}ms:`, error);
    lastError = error;
  }

  throw new Error(
    `Claude analysis failed using ${ANALYSIS_MODEL}. Last error: ${String(lastError ?? "unknown")}`,
  );
}
