import dotenv from "dotenv";
import { readFile } from "fs/promises";
import { supabase } from "./supabaseClient";
import { retryWithExponentialBackoff } from "../utils/retry";
import { getRequiredEnv } from "../utils/env";
import {
  ALLOWED_ANTHROPIC_MODEL,
  assertAllowedAnthropicModel,
} from "../utils/modelPolicy";

dotenv.config({ quiet: true });

const ANTHROPIC_API_KEY = getRequiredEnv("ANTHROPIC_API_KEY");

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_TIMEOUT_MS = 45_000;

const EMBEDDING_MODEL = ALLOWED_ANTHROPIC_MODEL;

// RAG still needs vectors, so we derive stable semantic vectors via Claude in JSON mode.
assertAllowedAnthropicModel(EMBEDDING_MODEL, "embedding");

export { EMBEDDING_MODEL };

console.log(`[embeddings] using model: ${EMBEDDING_MODEL}`);

const EMBEDDING_DIMENSION = 3072;
const TARGET_CHUNK_TOKENS = 900;
const MAX_CHUNK_TOKENS = 1000;
const DEFAULT_CONTEXT_TOKENS = 2500;
const MIN_SIMILARITY_FOR_CONTEXT = 0.2;
const SEED_TITLE_PREFIX = "[SEED]";
const seedDocumentsPath = process.env.SEED_DOCUMENTS_PATH?.trim();

type AnthropicMessageResponse = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

type DocumentRow = {
  id: number;
  title?: string | null;
  content?: string | null;
  text?: string | null;
  body?: string | null;
};

type MatchDocumentRow = {
  id: number;
  title?: string | null;
  content?: string | null;
  text?: string | null;
  body?: string | null;
  similarity?: number | null;
};

type SeedDocumentInput = {
  key: string;
  title?: string;
  content: string;
  source?: string;
  tags?: string[];
};

export type RagContextResult = {
  context: string;
  documents: Array<{
    id: number;
    similarity: number | null;
  }>;
};

class AnthropicHttpError extends Error {
  status: number;

  retryable: boolean;

  constructor(status: number, body: string) {
    super(`Anthropic messages request failed with status ${status}: ${body}`);
    this.name = "AnthropicHttpError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSeedDocument(input: SeedDocumentInput): SeedDocumentInput | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const key = typeof input.key === "string" ? input.key.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  const source = typeof input.source === "string" ? input.source.trim() : "";
  const tags = Array.isArray(input.tags)
    ? input.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim())
    : [];

  if (!key || !content) {
    return null;
  }

  return {
    key,
    title: title || key,
    content,
    source: source || undefined,
    tags: tags.length > 0 ? tags : undefined,
  };
}

function buildSeedTitle(seed: SeedDocumentInput): string {
  const baseTitle = seed.title?.trim() || seed.key.trim();
  return `${SEED_TITLE_PREFIX} ${baseTitle}`;
}

function buildSeedContent(seed: SeedDocumentInput): string {
  const core = normalizeWhitespace(seed.content);
  const sourceLine = seed.source ? `\n\nSource: ${seed.source}` : "";
  const tagsLine =
    seed.tags && seed.tags.length > 0 ? `\n\nTags: ${seed.tags.join(", ")}` : "";
  return `${core}${sourceLine}${tagsLine}`.trim();
}

async function loadSeedDocuments(): Promise<SeedDocumentInput[]> {
  if (!seedDocumentsPath) {
    return [];
  }

  try {
    const raw = await readFile(seedDocumentsPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      console.warn("[seed] SEED_DOCUMENTS_PATH must contain a JSON array");
      return [];
    }

    return parsed
      .map((item) => normalizeSeedDocument(item as SeedDocumentInput))
      .filter((item): item is SeedDocumentInput => item !== null);
  } catch (error) {
    console.warn("[seed] Failed to load seed documents:", error);
    return [];
  }
}

async function ensureSeedDocuments(): Promise<number> {
  const seeds = await loadSeedDocuments();

  if (seeds.length === 0) {
    return 0;
  }

  const seedTitles = seeds.map(buildSeedTitle);
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, content")
    .in("title", seedTitles);

  if (error) {
    throw new Error(`Failed to load existing seed documents: ${error.message}`);
  }

  const existingByTitle = new Map<string, { id: number; content: string | null }>();

  for (const row of data ?? []) {
    if (typeof row.title === "string") {
      existingByTitle.set(row.title, {
        id: row.id,
        content: typeof row.content === "string" ? row.content : null,
      });
    }
  }

  let insertedCount = 0;

  for (const seed of seeds) {
    const title = buildSeedTitle(seed);
    const content = buildSeedContent(seed);
    const existing = existingByTitle.get(title);

    if (!existing) {
      const { error: insertError } = await supabase
        .from("documents")
        .insert([{ title, content }]);

      if (insertError) {
        throw new Error(`Failed to insert seed document ${title}: ${insertError.message}`);
      }

      insertedCount += 1;
      continue;
    }

    if (existing.content !== content) {
      const { error: updateError } = await supabase
        .from("documents")
        .update({ content })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(`Failed to update seed document ${title}: ${updateError.message}`);
      }
    }
  }

  return insertedCount;
}

