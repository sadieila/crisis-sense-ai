/**
 * incidentService.ts
 *
 * Deterministic incident grouping logic.
 * NO AI in this file. Pure business logic.
 *
 * Rules:
 *  1. A report belongs to an existing incident if category + area match
 *     and the incident was created within INCIDENT_WINDOW_HOURS.
 *  2. If no match is found, create a new incident with status = "monitoring".
 *  3. If an incident's report_count reaches ACTIVE_THRESHOLD,
 *     escalate its status to "active".
 *
 * All numbers are configurable via env vars.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Incident } from "@shared/schema";

// ── Config ────────────────────────────────────────────────────────────────────
const INCIDENT_WINDOW_HOURS = parseInt(
    process.env.INCIDENT_WINDOW_HOURS ?? "24",
    10,
);
const ACTIVE_THRESHOLD = parseInt(process.env.ACTIVE_THRESHOLD ?? "5", 10);

// ── Types ─────────────────────────────────────────────────────────────────────
export interface IncidentMatchResult {
    incident: Incident;
    isNew: boolean;
    escalated: boolean;
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Find an existing open incident for a (category, area) pair created within
 * the configured time window, or create a new one.
 */
async function findOrCreateIncident(
    supabase: SupabaseClient,
    category: string,
    area: string,
): Promise<{ incident: Incident; isNew: boolean }> {
    const windowStart = new Date(
        Date.now() - INCIDENT_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    // Look for an existing open incident (monitoring or active, NOT resolved)
    const { data: existing, error: fetchErr } = await supabase
        .from("incidents")
        .select("*")
        .eq("category", category)
        .eq("area", area)
        .in("status", ["monitoring", "active"])
        .gte("created_at", windowStart)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (fetchErr) {
        console.error("[incidentService] findOrCreateIncident fetch error:", fetchErr.message);
        throw new Error("Failed to query incidents: " + fetchErr.message);
    }

    if (existing) {
        return { incident: existing as Incident, isNew: false };
    }

    // Create a new incident
    const { data: created, error: createErr } = await supabase
        .from("incidents")
        .insert({
            category,
            area,
            status: "monitoring",
            severity: 1,
            report_count: 0, // will be incremented by linkReportToIncident
        })
        .select("*")
        .single();

    if (createErr || !created) {
        console.error("[incidentService] findOrCreateIncident create error:", createErr?.message);
        throw new Error("Failed to create incident: " + (createErr?.message ?? "no data returned"));
    }

    return { incident: created as Incident, isNew: true };
}

/**
 * Link a report to an incident and synchronize report_count from relation truth.
 * Safe to call multiple times — primary key constraint prevents duplicates.
 */
async function linkReportToIncident(
    supabase: SupabaseClient,
    incidentId: string,
    reportId: string,
): Promise<Incident> {
    // Insert the join record (ignore conflicts — a report may only belong to one incident)
    const { error: joinErr } = await supabase
        .from("incident_reports")
        .upsert({ incident_id: incidentId, report_id: reportId }, { onConflict: "incident_id,report_id" });

    if (joinErr) {
        console.error("[incidentService] linkReportToIncident join error:", joinErr.message);
        throw new Error("Failed to link report to incident: " + joinErr.message);
    }

    const linkedCount = await getLinkedReportCount(supabase, incidentId);

    // Derive report_count from join-table truth for idempotency and concurrency safety.
    const { data: updated, error: updateErr } = await supabase
        .from("incidents")
        .update({ report_count: linkedCount, updated_at: new Date().toISOString() })
        .eq("id", incidentId)
        .select("*")
        .single();

    if (updateErr || !updated) {
        console.error("[incidentService] linkReportToIncident update error:", updateErr?.message);
        throw new Error("Failed to update incident count: " + (updateErr?.message ?? "no data returned"));
    }

    return updated as Incident;
}

/** Helper: derive count from incident_reports to avoid drift and duplicate increments. */
async function getLinkedReportCount(
    supabase: SupabaseClient,
    incidentId: string,
): Promise<number> {
    const { count, error } = await supabase
        .from("incident_reports")
        .select("report_id", { count: "exact", head: true })
        .eq("incident_id", incidentId);

    if (error) {
        console.error("[incidentService] getLinkedReportCount error:", error.message);
        throw new Error("Failed to count linked reports: " + error.message);
    }

    return count ?? 0;
}

/**
 * Escalate incident to "active" if it has reached the threshold.
 * Returns the updated incident and whether escalation occurred.
 *
 * This is deterministic: escalation happens IF AND ONLY IF
 * report_count >= ACTIVE_THRESHOLD and status is still "monitoring".
 */
async function maybeEscalate(
    supabase: SupabaseClient,
    incident: Incident,
): Promise<{ incident: Incident; escalated: boolean }> {
    if (incident.status !== "monitoring" || incident.report_count < ACTIVE_THRESHOLD) {
        return { incident, escalated: false };
    }

    const newSeverity = computeSeverity(incident.report_count);

    const { data: escalated, error } = await supabase
        .from("incidents")
        .update({ status: "active", severity: newSeverity, updated_at: new Date().toISOString() })
        .eq("id", incident.id)
        .eq("status", "monitoring") // guard: don't double-escalate
        .select("*")
        .maybeSingle();

    if (error) {
        console.error("[incidentService] maybeEscalate error:", error.message);
        return { incident, escalated: false };
    }

    if (!escalated) {
        // Another concurrent update already escalated it — fetch current state
        const { data: current } = await supabase
            .from("incidents")
            .select("*")
            .eq("id", incident.id)
            .single();
        return { incident: (current ?? incident) as Incident, escalated: false };
    }

    console.log(`[incidentService] escalated incident ${incident.id} (${incident.category} / ${incident.area}) → active`);
    return { incident: escalated as Incident, escalated: true };
}

/**
 * Derive severity from report count.
 * Simple, deterministic — no AI.
 */
function computeSeverity(reportCount: number): number {
    if (reportCount >= 20) return 5;
    if (reportCount >= 15) return 4;
    if (reportCount >= 10) return 3;
    if (reportCount >= 5) return 2;
    return 1;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main entry point called after a report is saved.
 * Orchestrates: find/create → link → escalate.
 * Returns the final incident state and whether it just became active.
 */
export async function processReportIntoIncident(
    supabase: SupabaseClient,
    reportId: string,
    category: string,
    area: string,
): Promise<IncidentMatchResult> {
    const { incident: found, isNew } = await findOrCreateIncident(supabase, category, area);

    const linked = await linkReportToIncident(supabase, found.id, reportId);

    const { incident: final, escalated } = await maybeEscalate(supabase, linked);

    return { incident: final, isNew, escalated };
}

/**
 * Fetch all reports linked to an incident.
 */
export async function getIncidentReports(
    supabase: SupabaseClient,
    incidentId: string,
    limit = 500,
): Promise<Array<{ id: string; title: string | null; category: string | null; area: string | null; status: string; created_at: string; content: string | null }>> {
    const { data, error } = await supabase
        .from("incident_reports")
        .select("report_id")
        .eq("incident_id", incidentId)
        .limit(limit);

    if (error) {
        console.error(`[getIncidentReports] join-table query failed for incident ${incidentId}:`, error.message);
        return [];
    }
    if (!data || data.length === 0) {
        console.warn(`[getIncidentReports] no linked reports found for incident ${incidentId}`);
        return [];
    }

    const reportIds = data.map((r: any) => r.report_id);

    const { data: reports, error: reportsErr } = await supabase
        .from("reports")
        .select("id, title, category, area, status, created_at, content")
        .in("id", reportIds)
        .order("created_at", { ascending: false });

    if (reportsErr) {
        console.error(`[getIncidentReports] reports query failed for incident ${incidentId}:`, reportsErr.message);
        return [];
    }

    console.log(`[getIncidentReports] incident ${incidentId}: ${reportIds.length} join rows → ${reports?.length ?? 0} reports retrieved`);
    return (reports ?? []) as any[];
}
