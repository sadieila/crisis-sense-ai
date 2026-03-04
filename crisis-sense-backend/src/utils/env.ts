import { ALLOWED_ANTHROPIC_MODEL } from "./modelPolicy";
type ServiceType = "api" | "worker";

const REQUIRED_RUNTIME_ENV = [
  "SUPABASE_URL",
  "ANTHROPIC_API_KEY",
  "INTERNAL_DASHBOARD_API_KEY",
  "PORT",
] as const;

function parsePositiveInt(name: string, rawValue: string): number {
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer, got "${rawValue}"`);
  }

  return parsed;
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseServiceKey(): string {
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRole) {
    return serviceRole;
  }

  const legacyServiceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (legacyServiceKey) {
    return legacyServiceKey;
  }

  throw new Error(
    "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)",
  );
}

export function getPositiveIntEnv(name: string, fallback?: number): number {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) {
    if (fallback === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }

    return fallback;
  }

  return parsePositiveInt(name, rawValue);
}

export function validateRuntimeEnv(service: ServiceType): void {
  const missing: string[] = REQUIRED_RUNTIME_ENV.filter((name) => !process.env[name]?.trim());

  const hasServiceRoleKey =
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) ||
    Boolean(process.env.SUPABASE_SERVICE_KEY?.trim());
  if (!hasServiceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `[boot][${service}] Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  // Validate numeric env values at boot to avoid runtime crashes.
  parsePositiveInt("PORT", process.env.PORT!.trim());

  if (service === "worker") {
    if (process.env.REPORT_PROCESSOR_POLL_MS?.trim()) {
      parsePositiveInt(
        "REPORT_PROCESSOR_POLL_MS",
        process.env.REPORT_PROCESSOR_POLL_MS.trim(),
      );
    }

    if (process.env.REPORT_PROCESSOR_BATCH_SIZE?.trim()) {
      parsePositiveInt(
        "REPORT_PROCESSOR_BATCH_SIZE",
        process.env.REPORT_PROCESSOR_BATCH_SIZE.trim(),
      );
    }

    if (process.env.DOCUMENT_EMBEDDING_BATCH_SIZE?.trim()) {
      parsePositiveInt(
        "DOCUMENT_EMBEDDING_BATCH_SIZE",
        process.env.DOCUMENT_EMBEDDING_BATCH_SIZE.trim(),
      );
    }
  }

  const nodeVersion = process.version;
  const model = ALLOWED_ANTHROPIC_MODEL;

  if (service === "worker") {
    const pollMs = process.env.REPORT_PROCESSOR_POLL_MS?.trim() || "5000";
    console.log(
      `[boot] service=worker node=${nodeVersion} model=${model} poll_ms=${pollMs}`,
    );
    return;
  }

  console.log(`[boot] service=api node=${nodeVersion} model=${model}`);
}
