import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv, getSupabaseServiceKey } from "../utils/env";

// Load env in this module so client initialization is safe regardless of import order.
dotenv.config({ quiet: true });

const supabaseUrl = getRequiredEnv("SUPABASE_URL");
const supabaseServiceKey = getSupabaseServiceKey();

try {
  new URL(supabaseUrl);
} catch {
  throw new Error("Invalid SUPABASE_URL format");
}

// Service role key bypasses RLS and must remain server-only.
export const supabase = createClient(supabaseUrl, supabaseServiceKey);
