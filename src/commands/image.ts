import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout } from "node:process";
import { DEFAULT_IMAGE_MODEL, loadConfig } from "../config.ts";
import { resolveApiKey, gatewayFetch, findModel, type ModelEntry } from "../gateway.ts";

export type ImageOptions = {
  prompt: string;
  model?: string;
  apiKey?: string;
  output?: string;
  count?: number;
  json?: boolean;
};

export async function runImage(options: ImageOptions): Promise<void> {
  const config = await loadConfig();
  const apiKey = await resolveApiKey(config, options.apiKey);
  const modelId = options.model ?? config.imageModel ?? DEFAULT_IMAGE_MODEL;
  const count = options.count ?? 1;

  if (!options.json) {
    stdout.write(`Generating ${count > 1 ? `${count} images` : "image"} with ${modelId}…\n`);
  }

  const meta = await findModel(modelId);
  const route = pickRoute(modelId, meta);

  const bytesList = route === "chat"
    ? await viaChatCompletions({ apiKey, modelId, prompt: options.prompt, count })
    : await viaImagesGenerations({ apiKey, modelId, prompt: options.prompt, count });

  if (bytesList.length === 0) throw new Error("Gateway returned no images.");

  const savedPaths = await Promise.all(
    bytesList.map(async (bytes, i) => {
      const filePath = resolveOutputPath(options.output, i, bytesList.length);
      await writeFile(filePath, bytes);
      return filePath;
    }),
  );

  if (options.json) {
    stdout.write(JSON.stringify({ model: modelId, files: savedPaths }, null, 2) + "\n");
  } else {
    for (const p of savedPaths) stdout.write(`Saved: ${p}\n`);
  }
}

function pickRoute(modelId: string, meta: ModelEntry | undefined): "images" | "chat" {
  if (!meta) return "images";
  if (meta.type === "image") return "images";
  if (meta.tags?.includes("image-generation")) return "chat";
  throw new Error(
    `Model "${modelId}" does not support image generation (type=${meta.type}). ` +
      `Run \`ai-gateway models --type image\` for image-only models, or pick a multimodal LLM with the "image-generation" tag (e.g. google/gemini-2.5-flash-image).`,
  );
}

type RouteArgs = { apiKey: string; modelId: string; prompt: string; count: number };

async function viaImagesGenerations(args: RouteArgs): Promise<Uint8Array[]> {
  const res = await gatewayFetch("/images/generations", {
    apiKey: args.apiKey,
    method: "POST",
    body: JSON.stringify({
      model: args.modelId,
      prompt: args.prompt,
      n: args.count,
      response_format: "b64_json",
    }),
  });
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const entries = json.data ?? [];
  return Promise.all(entries.map(decodeImageEntry));
}

type ChatImage = { type?: string; image_url?: { url?: string } };
type ChatResponse = {
  choices?: Array<{
    message?: { content?: string; images?: ChatImage[] };
  }>;
};

async function viaChatCompletions(args: RouteArgs): Promise<Uint8Array[]> {
  // /v1/chat/completions has no native `n`; fan out and collect.
  const responses = await Promise.all(
    Array.from({ length: args.count }, () =>
      gatewayFetch("/chat/completions", {
        apiKey: args.apiKey,
        method: "POST",
        body: JSON.stringify({
          model: args.modelId,
          messages: [{ role: "user", content: args.prompt }],
          stream: false,
        }),
      }).then((res) => res.json() as Promise<ChatResponse>),
    ),
  );

  const collected: Uint8Array[] = [];
  for (const json of responses) {
    const message = json.choices?.[0]?.message;
    const images = message?.images ?? [];
    if (images.length === 0) {
      throw new Error(
        `Model "${args.modelId}" returned no images. Text response: ${message?.content?.slice(0, 200) ?? "(empty)"}`,
      );
    }
    for (const img of images) collected.push(decodeDataUrl(img.image_url?.url));
  }
  return collected;
}

async function decodeImageEntry(entry: { b64_json?: string; url?: string }): Promise<Uint8Array> {
  if (entry.b64_json) return Buffer.from(entry.b64_json, "base64");
  if (entry.url) {
    if (entry.url.startsWith("data:")) return decodeDataUrl(entry.url);
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`Failed to download image: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error("Image entry had neither b64_json nor url.");
}

function decodeDataUrl(url: string | undefined): Uint8Array {
  if (!url) throw new Error("Empty image URL in response.");
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma === -1) {
    throw new Error(`Unexpected image URL format: ${url.slice(0, 50)}…`);
  }
  return Buffer.from(url.slice(comma + 1), "base64");
}

function resolveOutputPath(
  override: string | undefined,
  index: number,
  total: number,
): string {
  if (override) {
    if (total === 1) return resolve(override);
    return resolve(suffixFilename(override, `-${index + 1}`));
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const suffix = total === 1 ? "" : `-${index + 1}`;
  return resolve(`ai-image-${stamp}${suffix}.png`);
}

function suffixFilename(path: string, suffix: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return path + suffix;
  return path.slice(0, dot) + suffix + path.slice(dot);
}
