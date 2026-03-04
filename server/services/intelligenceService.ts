/**
 * intelligenceService.ts  —  Proactive AI Intelligence Scanner
 *
 * PURPOSE: Analyze unlinked and weakly linked reports to discover
 * cross-category relationships, temporal clusters, and hidden crises
 * that deterministic grouping (same area + same category) cannot detect.
 *
 * ZERO AUTOMATION: This service NEVER creates, merges, or modifies incidents.
 * It produces suggestions that human operators must review and act on.
 *
 * DESIGN:
 *  - Scans reports from the last N hours
 *  - Groups by geographic proximity (same area)
 *  - Detects cross-category causal chains
 *  - Generates "intelligence suggestions" with reasoning
 *  - All output is advisory — stored for operator review
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IntelligenceSuggestion {
    id: string;
    type: "cross_category_link" | "temporal_cluster" | "weak_signal" | "escalation_risk";
    title: string;
    description: string;
    area: string;
    categories_involved: string[];
    report_ids: string[];
    confidence: number; // 0–100
    confidence_level: "عالية" | "متوسطة" | "منخفضة";
    reasoning: string;
    suggested_action: string;
    created_at: string;
    status: "new" | "reviewed" | "accepted" | "dismissed";
}

export interface IntelligenceScanResult {
    suggestions: IntelligenceSuggestion[];
    reports_scanned: number;
    scan_duration_ms: number;
}

// ── Known causal chains (from AI_INTELLIGENCE_RULES.md Part III) ────────────

interface CausalChain {
    from: string;
    to: string;
    relationship: string;
    base_confidence: number;
}

const KNOWN_CAUSAL_CHAINS: CausalChain[] = [
    { from: "مياه وصرف صحي", to: "صحة", relationship: "تلوث المياه → أمراض معدية (إسهال، التهابات)", base_confidence: 80 },
    { from: "مأوى وخيم", to: "الشتاء والتدفئة", relationship: "تلف المأوى → تعرض للبرد والتجمد", base_confidence: 85 },
    { from: "غذاء وتغذية", to: "صحة", relationship: "سوء التغذية → ضعف المناعة ← عدوى", base_confidence: 75 },
    { from: "مياه وصرف صحي", to: "غذاء وتغذية", relationship: "مياه ملوثة → تلوث الغذاء", base_confidence: 60 },
    { from: "الشتاء والتدفئة", to: "صحة", relationship: "برد شديد → التهابات تنفسية", base_confidence: 70 },
    { from: "مأوى وخيم", to: "صحة", relationship: "اكتظاظ ورطوبة → أمراض جلدية وتنفسية", base_confidence: 65 },
    { from: "الوصول للخدمات الطبية", to: "صحة", relationship: "عدم الوصول → تدهور الحالات القائمة", base_confidence: 90 },
];

// ── Report scanner ─────────────────────────────────────────────────────────────

interface ScannedReport {
    id: string;
    title: string | null;
    content: string | null;
    category: string;
    area: string;
    status: string;
    created_at: string;
    is_linked: boolean;
}

/**
 * Fetch recent reports and tag whether they're linked to an incident.
 */
async function fetchRecentReports(
    supabase: SupabaseClient,
    hoursBack: number = 48,
): Promise<ScannedReport[]> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

    const { data: reports, error: reportsErr } = await supabase
        .from("reports")
        .select("id, title, content, category, area, status, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);

    if (reportsErr || !reports) return [];

    // Get linked report IDs
    const { data: linked } = await supabase
        .from("incident_reports")
        .select("report_id");

    const linkedIds = new Set((linked ?? []).map((r: any) => String(r.report_id)));

    return reports.map((r: any) => ({
        id: String(r.id),
        title: r.title,
        content: r.content,
        category: r.category ?? "",
        area: r.area ?? "",
        status: r.status ?? "pending",
        created_at: r.created_at,
        is_linked: linkedIds.has(String(r.id)),
    }));
}

// ── Analyzers ──────────────────────────────────────────────────────────────────

