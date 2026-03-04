/**
 * incidentAiService.ts  —  AI Intelligence Layer v2.0
 *
 * PROMPT VERSION: v2.0 (cross-category reasoning, cohesion scoring, structured JSON)
 * RULES FILE:     server/services/AI_INTELLIGENCE_RULES.md
 *
 * STRICT CONSTRAINTS (never violate):
 *  1. Called ONLY when an incident transitions to "active"
 *  2. Called ONLY ONCE per incident unless manually re-triggered
 *  3. Never called per-report, never called on every request
 *  4. Zero PII sent to Claude — no fullName, idNumber, phone in prompt
 *  5. AI output is ADVISORY ONLY — never auto-closes or auto-escalates incidents
 *  6. All failures are logged with full detail — no silent swallowing
 *  7. Confidence level and disclaimer are MANDATORY in every response
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient as SC } from "@supabase/supabase-js";
import type { Incident } from "@shared/schema";

const TIMEOUT_MS = 60_000; // v2.0 prompt is larger — allow 60s

// ── Model resolution ───────────────────────────────────────────────────────────

function getModel(): string {
    return (
        process.env.CLAUDE_MODEL ??
        process.env.ANTHROPIC_ANALYSIS_MODEL_PRIMARY ??
        "claude-3-5-sonnet-20240620"
    );
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface IncidentReportContext {
    title: string | null;
    content: string | null;
    area: string | null;
    category?: string | null;
    created_at?: string | null;
}

/** Mirrors the JSON output contract defined in AI_INTELLIGENCE_RULES.md Part VI */
interface AiV2Output {
    narrative: string;
    hypotheses: Array<{
        hypothesis: string;
        causal_chain: string;
        confidence: "عالية" | "متوسطة" | "منخفضة";
        supporting_evidence: string[];
        counter_evidence: string[];
    }>;
    cross_category_signals: Array<{
        related_category: string;
        relationship_type: string;
        signal_description: string;
        confidence: "عالية" | "متوسطة" | "منخفضة";
    }>;
    cohesion_assessment: {
        score: number;
        band: "عالي" | "متوسط" | "ضعيف" | "هش";
        reasoning: string;
        grouping_risk: "acceptable" | "review_recommended" | "split_recommended";
    };
    watch_points: Array<{
        metric: string;
        threshold: string;
        rationale: string;
    }>;
    immediate_recommendation: string;
    confidence: {
        score: number;
        level: "عالية" | "متوسطة" | "منخفضة";
        key_limitations: string[];
    };
    disclaimer: string;
}

// ── PII stripper ───────────────────────────────────────────────────────────────

/**
 * Strip any PII-bearing fields before building the prompt.
 * Rule: NEVER send fullName, idNumber, or phone to Claude.
 */
function sanitizeReportForPrompt(
    r: IncidentReportContext & { fullName?: string; idNumber?: string; phone?: string },
): IncidentReportContext {
    return {
        title: r.title,
        content: r.content,
        area: r.area,
        category: r.category,
        created_at: r.created_at,
        // fullName, idNumber, phone: deliberately excluded
    };
}

// ── v2.0 Prompt builder ────────────────────────────────────────────────────────

/**
 * Build the v2.0 prompt following the AI_INTELLIGENCE_RULES.md framework.
 * Key upgrades over v1.0:
 *  - Arabic system role preamble
 *  - Cross-category causal chain reasoning
 *  - Structured hypothesis analysis with counter-evidence
 *  - Cohesion scoring (0–100)
 *  - Confidence calibration (score + limitations)
 *  - Mandatory disclaimer
 */
