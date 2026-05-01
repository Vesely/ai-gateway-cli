import { stdout } from "node:process";
import { CONFIG_PATH, loadConfig, patchConfig, DEFAULT_TEXT_MODEL, DEFAULT_IMAGE_MODEL, type Config } from "../config.ts";
import { maskKey } from "../gateway.ts";

const KEY_MAP: Record<string, keyof Config> = {
  "key": "apiKey",
  "text-model": "textModel",
  "image-model": "imageModel",
};

export async function runConfigShow(): Promise<void> {
  const cfg = await loadConfig();
  stdout.write(`Config: ${CONFIG_PATH}\n\n`);
  stdout.write(`api key:      ${cfg.apiKey ? maskKey(cfg.apiKey) : "(not set; falls back to AI_GATEWAY_API_KEY env)"}\n`);
  stdout.write(`text model:   ${cfg.textModel ?? DEFAULT_TEXT_MODEL}${cfg.textModel ? "" : " (default)"}\n`);
  stdout.write(`image model:  ${cfg.imageModel ?? DEFAULT_IMAGE_MODEL}${cfg.imageModel ? "" : " (default)"}\n`);
}

export async function runConfigSet(key: string, value: string): Promise<void> {
  const field = KEY_MAP[key];
  if (!field) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${Object.keys(KEY_MAP).join(", ")}.`,
    );
  }
  if (!value) throw new Error(`Missing value for "${key}".`);
  await patchConfig({ [field]: value });
  stdout.write(`Saved ${key}.\n`);
}
