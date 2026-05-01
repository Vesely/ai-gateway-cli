import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout, stderr } from "node:process";
import { createGateway } from "@ai-sdk/gateway";
import { experimental_generateVideo as generateVideo } from "ai";
import { DEFAULT_VIDEO_MODEL, loadConfig } from "../config.ts";
import { resolveApiKey, computeCost } from "../gateway.ts";

export type VideoOptions = {
  prompt: string;
  model?: string;
  apiKey?: string;
  output?: string;
  duration?: number;
  aspect?: string;
  resolution?: string;
  json?: boolean;
};

export async function runVideo(options: VideoOptions): Promise<void> {
  const config = await loadConfig();
  const apiKey = await resolveApiKey(config, options.apiKey);
  const modelId = options.model ?? config.videoModel ?? DEFAULT_VIDEO_MODEL;

  const aspectRatio = options.aspect as `${number}:${number}` | undefined;
  if (aspectRatio && !/^\d+:\d+$/.test(aspectRatio)) {
    throw new Error(`Invalid --aspect "${options.aspect}". Use width:height, e.g. 16:9.`);
  }

  const gateway = createGateway({ apiKey });
  const start = Date.now();
  const stopSpinner = options.json
    ? () => {}
    : startSpinner(`Generating video with ${modelId}`);

  let result: Awaited<ReturnType<typeof generateVideo>>;
  try {
    result = await generateVideo({
      model: gateway.videoModel(modelId),
      prompt: options.prompt,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(options.duration != null ? { duration: options.duration } : {}),
      ...(options.resolution
        ? { resolution: options.resolution as `${number}x${number}` }
        : {}),
    });
  } finally {
    stopSpinner();
  }

  if (!result.videos.length) throw new Error("Gateway returned no videos.");

  const ext = pickExtension(result.videos[0]?.mediaType);
  const savedPaths = await Promise.all(
    result.videos.map(async (video, i) => {
      const filePath = resolveOutputPath(options.output, i, result.videos.length, ext);
      await writeFile(filePath, video.uint8Array);
      return filePath;
    }),
  );

  if (options.json) {
    const seconds = options.duration ?? defaultDuration(modelId);
    const cost = await computeCost(modelId, {
      videoSeconds: seconds && result.videos.length ? seconds * result.videos.length : undefined,
      videoResolution: options.resolution,
    });
    stdout.write(
      JSON.stringify(
        {
          model: modelId,
          files: savedPaths,
          elapsedSeconds: +((Date.now() - start) / 1000).toFixed(1),
          durationSeconds: seconds ?? null,
          resolution: options.resolution ?? null,
          aspectRatio: options.aspect ?? null,
          cost,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    for (const p of savedPaths) stdout.write(`Saved: ${p}\n`);
  }
}

function defaultDuration(modelId: string): number {
  if (modelId.startsWith("google/veo")) return 8;
  if (modelId.startsWith("klingai/")) return 5;
  if (modelId.startsWith("alibaba/")) return 5;
  return 5;
}

function pickExtension(mediaType: string | undefined): string {
  if (!mediaType) return "mp4";
  if (mediaType.includes("webm")) return "webm";
  if (mediaType.includes("quicktime")) return "mov";
  return "mp4";
}

function resolveOutputPath(
  override: string | undefined,
  index: number,
  total: number,
  ext: string,
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
  return resolve(`ai-video-${stamp}${suffix}.${ext}`);
}

function suffixFilename(path: string, suffix: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return path + suffix;
  return path.slice(0, dot) + suffix + path.slice(dot);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startSpinner(label: string): () => void {
  if (!stderr.isTTY) {
    stderr.write(`${label}…\n`);
    return () => {};
  }
  const start = Date.now();
  let i = 0;
  const render = () => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    stderr.write(`\r${SPINNER_FRAMES[i % SPINNER_FRAMES.length]} ${label}… ${elapsed}s`);
    i++;
  };
  render();
  const interval = setInterval(render, 200);
  return () => {
    clearInterval(interval);
    const elapsed = Math.round((Date.now() - start) / 1000);
    stderr.write(`\r${" ".repeat(label.length + 20)}\r`);
    stderr.write(`Done in ${elapsed}s.\n`);
  };
}