function buildIncidentPromptV2(
    incident: Incident,
    memberReports: IncidentReportContext[],
): string {
    const SYSTEM_ROLE = `أنت محلل ذكاء اصطناعي متخصص في تحليل بلاغات الأزمات الإنسانية ميدانياً في قطاع غزة. مهمتك هي:
1. تحليل مجموعة البلاغات المرتبطة بالحادثة وتقديم تقييم استشاري موضوعي
2. الكشف عن الروابط السببية والعلاقات المخفية بين الفئات المختلفة
3. تقديم درجة تماسك للمجموعة (هل البلاغات تصف حادثة واحدة متماسكة أم حالات متفرقة؟)
4. الإشارة بصراحة إلى حدود ثقتك في التحليل

قواعد صارمة لا تُخالَف:
- لا تقرر، لا تُصدر أوامر، لا تُصعّد تلقائياً — أنت تُقدّم رأياً استشارياً للمشغل البشري
- لا تستنتج معلومات شخصية تعريفية (لا أسماء، لا أرقام هويات)
- إذا كانت البيانات غير كافية للاستنتاج القاطع، قل ذلك صراحةً مع درجة ثقة منخفضة
- الإخراج يجب أن يكون JSON صحيح فقط — لا نص قبله ولا بعده`;

    const safeReports = memberReports
        .slice(0, 10)
        .map(sanitizeReportForPrompt);

    const reportLines = safeReports
        .map((r, i) => {
            const date = r.created_at ? new Date(r.created_at).toLocaleDateString("ar-EG") : "غير محدد";
            const content = (r.content ?? r.title ?? "").slice(0, 350);
            return `[بلاغ ${i + 1}] التاريخ: ${date} | الفئة: ${r.category ?? incident.category} | المنطقة: ${r.area ?? incident.area}\n${content}`;
        })
        .join("\n\n---\n\n");

    const outputContract = JSON.stringify({
        narrative: "وصف عربي من 3–4 جمل للحادثة: ماذا يحدث، أين، وما مدى خطورتها",
        hypotheses: [
            {
                hypothesis: "الفرضية السببية الرئيسية",
                causal_chain: "سلسلة السببية المباشرة (مثال: انقطاع المياه → غياب النظافة → انتشار العدوى)",
                confidence: "عالية | متوسطة | منخفضة",
                supporting_evidence: ["دليل 1 من البلاغات", "دليل 2"],
                counter_evidence: ["شيء يُضعف هذه الفرضية إن وُجد"]
            }
        ],
        cross_category_signals: [
            {
                related_category: "اسم الفئة المرتبطة بالعربية",
                relationship_type: "سببية | تعزيزية | متزامنة",
                signal_description: "وصف العلاقة بين فئتي الحادثة والفئة المرتبطة",
                confidence: "عالية | متوسطة | منخفضة"
            }
        ],
        cohesion_assessment: {
            score: 0,
            band: "عالي (75-100) | متوسط (50-74) | ضعيف (25-49) | هش (0-24)",
            reasoning: "لماذا هذه الدرجة؟ هل البلاغات تصف حادثة واحدة أم حالات متفرقة؟",
            grouping_risk: "acceptable | review_recommended | split_recommended"
        },
        watch_points: [
            {
                metric: "مؤشر المراقبة",
                threshold: "الحد الذي يستوجب التصعيد",
                rationale: "لماذا هذا المؤشر مهم"
            }
        ],
        immediate_recommendation: "توصية واحدة فورية محددة وقابلة للتنفيذ (جملة واحدة)",
        confidence: {
            score: 0,
            level: "عالية | متوسطة | منخفضة",
            key_limitations: ["قيد رئيسي 1", "قيد رئيسي 2"]
        },
        disclaimer: "هذا التحليل استشاري آلي فقط ويجب مراجعته من قِبل مشغل بشري قبل اتخاذ أي قرار."
    }, null, 2);

    return `${SYSTEM_ROLE}

══════════════════════════════════════════════
معلومات الحادثة:
- المعرّف: ${incident.id.slice(0, 8)}
- الفئة الأساسية: ${incident.category}
- المنطقة: ${incident.area}
- عدد البلاغات: ${incident.report_count}
- درجة الخطورة الحالية: ${incident.severity}/5
- الحالة: ${incident.status}
══════════════════════════════════════════════

البلاغات المرتبطة (${safeReports.length} بلاغ):

${reportLines || "(لا توجد بلاغات مرتبطة)"}

══════════════════════════════════════════════

الخلاصة التي أحتاجها:
1. هل هذه البلاغات تصف أزمة متماسكة واحدة أم حالات منفصلة؟
2. ما الفرضيات السببية الأكثر احتمالاً؟
3. هل تُشير البيانات إلى روابط مع فئات أخرى (مثال: مياه → صحة، مأوى → شتاء، غذاء → صحة)؟
4. ما درجة تماسك المجموعة (0–100)؟
5. ما التوصية الفورية الأولى؟

أجب فقط بـ JSON صالح يتطابق مع هذا الهيكل بالضبط:
${outputContract}`;
}

