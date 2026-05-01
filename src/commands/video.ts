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

  const resolution = normalizeResolution(options.resolution, aspectRatio, modelId);

  const gateway = createGateway({ apiKey });
  const start = Date.now();
  const stopSpinner = options.json
    ? (_: boolean) => {}
    : startSpinner(`Generating video with ${modelId}`);

  let result: Awaited<ReturnType<typeof generateVideo>>;
  let succeeded = false;
  try {
    result = await generateVideo({
      model: gateway.videoModel(modelId),
      prompt: options.prompt,
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(options.duration != null ? { duration: options.duration } : {}),
      ...(resolution ? { resolution } : {}),
    });
    succeeded = true;
  } finally {
    stopSpinner(succeeded);
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
    const cost =
      options.duration != null && resolution
        ? await computeCost(modelId, {
            videoSeconds: options.duration * result.videos.length,
            videoResolution: resolution,
          })
        : null;
    stdout.write(
      JSON.stringify(
        {
          model: modelId,
          files: savedPaths,
          elapsedSeconds: +((Date.now() - start) / 1000).toFixed(1),
          durationSeconds: options.duration ?? null,
          resolution: resolution ?? null,
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

const SHORTHAND_RESOLUTIONS: Record<string, [number, number]> = {
  "480p": [854, 480],
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
  "2160p": [3840, 2160],
  "4k": [3840, 2160],
};

function normalizeResolution(
  input: string | undefined,
  aspect: `${number}:${number}` | undefined,
  modelId: string,
): `${number}x${number}` | undefined {
  if (!input) return undefined;
  const direct = input.match(/^(\d+)x(\d+)$/i);
  if (direct) return `${Number(direct[1])}x${Number(direct[2])}`;
  const dims = SHORTHAND_RESOLUTIONS[input.toLowerCase()];
  if (!dims) {
    throw new Error(
      `Invalid --resolution "${input}". Use NxN (e.g. 1280x720) or a shorthand (480p, 720p, 1080p, 1440p, 2160p, 4k).`,
    );
  }
  let [w, h] = dims;
  // Wan v2.5 ships 480p as 848x480, not the Grok/Seedance 854x480.
  if (input.toLowerCase() === "480p" && modelId === "alibaba/wan-v2.5-t2v-preview") {
    w = 848;
  }
  if (aspect) {
    const [awStr, ahStr] = aspect.split(":");
    const aw = Number(awStr);
    const ah = Number(ahStr);
    if (aw === ah) {
      const side = Math.min(w, h);
      w = side;
      h = side;
    } else if (aw < ah) {
      [w, h] = [h, w];
    }
  }
  return `${w}x${h}`;
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
    const withExt = override.includes(".") ? override : `${override}.${ext}`;
    if (total === 1) return resolve(withExt);
    return resolve(suffixFilename(withExt, `-${index + 1}`));
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

function startSpinner(label: string): (succeeded: boolean) => void {
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
  return (succeeded) => {
    clearInterval(interval);
    stderr.write(`\r${" ".repeat(label.length + 20)}\r`);
    if (succeeded) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      stderr.write(`Done in ${elapsed}s.\n`);
    }
  };
}
