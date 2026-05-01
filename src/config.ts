import { homedir } from "node:os";
import { join } from "node:path";
import { stderr } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export type Config = {
  apiKey?: string;
  textModel?: string;
  imageModel?: string;
  videoModel?: string;
};

export const DEFAULT_TEXT_MODEL = "xai/grok-4.1-fast-non-reasoning";
export const DEFAULT_IMAGE_MODEL = "google/imagen-4.0-fast-generate-001";
export const DEFAULT_VIDEO_MODEL = "xai/grok-imagine-video";

const CONFIG_DIR = join(homedir(), ".config", "ai-gateway-cli");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Config;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    stderr.write(`Warning: ${CONFIG_PATH} is not valid JSON. Using empty config.\n`);
    return {};
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function patchConfig(patch: Partial<Config>): Promise<Config> {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await saveConfig(next);
  return next;
}