// ── Claude API call ────────────────────────────────────────────────────────────

interface ClaudeCallResult {
    text: string | null;
    error: string | null;
}

async function callClaude(prompt: string): Promise<ClaudeCallResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

    if (!apiKey || apiKey === "your-anthropic-api-key-here" || apiKey.length < 20) {
        const msg = "[incidentAiService] ANTHROPIC_API_KEY is missing or placeholder — cannot generate AI summary";
        console.error(msg);
        return { text: null, error: "ANTHROPIC_API_KEY not configured" };
    }

    const model = getModel();
    console.log(`[incidentAiService v2] calling model=${model}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model,
                max_tokens: 2000,  // v2.0 output is larger
                messages: [{ role: "user", content: prompt }],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            let errorBody = "(unreadable)";
            try { errorBody = await response.text(); } catch { /* ignore */ }
            const msg = `[incidentAiService v2] Claude HTTP ${response.status}: ${errorBody.slice(0, 500)}`;
            console.error(msg);
            return { text: null, error: `HTTP ${response.status}` };
        }

        const data = (await response.json()) as any;
        const text: string | null = data?.content?.[0]?.text ?? null;

        if (!text) {
            console.error("[incidentAiService v2] Claude returned empty content:", JSON.stringify(data).slice(0, 300));
            return { text: null, error: "Empty response from Claude" };
        }

        return { text, error: null };
    } catch (err: any) {
        if (err.name === "AbortError") {
            console.error(`[incidentAiService v2] Timed out after ${TIMEOUT_MS}ms`);
            return { text: null, error: "Timeout" };
        }
        console.error("[incidentAiService v2] Fetch error:", err.message);
        return { text: null, error: err.message };
    } finally {
        clearTimeout(timeout);
    }
}

// ── v2.0 Response parser ───────────────────────────────────────────────────────

/**
 * Parse the v2.0 structured JSON output from Claude.
 * Falls back gracefully to storing raw text if JSON is malformed.
 *
 * Returns a human-readable RTL string for storage in ai_summary,
 * AND the raw structured JSON for future schema extensions.
 */
function parseV2Response(rawText: string): { summary: string; structuredJson: string | null } {
    // Strip markdown code fences Claude sometimes adds
    const stripped = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    try {
        const parsed = JSON.parse(stripped) as AiV2Output;
        const parts: string[] = [];

        // Narrative
        if (parsed.narrative) {
            parts.push(`📋 ${parsed.narrative}`);
        }

        // Hypotheses (top 2)
        const topHyps = (parsed.hypotheses ?? []).slice(0, 2);
        if (topHyps.length > 0) {
            parts.push("🔍 الفرضيات السببية:");
            for (const h of topHyps) {
                const confIcon = h.confidence === "عالية" ? "🟢" : h.confidence === "متوسطة" ? "🟡" : "🔴";
                parts.push(`${confIcon} ${h.hypothesis}`);
                if (h.causal_chain) parts.push(`   ↳ ${h.causal_chain}`);
            }
        }

        // Cross-category signals
        const crossCat = (parsed.cross_category_signals ?? []).slice(0, 2);
        if (crossCat.length > 0) {
            parts.push("🔗 روابط مع فئات أخرى:");
            for (const s of crossCat) {
                parts.push(`• ${s.related_category}: ${s.signal_description}`);
            }
        }

        // Cohesion score
        if (parsed.cohesion_assessment) {
            const c = parsed.cohesion_assessment;
            const riskIcon = c.grouping_risk === "acceptable" ? "✅" : c.grouping_risk === "review_recommended" ? "⚠️" : "⛔";
            parts.push(`📊 تماسك المجموعة: ${c.score}/100 (${c.band}) ${riskIcon}`);
            if (c.reasoning) parts.push(`   ${c.reasoning}`);
        }

        // Immediate recommendation
        if (parsed.immediate_recommendation) {
            parts.push(`💡 التوصية الفورية: ${parsed.immediate_recommendation}`);
        }

        // Confidence
        if (parsed.confidence) {
            const lvl = parsed.confidence.level;
            const confIcon = lvl === "عالية" ? "🟢" : lvl === "متوسطة" ? "🟡" : "🔴";
            parts.push(`${confIcon} ثقة التحليل: ${lvl} (${parsed.confidence.score}/100)`);
            if ((parsed.confidence.key_limitations ?? []).length > 0) {
                parts.push(`   القيود: ${parsed.confidence.key_limitations.join(" | ")}`);
            }
        }

        // Disclaimer (always last)
        if (parsed.disclaimer) {
            parts.push(`\n⚠️ ${parsed.disclaimer}`);
        }

        const summary = parts.join("\n\n");
        return { summary, structuredJson: stripped };
    } catch {
        console.warn("[incidentAiService v2] Response was not valid JSON — storing raw text as fallback");
        return { summary: rawText.slice(0, 2000), structuredJson: null };
    }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Generate and persist a v2.0 AI analysis for a newly-active (or re-triggered) incident.
 *
 * Guards:
 * - Returns immediately if incident.ai_summary is already set (unless caller cleared it)
 * - Logs full error details to console — no silent failures
 * - DB update uses .is("ai_summary", null) to prevent race-condition double-write
 *
 * v2.0 changes from v1.0:
 * - Cross-category causal chain reasoning
 * - Cohesion score (0–100) with grouping risk assessment
 * - Structured hypothesis analysis with counter-evidence
 * - Confidence calibration with explicit limitations
 * - max_tokens increased to 2000
 * - Timeout increased to 60s
 */
export async function generateAndStoreIncidentSummary(
    supabase: SupabaseClient,
    incident: Incident,
    reports: Array<{ title: string | null; content: string | null; area: string | null; category?: string | null; created_at?: string | null }>,
): Promise<{ success: boolean; error: string | null }> {
    // Guard: already has a summary
    if (incident.ai_summary) {
        console.log(`[incidentAiService v2] incident ${incident.id} already has ai_summary — skipping`);
        return { success: true, error: null };
    }

    console.log(
        `[incidentAiService v2] START — incident=${incident.id} category="${incident.category}" area="${incident.area}" reports=${reports.length}`,
    );

    const prompt = buildIncidentPromptV2(incident, reports);
    const { text: rawText, error: callError } = await callClaude(prompt);

    if (!rawText) {
        console.error(`[incidentAiService v2] FAIL — incident=${incident.id} reason="${callError}"`);
        return { success: false, error: callError };
    }

    const { summary: summaryText } = parseV2Response(rawText);

    const { data: updatedIncident, error: dbError } = await supabase
        .from("incidents")
        .update({
            ai_summary: summaryText,
            updated_at: new Date().toISOString(),
        })
        .eq("id", incident.id)
        .is("ai_summary", null) // idempotency guard — prevent race-condition double-write
        .select("id")
        .maybeSingle();

    if (dbError) {
        console.error(`[incidentAiService v2] DB write failed — incident=${incident.id}:`, dbError.message);
        return { success: false, error: dbError.message };
    }

    if (!updatedIncident) {
        console.warn(
            `[incidentAiService v2] DB write did not match any row — incident=${incident.id} (ai_summary may have changed concurrently)`,
        );
        return { success: false, error: "Incident summary was not persisted (idempotency guard)" };
    }

    console.log(`[incidentAiService v2] SUCCESS — incident=${incident.id} summary stored (${summaryText.length} chars)`);
    return { success: true, error: null };
}
