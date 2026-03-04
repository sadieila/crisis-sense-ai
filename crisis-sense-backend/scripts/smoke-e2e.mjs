import process from "node:process";

const baseUrl =
  process.env.SMOKE_BASE_URL?.trim() ||
  `http://127.0.0.1:${process.env.PORT?.trim() || "3000"}`;
const dashboardApiKey = process.env.INTERNAL_DASHBOARD_API_KEY?.trim() || "";
const smokeUserId = process.env.SMOKE_USER_ID?.trim() || "";
const timeoutMs = Number.parseInt(process.env.SMOKE_TIMEOUT_MS?.trim() || "180000", 10);
const pollIntervalMs = Number.parseInt(
  process.env.SMOKE_POLL_INTERVAL_MS?.trim() || "5000",
  10,
);

if (!dashboardApiKey) {
  throw new Error("INTERNAL_DASHBOARD_API_KEY is required for smoke test");
}

if (!smokeUserId) {
  throw new Error("SMOKE_USER_ID is required for smoke test");
}

if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error(`Invalid SMOKE_TIMEOUT_MS: ${process.env.SMOKE_TIMEOUT_MS}`);
}

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error(
    `Invalid SMOKE_POLL_INTERVAL_MS: ${process.env.SMOKE_POLL_INTERVAL_MS}`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createReport(iteration) {
  const response = await fetch(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id: smokeUserId,
      title: `Smoke report ${iteration}`,
      content: `Smoke test scenario ${iteration}: flood alert near city hospital and road closure.`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`POST /api/reports failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const id = payload?.report?.id;

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("POST /api/reports did not return a valid report id");
  }

  return id;
}

async function waitForAnalysis(reportId) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/reports/${reportId}/analysis`, {
      method: "GET",
      headers: { "x-dashboard-key": dashboardApiKey },
    });

    if (response.status === 200) {
      const payload = await response.json();

      if (!payload?.analysis) {
        throw new Error(`Report ${reportId} returned 200 without analysis payload`);
      }

      return;
    }

    if (response.status === 409) {
      await sleep(pollIntervalMs);
      continue;
    }

    const body = await response.text();
    throw new Error(
      `GET /api/reports/${reportId}/analysis failed (${response.status}): ${body}`,
    );
  }

  throw new Error(`Timed out waiting for analysis for report ${reportId}`);
}

async function runScenario(iteration) {
  const reportId = await createReport(iteration);
  await waitForAnalysis(reportId);
}

async function main() {
  console.log(`[smoke] base_url=${baseUrl}`);
  await runScenario(1);
  await runScenario(2);
  console.log("[smoke] PASS");
}

main().catch((error) => {
  console.error("[smoke] FAIL:", error);
  process.exit(1);
});
