import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { supabase } from "../services/supabaseClient";
import { getRequiredEnv } from "../utils/env";

const router = Router();

type CreateReportBody = {
  user_id?: unknown;
  title?: unknown;
  content?: unknown;
};

type ReportStatus = "pending" | "processing" | "analyzed" | "failed";

const DASHBOARD_API_KEY = getRequiredEnv("INTERNAL_DASHBOARD_API_KEY");
const ALLOWED_REPORT_STATUSES: ReportStatus[] = [
  "pending",
  "processing",
  "analyzed",
  "failed",
];

function parseReportId(rawId: string | string[]): number | null {
  if (Array.isArray(rawId)) {
    return null;
  }

  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function isAllowedStatus(value: string): value is ReportStatus {
  return ALLOWED_REPORT_STATUSES.includes(value as ReportStatus);
}

function hasValidDashboardKey(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function requireDashboardAccess(req: Request, res: Response, next: NextFunction): void {
  const providedKey = req.header("x-dashboard-key")?.trim() ?? "";

  if (!providedKey || !hasValidDashboardKey(providedKey, DASHBOARD_API_KEY)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const { user_id, title, content } = req.body as CreateReportBody;

    if (typeof user_id !== "string" || user_id.trim().length === 0) {
      return res.status(400).json({ error: "user_id is required and must be a non-empty string" });
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "content is required and must be a non-empty string" });
    }

    if (title !== undefined && typeof title !== "string") {
      return res.status(400).json({ error: "title must be a string when provided" });
    }

    const payload = {
      user_id: user_id.trim(),
      title: typeof title === "string" ? title.trim() : null,
      content: content.trim(),
      status: "pending",
    };

    const { data, error } = await supabase
      .from("reports")
      .insert([payload])
      .select("*")
      .single();

    if (error) {
      console.error("Failed to create report:", error);
      return res.status(500).json({ error: "Failed to create report" });
    }

    return res.status(201).json({ report: data });
  } catch (error) {
    console.error("Unexpected error while creating report:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/", requireDashboardAccess, async (req: Request, res: Response) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(req.query.page_size, 20), 100);
    const statusQuery = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("reports")
      .select("id, status, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (statusQuery) {
      if (!isAllowedStatus(statusQuery)) {
        return res.status(400).json({ error: "Invalid status filter" });
      }

      query = query.eq("status", statusQuery);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error("Failed to list reports:", error);
      return res.status(500).json({ error: "Failed to list reports" });
    }

    const total = count ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    return res.status(200).json({
      reports: data ?? [],
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    console.error("Unexpected error while listing reports:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", requireDashboardAccess, async (req: Request, res: Response) => {
  try {
    const id = parseReportId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "id must be a positive integer" });
    }

    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Failed to fetch report:", error);
      return res.status(500).json({ error: "Failed to fetch report" });
    }

    if (!data) {
      return res.status(404).json({ error: "Report not found" });
    }

    return res.status(200).json({ report: data });
  } catch (error) {
    console.error("Unexpected error while fetching report:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/analysis", requireDashboardAccess, async (req: Request, res: Response) => {
  try {
    const id = parseReportId(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "id must be a positive integer" });
    }

    const { data, error } = await supabase
      .from("reports")
      .select("status, analysis_result")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Failed to fetch report analysis:", error);
      return res.status(500).json({ error: "Failed to fetch report analysis" });
    }

    if (!data) {
      return res.status(404).json({ error: "Report not found" });
    }

    if (data.status === "analyzed") {
      if (!data.analysis_result) {
        return res.status(500).json({ error: "Analysis unavailable" });
      }

      return res.status(200).json({ analysis: data.analysis_result });
    }

    if (data.status === "failed") {
      return res.status(422).json({ error: "Report analysis failed", status: data.status });
    }

    return res.status(409).json({ error: "Report analysis not ready", status: data.status });
  } catch (error) {
    console.error("Unexpected error while fetching report analysis:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