function generateId(): string {
    return `intel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detect cross-category relationships within the same geographic area.
 * Uses known causal chains from AI_INTELLIGENCE_RULES.md.
 */
function detectCrossCategoryLinks(reports: ScannedReport[]): IntelligenceSuggestion[] {
    const suggestions: IntelligenceSuggestion[] = [];

    // Group reports by area
    const byArea = new Map<string, ScannedReport[]>();
    for (const r of reports) {
        const key = r.area;
        if (!byArea.has(key)) byArea.set(key, []);
        byArea.get(key)!.push(r);
    }

    for (const [area, areaReports] of Array.from(byArea)) {
        // Get unique categories in this area
        const categories = Array.from(new Set(areaReports.map((r: ScannedReport) => r.category)));
        if (categories.length < 2) continue;

        // Check all known causal chains
        for (const chain of KNOWN_CAUSAL_CHAINS) {
            const fromReports = areaReports.filter((r: ScannedReport) => r.category === chain.from);
            const toReports = areaReports.filter((r: ScannedReport) => r.category === chain.to);

            if (fromReports.length >= 1 && toReports.length >= 1) {
                // Calculate confidence boost based on report volume
                const volumeBoost = Math.min(15, (fromReports.length + toReports.length - 2) * 3);
                const confidence = Math.min(95, chain.base_confidence + volumeBoost);
                const confLevel = confidence >= 70 ? "عالية" : confidence >= 45 ? "متوسطة" : "منخفضة";

                const allReportIds = [...fromReports, ...toReports].map((r) => r.id);

                suggestions.push({
                    id: generateId(),
                    type: "cross_category_link",
                    title: `رابط سببي محتمل: ${chain.from} ↔ ${chain.to}`,
                    description: `في منطقة ${area}، تم رصد ${fromReports.length} بلاغ(ات) في "${chain.from}" و${toReports.length} بلاغ(ات) في "${chain.to}" خلال نفس الفترة الزمنية.`,
                    area,
                    categories_involved: [chain.from, chain.to],
                    report_ids: allReportIds,
                    confidence,
                    confidence_level: confLevel,
                    reasoning: `السلسلة السببية المعروفة: ${chain.relationship}. وجود بلاغات متزامنة في كلا الفئتين يعزز احتمال وجود أزمة مركبة.`,
                    suggested_action: `مراجعة البلاغات في "${chain.from}" و"${chain.to}" في ${area} — قد تكون حالة أزمة مركبة تحتاج تنسيق متعدد القطاعات.`,
                    created_at: new Date().toISOString(),
                    status: "new",
                });
            }
        }
    }

    return suggestions;
}

/**
 * Detect temporal clusters — bursts of reports in a short window
 * that may indicate an emerging crisis.
 */
function detectTemporalClusters(reports: ScannedReport[]): IntelligenceSuggestion[] {
    const suggestions: IntelligenceSuggestion[] = [];

    // Group by (area + category) and check for time-concentrated bursts
    const groups = new Map<string, ScannedReport[]>();
    for (const r of reports) {
        const key = `${r.area}||${r.category}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(r);
    }

    for (const [key, groupReports] of Array.from(groups)) {
        if (groupReports.length < 3) continue;

        // Sort by time
        const sorted = [...groupReports].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

        // Check if 3+ reports arrived within a 6-hour window
        for (let i = 0; i <= sorted.length - 3; i++) {
            const windowStart = new Date(sorted[i].created_at).getTime();
            const windowEnd = new Date(sorted[i + 2].created_at).getTime();
            const windowHours = (windowEnd - windowStart) / (60 * 60 * 1000);

            if (windowHours <= 6) {
                const [area, category] = key.split("||");
                const clusterReports = sorted.slice(i, i + 3);
                const unlinked = clusterReports.filter((r) => !r.is_linked);
                if (unlinked.length === 0) continue; // all already linked

                const confidence = Math.min(85, 50 + unlinked.length * 10);
                const confLevel = confidence >= 70 ? "عالية" : confidence >= 45 ? "متوسطة" : "منخفضة";

                suggestions.push({
                    id: generateId(),
                    type: "temporal_cluster",
                    title: `تجمع زمني: ${clusterReports.length} بلاغات في ${category} — ${area}`,
                    description: `${clusterReports.length} بلاغات وصلت خلال ${windowHours.toFixed(1)} ساعات في "${category}" في ${area}. ${unlinked.length} منها غير مرتبطة بحادثة.`,
                    area,
                    categories_involved: [category],
                    report_ids: clusterReports.map((r) => r.id),
                    confidence,
                    confidence_level: confLevel,
                    reasoning: `تركز البلاغات في فترة زمنية قصيرة يشير إلى حدث ميداني واحد يطال عدة مبلّغين. البلاغات غير المرتبطة تحتاج مراجعة.`,
                    suggested_action: `مراجعة ربط ${unlinked.length} بلاغ(ات) غير مرتبطة بحادثة قائمة أو إنشاء حادثة جديدة إذا لزم الأمر.`,
                    created_at: new Date().toISOString(),
                    status: "new",
                });
                break; // One suggestion per group
            }
        }
    }

    return suggestions;
}

