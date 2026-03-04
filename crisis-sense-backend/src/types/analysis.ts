export type RiskSeverity = "low" | "medium" | "high";

export type RiskItem = {
  description: string;
  severity: RiskSeverity;
  reason: string;
};

export type RecommendationItem = {
  action: string;
  confidence: number;
  priority: number;
};

export type AnalysisResult = {
  summary: string;
  risks: RiskItem[];
  recommendations: RecommendationItem[];
  overall_severity: number;
};

export const ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "risks", "recommendations", "overall_severity"],
  properties: {
    summary: { type: "string" },
    risks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "severity", "reason"],
        properties: {
          description: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string" },
        },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "confidence", "priority"],
        properties: {
          action: { type: "string" },
          confidence: { type: "number" },
          priority: { type: "number" },
        },
      },
    },
    overall_severity: { type: "number" },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRiskSeverity(value: unknown): value is RiskSeverity {
  return value === "low" || value === "medium" || value === "high";
}

function isRiskItem(value: unknown): value is RiskItem {
  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);

  if (keys.length !== 3 || !keys.includes("description") || !keys.includes("severity") || !keys.includes("reason")) {
    return false;
  }

  return (
    typeof value.description === "string" &&
    value.description.trim().length > 0 &&
    isRiskSeverity(value.severity) &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0
  );
}

function isRecommendationItem(value: unknown): value is RecommendationItem {
  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);

  if (keys.length !== 3 || !keys.includes("action") || !keys.includes("confidence") || !keys.includes("priority")) {
    return false;
  }

  const confidenceValid =
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1;

  const priorityValid =
    typeof value.priority === "number" &&
    Number.isFinite(value.priority) &&
    value.priority >= 0 &&
    Number.isInteger(value.priority);

  return (
    typeof value.action === "string" &&
    value.action.trim().length > 0 &&
    confidenceValid &&
    priorityValid
  );
}

export function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (!isPlainObject(value)) {
    return false;
  }

  const keys = Object.keys(value);
  const expectedKeys = ["summary", "risks", "recommendations", "overall_severity"];

  if (keys.length !== expectedKeys.length || !expectedKeys.every((key) => keys.includes(key))) {
    return false;
  }

  if (typeof value.summary !== "string" || value.summary.trim().length === 0) {
    return false;
  }

  if (!Array.isArray(value.risks) || !value.risks.every(isRiskItem)) {
    return false;
  }

  if (
    !Array.isArray(value.recommendations) ||
    !value.recommendations.every(isRecommendationItem)
  ) {
    return false;
  }

  if (
    typeof value.overall_severity !== "number" ||
    !Number.isFinite(value.overall_severity) ||
    value.overall_severity < 0 ||
    value.overall_severity > 10
  ) {
    return false;
  }

  return true;
}
