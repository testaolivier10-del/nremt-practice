/* LevlPrep Ask — the site's built-in tutor.
 *
 * Two layers, and the first one is always there:
 *
 *   1. Retrieval (always on, free, offline, no account). Builds a BM25 index
 *      over this site's own pages — study notes, glossary, mnemonics, flow
 *      diagrams, skills guide, scenarios, study plan — and answers by quoting
 *      the passage that actually covers the question, with a link back to it.
 *      Nothing leaves the browser.
 *
 *   2. An optional generative layer. If (and only if) the reader has saved an
 *      endpoint under Settings, the same retrieved passages are POSTed to it
 *      along with the question, and the model phrases a direct answer that is
 *      grounded in those passages. See worker/ for a $0 Cloudflare Worker that
 *      implements the endpoint. If it's unset, erroring, or out of quota, we
 *      fall back to layer 1 rather than showing a broken chat.
 *
 * Grounding is the whole point: this is exam-prep material, and a model
 * free-styling protocol details would be worse than no answer at all. Layer 2
 * is only ever allowed to rephrase what layer 1 found.
 *
 * Drop `<script src="assets/tutor.js" defer></script>` on a page and a launcher
 * appears bottom-right. ask.html hosts the same engine full-page by setting
 * window.LEVLPREP_TUTOR_INLINE before this file loads.
 */
