import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { type Config, saveConfig } from "./config.ts";

export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export type ModelEntry = {
  id: string;
  name?: string;
  type: "language" | "image" | "embedding" | "reranking" | "video" | string;
  tags?: string[];
  context_window?: number;
  max_tokens?: number;
  pricing?: {
    input?: string;
    output?: string;
    image?: string;
  };
};

let modelsCache: Promise<ModelEntry[]> | null = null;

export async function fetchModelsCached(): Promise<ModelEntry[]> {
  if (!modelsCache) {
    modelsCache = fetchModels().catch((err) => {
      modelsCache = null;
      throw err;
    });
  }
  return modelsCache;
}

export async function findModel(id: string): Promise<ModelEntry | undefined> {
  const all = await fetchModelsCached();
  return all.find((m) => m.id === id);
}

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
};

export async function computeCost(
  modelId: string,
  usage: Usage,
): Promise<number | null> {
  const meta = await findModel(modelId).catch(() => undefined);
  const pricing = meta?.pricing;
  if (!pricing || (pricing.input == null && pricing.output == null && pricing.image == null)) {
    return null;
  }
  const inputPrice = Number(pricing.input ?? 0);
  const outputPrice = Number(pricing.output ?? 0);
  const imagePrice = Number(pricing.image ?? 0);
  return (
    (usage.inputTokens ?? 0) * (Number.isFinite(inputPrice) ? inputPrice : 0) +
    (usage.outputTokens ?? 0) * (Number.isFinite(outputPrice) ? outputPrice : 0) +
    (usage.imageCount ?? 0) * (Number.isFinite(imagePrice) ? imagePrice : 0)
  );
}

export async function resolveApiKey(
  config: Config,
  flagKey?: string,
): Promise<string> {
  if (flagKey) return flagKey;
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  if (config.apiKey) return config.apiKey;

  if (!stdin.isTTY) {
    throw new Error(
      "No API key found. Set AI_GATEWAY_API_KEY, pass --key, or run `ai-gateway config set key <value>`.",
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write("No API key found. Get one at https://vercel.com/ai-gateway\n");
    const key = (await rl.question("Paste your AI Gateway API key: ")).trim();
    if (!key) throw new Error("Aborted: empty key");
    await saveConfig({ ...config, apiKey: key });
    stdout.write("Key saved to config.\n\n");
    return key;
  } finally {
    rl.close();
  }
}

export async function fetchModels(): Promise<ModelEntry[]> {
  const res = await fetch(`${GATEWAY_BASE_URL}/models`);
  if (!res.ok) {
    throw new Error(`Failed to list models: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data?: ModelEntry[] };
  return json.data ?? [];
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export async function gatewayFetch(
  path: string,
  init: RequestInit & { apiKey: string },
): Promise<Response> {
  const { apiKey, headers, ...rest } = init;
  const res = await fetch(`${GATEWAY_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...headers,
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GatewayError(formatHttpError(res.status, body), res.status);
  }
  return res;
}

function formatHttpError(status: number, body: string): string {
  const detail = extractErrorMessage(body);
  if (status === 401)
    return `Unauthorized (401). Check your API key. ${detail}`.trim();
  if (status === 404)
    return `Not found (404). Unknown model? Run \`ai-gateway models\` to see options. ${detail}`.trim();
  if (status === 429)
    return `Rate limited (429). ${detail}`.trim();
  return `HTTP ${status}. ${detail}`.trim();
}

function extractErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // fall through
  }
  return body.slice(0, 300);
}
