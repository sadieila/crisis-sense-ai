import { DeterministicSignals } from "./analysisGovernance";

export type SeverityBucket = "low" | "medium" | "high";
export type TrustLevel = "low" | "medium" | "high";
export type DisplayMode = "informational" | "actionable" | "review_required";

export type DashboardView = {
  severity_bucket: SeverityBucket;
  trust_level: TrustLevel;
  urgency_flag: boolean;
  display_mode: DisplayMode;
};

export type DashboardViewInput = {
  overallSeverity: number | null;
  averageConfidence: number | null;
  needsHumanReview: boolean;
  informationalOnly: boolean;
};

export type EvaluationTag =
  | "vague_input"
  | "short_input"
  | "repeated_report"
  | "high_risk_event"
  | "multi_entity_report";

export type EvaluationTagInput = {
  content: string;
  isRepeated: boolean;
  overallSeverity: number | null;
  deterministicSignals: DeterministicSignals;
  shortInputThreshold: number;
  vagueInputMinWords: number;
};

export type EvaluationSummary = {
  total_reports: number;
  vague_input: number;
  short_input: number;
  repeated_report: number;
  high_risk_event: number;
  multi_entity_report: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toWordCount(content: string): number {
  const normalized = content.trim();

  if (!normalized) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}

export function deriveSeverityBucket(overallSeverity: number | null): SeverityBucket {
  const value = typeof overallSeverity === "number" && Number.isFinite(overallSeverity)
    ? overallSeverity
    : 0;

  if (value >= 7) {
    return "high";
  }

  if (value >= 4) {
    return "medium";
  }

  return "low";
}

export function deriveTrustLevel(averageConfidence: number | null): TrustLevel {
  const value = typeof averageConfidence === "number" && Number.isFinite(averageConfidence)
    ? clamp(averageConfidence, 0, 1)
    : 0;

  if (value >= 0.75) {
    return "high";
  }

  if (value >= 0.5) {
    return "medium";
  }

  return "low";
}

export function deriveDashboardView(input: DashboardViewInput): DashboardView {
  const severityBucket = deriveSeverityBucket(input.overallSeverity);
  const trustLevel = deriveTrustLevel(input.averageConfidence);
  const urgencyFlag =
    (input.overallSeverity ?? 0) >= 7 && trustLevel !== "low";

  if (input.needsHumanReview) {
    return {
      severity_bucket: severityBucket,
      trust_level: trustLevel,
      urgency_flag: urgencyFlag,
      display_mode: "review_required",
    };
  }

  if (input.informationalOnly || trustLevel === "low") {
    return {
      severity_bucket: severityBucket,
      trust_level: trustLevel,
      urgency_flag: urgencyFlag,
      display_mode: "informational",
    };
  }

  return {
    severity_bucket: severityBucket,
    trust_level: trustLevel,
    urgency_flag: urgencyFlag,
    display_mode: "actionable",
  };
}

export function deriveEvaluationTags(input: EvaluationTagInput): EvaluationTag[] {
  const tags: EvaluationTag[] = [];
  const contentLength = input.content.length;
  const wordCount = toWordCount(input.content);
  const severity = input.overallSeverity ?? 0;

  if (contentLength < input.shortInputThreshold) {
    tags.push("short_input");
  }

  const looksVague =
    wordCount < input.vagueInputMinWords &&
    input.deterministicSignals.entity_matches.length === 0 &&
    input.deterministicSignals.inferred_category === "uncategorized";

  if (looksVague) {
    tags.push("vague_input");
  }

  if (input.isRepeated) {
    tags.push("repeated_report");
  }

  if (severity >= 7 || input.deterministicSignals.severity_signal) {
    tags.push("high_risk_event");
  }

  if (input.deterministicSignals.complexity_signal) {
    tags.push("multi_entity_report");
  }

  return [...new Set(tags)];
}

export function summarizeEvaluationTags(
  tagSets: Array<ReadonlyArray<EvaluationTag> | null | undefined>,
): EvaluationSummary {
  const summary: EvaluationSummary = {
    total_reports: 0,
    vague_input: 0,
    short_input: 0,
    repeated_report: 0,
    high_risk_event: 0,
    multi_entity_report: 0,
  };

  for (const tags of tagSets) {
    summary.total_reports += 1;

    if (!tags || tags.length === 0) {
      continue;
    }

    const uniqueTags = new Set(tags);

    for (const tag of uniqueTags) {
      summary[tag] += 1;
    }
  }

  return summary;
}