function splitLargeWord(word: string, maxTokens: number): string[] {
  const maxChars = Math.max(1, maxTokens * 4);
  const chunks: string[] = [];

  for (let index = 0; index < word.length; index += maxChars) {
    chunks.push(word.slice(index, index + maxChars));
  }

  return chunks;
}

function splitTextIntoChunks(text: string): string[] {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const chunks: string[] = [];
  let currentWords: string[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (currentWords.length === 0) {
      return;
    }

    chunks.push(currentWords.join(" "));
    currentWords = [];
    currentTokens = 0;
  };

  for (const word of words) {
    const wordTokens = estimateTokenCount(word);

    if (wordTokens > MAX_CHUNK_TOKENS) {
      flush();
      chunks.push(...splitLargeWord(word, MAX_CHUNK_TOKENS));
      continue;
    }

    if (currentTokens + wordTokens > TARGET_CHUNK_TOKENS && currentWords.length > 0) {
      flush();
    }

    currentWords.push(word);
    currentTokens += wordTokens;

    if (currentTokens >= MAX_CHUNK_TOKENS) {
      flush();
    }
  }

  flush();

  return chunks;
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

function averageEmbeddings(vectors: number[][], weights: number[]): number[] {
  if (vectors.length === 0) {
    throw new Error("Cannot average an empty embedding set");
  }

  const dimensions = vectors[0].length;
  const weightedSum = new Array<number>(dimensions).fill(0);
  let totalWeight = 0;

  for (let index = 0; index < vectors.length; index += 1) {
    const vector = vectors[index];
    const weight = weights[index] ?? 1;

    if (vector.length !== dimensions) {
      throw new Error("Embedding dimensions are inconsistent across chunks");
    }

    totalWeight += weight;

    for (let dim = 0; dim < dimensions; dim += 1) {
      weightedSum[dim] += vector[dim] * weight;
    }
  }

  if (totalWeight === 0) {
    throw new Error("Total embedding weight cannot be zero");
  }

  const averaged = weightedSum.map((value) => value / totalWeight);
  return normalizeVector(averaged);
}

function extractDocumentContent(document: DocumentRow | MatchDocumentRow): string {
  const body = [document.content, document.text, document.body]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  const title = typeof document.title === "string" ? document.title.trim() : "";

  if (title && body) {
    return `${title}\n\n${body}`;
  }

  return normalizeWhitespace(body ?? "");
}

function parseJsonOutput(rawOutput: string): unknown {
  try {
    return JSON.parse(rawOutput);
  } catch {
    const start = rawOutput.indexOf("{");
    const end = rawOutput.lastIndexOf("}");

    if (start === -1 || end <= start) {
      throw new Error("Model output was not valid JSON");
    }

    return JSON.parse(rawOutput.slice(start, end + 1));
  }
}

function extractResponseText(payload: AnthropicMessageResponse): string {
  if (!Array.isArray(payload.content)) {
    throw new Error("Anthropic response did not include content blocks");
  }

  const textParts = payload.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (textParts.length === 0) {
    throw new Error("Anthropic response content did not contain text output");
  }

  return textParts.join("\n").trim();
}

function validateEmbedding(embedding: unknown): number[] {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Invalid embedding payload: expected ${EMBEDDING_DIMENSION} numeric values`,
    );
  }

  for (const value of embedding) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Embedding payload contains non-numeric values");
    }
  }

  return normalizeVector(embedding);
}

async function requestEmbedding(chunk: string): Promise<number[]> {
  const systemPrompt = `Return JSON only, no markdown.
Generate exactly one key named embedding.
embedding must be an array of exactly ${EMBEDDING_DIMENSION} finite numbers.
The vector must be semantic for retrieval and normalized to unit length.`;

  const userPrompt = JSON.stringify({
    task: "semantic_embedding",
    dimension: EMBEDDING_DIMENSION,
    text: chunk,
  });

  return retryWithExponentialBackoff(
    async () => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), ANTHROPIC_TIMEOUT_MS);

      try {
        const response = await fetch(ANTHROPIC_MESSAGES_URL, {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            max_tokens: 12000,
            temperature: 0,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: userPrompt,
              },
            ],
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new AnthropicHttpError(response.status, body);
        }

        const payload = (await response.json()) as AnthropicMessageResponse;
        const text = extractResponseText(payload);
        const parsed = parseJsonOutput(text) as { embedding?: unknown };

        return validateEmbedding(parsed.embedding);
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      maxAttempts: 4,
      onRetry: (error, attempt, delayMs) => {
        console.warn(
          `[embeddings] retrying Anthropic embedding request (attempt ${attempt + 1}) in ${delayMs}ms: ${String(
            error,
          )}`,
        );
      },
    },
  );
}

export async function createTextEmbedding(text: string): Promise<number[]> {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    throw new Error("Cannot create embeddings for empty text");
  }

  const chunks = splitTextIntoChunks(normalized);
  const vectors: number[][] = [];
  const weights: number[] = [];

  for (const chunk of chunks) {
    const embedding = await requestEmbedding(chunk);
    vectors.push(embedding);
    weights.push(estimateTokenCount(chunk));
  }

  return averageEmbeddings(vectors, weights);
}

export async function ensureDocumentEmbeddings(limit = 20): Promise<number> {
  try {
    const insertedSeeds = await ensureSeedDocuments();

    if (insertedSeeds > 0) {
      console.log(`[seed] inserted ${insertedSeeds} seed documents`);
    }
  } catch (error) {
    // Seed documents should not block regular processing.
    console.warn("[seed] Skipping seed document sync due to error:", error);
  }

  const { data, error } = await supabase
    .from("documents")
    .select("id, title, content, text, body")
    .is("embedding", null)
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load documents for embedding: ${error.message}`);
  }

  const documents = (data ?? []) as DocumentRow[];
  let updatedCount = 0;

  for (const document of documents) {
    const sourceText = extractDocumentContent(document);

    if (!sourceText) {
      continue;
    }

    const embedding = await createTextEmbedding(sourceText);

    const { error: updateError } = await supabase
      .from("documents")
      .update({ embedding })
      .eq("id", document.id);

    if (updateError) {
      throw new Error(
        `Failed to store embedding for document ${document.id}: ${updateError.message}`,
      );
    }

    updatedCount += 1;
  }

  return updatedCount;
}