/**
 * Detect weak signals — areas with low but rising report counts
 * that haven't yet hit the incident threshold.
 */
function detectWeakSignals(reports: ScannedReport[]): IntelligenceSuggestion[] {
    const suggestions: IntelligenceSuggestion[] = [];

    // Only unlinked reports
    const unlinked = reports.filter((r) => !r.is_linked);

    // Group unlinked by area
    const byArea = new Map<string, ScannedReport[]>();
    for (const r of unlinked) {
        if (!byArea.has(r.area)) byArea.set(r.area, []);
        byArea.get(r.area)!.push(r);
    }

    for (const [area, areaReports] of Array.from(byArea)) {
        if (areaReports.length < 2) continue;

        const categories = Array.from(new Set(areaReports.map((r: ScannedReport) => r.category)));
        const confidence = Math.min(60, 25 + areaReports.length * 8);
        const confLevel = confidence >= 70 ? "عالية" : confidence >= 45 ? "متوسطة" : "منخفضة";

        suggestions.push({
            id: generateId(),
            type: "weak_signal",
            title: `إشارة ضعيفة: ${areaReports.length} بلاغات غير مرتبطة في ${area}`,
            description: `${areaReports.length} بلاغات غير مرتبطة بأي حادثة في ${area}، تشمل الفئات: ${categories.join("، ")}.`,
            area,
            categories_involved: categories,
            report_ids: areaReports.map((r: ScannedReport) => r.id),
            confidence,
            confidence_level: confLevel,
            reasoning: `بلاغات متعددة في نفس المنطقة لم تُربط بحوادث قائمة. قد تكون حالات فردية أو بداية نمط ناشئ.`,
            suggested_action: `مراجعة البلاغات في ${area} لتحديد ما إذا كانت مرتبطة بحادثة قائمة أو تمثل نمطاً جديداً.`,
            created_at: new Date().toISOString(),
            status: "new",
        });
    }

    return suggestions;
}

// ── Main scan function ─────────────────────────────────────────────────────────

/**
 * Run a full intelligence scan.
 * Returns suggestions sorted by confidence (highest first).
 *
 * This function:
 *  - NEVER modifies any data
 *  - NEVER creates incidents
 *  - Only reads reports and generates advisory suggestions
 */
export async function runIntelligenceScan(
    supabase: SupabaseClient,
): Promise<IntelligenceScanResult> {
    const startTime = Date.now();

    const reports = await fetchRecentReports(supabase, 48);

    if (reports.length === 0) {
        return {
            suggestions: [],
            reports_scanned: 0,
            scan_duration_ms: Date.now() - startTime,
        };
    }

    // Run all analyzers
    const crossCategory = detectCrossCategoryLinks(reports);
    const temporalClusters = detectTemporalClusters(reports);
    const weakSignals = detectWeakSignals(reports);

    // Combine and sort by confidence (descending)
    const allSuggestions = [...crossCategory, ...temporalClusters, ...weakSignals]
        .sort((a, b) => b.confidence - a.confidence);

    // Deduplicate by area + categories combo
    const seen = new Set<string>();
    const deduplicated = allSuggestions.filter((s) => {
        const key = `${s.type}:${s.area}:${s.categories_involved.sort().join(",")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(
        `[intelligenceService] scan complete — ${reports.length} reports → ${deduplicated.length} suggestions (${Date.now() - startTime}ms)`,
    );

    return {
        suggestions: deduplicated,
        reports_scanned: reports.length,
        scan_duration_ms: Date.now() - startTime,
    };
}
