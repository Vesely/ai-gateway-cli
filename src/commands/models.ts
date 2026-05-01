import { stdout } from "node:process";
import { fetchModelsCached, type ModelEntry } from "../gateway.ts";

export type ModelsOptions = {
  type?: string;
  json?: boolean;
  search?: string;
};

export async function runModels(options: ModelsOptions): Promise<void> {
  const all = await fetchModelsCached();
  const filtered = filterModels(all, options);

  if (options.json) {
    stdout.write(JSON.stringify(filtered, null, 2) + "\n");
    return;
  }

  if (filtered.length === 0) {
    stdout.write("No models matched.\n");
    return;
  }

  stdout.write(formatTable(filtered) + "\n");
  stdout.write(`\n${filtered.length} model(s).\n`);
}

function filterModels(models: ModelEntry[], opts: ModelsOptions): ModelEntry[] {
  let result = models;
  if (opts.type) result = result.filter((m) => m.type === opts.type);
  if (opts.search) {
    const needle = opts.search.toLowerCase();
    result = result.filter((m) =>
      m.id.toLowerCase().includes(needle) ||
      (m.name ?? "").toLowerCase().includes(needle),
    );
  }
  return result.sort(byPriceThenId);
}

function byPriceThenId(a: ModelEntry, b: ModelEntry): number {
  const aCost = primaryCost(a);
  const bCost = primaryCost(b);
  if (aCost !== bCost) return aCost - bCost;
  return a.id.localeCompare(b.id);
}

function primaryCost(m: ModelEntry): number {
  const p = m.pricing;
  if (!p) return Number.POSITIVE_INFINITY;
  if (m.type === "image") return Number(p.image ?? Number.POSITIVE_INFINITY);
  const out = Number(p.output ?? "NaN");
  if (!Number.isNaN(out)) return out;
  const inp = Number(p.input ?? "NaN");
  return Number.isNaN(inp) ? Number.POSITIVE_INFINITY : inp;
}

function formatTable(models: ModelEntry[]): string {
  const rows = models.map((m) => ({
    id: m.id,
    type: m.type,
    price: priceLabel(m),
  }));
  const idW = Math.max(2, ...rows.map((r) => r.id.length));
  const typeW = Math.max(4, ...rows.map((r) => r.type.length));
  const priceW = Math.max(5, ...rows.map((r) => r.price.length));

  const header = `${"MODEL".padEnd(idW)}  ${"TYPE".padEnd(typeW)}  ${"PRICE".padEnd(priceW)}`;
  const sep = `${"-".repeat(idW)}  ${"-".repeat(typeW)}  ${"-".repeat(priceW)}`;
  const body = rows
    .map((r) => `${r.id.padEnd(idW)}  ${r.type.padEnd(typeW)}  ${r.price.padEnd(priceW)}`)
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

function priceLabel(m: ModelEntry): string {
  const p = m.pricing;
  if (!p) return "-";
  if (m.type === "image") {
    return p.image ? `$${p.image}/img` : "-";
  }
  if (p.input || p.output) {
    const inp = p.input ? perMillion(p.input) : "?";
    const out = p.output ? perMillion(p.output) : "?";
    return `$${inp} / $${out} per 1M tok`;
  }
  return "-";
}

function perMillion(perToken: string): string {
  const n = Number(perToken);
  if (Number.isNaN(n)) return perToken;
  return (n * 1_000_000).toFixed(2);
}
