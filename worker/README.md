# LevlPrep Ask — optional AI backend

The site's **Ask** feature works with nothing deployed. It indexes this site's
own pages in the browser and answers by quoting the relevant passage. That path
is free, private, works offline, and is the default.

This Worker is the optional second layer. It takes the passages the browser
already found and has a model write a direct answer from them, so a reader gets
prose rather than a quote. It is grounded on purpose: the model is instructed to
use only the supplied passages, because an invented protocol detail on an exam
prep site is worse than no answer.

## Cost

Cloudflare Workers AI includes a **free daily allowance** on a free account
(no card required). This Worker is built so that running out is harmless:

- Requests past the allowance return an error.
- The site catches that and falls back to its own local answers.
- The reader sees a normal answer either way.

There is also a per-IP rate limit (12/min) so one visitor cannot drain the
day's allowance.

## Deploy

```bash
npm install -g wrangler     # one time
cd worker
wrangler login              # opens a browser, free Cloudflare account
wrangler deploy
```

Wrangler prints a URL like `https://levlprep-ask.<your-subdomain>.workers.dev`.

## Turn it on

1. Open the site, click **Ask**, then the ⚙ icon.
2. Paste the Worker URL and hit **Save**.

The setting lives in that browser's `localStorage`. To turn it on for every
visitor instead, set it as the default in `assets/tutor.js` — replace the empty
fallback in `readEndpoint()` with your URL.

## Before going public

Edit `ALLOWED_ORIGINS` in `src/index.js` to your real domain. Without that,
another site can point at your endpoint and spend your allowance.

## Swapping the model

`MODEL` at the top of `src/index.js`. Any Workers AI text model works;
`@cf/meta/llama-3.1-8b-instruct` is the default because it's fast and inside
the free allowance. A larger model gives better prose but uses more of the
daily budget.

If you'd rather use the Claude API (much better answers, but **paid** per
request), keep the same request/response shape — `{question, context, history}`
in, `{answer}` out — and the site needs no changes at all.
