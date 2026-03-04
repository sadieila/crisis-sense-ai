import { AnalysisResult, RecommendationItem } from "../types/analysis";

type CategoryRule = {
  name: string;
  patterns: RegExp[];
};

type EntityRule = {
  name: string;
  pattern: RegExp;
};

const CATEGORY_RULES: CategoryRule[] = [
  {
    name: "health",
    patterns: [/\b(hospital|clinic|ambulance|patient|medical|health|injur|disease)\b/i],
  },
  {
    name: "infrastructure",
    patterns: [/\b(road|bridge|highway|power|electric|water|sewage|network|station)\b/i],
  },
  {
    name: "safety",
    patterns: [/\b(fire|explosion|collapse|evacuat|accident|hazard|danger|violence)\b/i],
  },
  {
    name: "environment",
    patterns: [/\b(flood|wildfire|earthquake|storm|pollution|contamination|landslide)\b/i],
  },
];

const ENTITY_RULES: EntityRule[] = [
  { name: "hospital", pattern: /\bhospital\b/i },
  { name: "road", pattern: /\b(road|highway|street|bridge)\b/i },
  { name: "school", pattern: /\bschool\b/i },
  { name: "transport", pattern: /\b(airport|station|bus|rail)\b/i },
  { name: "utilities", pattern: /\b(power|electric|water|substation|pipeline)\b/i },
  { name: "district", pattern: /\b(city|district|zone|neighborhood)\b/i },
];

const LOCATION_HINT_REGEX =
  /\b(at|in|near|around)\s+[a-z0-9][a-z0-9\s\-]{2,}\b|\b(road|street|avenue|district|city|hospital|school|bridge|station)\b/i;
const TIME_HINT_REGEX =
  /\b(today|yesterday|tonight|morning|afternoon|evening|night|hour|hours|minute|minutes)\b|\b\d{1,2}:\d{2}\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function averageConfidence(recommendations: RecommendationItem[]): number | null {
  if (recommendations.length === 0) {
    return null;
  }

  const sum = recommendations.reduce((acc, item) => acc + item.confidence, 0);
  return Number((sum / recommendations.length).toFixed(4));
}

export type DeterministicSignals = {
  inferred_category: string;
  severity_signal: boolean;
  complexity_signal: boolean;
  entity_matches: string[];
  recent_category_reports: number;
  category_window_minutes: number;
};

export type ConfidencePenaltyOptions = {
  shortContentThreshold: number;
  missingReferencePenalty: number;
  shortContentPenalty: number;
};

export type ConfidencePenaltyResult = {
  analysis: AnalysisResult;
  totalPenalty: number;
  missingLocationOrTime: boolean;
  shortContent: boolean;
};

export type LightGuardrailResult = {
  analysis: AnalysisResult;
  averageConfidence: number | null;
  informationalOnly: boolean;
};

export function inferReportCategory(content: string): string {
  let winner = "uncategorized";
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;

    for (const pattern of rule.patterns) {
      if (pattern.test(content)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      winner = rule.name;
    }
  }

  return winner;
}

export function deriveDeterministicSignals(
  content: string,
  recentCategoryReports: number,
  categoryWindowMinutes: number,
  categoryBurstThreshold: number,
): DeterministicSignals {
  const inferredCategory = inferReportCategory(content);
  const matchedEntities = ENTITY_RULES.filter((rule) => rule.pattern.test(content)).map(
    (rule) => rule.name,
  );

  return {
    inferred_category: inferredCategory,
    severity_signal: recentCategoryReports >= categoryBurstThreshold,
    complexity_signal: matchedEntities.length >= 2,
    entity_matches: matchedEntities,
    recent_category_reports: recentCategoryReports,
    category_window_minutes: categoryWindowMinutes,
  };
}

function hasLocationOrTimeHints(content: string): boolean {
  return LOCATION_HINT_REGEX.test(content) && TIME_HINT_REGEX.test(content);
}

export function applyConfidencePenalty(
  analysis: AnalysisResult,
  content: string,
  options: ConfidencePenaltyOptions,
): ConfidencePenaltyResult {
  const missingLocationOrTime = !hasLocationOrTimeHints(content);
  const shortContent = content.length < options.shortContentThreshold;

  let totalPenalty = 0;

  if (missingLocationOrTime) {
    totalPenalty += options.missingReferencePenalty;
  }

  if (shortContent) {
    totalPenalty += options.shortContentPenalty;
  }

  totalPenalty = clamp(totalPenalty, 0, 1);

  if (totalPenalty <= 0) {
    return {
      analysis,
      totalPenalty,
      missingLocationOrTime,
      shortContent,
    };
  }

  const downgraded: AnalysisResult = {
    ...analysis,
    recommendations: analysis.recommendations.map((item) => ({
      ...item,
      confidence: clamp(item.confidence - totalPenalty, 0, 1),
    })),
  };

  return {
    analysis: downgraded,
    totalPenalty,
    missingLocationOrTime,
    shortContent,
  };
}

export function applyLightAnalysisGuardrails(
  analysis: AnalysisResult,
  minimumConfidence: number,
): LightGuardrailResult {
  const boundedThreshold = clamp(minimumConfidence, 0, 1);
  const originalAverage = averageConfidence(analysis.recommendations);
  const filteredRecommendations = analysis.recommendations.filter(
    (item) => item.confidence >= boundedThreshold,
  );

  const filtered: AnalysisResult = {
    ...analysis,
    recommendations: filteredRecommendations,
  };

  const informationalOnly =
    originalAverage === null || originalAverage < boundedThreshold;

  if (informationalOnly) {
    return {
      analysis: { ...analysis, recommendations: [] },
      averageConfidence: originalAverage,
      informationalOnly,
    };
  }

  return {
    analysis: filtered,
    averageConfidence: originalAverage,
    informationalOnly,
  };
}
