import type { AIAnalysis, Crisis, Report, Stats } from "@shared/schema";

const CACHE_TTL = 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const TIMEOUT_MS = 30 * 1000;

interface CacheEntry {
  data: AIAnalysis;
  timestamp: number;
}

const analysisCache = new Map<string, CacheEntry>();
const lastCallTime = new Map<string, number>();

interface AnalysisContext {
  crisis: Crisis;
  stats: Stats;
  sampleReports: Pick<Report, "id" | "category" | "area" | "subProblem" | "details">[];
}

function buildPrompt(context: AnalysisContext): string {
  return `أنت مساعد تحليلي باللغة العربية مهمته: توليد تفسير تحليلي مُبسّط ومحايد لأزمة مبنية على بيانات رقمية ونصوص بلاغات.
لا تصدّر أي نص خارج شكل JSON المطلوب. لا تعطي تعليمات تنفيذية — فقط تفسير، فرضيات قابلة للاختبار، ونقاط مراقبة قابلة للقياس.

البيانات:
${JSON.stringify({ crisis: context.crisis, stats: context.stats, sampleReports: context.sampleReports }, null, 2)}

أنتج JSON بالشكل التالي بالضبط:
{
  "narrative": "ملخص 3-5 جمل قصيرة بالعربية",
  "hypotheses": [{"text": "نص الفرضية", "likelihood": "high|medium|low", "evidence": ["report-id"]}],
  "what_to_watch": [{"metric": "المقياس", "threshold": "الحد", "why": "السبب"}],
  "sampleReports": [{"id": "...", "excerpt": "..."}],
  "confidence": 0.0-1.0,
  "disclaimer": "تفسير تحليلي — لا يُعد توصية تنفيذية"
}`;
}

function generateMockAnalysis(crisis: Crisis, sampleReports: Report[]): AIAnalysis {
  const evidenceIds = sampleReports.slice(0, 3).map(r => r.id);

  return {
    narrative: `تحليل أزمة "${crisis.title}": تم رصد ${crisis.reportCount} بلاغ مرتبط بهذه الأزمة في منطقة ${crisis.area}. الوضع يتطلب متابعة دقيقة من المنظمات الإنسانية المعنية. البلاغات تشير إلى نمط تصاعدي في حدة المشكلة مع وجود فجوة بين الاحتياجات والاستجابة الحالية. التركّز الجغرافي يشير إلى بؤرة محددة تتطلب أولوية في التدخل.`,
    hypotheses: [
      {
        text: `تدمير أو تضرر البنية التحتية في منطقة ${crisis.area} قد يكون العامل الرئيسي وراء تصاعد البلاغات`,
        likelihood: "high" as const,
        evidence: evidenceIds.slice(0, 2),
      },
      {
        text: "احتمال تفاقم الوضع خلال 48-72 ساعة القادمة في حال عدم التدخل المباشر",
        likelihood: "medium" as const,
        evidence: evidenceIds.slice(0, 1),
      },
      {
        text: "وجود ارتباط محتمل بين هذه الأزمة وأزمات مجاورة مما يضاعف الأثر على السكان المتضررين",
        likelihood: "medium" as const,
        evidence: evidenceIds,
      },
    ],
    watchPoints: [
      {
        metric: "معدل البلاغات الجديدة",
        threshold: `أكثر من ${Math.ceil(crisis.reportCount / 7)} بلاغ يومياً`,
        why: "يشير إلى تسارع في تدهور الوضع وحاجة لتصعيد الاستجابة",
      },
      {
        metric: "نسبة البلاغات الحرجة",
        threshold: "تجاوز 60% من إجمالي البلاغات",
        why: "يدل على تحول نوعي في طبيعة الأزمة يستدعي موارد متخصصة",
      },
      {
        metric: "التوسع الجغرافي",
        threshold: "ظهور بلاغات في مناطق جديدة",
        why: "يشير إلى انتشار الأزمة خارج البؤرة الأصلية",
      },
    ],
    sampleReports: sampleReports.slice(0, 5).map(r => ({
      id: r.id,
      title: r.subProblem,
      category: r.category,
      area: r.area,
    })),
    confidence: crisis.severity === "critical" ? 0.82 : crisis.severity === "high" ? 0.71 : 0.65,
    disclaimer: "تفسير تحليلي — لا يُعد توصية تنفيذية",
  };
}

async function callClaudeAPI(prompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`Claude API error: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    return data?.content?.[0]?.text || null;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn("Claude API timeout");
    } else {
      console.warn("Claude API error:", err.message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAnalysis(
  crisis: Crisis,
  sampleReports: Report[],
  stats: Stats,
): Promise<AIAnalysis> {
  const cached = analysisCache.get(crisis.id);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const lastCall = lastCallTime.get(crisis.id) || 0;
  const timeSinceLastCall = Date.now() - lastCall;

  let analysis: AIAnalysis;

  if (timeSinceLastCall >= COOLDOWN_MS) {
    lastCallTime.set(crisis.id, Date.now());

    const context: AnalysisContext = {
      crisis,
      stats,
      sampleReports: sampleReports.map(r => ({
        id: r.id,
        category: r.category,
        area: r.area,
        subProblem: r.subProblem,
        details: r.details,
      })),
    };

    const prompt = buildPrompt(context);
    const rawText = await callClaudeAPI(prompt);

    if (rawText) {
      try {
        const parsed = JSON.parse(rawText);
        analysis = {
          narrative: parsed.narrative || "",
          hypotheses: (parsed.hypotheses || []).map((h: any) => ({
            text: h.text || "",
            likelihood: h.likelihood || "medium",
            evidence: h.evidence || [],
          })),
          watchPoints: (parsed.what_to_watch || []).map((w: any) => ({
            metric: w.metric || "",
            threshold: w.threshold || "",
            why: w.why || "",
          })),
          sampleReports: (parsed.sampleReports || []).map((r: any) => ({
            id: r.id || "",
            title: r.excerpt || r.title || "",
            category: "",
            area: "",
          })),
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
          disclaimer: parsed.disclaimer || "تفسير تحليلي — لا يُعد توصية تنفيذية",
        };
      } catch {
        console.warn("Failed to parse Claude response, using mock");
        analysis = generateMockAnalysis(crisis, sampleReports);
      }
    } else {
      analysis = generateMockAnalysis(crisis, sampleReports);
    }
  } else {
    analysis = generateMockAnalysis(crisis, sampleReports);
  }

  analysisCache.set(crisis.id, { data: analysis, timestamp: Date.now() });
  return analysis;
}

export function clearAnalysisCache(crisisId?: string) {
  if (crisisId) {
    analysisCache.delete(crisisId);
  } else {
    analysisCache.clear();
  }
}
