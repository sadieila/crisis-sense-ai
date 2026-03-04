import type { Express, NextFunction, Request, Response } from "express";
import { type Server } from "http";
import session from "express-session";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storage } from "./storage";
import {
  areas,
  categories,
  insertReportSchema,
  loginSchema,
  subAreas,
  type SafeUser,
  type Incident,
} from "@shared/schema";
import {
  getIncidentReports,
  processReportIntoIncident,
} from "./services/incidentService";
import { generateAndStoreIncidentSummary } from "./services/incidentAiService";
import { buildIncidentExcel } from "./services/exportService";
import { runIntelligenceScan } from "./services/intelligenceService";

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

type AnalyzeActor = {
  id: string;
  displayName: string;
  orgId: string;
  role: string;
};

let cachedSupabaseAdmin: SupabaseClient | null = null;

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

/**
 * Role-based access middleware.
 * Usage: requireRole("admin") or requireRole("analyst", "admin")
 * Viewer sessions are denied unless explicitly included.
 */
function requireRole(...allowedRoles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        message: `Access denied. Required role: ${allowedRoles.join(" or ")}`,
      });
    }
    next();
  };
}

function getSupabaseAdmin(): SupabaseClient | null {
  if (cachedSupabaseAdmin) return cachedSupabaseAdmin;

  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return null;
  }

  cachedSupabaseAdmin = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cachedSupabaseAdmin;
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
}

async function resolveAnalyzeActor(
  req: Request,
  supabase: SupabaseClient,
): Promise<AnalyzeActor | null> {
  if (req.session.userId) {
    const user = await storage.getUser(req.session.userId);
    if (!user) return null;
    return {
      id: user.id,
      displayName: user.displayName,
      orgId: user.orgId,
      role: user.role,
    };
  }

  const token = getBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const appMetadata = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (metadata.display_name as string | undefined) ||
    (metadata.full_name as string | undefined) ||
    data.user.email ||
    data.user.id;
  const role =
    (appMetadata.role as string | undefined) ||
    (metadata.role as string | undefined) ||
    "analyst";
  const orgId =
    (appMetadata.org_id as string | undefined) ||
    (metadata.org_id as string | undefined) ||
    "supabase";

  return { id: data.user.id, displayName, orgId, role };
}

function sanitizeErrorMessage(message: string): string {
  if (!message) return "Unexpected error";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

// ── Rate limiter (in-memory, per-IP) ──────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ message: "Too many requests. Please wait before submitting again." });
  }
  next();
}

