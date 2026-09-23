export const LLM_CLIENT = Symbol('LLM_CLIENT');

// Gemini model via Google AI Studio (Gemini Developer API), not Vertex AI.
// Pinned explicitly (not an alias like "gemini-flash-latest") so a
// provider-side default change can't silently alter chatbot behavior/cost
// without a deploy here. Override via LLM_MODEL for a different model
// without a code change.
export const DEFAULT_LLM_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_LLM_MAX_OUTPUT_TOKENS = 1024;

// Total attempts including the original request (SDK's own definition —
// 1 means no retry). Kept modest rather than the SDK's own default of 5:
// retries burn the same free-tier quota as fresh requests, so retrying
// aggressively against a 429 makes the quota problem worse, not better.
export const DEFAULT_LLM_RETRY_ATTEMPTS = 3;

// Only transient/rate-limit failures — never retry a 4xx auth/validation
// error (e.g. bad API key, malformed request), since those fail the same
// way every time and retrying just wastes the attempt budget.
export const LLM_RETRY_STATUS_CODES = [429, 500, 502, 503, 504];
