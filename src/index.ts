import { stderr, stdout, exit, argv } from "node:process";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { runText } from "./commands/text.ts";
import { runImage } from "./commands/image.ts";
import { runVideo } from "./commands/video.ts";
import { runModels } from "./commands/models.ts";
import { runConfigShow, runConfigSet } from "./commands/config-cmd.ts";

const HELP = `ai-gateway — generate text, images, and video via the Vercel AI Gateway.

USAGE
  ai-gateway [text] [options] <prompt>          generate text (streamed)
  ai-gateway image [options] <prompt>           generate an image, save to disk
  ai-gateway video [options] <prompt>           generate a video, save to disk
  ai-gateway models [options]                   list available models
  ai-gateway config                             show current config
  ai-gateway config set <key> <value>           set "key" | "text-model" | "image-model" | "video-model"

TEXT OPTIONS
  -m, --model <id>     model id (default: configured or xai/grok-4.1-fast-non-reasoning)
      --json           print full JSON response instead of streaming
      --key <value>    override API key for this call
  Stdin: piped input is prepended to the prompt as context.

IMAGE OPTIONS
  -m, --model <id>     model id (default: configured or bfl/flux-2-flex)
  -o, --output <path>  output file (default: ./ai-image-<timestamp>.png)
  -n, --count <n>      number of images (default: 1)
      --json           print JSON metadata instead of human output
      --key <value>    override API key for this call

VIDEO OPTIONS
  -m, --model <id>     model id (default: configured or xai/grok-imagine-video)
  -o, --output <path>  output file (default: ./ai-video-<timestamp>.mp4)
      --duration <s>   length in seconds (model-specific defaults)
      --aspect <r>     aspect ratio, e.g. 16:9, 9:16, 1:1
      --resolution <r> resolution, e.g. 720p, 1080p, 1280x720
      --json           print JSON metadata instead of human output
      --key <value>    override API key for this call

MODELS OPTIONS
      --type <type>    filter by type: language | image | embedding | reranking | video
      --search <text>  filter by id/name substring
      --json           raw JSON

ENV
  AI_GATEWAY_API_KEY   API key fallback (overridden by --key, overrides config file).

EXAMPLES
  ai-gateway "explain quicksort in 3 bullets"
  cat README.md | ai-gateway "summarize this"
  ai-gateway image "a red fox in a snowy forest" -o fox.png
  ai-gateway video "a wave crashing on rocks at sunset" --duration 5
  ai-gateway models --type video
  ai-gateway config set key sk_...
`;

const TEXT_OPTIONS = {
  model: { type: "string", short: "m" },
  key: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

const IMAGE_OPTIONS = {
  model: { type: "string", short: "m" },
  output: { type: "string", short: "o" },
  count: { type: "string", short: "n" },
  key: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

const VIDEO_OPTIONS = {
  model: { type: "string", short: "m" },
  output: { type: "string", short: "o" },
  duration: { type: "string" },
  aspect: { type: "string" },
  resolution: { type: "string" },
  key: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

const MODELS_OPTIONS = {
  type: { type: "string" },
  search: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

async function main(): Promise<void> {
  const raw = argv.slice(2);
  if (raw.length === 0 || raw[0] === "--help" || raw[0] === "-h" || raw[0] === "help") {
    stdout.write(HELP);
    return;
  }

  const [first, ...rest] = raw;
  switch (first) {
    case "image":
      return dispatchImage(rest);
    case "video":
      return dispatchVideo(rest);
    case "models":
      return dispatchModels(rest);
    case "config":
      return dispatchConfig(rest);
    case "text":
      return dispatchText(rest);
    default:
      return dispatchText(raw);
  }
}

async function dispatchText(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args, options: TEXT_OPTIONS, allowPositionals: true, strict: true,
  });
  if (values.help) return void stdout.write(HELP);
  const prompt = positionals.join(" ").trim();
  if (!prompt) throw new Error('Missing prompt. Try: ai-gateway "hello world"');
  await runText({
    prompt,
    model: values.model,
    apiKey: values.key,
    json: values.json,
  });
}

async function dispatchImage(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args, options: IMAGE_OPTIONS, allowPositionals: true, strict: true,
  });
  if (values.help) return void stdout.write(HELP);
  const prompt = positionals.join(" ").trim();
  if (!prompt) throw new Error('Missing prompt. Try: ai-gateway image "a red fox"');
  const count = values.count !== undefined ? Number(values.count) : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
    throw new Error("--count must be a positive integer.");
  }
  await runImage({
    prompt,
    model: values.model,
    apiKey: values.key,
    output: values.output,
    count,
    json: values.json,
  });
}

async function dispatchVideo(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args, options: VIDEO_OPTIONS, allowPositionals: true, strict: true,
  });
  if (values.help) return void stdout.write(HELP);
  const prompt = positionals.join(" ").trim();
  if (!prompt) throw new Error('Missing prompt. Try: ai-gateway video "a wave crashing on rocks"');
  const duration = values.duration !== undefined ? Number(values.duration) : undefined;
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
    throw new Error("--duration must be a positive number of seconds.");
  }
  await runVideo({
    prompt,
    model: values.model,
    apiKey: values.key,
    output: values.output,
    duration,
    aspect: values.aspect,
    resolution: values.resolution,
    json: values.json,
  });
}

async function dispatchModels(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args, options: MODELS_OPTIONS, allowPositionals: false, strict: true,
  });
  if (values.help) return void stdout.write(HELP);
  await runModels({
    type: values.type,
    search: values.search,
    json: values.json,
  });
}

async function dispatchConfig(args: string[]): Promise<void> {
  const [sub, key, ...valueParts] = args;
  if (!sub) return runConfigShow();
  if (sub === "set") {
    if (!key) throw new Error("Usage: ai-gateway config set <key> <value>");
    return runConfigSet(key, valueParts.join(" "));
  }
  throw new Error(`Unknown config subcommand "${sub}". Try: ai-gateway config | config set <key> <value>`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  stderr.write(`Error: ${message}\n`);
  exit(1);
});
