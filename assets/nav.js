/* Shared site header: renders the flat nav bar into #site-header and
   highlights the current page/section. Keeps every page in sync from one
   file instead of each page hand-copying its own nav markup. */
(function(){
  var NAV_ITEMS = [
    { href: 'practice.html', label: 'Practice' },
    { href: 'study-plan.html', label: 'Study Plan' },
    { href: 'study-notes.html', label: 'Notes' },
    { href: 'mnemonics.html', label: 'Mnemonics' },
    { href: 'glossary.html', label: 'Glossary' },
    { href: 'tools.html', label: 'Tools' },
    { href: 'dashboard.html', label: 'Dashboard' }
  ];

  // Pages that live "under" Tools (linked from the tools.html hub) but keep
  // their own URL — the Tools nav link should still read as active on them.
  var TOOLS_SUBPAGES = ['tools.html', 'body-map.html', 'sound-trainer.html', 'scenario-sim.html', 'skillsheets.html', 'flowcharts.html', 'search.html'];

  function currentFile(){
    var p = location.pathname.split('/').pop();
    return p || 'index.html';
  }

  // ---- XP & levels: a lightweight leveling layer over existing progress data.
  // Stored separately from the stats it's derived from (mastery/domain/streak)
  // so the header badge can render without re-deriving anything. Quiz pages award
  // XP by calling window.LevlXP.awardXp(); this file owns the header display so
  // every page (not just index.html) can show the current level. ----
  var XP_KEY = 'nremt_xp';
  var LEVEL_TITLES = [
    { min: 1, title: 'First Responder' },
    { min: 3, title: 'EMT Trainee' },
    { min: 6, title: 'EMT Candidate' },
    { min: 10, title: 'Field Ready' },
    { min: 15, title: 'Rig Veteran' },
    { min: 20, title: 'Code 3 Pro' },
    { min: 30, title: 'NREMT Legend' },
  ];
  // Per-domain XP bonuses for crossing accuracy milestones (needs a minimum sample
  // size so an early lucky streak on 3 questions can't claim a "mastery" tier).
  var DOMAIN_TIER_THRESHOLDS = [
    { pct: 70, minTotal: 20, xp: 30 },
    { pct: 85, minTotal: 20, xp: 50 },
    { pct: 95, minTotal: 20, xp: 75 },
  ];

  function loadXp(){
    try{
      var raw = localStorage.getItem(XP_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return { total: (parsed && parsed.total) || 0, domainTiers: (parsed && parsed.domainTiers) || {} };
    }catch(e){ return { total: 0, domainTiers: {} }; }
  }
  function saveXp(state){
    try{ localStorage.setItem(XP_KEY, JSON.stringify(state)); }catch(e){}
  }
  // Cumulative XP needed to REACH level n (n >= 1); quadratic so each level takes
  // a bit longer than the last.
  function xpForLevel(n){ return 100 * (n - 1) * (n - 1); }
  function levelForXp(xp){
    var n = 1;
    while(xpForLevel(n + 1) <= xp) n++;
    return n;
  }
  function titleForLevel(level){
    var t = LEVEL_TITLES[0].title;
    for(var i = 0; i < LEVEL_TITLES.length; i++){
      if(level >= LEVEL_TITLES[i].min) t = LEVEL_TITLES[i].title;
    }
    return t;
  }
  // amount: flat XP to add. domainTierUpdates: optional {domain: newTierNumber}
  // map for domains that just crossed an accuracy milestone.
  function awardXp(amount, domainTierUpdates){
    var state = loadXp();
    state.total += (amount || 0);
    if(domainTierUpdates){
      for(var d in domainTierUpdates){
        if(Object.prototype.hasOwnProperty.call(domainTierUpdates, d)) state.domainTiers[d] = domainTierUpdates[d];
      }
    }
    saveXp(state);
    renderLevelBadge();
    return state;
  }
  function renderLevelBadge(){
    var el = document.getElementById('levelBadge');
    if(!el) return;
    var state = loadXp();
    var level = levelForXp(state.total);
    var next = xpForLevel(level + 1);
    var prev = xpForLevel(level);
    var into = state.total - prev, span = Math.max(1, next - prev);
    el.textContent = 'Lvl ' + level;
    el.title = titleForLevel(level) + ' — ' + state.total + ' XP (' + into + '/' + span + ' to Lvl ' + (level + 1) + ')';
  }

  window.LevlXP = {
    loadXp: loadXp, awardXp: awardXp, xpForLevel: xpForLevel, levelForXp: levelForXp,
    titleForLevel: titleForLevel, renderLevelBadge: renderLevelBadge,
    DOMAIN_TIER_THRESHOLDS: DOMAIN_TIER_THRESHOLDS,
  };

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function renderHeader(){
    var mount = document.getElementById('site-header');
    if(!mount) return;
    var cur = currentFile();

    var itemsHtml = NAV_ITEMS.map(function(item){
      var active = item.href === cur || (item.href === 'tools.html' && TOOLS_SUBPAGES.indexOf(cur) !== -1);
      return '<a href="' + item.href + '" class="nav-link' + (active ? ' active' : '') + '"' +
        (active ? ' aria-current="page"' : '') +
        '>' + escapeHtml(item.label) + '<span class="rule"></span></a>';
    }).join('');

    mount.innerHTML =
      '<div class="site-header__inner">' +
        '<a class="site-header__brand" href="index.html">' +
          '<span class="brand-mark" aria-hidden="true">+</span> LevlPrep' +
        '</a>' +
        '<nav class="site-header__groups" aria-label="Site sections">' + itemsHtml +
          '<a href="dashboard.html' + (cur === 'dashboard.html' ? '#levelSection' : '') + '" class="level-badge" id="levelBadge" title="Your level">Lvl 1</a>' +
          '<button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle dark mode" title="Toggle dark mode">◑</button>' +
        '</nav>' +
      '</div>';

    var fallback = document.querySelector('.site-nav-fallback');
    if(fallback) fallback.remove();

    renderLevelBadge();

    var toggle = document.getElementById('themeToggle');
    if(toggle) toggle.addEventListener('click', function(){
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(isDark ? 'light' : 'dark');
    });

    syncHeaderHeightVar();
  }

  // ---- Exposes the sticky header's real rendered height as --site-header-h
  // so pages with their own sticky elements (e.g. the exam timer bar) can
  // stack directly beneath it instead of overlapping it. Re-measured on
  // resize since the nav wraps to a second line on narrow screens. ----
  function syncHeaderHeightVar(){
    var mount = document.getElementById('site-header');
    if(!mount) return;
    document.documentElement.style.setProperty('--site-header-h', mount.offsetHeight + 'px');
  }
  var headerResizeTimer;
  window.addEventListener('resize', function(){
    clearTimeout(headerResizeTimer);
    headerResizeTimer = setTimeout(syncHeaderHeightVar, 150);
  });

  // ---- Dark mode: applied as early as possible (see the inline snippet in
  // each page's <head>) to avoid a flash of the wrong theme; this just keeps
  // the toggle button and localStorage in sync after that. ----
  var THEME_KEY = 'nremt_theme';
  function setTheme(mode){
    if(mode === 'dark'){
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try{ localStorage.setItem(THEME_KEY, mode); }catch(e){}
  }

  // ---- Offline support: register the service worker once per page load. ----
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(){ /* offline support is best-effort */ });
    });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', renderHeader);
  } else {
    renderHeader();
  }
})();
