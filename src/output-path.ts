import { resolve } from "node:path";

export function resolveOutputPath(
  override: string | undefined,
  index: number,
  total: number,
  ext: string,
  prefix: string,
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
  return resolve(`${prefix}-${stamp}${suffix}.${ext}`);
}

function suffixFilename(path: string, suffix: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return path + suffix;
  return path.slice(0, dot) + suffix + path.slice(dot);
}
