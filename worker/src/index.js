/**
 * LevlPrep Ask — optional AI backend.
 *
 * The site answers questions on its own, in the browser, with no server at all.
 * This Worker is the optional upgrade: it takes the passages the browser already
 * retrieved and has a model write a direct answer from them.
 *
 * It runs on Cloudflare Workers AI, which has a free daily allowance on a free
 * account. There is no API key in the browser — the model is reached through
 * the platform binding, so nothing sensitive ships to the client. When the free
 * allowance is used up the request fails and the site silently falls back to its
 * own answers, so the page never breaks and the bill never starts.
 *
 * Deploy: see ../README.md
 */

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Only these origins may call the Worker. Without this, anyone could point
// their own site at your endpoint and spend your daily allowance.
const ALLOWED_ORIGINS = [
  'https://testaolivier10-del.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

// The model is allowed to rephrase and organize the supplied passages. It is
// not allowed to add clinical facts of its own — on an exam-prep site, a
// confident invention is worse than "that isn't covered here".
const SYSTEM_PROMPT = [
  'You are the study assistant built into LevlPrep, an NREMT-EMT exam prep site.',
  'You answer using ONLY the reference passages provided with each question. They are drawn from the site\'s own study notes, glossary, mnemonics, flow diagrams and skill sheets.',
  '',
  'Rules:',
  '1. Never state a clinical fact, number, dose, or protocol step that is not in the passages. If the passages do not cover the question, say plainly that the site does not cover it and suggest what it does cover.',
  '2. Do not speculate or fill gaps from your own knowledge, even when you are confident.',
  '3. Answer in 2-5 short sentences, or a short bullet list for steps and criteria. Plain text; **bold** for emphasis is fine.',
  '4. Write for a student preparing for the NREMT cognitive exam: direct, concrete, exam-focused.',
  '5. This is study material, not medical direction. If a question asks what to do for a real patient, answer at the level of exam content and note that local protocol and medical direction govern real calls.',
  '6. Never give a definitive answer about a real, in-progress emergency. Direct the reader to call 911 / medical control.',
].join('\n');

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405, origin);
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Origin not allowed' }, 403, origin);
    }

    // Per-visitor throttle, so one person (or one script) can't drain the
    // day's free allowance in a minute.
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'anonymous';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) {
        return json({ error: 'Rate limited. The site will answer from its own material instead.' }, 429, origin);
      }
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, origin);
    }

    const question = String(payload?.question || '').trim().slice(0, 500);
    const context = Array.isArray(payload?.context) ? payload.context.slice(0, 6) : [];
    const history = Array.isArray(payload?.history) ? payload.history.slice(-4) : [];

    if (!question) return json({ error: 'Missing question' }, 400, origin);
    // No passages means the site found nothing relevant. Answering anyway is
    // exactly the ungrounded guess this endpoint exists to avoid.
    if (!context.length) return json({ error: 'No context supplied' }, 400, origin);

    const references = context
      .map((c, i) => {
        const page = String(c?.page || '').slice(0, 80);
        const heading = String(c?.heading || '').slice(0, 160);
        const text = String(c?.text || '').slice(0, 1200);
        return `[${i + 1}] ${page} — ${heading}\n${text}`;
      })
      .join('\n\n');

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const turn of history) {
      if (turn?.q) messages.push({ role: 'user', content: String(turn.q).slice(0, 300) });
      if (turn?.a) messages.push({ role: 'assistant', content: String(turn.a).slice(0, 600) });
    }
    messages.push({
      role: 'user',
      content: `Reference passages from the site:\n\n${references}\n\n---\nStudent's question: ${question}\n\nAnswer using only the passages above.`,
    });

    try {
      const result = await env.AI.run(MODEL, { messages, max_tokens: 400, temperature: 0.2 });
      const answer = String(result?.response || '').trim();
      if (!answer) return json({ error: 'Empty response' }, 502, origin);
      return json({ answer }, 200, origin);
    } catch (err) {
      // Out of free allowance, model unavailable, anything else: tell the
      // client to fall back rather than pretending to have answered.
      return json({ error: 'Model unavailable', detail: String(err).slice(0, 200) }, 502, origin);
    }
  },
};