// Periodic cleanup of stale rate-limit entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of Array.from(rateLimitMap)) {
    if (now > entry.reset) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  const isProduction = process.env.NODE_ENV === "production";
  const sessionSecret = process.env.SESSION_SECRET;

  if (isProduction && (!sessionSecret || sessionSecret === "crisis-sense-dev-secret")) {
    throw new Error("SESSION_SECRET must be set to a strong value in production.");
  }

  app.use(
    session({
      secret: sessionSecret || "crisis-sense-dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/categories", (_req, res) => {
    res.json(categories);
  });

  app.get("/api/areas", (_req, res) => {
    res.json({ areas, subAreas });
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid credentials payload" });
    }

    const user = await storage.getUserByUsername(parsed.data.username);
    if (!user || user.password !== parsed.data.password) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const org = await storage.getOrganization(user.orgId);
    req.session.userId = user.id;

    const safeUser: SafeUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      orgId: user.orgId,
      role: user.role,
    };

    await storage.addAuditEntry({
      userId: user.id,
      userName: user.displayName,
      orgId: user.orgId,
      action: "login",
      entityType: "session",
      entityId: user.id,
      details: `Login: ${user.displayName}`,
    });

    return res.json({ user: safeUser, org });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => { });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const org = await storage.getOrganization(user.orgId);
    const safeUser: SafeUser = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      orgId: user.orgId,
      role: user.role,
    };

    return res.json({ user: safeUser, org });
  });

  app.get("/api/organizations", authMiddleware, async (_req, res) => {
    const orgs = await storage.getOrganizations();
    res.json(orgs);
  });

  app.get("/api/reports/stats", authMiddleware, async (_req, res) => {
    const stats = await storage.getReportStats();
    res.json(stats);
  });

  app.get("/api/reports", authMiddleware, async (req, res) => {
    const filters = {
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      region: req.query.region as string | undefined,
      category: req.query.category as string | undefined,
      severity: req.query.severity ? parseInt(req.query.severity as string, 10) : undefined,
      q: req.query.q as string | undefined,
    };
    const result = await storage.getReports(filters);
    res.json(result);
  });

  app.get("/api/reports/:id", authMiddleware, async (req, res) => {
    const report = await storage.getReport(String(req.params.id));
    if (!report) return res.status(404).json({ message: "Report not found" });
    res.json(report);
  });

  app.post("/api/reports", rateLimitMiddleware, async (req, res) => {
    const parsed = insertReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid report payload",
        errors: parsed.error.errors,
      });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res
        .status(500)
        .json({ message: "Supabase configuration is missing" });
    }

    const payload = parsed.data;
    const normalizedSpecificLocation =
      typeof payload.specificLocation === "string" &&
        payload.specificLocation.trim() === ""
        ? null
        : payload.specificLocation ?? null;
    const details = payload.details?.trim() ?? "";
    const userId =
      payload.idNumber?.trim() ||
      payload.phone?.trim() ||
      payload.fullName?.trim() ||
      "citizen-anonymous";
    const title = `${payload.category} - ${payload.subProblem}`.slice(0, 120);
    const content = [
      `Category: ${payload.category}`,
      `Issue: ${payload.subProblem}`,
      `Area: ${payload.area}`,
      normalizedSpecificLocation
        ? `Specific location: ${normalizedSpecificLocation}`
        : "",
      details ? `Details: ${details}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n");

    const { data, error } = await supabase
      .from("reports")
      .insert([
        {
          user_id: userId,
          title,
          content,
          status: "pending",
          category: payload.category,
          area: payload.area,
        },
      ])
      .select("id, status, created_at")
      .single();

    if (error || !data) {
      console.error("[reports:create] supabase_insert_failed", {
        error: error?.message ?? "Unknown insert error",
        hasSpecificLocation: normalizedSpecificLocation !== null,
      });
      return res.status(500).json({
        message: "Failed to create report",
        error: sanitizeErrorMessage(error?.message ?? "Unknown error"),
      });
    }

    const reportId = String(data.id);
    try {
      const { incident } = await processReportIntoIncident(
        supabase,
        reportId,
        payload.category,
        payload.area,
      );

      if (incident.status === "active" && !incident.ai_summary) {
        const linkedReports = await getIncidentReports(supabase, incident.id, 10);
        const aiResult = await generateAndStoreIncidentSummary(
          supabase,
          incident,
          linkedReports,
        );
        if (!aiResult.success) {
          console.error("[reports:create] incident_ai_generation_failed", {
            reportId,
            incidentId: incident.id,
            error: aiResult.error ?? "Unknown incident AI error",
          });
        }
      }
    } catch (pipelineError: any) {
      console.error("[reports:create] incident_pipeline_error", {
        reportId,
        error: pipelineError?.message ?? "Unknown pipeline error",
      });
      return res.status(500).json({
        message: "Report created but incident processing failed",
        id: reportId,
      });
    }

    return res.status(201).json({
      id: reportId,
      category: payload.category,
      subProblem: payload.subProblem,
      area: payload.area,
      specificLocation: normalizedSpecificLocation,
      details,
      fullName: payload.fullName || "",
      idNumber: payload.idNumber || "",
      phone: payload.phone || "",
      severityLevel: 3,
      status: "pending",
      assignedTo: "",
      createdAt: data.created_at || new Date().toISOString(),
    });
  });

  app.get("/api/incidents", authMiddleware, async (req, res) => {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res
        .status(500)
        .json({ message: "Supabase configuration is missing" });
    }

    let query = supabase
      .from("incidents")
      .select("*")
      .order("updated_at", { ascending: false });

    if (req.query.status) {
      query = query.eq("status", req.query.status);
    }
    if (req.query.limit) {
      query = query.limit(parseInt(req.query.limit as string, 10));
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ message: error.message });
    return res.json(data ?? []);
  });

  app.get("/api/incidents/:id", authMiddleware, async (req, res) => {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res
        .status(500)
        .json({ message: "Supabase configuration is missing" });
    }

    const { data, error } = await supabase
      .from("incidents")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) return res.status(500).json({ message: error.message });
    if (!data) return res.status(404).json({ message: "Incident not found" });
    return res.json(data);
  });

  // ── Incident Reports with Filtering (Phase 2 — Deliverable 2.1) ─────────────
  // Supports: ?category=&area=&dateFrom=&dateTo=&limit=
  app.get("/api/incidents/:id/reports", authMiddleware, async (req, res) => {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ message: "Supabase configuration is missing" });
    }

    const incidentId = String(req.params.id);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const categoryFilter = req.query.category as string | undefined;
    const areaFilter = req.query.area as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;

    // Fetch linked report IDs first
    const { data: joinData, error: joinErr } = await supabase
      .from("incident_reports")
      .select("report_id")
      .eq("incident_id", incidentId)
      .limit(200);

    if (joinErr) return res.status(500).json({ message: joinErr.message });
    if (!joinData || joinData.length === 0) {
      res.setHeader("X-Filter-Active", "false");
      return res.json([]);
    }

    const reportIds = joinData.map((r: any) => r.report_id);

    // Build filtered reports query
    let query = supabase
      .from("reports")
      .select("id, title, category, area, status, created_at, content")
      .in("id", reportIds)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (categoryFilter) query = query.eq("category", categoryFilter);
    if (areaFilter) query = query.eq("area", areaFilter);
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lte("created_at", dateTo);

    const { data: reports, error: reportsErr } = await query;
    if (reportsErr) return res.status(500).json({ message: reportsErr.message });

    const filtersActive = !!(categoryFilter || areaFilter || dateFrom || dateTo);
    res.setHeader("X-Filter-Active", filtersActive ? "true" : "false");
    res.setHeader("X-Total-Linked", String(joinData.length));
    return res.json(reports ?? []);
  });


  // ── Incident Excel Export ─────────────────────────────────────────────────
  // Auth: Supabase JWT or session | Role: analyst or admin | Logged: yes
  app.get("/api/incidents/:id/export", async (req, res) => {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ message: "Supabase configuration is missing" });
    }

    // Dual-auth: session OR Supabase JWT (same as analyze endpoint)
    const actor = await resolveAnalyzeActor(req, supabase);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });
    if (actor.role !== "admin" && actor.role !== "analyst") {
      return res.status(403).json({ message: "Access denied. Required role: analyst or admin" });
    }

    const { data: incident, error: incidentError } = await supabase
      .from("incidents")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (incidentError) {
      console.error("[export] incident fetch error:", incidentError.message);
      return res.status(500).json({ message: "Failed to retrieve incident" });
    }
    if (!incident) return res.status(404).json({ message: "Incident not found" });

    // Fetch ALL linked reports — no artificial limit
    const rawReports = await getIncidentReports(supabase, String(req.params.id), 500);

    // Validate report count matches incident metadata
    if (rawReports.length !== incident.report_count) {
      console.warn(`[export] report count mismatch: incident.report_count=${incident.report_count}, actual linked=${rawReports.length}`);
    }
    console.log(`[export] incident ${incident.id}: exporting ${rawReports.length} reports (expected ${incident.report_count})`);

    const safeReports = rawReports.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      category: r.category,
      area: r.area,
      status: r.status,
      created_at: r.created_at,
    }));

    let xlsxBuffer: Buffer;
    try {
      xlsxBuffer = await buildIncidentExcel(
        {
          id: incident.id,
          category: incident.category,
          area: incident.area,
          status: incident.status,
          severity: incident.severity,
          report_count: incident.report_count,
          ai_summary: incident.ai_summary ?? null,
          created_at: incident.created_at,
          updated_at: incident.updated_at,
        },
        safeReports,
        { displayName: actor.displayName, role: actor.role },
      );
    } catch (buildError: any) {
      console.error("[export] xlsx build failed:", buildError?.message);
      return res.status(500).json({ message: "Failed to build export file" });
    }

    // Audit log
    await storage.addAuditEntry({
      userId: actor.id,
      userName: actor.displayName,
      orgId: actor.orgId,
      action: "export_incident",
      entityType: "incident",
      entityId: String(req.params.id),
      details: `Exported incident as .xlsx | reports: ${safeReports.length} (expected: ${incident.report_count}) | role: ${actor.role}`,
    });

    const filename = `incident-${incident.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("X-Export-By", actor.displayName);
    res.setHeader("X-Export-Role", actor.role);
    return res.send(xlsxBuffer);
  });

  app.post("/api/incidents/:id/analyze", async (req, res) => {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res
        .status(500)
        .json({ message: "Supabase configuration is missing" });
    }

    const actor = await resolveAnalyzeActor(req, supabase);
    if (!actor) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { data: incident, error: incidentError } = await supabase
      .from("incidents")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (incidentError) return res.status(500).json({ message: incidentError.message });
    if (!incident) return res.status(404).json({ message: "Incident not found" });

    const { error: resetError } = await supabase
      .from("incidents")
      .update({ ai_summary: null })
      .eq("id", req.params.id);
    if (resetError) {
      return res.status(500).json({
        message: "Failed to initialize incident analysis",
        error: sanitizeErrorMessage(resetError.message),
        success: false,
        incidentId: req.params.id,
      });
    }

    const reports = await getIncidentReports(supabase, req.params.id, 10);
    const result = await generateAndStoreIncidentSummary(
      supabase,
      { ...(incident as Incident), ai_summary: null },
      reports,
    );

    await storage.addAuditEntry({
      userId: actor.id,
      userName: actor.displayName,
      orgId: actor.orgId,
      action: "analyze_incident",
      entityType: "incident",
      entityId: req.params.id,
      details: `Incident analysis ${result.success ? "succeeded" : `failed: ${result.error}`}`,
    });

    return res.status(result.success ? 200 : 500).json({
      message: result.success ? "Analysis completed" : "Analysis failed",
      success: result.success,
      error: result.error,
      incidentId: req.params.id,
    });
  });

  app.get("/api/crises", async (req, res) => {
    const filters = {
      status: req.query.status as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    const crises = await storage.getCrises(filters);
    res.json(crises);
  });

  app.get("/api/crises/:id", async (req, res) => {
    const crisis = await storage.getCrisis(req.params.id);
    if (!crisis) return res.status(404).json({ message: "Crisis not found" });
    res.json(crisis);
  });

  app.get("/api/crises/:id/reports", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
    const reports = await storage.getCrisisReports(req.params.id, limit);
    res.json(reports);
  });

  app.post("/api/sensemaking/generate/:crisisId", authMiddleware, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const analysis = await storage.generateCrisisAnalysis(String(req.params.crisisId));
      const record = await storage.saveAnalysisRecord(
        String(req.params.crisisId),
        analysis,
        user.id,
        user.displayName,
      );

      await storage.addAuditEntry({
        userId: user.id,
        userName: user.displayName,
        orgId: user.orgId,
        action: "generate_analysis",
        entityType: "crisis",
        entityId: String(req.params.crisisId),
        details: "Generated crisis analysis",
      });

      res.json({ analysis, recordId: record.id });
    } catch (error: any) {
      res
        .status(error.message === "Crisis not found" ? 404 : 500)
        .json({ message: error.message });
    }
  });

  app.get("/api/sensemaking/history/:crisisId", authMiddleware, async (req, res) => {
    const records = await storage.getAnalysisRecords(String(req.params.crisisId));
    res.json(records);
  });

  app.post("/api/sensemaking/:recordId/review", authMiddleware, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (user.role === "viewer") return res.status(403).json({ message: "Forbidden" });

    const { status, note } = req.body;
    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid review status" });
    }

    const record = await storage.updateAnalysisStatus(
      String(req.params.recordId),
      status,
      user.id,
      user.displayName,
      note || "",
    );
    if (!record) return res.status(404).json({ message: "Analysis record not found" });

    await storage.addAuditEntry({
      userId: user.id,
      userName: user.displayName,
      orgId: user.orgId,
      action: status === "approved" ? "approve_analysis" : "reject_analysis",
      entityType: "analysis",
      entityId: String(req.params.recordId),
      details: `${status} analysis${note ? `: ${note}` : ""}`,
    });

    res.json(record);
  });

  app.get("/api/audit", authMiddleware, requireRole("admin"), async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const log = await storage.getAuditLog(limit);
    res.json(log);
  });

  app.get("/api/monitoring/signals", authMiddleware, async (_req, res) => {
    const signals = await storage.getSignals();
    res.json(signals);
  });

  // ── Intelligence Scanner ───────────────────────────────────────────────
  // Auth: Supabase JWT or session | Role: analyst or admin
  app.get("/api/intelligence/scan", async (req, res) => {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ message: "Supabase configuration is missing" });
    }

    const actor = await resolveAnalyzeActor(req, supabase);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });
    if (actor.role !== "admin" && actor.role !== "analyst") {
      return res.status(403).json({ message: "Access denied" });
    }

    try {
      const result = await runIntelligenceScan(supabase);

      await storage.addAuditEntry({
        userId: actor.id,
        userName: actor.displayName,
        orgId: actor.orgId,
        action: "intelligence_scan",
        entityType: "system",
        entityId: "intelligence",
        details: `Scan: ${result.reports_scanned} reports → ${result.suggestions.length} suggestions (${result.scan_duration_ms}ms)`,
      });

      return res.json(result);
    } catch (err: any) {
      console.error("[intelligence] scan failed:", err.message);
      return res.status(500).json({ message: "Intelligence scan failed", error: err.message });
    }
  });

  // ── Analyst Notes — PATCH /api/incidents/:id/notes ───────────────────────
  // Auth: session | Role: analyst or admin | Audited
  app.patch("/api/incidents/:id/notes", authMiddleware, requireRole("analyst", "admin"), async (req, res) => {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ message: "Supabase configuration is missing" });
    }

    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: "User not found" });

    const notes = typeof req.body.notes === "string" ? req.body.notes.trim().slice(0, 2000) : "";

    const { data, error } = await supabase
      .from("incidents")
      .update({ analyst_notes: notes })
      .eq("id", req.params.id)
      .select("id, analyst_notes")
      .maybeSingle();

    if (error) {
      console.error("[incidents:notes] update failed:", error.message);
      return res.status(500).json({ message: "Failed to update notes" });
    }
    if (!data) return res.status(404).json({ message: "Incident not found" });

    await storage.addAuditEntry({
      userId: user.id,
      userName: user.displayName,
      orgId: user.orgId,
      action: "update_analyst_notes",
      entityType: "incident",
      entityId: String(req.params.id),
      details: `Analyst notes updated (${notes.length} chars)`,
    });

    return res.json({ id: data.id, analyst_notes: data.analyst_notes });
  });

  return httpServer;
}
