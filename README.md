# ai-gateway

A tiny CLI for generating text and images via the [Vercel AI Gateway](https://vercel.com/ai-gateway). One key, hundreds of models, no code required.

```bash
ai-gateway "explain quicksort in 3 bullets"
ai-gateway image "a red fox in a snowy forest" -o fox.png
cat README.md | ai-gateway "summarize this"
```

## Install

Requires Node 20+.

```bash
npm install -g ai-gateway-cli
```

Or with another package manager:

```bash
pnpm add -g ai-gateway-cli
bun add -g ai-gateway-cli
```

## First run

Get an API key from <https://vercel.com/ai-gateway> and either:

- Run any command — you'll be prompted to paste it (saved to `~/.config/ai-gateway-cli/config.json`, chmod 600), or
- Export it: `export AI_GATEWAY_API_KEY=...`, or
- Run `ai-gateway config set key sk_...`

## Commands

| Command | What it does |
| --- | --- |
| `ai-gateway "<prompt>"` | Streamed text completion (default command). |
| `ai-gateway image "<prompt>"` | Generate an image, save to disk. |
| `ai-gateway models` | List all available models with prices. |
| `ai-gateway config` | Show current config. |
| `ai-gateway config set <key> <value>` | Set `key`, `text-model`, or `image-model`. |

## Defaults

Picked for the best price/quality ratio:

- Text: `xai/grok-4.1-fast-non-reasoning`
- Image: `bfl/flux-2-flex`

Override per-call with `-m <model-id>`, or persist with `ai-gateway config set text-model openai/gpt-5.4`.

## Examples

```bash
# Text with a different model
ai-gateway -m anthropic/claude-opus-4.6 "draft a tweet about CLIs"

# Pipe context in
git diff | ai-gateway "write a commit message for this diff"

# Get raw JSON (no streaming)
ai-gateway --json "hello" | jq .text

# Image with a specific output path
ai-gateway image -m bfl/flux-2-pro -o cover.png "a minimalist mountain logo"

# Multiple images
ai-gateway image -n 4 "abstract wallpaper, blue and gold"

# Multimodal LLMs that generate images (Nano Banana, Gemini 3 Pro Image, GPT-5 image)
ai-gateway image -m google/gemini-2.5-flash-image "a hedgehog wearing a tiny hat"
ai-gateway image -m google/gemini-3-pro-image -o cover.png "minimalist mountain logo"

# Browse models
ai-gateway models --type image
ai-gateway models --search claude
ai-gateway models --json | jq '.[] | select(.type=="language") | .id'
```

## Key resolution order

1. `--key <value>` flag
2. `AI_GATEWAY_API_KEY` env var
3. `~/.config/ai-gateway-cli/config.json`
4. Interactive prompt (TTY only)