(function(){
  'use strict';

  var ENDPOINT_KEY = 'levlprep_ai_endpoint';
  var MET_KEY = 'levlprep_ai_met';

  // Pages worth reading to answer a question. practice.html is deliberately
  // absent: it's 2.3MB of inline question bank, and parsing it would cost more
  // than it's worth. Questions that smell like a domain get a deep link into
  // its ?domain= filter instead (see DOMAINS below) — the same param the
  // homepage path nodes and the dashboard's weak-domain links already use.
  var PAGES = [
    { file: 'study-notes.html', title: 'Study Notes' },
    { file: 'glossary.html',    title: 'Glossary' },
    { file: 'mnemonics.html',   title: 'Mnemonics' },
    { file: 'flowcharts.html',  title: 'Flow Diagrams' },
    { file: 'skillsheets.html', title: 'Skills Guide' },
    { file: 'scenario-sim.html',title: 'Scenarios' },
    { file: 'study-plan.html',  title: 'Study Plan' }
  ];

  var DOMAINS = [
    { domain: 'Assessment', words: ['assessment','scene size-up','size up','primary survey','secondary survey','vital','opqrst','sample','reassess'] },
    { domain: 'Airway & Respiratory', words: ['airway','respiratory','breathing','ventilat','oxygen','copd','asthma','pneumothorax','suction','bvm','opa','npa','capnograph'] },
    { domain: 'Cardiac & Medical', words: ['cardiac','chest pain','arrest','cpr','aed','stroke','diabet','seizure','overdose','allerg','anaphylax','myocardial','hypoglyc'] },
    { domain: 'Trauma', words: ['trauma','bleed','hemorrhage','shock','fracture','wound','burn','head injury','spinal','tourniquet','splint'] },
    { domain: 'OB/Peds & Special Populations', words: ['pediatric','peds','obstetric','pregnan','delivery','newborn','neonate','geriatric','child','infant'] },
    { domain: 'EMS Operations', words: ['operations','mci','mass casualty','triage','documentation','ambulance','hazmat','scene safety','radio report','consent'] }
  ];

  // EMS runs on abbreviations, and readers type them both ways. Expanding the
  // query in both directions is what makes "what's an MI" find the pages that
  // only ever write "myocardial infarction".
  var SYNONYMS = {
    // Kept tight on purpose: expanding "MI" to "heart" made every passage that
    // happens to say the word heart a candidate, and a DNR definition beat the
    // infarction entry.
    'mi':['myocardial','infarction'], 'acs':['acute','coronary','syndrome'],
    'sob':['shortness','breath','dyspnea'], 'ams':['altered','mental','status'],
    'loc':['level','consciousness'], 'cpr':['compressions','resuscitation'],
    'aed':['defibrillator','defibrillation'], 'bvm':['bag','valve','mask'],
    'opa':['oropharyngeal','airway'], 'npa':['nasopharyngeal','airway'],
    'copd':['chronic','obstructive','pulmonary'], 'chf':['congestive','heart','failure'],
    'cva':['stroke','cerebrovascular'], 'tia':['transient','ischemic'],
    'dka':['diabetic','ketoacidosis'], 'mci':['mass','casualty'],
    'ppe':['personal','protective','equipment'], 'bsi':['body','substance','isolation'],
    'als':['advanced','life','support'], 'bls':['basic','life','support'],
    'ecg':['ekg','electrocardiogram'], 'ekg':['ecg','electrocardiogram'],
    'bp':['blood','pressure'], 'hr':['heart','rate','pulse'],
    'rr':['respiratory','rate'], 'gcs':['glasgow','coma'],
    'ntg':['nitroglycerin'], 'epi':['epinephrine'], 'narcan':['naloxone'],
    'kids':['pediatric','child','infant'], 'child':['pediatric'],
    'heart':['cardiac'], 'lungs':['respiratory','pulmonary'], 'breathing':['respiratory','ventilation'],
    'attack':['infarction'], 'bleeding':['hemorrhage'], 'pregnant':['obstetric','pregnancy']
  };

  var STOP = new Set(('a an the is are was were be been being of for to in on at by with from as it its this that these those and or but if then than so what whats when where which who whom how why do does did doing can could should would will shall may might must i you he she they we me my your their there here about into over under again further once all any both each few more most other some such no nor not only own same too very just also get got have has had').split(' '));

  // ---------------------------------------------------------------- utilities
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function tokenize(s){
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s/-]/g,' ').split(/[\s/-]+/).filter(Boolean);
  }
  // Crude but effective for medical prose: fold plurals and -ing/-ed so
  // "seizures", "seizure" and "bleeding", "bleed" collapse to one term.
  function stem(w){
    if(w.length > 4 && /ies$/.test(w)) return w.slice(0,-3) + 'y';
    if(w.length > 4 && /(sses|shes|ches|xes)$/.test(w)) return w.slice(0,-2);
    if(w.length > 3 && /s$/.test(w) && !/ss|us|is$/.test(w)) return w.slice(0,-1);
    if(w.length > 5 && /ing$/.test(w)) return w.slice(0,-3);
    if(w.length > 4 && /ed$/.test(w)) return w.slice(0,-2);
    return w;
  }
  // A word and its expansions are one *concept*, not competing terms. "OPA"
  // and "oropharyngeal" are the same idea asked two ways, so a passage should
  // be credited once for matching either — not penalized for using the word
  // the reader didn't type. Expansions count for less than what was actually
  // typed, since they're a guess at intent.
  var SYN_WEIGHT = 0.6;
  function queryConcepts(q){
    var raw = tokenize(q), concepts = [];
    raw.forEach(function(w){
      if(STOP.has(w) || w.length < 2) return;
      var variants = [{ term: stem(w), weight: 1 }];
      (SYNONYMS[w] || []).forEach(function(syn){
        var st = stem(syn);
        if(!variants.some(function(v){ return v.term === st; })) variants.push({ term: st, weight: SYN_WEIGHT });
      });
      concepts.push(variants);
    });
    return concepts;
  }
  // Flat list, for highlighting matched words in a quoted passage.
  function queryTerms(q){
    var out = [];
    queryConcepts(q).forEach(function(variants){
      variants.forEach(function(v){ out.push(v.term); });
    });
    return out;
  }
  function readEndpoint(){
    try { return (localStorage.getItem(ENDPOINT_KEY) || '').trim(); } catch(e){ return ''; }
  }
  function writeEndpoint(v){
    try { v ? localStorage.setItem(ENDPOINT_KEY, v) : localStorage.removeItem(ENDPOINT_KEY); } catch(e){}
  }

  // ------------------------------------------------------------------- index
  var INDEX = null, indexPromise = null, AVG_LEN = 1, DF = Object.create(null), N = 0;

  // Pulling the readable text out of these pages takes two passes, because
  // the site stores its material two different ways.
  //
  //   1. The DOM pass handles anything present in the served HTML. It walks
  //      down until a subtree is small enough to stand as one passage, which
  //      keeps a mnemonic card or a table row whole instead of shredding it
  //      into spans — and it doesn't care what tags a page happens to use.
  //
  //   2. The script pass handles the rest. study-notes, glossary, mnemonics
  //      and scenario-sim render from inline JS data (CHAPTERS, TERMS,
  //      SCENARIOS…), which DOMParser never executes, so the served HTML is
  //      nearly empty. Rather than hard-code each page's schema — which would
  //      rot the first time one changes — we read the string literals out of
  //      the inline scripts and use their key names to tell a heading from a
  //      body. Any future page that follows the same title/text shape gets
  //      indexed for free.
  var MAX_CHARS = 900;
  var MIN_CHARS = 40;

  // Lookbehind would be tidier, but it throws a SyntaxError at parse time on
  // older iOS Safari — which would take the whole tutor down, not just links.
  function splitSentences(text){
    var out = [], start = 0;
    for(var i = 0; i < text.length; i++){
      if(/[.!?]/.test(text[i]) && (i + 1 >= text.length || /\s/.test(text[i+1]))){
        out.push(text.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
    if(start < text.length) out.push(text.slice(start).trim());
    return out.filter(Boolean);
  }

  function norm(s){ return String(s || '').replace(/\s+/g,' ').trim(); }

  // A long topic becomes several passages rather than one truncated one —
  // split on sentence boundaries so each piece still reads as prose.
  function pushChunk(chunks, page, heading, text){
    text = norm(text);
    if(text.length < MIN_CHARS) return;
    heading = norm(heading).slice(0,120) || page.title;

    var parts = text.length <= MAX_CHARS ? [text] : [];
    if(!parts.length){
      var sentences = splitSentences(text), cur = '';
      for(var i = 0; i < sentences.length; i++){
        var sentence = sentences[i];
        // A single run-on longer than the budget still has to be cut somewhere.
        while(sentence.length > MAX_CHARS){
          if(cur){ parts.push(cur); cur = ''; }
          parts.push(sentence.slice(0, MAX_CHARS));
          sentence = sentence.slice(MAX_CHARS);
        }
        if(cur.length + sentence.length + 1 > MAX_CHARS){ parts.push(cur); cur = sentence; }
        else cur = cur ? cur + ' ' + sentence : sentence;
      }
      if(cur) parts.push(cur);
    }
    parts.forEach(function(part){
      if(part.length >= MIN_CHARS) chunks.push({ page: page.title, file: page.file, heading: heading, text: part });
    });
  }

  var SKIP_TAGS = /^(script|style|noscript|svg|canvas|nav|footer|form|select|option|button|input|textarea|iframe|template)$/;

  // Much of the study material is comparison tables. Taking textContent
  // flattens them into a run-on — "Condition Key signs Pneumothorax
  // Diminished/absent breath sounds…" — so rebuild them with the cell and row
  // boundaries still visible. Costs nothing for retrieval and makes the
  // difference between a quote a reader can use and a wall of words.
  function tableText(table){
    var rows = table.querySelectorAll('tr'), out = [];
    for(var r = 0; r < rows.length; r++){
      var cells = rows[r].querySelectorAll('th,td'), parts = [];
      for(var c = 0; c < cells.length; c++){
        var cell = norm(cells[c].textContent);
        if(cell) parts.push(cell);
      }
      if(parts.length) out.push(parts.join(' · '));
    }
    return out.join(' — ');
  }

  function elementText(el){
    return el.tagName.toLowerCase() === 'table' ? tableText(el) : norm(el.textContent);
  }

  function extractFromDom(doc, page, chunks){
    var heading = page.title;
    (function walk(parent){
      var kids = parent.children;
      for(var i = 0; i < kids.length; i++){
        var el = kids[i], tag = el.tagName.toLowerCase();
        if(SKIP_TAGS.test(tag)) continue;
        if(el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') continue;
        if(/^h[1-6]$/.test(tag)){
          var ht = norm(el.textContent);
          if(ht) heading = ht;
          continue;
        }
        var text = elementText(el);
        if(!text) continue;
        // Small enough to be a passage on its own: take it whole and stop.
        if(text.length <= MAX_CHARS){ pushChunk(chunks, page, heading, text); continue; }
        // Too big, and nothing to descend into: keep the head of it.
        if(!el.children.length){ pushChunk(chunks, page, heading, text); continue; }
        walk(el);
      }
    })(doc.body);
  }

  // Key names that read as a title vs. the body of a passage. Anything else
  // (ids, css classes, config) is ignored.
  var KEY_HEADING = /^(title|heading|term|name|label|question|prompt|mnemonic|step)$/i;
  var KEY_BODY = /^(def|definition|html|text|body|desc|description|content|detail|details|answer|explanation|rationale|feedback|note|notes|summary|tip|meaning|usedFor|used_for|stands_for|standsFor)$/i;
  var LITERAL_RE = /(?:"([A-Za-z_$][\w$]*)"|'([A-Za-z_$][\w$]*)'|([A-Za-z_$][\w$]*))\s*:\s*(`(?:[^`\\]|\\[\s\S])*`|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*')/g;

  function unquote(lit){
    var body = lit.slice(1, -1);
    return body.replace(/\\([\s\S])/g, function(_, c){
      return c === 'n' ? '\n' : c === 't' ? ' ' : c === 'r' ? '' : c;
    });
  }
  // Most of the study-notes material is HTML inside a template literal, tables
  // included, so this has to understand structure the same way the DOM pass
  // does — regex-stripping the tags turned every comparison table into a
  // run-on sentence. DOMParser documents are inert: nothing executes and
  // nothing loads.
  function toPlainText(raw){
    if(raw.indexOf('<') === -1 && raw.indexOf('&') === -1) return norm(raw);
    var doc = new DOMParser().parseFromString(
      '<!doctype html><body>' + raw.replace(/<br\s*\/?>/gi, ' '), 'text/html');

    var tables = doc.body.querySelectorAll('table');
    for(var i = 0; i < tables.length; i++){
      tables[i].replaceWith(doc.createTextNode(' ' + tableText(tables[i]) + ' '));
    }
    // Block boundaries have to become whitespace, or adjacent list items run
    // their last and first words together.
    doc.body.querySelectorAll('li,p,div,tr,dd,dt,h1,h2,h3,h4,h5,h6').forEach(function(el){
      el.appendChild(doc.createTextNode(' '));
    });
    return norm(doc.body.textContent);
  }

  function extractFromScripts(html, page, chunks){
    var scripts = html.match(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
    scripts.forEach(function(block){
      var src = block.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
      if(src.length < 200) return;               // theme bootstrap and friends
      var heading = page.title, buf = [], bufLen = 0, m;

      function flush(){
        if(bufLen) pushChunk(chunks, page, heading, buf.join(' '));
        buf = []; bufLen = 0;
      }

      LITERAL_RE.lastIndex = 0;
      while((m = LITERAL_RE.exec(src)) !== null){
        var key = m[1] || m[2] || m[3];
        var value = toPlainText(unquote(m[4]));
        if(!value) continue;
        if(KEY_HEADING.test(key)){
          // A title starts a new passage; anything already buffered belonged
          // to the previous one.
          if(value.length <= 140){ flush(); heading = value; continue; }
        }
        if(!KEY_BODY.test(key)) continue;
        if(value.length < 25) continue;          // UI strings, not material
        buf.push(value); bufLen += value.length + 1;
        if(bufLen >= MAX_CHARS) flush();
      }
      flush();
    });
  }

  function dedupe(chunks){
    var seen = Object.create(null), out = [];
    for(var i = 0; i < chunks.length; i++){
      var key = chunks[i].file + '|' + chunks[i].text.slice(0, 120);
      if(seen[key]) continue;
      seen[key] = 1;
      out.push(chunks[i]);
    }
    return out;
  }

  function extractChunks(html, page){
    var chunks = [];
    var doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, ' '), 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach(function(n){ n.remove(); });
    extractFromDom(doc, page, chunks);
    extractFromScripts(html, page, chunks);
    return dedupe(chunks);
  }

  function buildStats(){
    N = INDEX.length;
    var total = 0;
    DF = Object.create(null);
    INDEX.forEach(function(c){
      var tf = Object.create(null), tokens = 0;
      tokenize(c.heading + ' ' + c.text).forEach(function(w){
        if(w.length < 2) return;
        var s = stem(w);
        tf[s] = (tf[s] || 0) + 1;
        tokens++;
      });
      c.tf = tf;
      // Total tokens, not distinct ones: length normalization is meant to
      // compare like with like, and counting distinct terms made a dense
      // 900-character table look longer than it is, so short glossary stubs
      // beat the passage that actually answered the question.
      c.len = tokens || 1;
      c.headTerms = new Set(tokenize(c.heading).map(stem));
      total += c.len;
      for(var t in tf) DF[t] = (DF[t] || 0) + 1;
    });
    AVG_LEN = total / (N || 1);
  }

  function ensureIndex(){
    if(indexPromise) return indexPromise;
    indexPromise = Promise.all(PAGES.map(function(page){
      return fetch(page.file)
        .then(function(r){ if(!r.ok) throw new Error(r.status); return r.text(); })
        .then(function(html){ return extractChunks(html, page); })
        .catch(function(){ return []; });
    })).then(function(all){
      INDEX = all.reduce(function(a,b){ return a.concat(b); }, []);
      buildStats();
      return INDEX;
    });
    return indexPromise;
  }

  // Textbook BM25, plus two boosts that matter here: a heading hit (the
  // passage is *about* the term, not just mentioning it) and a verbatim
  // phrase hit (someone typed a mnemonic or an exact term).
  var K1 = 1.4, B = 0.5;

  function idfOf(term){
    var df = DF[term] || 0;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  }

  function search(q, limit){
    if(!INDEX || !INDEX.length) return [];
    var concepts = queryConcepts(q);
    if(!concepts.length) return [];
    var phrase = q.toLowerCase().trim();
    var usePhrase = phrase.length >= 5 && phrase.split(/\s+/).length <= 6;

    // Each concept is worth its best variant's rarity.
    var weights = concepts.map(function(variants){
      var best = 0;
      variants.forEach(function(v){ best = Math.max(best, idfOf(v.term) * v.weight); });
      return best;
    });
    var totalIdf = weights.reduce(function(a, b){ return a + b; }, 0);
    if(!totalIdf) return [];

    // The rarest concept is almost always the subject of the question. A
    // passage that misses it gets pushed down — softly, so an odd phrasing
    // still returns the next best thing rather than nothing.
    var keyIdx = 0;
    for(var wi = 1; wi < weights.length; wi++){ if(weights[wi] > weights[keyIdx]) keyIdx = wi; }

    var scored = [];
    for(var i = 0; i < INDEX.length; i++){
      var c = INDEX[i], score = 0, matchedIdf = 0, hasKey = false;

      for(var ci = 0; ci < concepts.length; ci++){
        var best = 0, bestIdf = 0, inHeading = false;
        // Credit the concept once, via whichever variant scores highest.
        for(var vi = 0; vi < concepts[ci].length; vi++){
          var v = concepts[ci][vi], f = c.tf[v.term];
          if(!f) continue;
          var idf = idfOf(v.term) * v.weight;
          var contribution = idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (c.len / AVG_LEN)));
          if(contribution > best){ best = contribution; bestIdf = idf; inHeading = c.headTerms.has(v.term); }
        }
        if(!best) continue;
        score += best + (inHeading ? bestIdf * 0.9 : 0);
        matchedIdf += bestIdf;
        if(ci === keyIdx) hasKey = true;
      }

      if(!matchedIdf) continue;
      score *= (0.35 + 0.65 * (matchedIdf / totalIdf));
      if(!hasKey) score *= 0.45;
      if(usePhrase && c.text.toLowerCase().indexOf(phrase) !== -1) score += 3.5;
      if(usePhrase && c.heading.toLowerCase().indexOf(phrase) !== -1) score += 5;
      scored.push({ chunk: c, score: score });
    }
    scored.sort(function(a, b){ return b.score - a.score; });

    // Keep the results varied: at most two passages from any one heading.
    var seen = Object.create(null), out = [];
    for(var k = 0; k < scored.length && out.length < (limit || 6); k++){
      var key = scored[k].chunk.file + '|' + scored[k].chunk.heading;
      if((seen[key] = (seen[key] || 0) + 1) > 2) continue;
      out.push(scored[k]);
    }
    return out;
  }

  function matchDomain(q){
    var ql = ' ' + q.toLowerCase() + ' ';
    for(var i = 0; i < DOMAINS.length; i++){
      for(var j = 0; j < DOMAINS[i].words.length; j++){
        if(ql.indexOf(DOMAINS[i].words[j]) !== -1) return DOMAINS[i].domain;
      }
    }
    return null;
  }

  // Deep-link straight to the sentence using a text fragment, so the reader
  // lands on the passage rather than the top of a 300KB notes page.
  function sourceHref(chunk, q){
    var terms = tokenize(q).filter(function(w){ return !STOP.has(w) && w.length > 2; });
    var target = '';
    var sentences = splitSentences(chunk.text);
    for(var i = 0; i < sentences.length && !target; i++){
      var sl = sentences[i].toLowerCase();
      for(var j = 0; j < terms.length; j++){
        if(sl.indexOf(terms[j]) !== -1){ target = sentences[i]; break; }
      }
    }
    if(!target) target = sentences[0] || '';
    target = target.split(/\s+/).slice(0, 9).join(' ').replace(/[.,;:]$/,'');
    return chunk.file + (target ? '#:~:text=' + encodeURIComponent(target) : '');
  }

  // --------------------------------------------------------- local answering
  var CONFIDENT = 4.0;

  function highlightPassage(text, q){
    var terms = queryTerms(q).filter(function(t){ return t.length > 2; });
    var html = esc(text);
    terms.slice(0, 8).forEach(function(t){
      var re = new RegExp('\\b(' + t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[a-z]{0,3})\\b','ig');
      html = html.replace(re, '<mark>$1</mark>');
    });
    return html;
  }

  function answerLocally(q, hits){
    if(!hits.length || hits[0].score < 1.2){
      var domain = matchDomain(q);
      return {
        html: '<p>I couldn’t find that in this site’s material. Try rewording it, or use the '
            + '<a href="search.html?q=' + encodeURIComponent(q) + '">full search</a>.</p>'
            + (domain ? '<p>If you’re after practice on this, the <b>' + esc(domain) + '</b> bank is the closest fit.</p>' : ''),
        sources: [], domain: domain
      };
    }
    var top = hits[0].chunk;
    var lead = hits[0].score >= CONFIDENT
      ? 'Here’s what this site’s <b>' + esc(top.page) + '</b> says about that:'
      : 'I’m not certain this is exactly what you meant, but the closest material on the site is:';

    var html = '<p>' + lead + '</p>'
      + '<blockquote class="lp-quote"><b>' + esc(top.heading) + '</b>'
      + '<span>' + highlightPassage(top.text, q) + '</span></blockquote>';

    var extra = hits.slice(1, 3).filter(function(h){ return h.score >= Math.max(2, hits[0].score * 0.6); });
    if(extra.length){
      html += '<p class="lp-more">Also relevant:</p><ul class="lp-more-list">'
        + extra.map(function(h){
            return '<li><a href="' + esc(sourceHref(h.chunk, q)) + '">' + esc(h.chunk.heading) + '</a> '
                 + '<span>— ' + esc(h.chunk.page) + '</span></li>';
          }).join('')
        + '</ul>';
    }
    // Only cite what actually supports the answer — a passage scoring a
    // fraction of the top hit is noise, not a source.
    var cited = hits.filter(function(h){ return h.score >= Math.max(2, hits[0].score * 0.5); })
                    .slice(0, 4).map(function(h){ return h.chunk; });
    return { html: html, sources: cited, domain: matchDomain(q) };
  }

  // --------------------------------------------------------------- LLM layer
  // The endpoint gets the question and the passages we retrieved, and is asked
  // to answer from those passages only. Anything other than a clean response
  // (offline, quota exhausted, misconfigured) falls back to the local answer —
  // never an error state the reader has to interpret.
  function askEndpoint(endpoint, q, hits, history){
    var context = hits.slice(0, 6).map(function(h){
      return { page: h.chunk.page, heading: h.chunk.heading, text: h.chunk.text, href: h.chunk.file };
    });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function(){ ctrl && ctrl.abort(); }, 30000);

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, context: context, history: (history || []).slice(-4) }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(data){
      clearTimeout(timer);
      var answer = (data && (data.answer || data.text || data.response) || '').trim();
      if(!answer) throw new Error('empty');
      return answer;
    }).catch(function(err){ clearTimeout(timer); throw err; });
  }

  // Model output is plain text; render the handful of shapes it actually uses
  // (paragraphs, bullets, **bold**) and escape everything else.
  function renderModelText(text){
    var blocks = esc(text).split(/\n{2,}/), html = '';
    blocks.forEach(function(block){
      var lines = block.split('\n').filter(function(l){ return l.trim(); });
      var bullets = lines.every(function(l){ return /^\s*[-*•]\s+/.test(l); });
      if(bullets && lines.length){
        html += '<ul>' + lines.map(function(l){ return '<li>' + inline(l.replace(/^\s*[-*•]\s+/,'')) + '</li>'; }).join('') + '</ul>';
      } else {
        html += '<p>' + inline(lines.join(' ')) + '</p>';
      }
    });
    return html;
    function inline(s){ return s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>'); }
  }

  // ------------------------------------------------------------------- view
  // The Assistant — the site's mascot, and the only way into the tutor.
  // One drawing, used at 58px in the corner and 26px in the panel header, so
  // the character stays the same object wherever it appears. The antenna light
  // pulses on idle and the eyes widen on hover; both stop under
  // prefers-reduced-motion.
  function mascotSvg(cls){
    return '<svg class="' + (cls || '') + '" viewBox="0 0 120 120" aria-hidden="true" focusable="false">'
      +   '<rect width="120" height="120" rx="26" fill="#16332E"/>'
      +   '<g class="lp-bob">'
      +     '<path d="M60 31 L60 19" stroke="#2C9C8B" stroke-width="4" stroke-linecap="round"/>'
      +     '<circle class="lp-blip" cx="60" cy="15" r="5.2" fill="#C9973A"/>'
      +     '<rect x="27" y="30" width="66" height="53" rx="17" fill="#2C9C8B"/>'
      +     '<rect x="35" y="42" width="50" height="27" rx="13.5" fill="#16332E"/>'
      +     '<circle class="lp-eye" cx="49" cy="55.5" r="4.6" fill="#3FBBA6"/>'
      +     '<circle class="lp-eye" cx="71" cy="55.5" r="4.6" fill="#3FBBA6"/>'
      +     '<rect x="45" y="86" width="30" height="8" rx="4" fill="#2C9C8B" opacity=".75"/>'
      +   '</g>'
      + '</svg>';
  }

  var CSS = [
    '.lp-launch{position:fixed;right:20px;bottom:20px;z-index:900;width:58px;height:58px;padding:0;',
      'border:none;background:transparent;cursor:pointer;line-height:0;',
      'filter:drop-shadow(0 4px 10px rgba(0,0,0,.26));transition:transform .16s ease;}',
    '.lp-launch svg{width:100%;height:100%;display:block;border-radius:18px;}',
    '.lp-launch:hover{transform:translateY(-2px) scale(1.04);}',
    '.lp-launch:active{transform:translateY(1px) scale(.98);}',
    '.lp-launch:hover .lp-eye{r:5.6;}',
    // A mascot with no label is a mystery button on first visit, so it says
    // what it is until someone has actually opened it once.
    '.lp-tip{position:fixed;right:86px;bottom:34px;z-index:900;background:var(--navy);color:#fff;',
      'font:800 12.5px var(--font-ui);padding:7px 12px;border-radius:10px;white-space:nowrap;',
      'pointer-events:none;opacity:0;transform:translateX(6px);transition:opacity .18s ease, transform .18s ease;}',
    '.lp-tip.show{opacity:1;transform:translateX(0);}',
    '.lp-bob{transform-box:fill-box;transform-origin:center;animation:lpbob 4.2s ease-in-out infinite;}',
    '@keyframes lpbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}',
    '.lp-blip{animation:lppulse 2.4s ease-in-out infinite;}',
    '@keyframes lppulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '.lp-avatar{width:26px;height:26px;flex:none;}',
    '.lp-avatar svg{width:100%;height:100%;border-radius:8px;display:block;}',
    '@media(prefers-reduced-motion:reduce){.lp-bob,.lp-blip{animation:none;}.lp-launch{transition:none;}}',
    '@media(max-width:520px){.lp-launch{right:14px;bottom:14px;width:52px;height:52px;}.lp-tip{display:none;}}',
    '.lp-panel{position:fixed;right:20px;bottom:20px;z-index:901;width:min(408px,calc(100vw - 32px));',
      'height:min(620px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--paper);',
      'border:var(--bw) solid var(--line);border-radius:20px;box-shadow:0 14px 40px rgba(0,0,0,.22);overflow:hidden;}',
    '@media(max-width:520px){.lp-panel{right:0;bottom:0;width:100vw;height:100dvh;border-radius:0;}}',
    '.lp-inline .lp-panel{position:static;width:100%;height:min(640px,70vh);box-shadow:var(--lift-sm);right:auto;bottom:auto;}',
    '.lp-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:var(--bw) solid var(--line);background:var(--white);}',
    '.lp-head b{font:900 15px var(--font-ui);color:var(--ink);flex:1;}',
    '.lp-head .lp-sub{display:block;font:700 11px var(--font-mono);color:var(--muted);letter-spacing:.02em;}',
    '.lp-icon{border:none;background:transparent;cursor:pointer;color:var(--muted);padding:5px;border-radius:8px;font:900 15px var(--font-ui);line-height:1;}',
    '.lp-icon:hover{background:var(--tint-accent);color:var(--accent);}',
    '.lp-log{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;background:var(--paper);}',
    '.lp-msg{max-width:100%;font-size:14px;font-weight:600;line-height:1.55;color:var(--ink);}',
    '.lp-msg p{margin:0 0 9px;} .lp-msg p:last-child{margin-bottom:0;}',
    '.lp-msg ul{margin:0 0 9px;padding-left:20px;} .lp-msg li{margin-bottom:4px;}',
    '.lp-msg a{color:var(--accent);font-weight:800;}',
    '.lp-msg.user{align-self:flex-end;background:var(--accent);color:var(--on-accent);padding:10px 14px;border-radius:16px 16px 4px 16px;font-weight:700;max-width:85%;}',
    '.lp-msg.bot{background:var(--white);border:var(--bw) solid var(--line);border-radius:16px 16px 16px 4px;padding:13px 15px;}',
    '.lp-quote{margin:0 0 10px;padding:11px 13px;background:var(--tint-accent);border-left:3px solid var(--accent);border-radius:0 10px 10px 0;}',
    '.lp-quote b{display:block;font-size:12.5px;font-weight:900;color:var(--accent);margin-bottom:5px;}',
    '.lp-quote span{display:block;font-size:13.5px;font-weight:600;}',
    '.lp-quote mark{background:#FDE9A0;color:inherit;border-radius:2px;}',
    ':root[data-theme="dark"] .lp-quote mark{background:#6b5a1f;}',
    '.lp-more{font:900 11px var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 0 5px!important;}',
    '.lp-more-list{list-style:none;padding:0!important;margin:0!important;}',
    '.lp-more-list li{font-size:13px;margin-bottom:4px;}',
    '.lp-more-list span{color:var(--muted);font-weight:700;font-size:12px;}',
    '.lp-src{display:flex;flex-wrap:wrap;gap:6px;margin-top:11px;padding-top:10px;border-top:1px dashed var(--line);}',
    '.lp-src a{font:800 11.5px var(--font-ui);text-decoration:none;color:var(--accent);background:var(--tint-accent);',
      'border-radius:999px;padding:5px 11px;}',
    '.lp-src a:hover{background:var(--accent);color:var(--on-accent);}',
    '.lp-note{font:700 11px var(--font-mono);color:var(--muted);margin-top:9px;line-height:1.45;}',
    '.lp-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;}',
    '.lp-chip{border:var(--bw) solid var(--line);background:var(--white);border-radius:999px;padding:7px 12px;',
      'font:800 12.5px var(--font-ui);color:var(--ink);cursor:pointer;text-align:left;}',
    '.lp-chip:hover{border-color:var(--accent);color:var(--accent);}',
    '.lp-form{display:flex;gap:8px;padding:12px;border-top:var(--bw) solid var(--line);background:var(--white);}',
    '.lp-form input{flex:1;min-width:0;padding:11px 13px;border:var(--bw) solid var(--line);border-radius:12px;',
      'font:700 14px var(--font-ui);background:var(--paper);color:var(--ink);}',
    '.lp-form input:focus{outline:2px solid var(--accent);outline-offset:1px;}',
    '.lp-form button{border:none;background:var(--accent);color:var(--on-accent);border-radius:12px;padding:0 16px;',
      'font:900 14px var(--font-ui);cursor:pointer;box-shadow:0 3px 0 var(--accent-press);}',
    '.lp-form button:disabled{opacity:.5;cursor:default;}',
    '.lp-dots span{display:inline-block;width:6px;height:6px;margin-right:4px;border-radius:50%;background:var(--muted);animation:lpb 1s infinite;}',
    '.lp-dots span:nth-child(2){animation-delay:.15s}.lp-dots span:nth-child(3){animation-delay:.3s}',
    '@keyframes lpb{0%,60%,100%{opacity:.25}30%{opacity:1}}',
    '.lp-settings{padding:16px;border-top:var(--bw) solid var(--line);background:var(--white);}',
    '.lp-settings label{display:block;font:900 11px var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px;}',
    '.lp-settings input{width:100%;padding:10px 12px;border:var(--bw) solid var(--line);border-radius:10px;',
      'font:700 13px var(--font-mono);background:var(--paper);color:var(--ink);margin-bottom:9px;}',
    '.lp-settings p{font:700 11.5px var(--font-mono);color:var(--muted);line-height:1.5;margin:0 0 10px;}',
    '.lp-settings .row{display:flex;gap:8px;}',
    '.lp-settings button{flex:1;border:var(--bw) solid var(--line);background:var(--white);color:var(--ink);',
      'border-radius:10px;padding:9px;font:900 12.5px var(--font-ui);cursor:pointer;}',
    '.lp-settings button.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent);}'
  ].join('');

  var STARTERS = [
    'What’s the difference between a hemothorax and a pneumothorax?',
    'How do I size an OPA?',
    'Walk me through OPQRST',
    'When is a tourniquet indicated?'
  ];

  function Tutor(mount, opts){
    opts = opts || {};
    var self = this;
    this.history = [];
    this.busy = false;

    var root = document.createElement('div');
    root.className = 'lp-panel';
    root.innerHTML =
      '<div class="lp-head">'
      +  '<span class="lp-avatar">' + mascotSvg() + '</span>'
      +  '<b>Ask LevlPrep<span class="lp-sub" data-role="mode"></span></b>'
      +  '<button class="lp-icon" data-act="settings" title="Settings" aria-label="Tutor settings">⚙</button>'
      +  (opts.inline ? '' : '<button class="lp-icon" data-act="close" title="Close" aria-label="Close">✕</button>')
      + '</div>'
      + '<div class="lp-log" data-role="log"></div>'
      + '<div class="lp-settings" data-role="settings" hidden></div>'
      + '<form class="lp-form" data-role="form">'
      +  '<input type="text" placeholder="Ask about anything on this site…" aria-label="Your question" autocomplete="off">'
      +  '<button type="submit">Ask</button>'
      + '</form>';
    mount.appendChild(root);

    this.root = root;
    this.log = root.querySelector('[data-role=log]');
    this.form = root.querySelector('[data-role=form]');
    this.input = root.querySelector('input');
    this.modeEl = root.querySelector('[data-role=mode]');
    this.settingsEl = root.querySelector('[data-role=settings]');

    this.form.addEventListener('submit', function(e){
      e.preventDefault();
      var q = self.input.value.trim();
      if(q && !self.busy){ self.input.value = ''; self.ask(q); }
    });
    root.querySelector('[data-act=settings]').addEventListener('click', function(){ self.toggleSettings(); });
    var closeBtn = root.querySelector('[data-act=close]');
    if(closeBtn) closeBtn.addEventListener('click', function(){ opts.onClose && opts.onClose(); });

    this.refreshMode();
    this.greet();
    ensureIndex();
  }

  Tutor.prototype.refreshMode = function(){
    this.modeEl.textContent = readEndpoint() ? 'AI answers · grounded in this site' : 'Answers from this site’s material';
  };

  Tutor.prototype.scroll = function(){ this.log.scrollTop = this.log.scrollHeight; };

  Tutor.prototype.bubble = function(cls, html){
    var el = document.createElement('div');
    el.className = 'lp-msg ' + cls;
    el.innerHTML = html;
    this.log.appendChild(el);
    this.scroll();
    return el;
  };

  Tutor.prototype.greet = function(){
    var self = this;
    var el = this.bubble('bot',
      '<p>Ask me anything covered on this site — the notes, glossary, mnemonics, flow diagrams and skill sheets are all indexed. '
      + 'I answer by pulling up the relevant material and linking you to it.</p>'
      + '<div class="lp-chips">' + STARTERS.map(function(s){
          return '<button class="lp-chip" type="button">' + esc(s) + '</button>';
        }).join('') + '</div>');
    el.querySelectorAll('.lp-chip').forEach(function(btn){
      btn.addEventListener('click', function(){ if(!self.busy) self.ask(btn.textContent); });
    });
  };

  // Short follow-ups ("what about kids?", "why?") carry no searchable terms of
  // their own — fold in the previous question so retrieval still has something
  // to work with.
  // "what about kids?" needs the previous question folded in; "when is a
  // tourniquet indicated?" does not. Judge that on how much the reader
  // actually typed, not on term count after synonym expansion — that counted
  // a normal five-word question as a fragment and answered the wrong thing.
  Tutor.prototype.expand = function(q){
    var last = this.history.length ? this.history[this.history.length - 1].q : '';
    if(!last) return q;
    var words = q.trim().split(/\s+/).length;
    var meaningful = tokenize(q).filter(function(w){ return !STOP.has(w); });
    return (words <= 3 || meaningful.length <= 1) ? last + ' ' + q : q;
  };

  Tutor.prototype.ask = function(q){
    var self = this;
    this.busy = true;
    this.form.querySelector('button').disabled = true;
    this.bubble('user', esc(q));
    var thinking = this.bubble('bot', '<span class="lp-dots"><span></span><span></span><span></span></span>');

    ensureIndex().then(function(){
      var hits = search(self.expand(q), 6);
      var endpoint = readEndpoint();
      var local = answerLocally(q, hits);

      function finish(html, sources, domain, note){
        thinking.innerHTML = html + self.sourcesHtml(sources, q, domain) + (note ? '<p class="lp-note">' + note + '</p>' : '');
        self.scroll();
        self.history.push({ q: q, a: html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 600) });
        self.busy = false;
        self.form.querySelector('button').disabled = false;
        self.input.focus();
      }

      if(endpoint && hits.length){
        askEndpoint(endpoint, q, hits, self.history).then(function(answer){
          finish(renderModelText(answer), local.sources, local.domain,
            'Written by an AI model from this site’s material — double-check anything clinical against your protocols.');
        }).catch(function(){
          finish(local.html, local.sources, local.domain,
            'The AI endpoint didn’t respond, so this is the site’s own material instead.');
        });
      } else {
        finish(local.html, local.sources, local.domain, null);
      }
    });
  };

  Tutor.prototype.sourcesHtml = function(sources, q, domain){
    var chips = (sources || []).slice(0, 4).map(function(c){
      return '<a href="' + esc(sourceHref(c, q)) + '">' + esc(c.page) + ' › ' + esc(c.heading.slice(0, 34)) + '</a>';
    });
    if(domain){
      chips.push('<a href="practice.html?domain=' + encodeURIComponent(domain) + '">Practice ' + esc(domain) + '</a>');
    }
    return chips.length ? '<div class="lp-src">' + chips.join('') + '</div>' : '';
  };

  Tutor.prototype.toggleSettings = function(){
    var self = this, box = this.settingsEl;
    if(!box.hidden){ box.hidden = true; return; }
    box.innerHTML =
      '<label for="lpEndpoint">AI endpoint (optional)</label>'
      + '<input id="lpEndpoint" type="url" placeholder="https://your-worker.workers.dev" value="' + esc(readEndpoint()) + '">'
      + '<p>Leave this empty and answers come straight from this site’s pages — nothing is sent anywhere, and it works offline. '
      + 'With an endpoint set, your question and the matching passages are sent there so a model can write the answer. '
      + 'See <code>worker/</code> in the repo for a free one you can deploy.</p>'
      + '<div class="row"><button type="button" data-act="save" class="primary">Save</button>'
      + '<button type="button" data-act="clear">Turn off</button></div>';
    box.hidden = false;
    box.querySelector('[data-act=save]').addEventListener('click', function(){
      writeEndpoint(box.querySelector('#lpEndpoint').value.trim());
      self.refreshMode(); box.hidden = true;
    });
    box.querySelector('[data-act=clear]').addEventListener('click', function(){
      writeEndpoint(''); self.refreshMode(); box.hidden = true;
    });
  };

  // ------------------------------------------------------------------ launch
  function injectCss(){
    if(document.getElementById('lp-tutor-css')) return;
    var s = document.createElement('style');
    s.id = 'lp-tutor-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function initFloating(){
    injectCss();
    var btn = document.createElement('button');
    btn.className = 'lp-launch';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Ask the study assistant');
    btn.innerHTML = mascotSvg();
    document.body.appendChild(btn);

    var tip = document.createElement('div');
    tip.className = 'lp-tip';
    tip.textContent = 'Ask me anything';
    document.body.appendChild(tip);

    var met = false;
    try { met = localStorage.getItem(MET_KEY) === '1'; } catch(e){}
    if(!met) setTimeout(function(){ tip.classList.add('show'); }, 1200);
    btn.addEventListener('mouseenter', function(){ tip.classList.add('show'); });
    btn.addEventListener('mouseleave', function(){ if(met) tip.classList.remove('show'); });

    var host = null, tutor = null;
    function close(){ if(host) host.style.display = 'none'; btn.style.display = ''; }
    function meet(){
      met = true;
      tip.classList.remove('show');
      try { localStorage.setItem(MET_KEY, '1'); } catch(e){}
    }
    btn.addEventListener('click', function(){
      if(!host){
        host = document.createElement('div');
        document.body.appendChild(host);
        tutor = new Tutor(host, { onClose: close });
      } else {
        host.style.display = '';
      }
      btn.style.display = 'none';
      meet();
      setTimeout(function(){ tutor.input.focus(); }, 50);
    });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && host && host.style.display !== 'none') close();
    });
  }

  function initInline(){
    injectCss();
    var mount = document.getElementById(window.LEVLPREP_TUTOR_INLINE);
    if(mount){
      mount.classList.add('lp-inline');
      new Tutor(mount, { inline: true });
    }
  }

  function boot(){
    if(window.LEVLPREP_TUTOR_INLINE) initInline();
    else initFloating();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.LevlPrepTutor = { search: search, ensureIndex: ensureIndex };
})();
