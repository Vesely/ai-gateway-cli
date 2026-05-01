import { stdin, stdout } from "node:process";
import { createGateway } from "@ai-sdk/gateway";
import { streamText, generateText } from "ai";
import { DEFAULT_TEXT_MODEL, loadConfig } from "../config.ts";
import { resolveApiKey, computeCost } from "../gateway.ts";

export type TextOptions = {
  prompt: string;
  model?: string;
  apiKey?: string;
  json?: boolean;
};

export async function runText(options: TextOptions): Promise<void> {
  const config = await loadConfig();
  const apiKey = await resolveApiKey(config, options.apiKey);
  const modelId = options.model ?? config.textModel ?? DEFAULT_TEXT_MODEL;

  const piped = await readPipedStdin();
  const prompt = piped ? `${piped}\n\n${options.prompt}` : options.prompt;

  const model = createGateway({ apiKey })(modelId);

  if (options.json) {
    const result = await generateText({ model, prompt });
    const usage = result.usage as { inputTokens?: number; outputTokens?: number };
    const cost = await computeCost(modelId, {
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
    });
    stdout.write(JSON.stringify(
      {
        model: modelId,
        text: result.text,
        usage: result.usage,
        finishReason: result.finishReason,
        cost,
      },
      null,
      2,
    ) + "\n");
    return;
  }

  const result = streamText({ model, prompt });
  for await (const chunk of result.textStream) stdout.write(chunk);
  stdout.write("\n");
}

async function readPipedStdin(): Promise<string> {
  if (stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}
