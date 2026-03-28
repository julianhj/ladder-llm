# ladder-llm

Single package: recruitment LLM pipeline (`src/recruitment/`) and Cloudflare Worker API (`src/index.ts`, Hono + Chanfana).

## Layout

- **`src/index.ts`** — Worker entry
- **`src/endpoints/`** — Chanfana `OpenAPIRoute` classes; routes `/health`, `/agents`, `/assessment`, plus **`/docs`** (Swagger UI) and **`/openapi.json`**
- **`src/recruitment/`** — pipeline library (formerly `@recruiter/openai`)
- **`configs/`**, **`prompts/`** — agent and OpenAI config + prompt YAML (embedded at build for the Worker)
- **`tests/`** — Jest tests

## Commands

```bash
npm install
npm run build          # embed configs/prompts + TypeScript check
npm run dev            # wrangler dev (preview env)
npm run deploy:preview # or staging / prod
npm test               # excludes tests/api-endpoint.test.ts (needs a running HTTP API)
npm run test:api       # optional: hit API_URL (default http://localhost:8000)
```

Secrets: set **`OPENAI_API_KEY`** as an encrypted Worker variable per environment. For local dev, copy **`.dev.vars.example`** → **`.dev.vars`**.

Protected routes expect a valid Cloudflare Access JWT (`CF-Access-JWT-Assertion`); **`CLOUDFLARE_ACCESS_*`** vars are in **`wrangler.jsonc`**.
