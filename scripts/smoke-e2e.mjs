import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const baseUrl =
  process.env.SMOKE_BASE_URL?.trim() ||
  `http://127.0.0.1:${process.env.PORT?.trim() || "5000"}`;
const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_KEY?.trim() ||
  "";
const smokeUserId = process.env.SMOKE_USER_ID?.trim() || "";

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required for smoke test");
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) is required for smoke test",
  );
}

if (!smokeUserId) {
  throw new Error("SMOKE_USER_ID is required for smoke test");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function assertHealth(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed (${response.status})`);
  }

  const payload = await response.json();
  if (payload?.status !== "ok") {
    throw new Error(`GET ${pathname} returned unexpected payload`);
  }
}

async function postReport() {
  const response = await fetch(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      user_id: smokeUserId,
      category: "صحة",
      subProblem: "نقص أدوية أساسية",
      area: "غزة المدينة",
      specificLocation: null,
      title: "صحة - نقص أدوية أساسية",
      content:
        "Category: صحة\nIssue: نقص أدوية أساسية\nArea: غزة المدينة\nDetails: smoke verification payload",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST /api/reports failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  if (!payload?.id) {
    throw new Error("POST /api/reports did not return an id");
  }

  return String(payload.id);
}

async function assertPersisted(reportId) {
  const normalizedId = /^\d+$/.test(reportId) ? Number.parseInt(reportId, 10) : reportId;
  const { data, error } = await supabase
    .from("reports")
    .select("id,status,created_at")
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase lookup failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Report ${reportId} was not persisted`);
  }

  if (data.status !== "pending") {
    throw new Error(`Report ${reportId} status expected "pending", received "${data.status}"`);
  }
}

async function main() {
  console.log(`[smoke] base_url=${baseUrl}`);
  await assertHealth("/health");
  await assertHealth("/api/health");
  const reportId = await postReport();
  await assertPersisted(reportId);
  console.log(`[smoke] created_report_id=${reportId}`);
  console.log("[smoke] PASS");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[smoke] FAIL: ${message}`);
  process.exit(1);
});
