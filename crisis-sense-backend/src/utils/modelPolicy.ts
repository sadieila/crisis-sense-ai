export const ALLOWED_ANTHROPIC_MODEL = "claude-3-haiku-20240307" as const;

export function assertAllowedAnthropicModel(
  model: string,
  usage: "analysis" | "embedding",
): void {
  if (model !== ALLOWED_ANTHROPIC_MODEL) {
    throw new Error(
      `Invalid ${usage} model "${model}". Allowed model: ${ALLOWED_ANTHROPIC_MODEL}`,
    );
  }
}