export const MATCH_DOCUMENTS_SQL = `
create or replace function match_documents(
  query_embedding vector(3072),
  match_count int default 5
)
returns table (
  id bigint,
  title text,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    documents.id,
    documents.title,
    documents.content,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where documents.embedding is not null
  order by documents.embedding <=> query_embedding
  limit match_count;
$$;
`;

export async function buildRagContext(
  queryEmbedding: number[],
  maxDocuments = 5,
  maxContextTokens = DEFAULT_CONTEXT_TOKENS,
): Promise<RagContextResult> {
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_count: maxDocuments,
  });

  if (error) {
    throw new Error(
      `Failed to retrieve context with RPC match_documents: ${error.message}`,
    );
  }

  const rows = Array.isArray(data) ? (data as MatchDocumentRow[]) : [];
  const contextParts: string[] = [];
  const usedDocuments: RagContextResult["documents"] = [];
  let remainingTokens = Math.max(1, maxContextTokens);

  for (const row of rows) {
    if (usedDocuments.length >= maxDocuments || remainingTokens <= 100) {
      break;
    }

    if (typeof row.similarity === "number" && row.similarity < MIN_SIMILARITY_FOR_CONTEXT) {
      continue;
    }

    const rawText = extractDocumentContent(row);

    if (!rawText) {
      continue;
    }

    let snippet = rawText;
    const snippetTokens = estimateTokenCount(snippet);

    if (snippetTokens > remainingTokens) {
      const charLimit = Math.max(1, remainingTokens * 4);
      snippet = normalizeWhitespace(snippet.slice(0, charLimit));
    }

    if (!snippet) {
      continue;
    }

    const finalTokenCount = estimateTokenCount(snippet);
    const similarity = typeof row.similarity === "number" ? row.similarity : null;

    contextParts.push(
      `Document ${usedDocuments.length + 1}${
        similarity !== null ? ` (similarity ${similarity.toFixed(4)})` : ""
      }:\n${snippet}`,
    );

    usedDocuments.push({ id: row.id, similarity });
    remainingTokens -= finalTokenCount;
  }

  return {
    context: contextParts.join("\n\n"),
    documents: usedDocuments,
  };
}
