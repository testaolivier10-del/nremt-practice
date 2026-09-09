/* Shared site header: renders the flat nav bar into #site-header and
   highlights the current page/section. Keeps every page in sync from one
   file instead of each page hand-copying its own nav markup. */
(function(){
  // The account-wide Study Hub landing page (a separate repo/site) that
  // lists this app as one of several products. Kept as its own link
  // (rather than repurposing the brand logo for it) now that this app has
  // a real homepage of its own to link to.
  var HUB_URL = 'https://testaolivier10-del.github.io/';

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
        '<span class="site-header__brand-row">' +
          '<a class="hub-back" href="' + HUB_URL + '" title="Back to Study Hub">&larr; Study Hub</a>' +
          '<a class="site-header__brand" href="index.html">' +
            '<span class="brand-mark" aria-hidden="true">+</span> LevlPrep' +
          '</a>' +
        '</span>' +
        '<nav class="site-header__groups" aria-label="Site sections">' + itemsHtml +
          '<a href="dashboard.html' + (cur === 'dashboard.html' ? '#levelSection' : '') + '" class="level-badge" id="levelBadge" title="Your level">Lvl 1</a>' +
          '<span id="accountSlot"></span>' +
          '<button type="button" class="theme-toggle" id="themeToggle" aria-label="Toggle dark mode" title="Toggle dark mode">◑</button>' +
        '</nav>' +
      '</div>';

    var fallback = document.querySelector('.site-nav-fallback');
    if(fallback) fallback.remove();

    renderLevelBadge();
    renderAccountUI();

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

  // ---- Accounts & cross-device sync ----
  // Login is entirely optional: every feature already works from localStorage
  // alone (see practice.html's seen/missed/flagged/mastery/streak tracking and
  // XP_KEY above). Signing in just layers periodic sync of that same data
  // through Supabase, keyed by user id and protected by row-level security —
  // so a signed-in user's progress follows them to a new browser/device
  // instead of resetting. The publishable key below is meant to be public;
  // it only grants what the database's RLS policies allow (each user can
  // read/write their own row and nothing else).
  var SUPABASE_URL = 'https://bsfcqrczehbcctwhxmrj.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_CuqCLCy8R9PL6ARZJ9TCow_ba0XySYI';
  var PROGRESS_KEYS = [
    'nremt_seen_questions', 'nremt_exam100_missed', 'nremt_exam100_flagged',
    'nremt_exam100_history', 'nremt_exam100_best', 'nremt_mastery',
    'nremt_domain_stats_all', 'nremt_streak', 'nremt_xp'
  ];
  // Deliberately left out of sync: nremt_inprogress_exam (an in-progress
  // attempt is device-local to avoid two devices racing on the same quiz),
  // nremt_option_order (just per-browser answer-shuffle display order), and
  // nremt_theme (a display preference, not progress).

  var sbClient = null;
  var currentUser = null;
  var syncTimer = null;
  var RELOAD_ONCE_KEY = 'nremt_sync_reloaded';

  function loadSupabaseSdk(cb){
    if(window.supabase && window.supabase.createClient){ cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = cb;
    s.onerror = function(){ /* offline or blocked — accounts just stay unavailable this load */ };
    document.head.appendChild(s);
  }
  function getClient(){
    if(!sbClient && window.supabase) sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    return sbClient;
  }

  function collectProgress(){
    var data = {};
    PROGRESS_KEYS.forEach(function(k){
      var v = localStorage.getItem(k);
      if(v !== null) data[k] = v;
    });
    return data;
  }
  function applyProgress(data){
    if(!data) return;
    Object.keys(data).forEach(function(k){
      if(PROGRESS_KEYS.indexOf(k) !== -1) localStorage.setItem(k, data[k]);
    });
  }

  function pushProgress(){
    var client = getClient();
    if(!client || !currentUser) return;
    client.from('user_progress')
      .upsert({ id: currentUser.id, data: collectProgress(), updated_at: new Date().toISOString() })
      .then(function(){ /* best-effort; next timer tick or visibility change retries */ });
  }

  // First login on a given account: if the cloud already has a saved row,
  // it wins (most common case — syncing an existing account onto a new
  // device). If not, this is the account's first sync, so seed the cloud
  // from whatever guest progress is already on this device rather than
  // discarding it.
  function pullProgressOrSeed(user){
    var client = getClient();
    return client.from('user_progress').select('data').eq('id', user.id).maybeSingle().then(function(res){
      if(res.error) return;
      if(res.data) applyProgress(res.data.data);
      else pushProgress();
    });
  }

  function startSyncTimer(){
    stopSyncTimer();
    syncTimer = setInterval(pushProgress, 30000);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  function stopSyncTimer(){
    if(syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  function onVisibilityChange(){
    if(document.visibilityState === 'hidden') pushProgress();
  }

  function renderAccountUI(){
    var mount = document.getElementById('accountSlot');
    if(!mount) return;
    if(currentUser){
      var label = currentUser.email ? currentUser.email.split('@')[0] : 'Account';
      mount.innerHTML = '<button type="button" class="account-btn" id="accountBtn" title="' +
        escapeHtml(currentUser.email || '') + '">' + escapeHtml(label) + '</button>';
    } else {
      mount.innerHTML = '<button type="button" class="account-btn" id="accountBtn">Log in</button>';
    }
    var btn = document.getElementById('accountBtn');
    if(btn) btn.addEventListener('click', function(){
      if(currentUser) openAccountMenu(); else openAuthModal();
    });
  }

  function openAccountMenu(){
    if(confirm('Signed in as ' + currentUser.email + '.\n\nSign out?')){
      pushProgress();
      var client = getClient();
      if(client) client.auth.signOut();
    }
  }

  function ensureAuthModal(){
    if(document.getElementById('authModalOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'authModalOverlay';
    overlay.className = 'auth-modal-overlay';
    overlay.innerHTML =
      '<div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">' +
        '<button type="button" class="auth-modal-close" id="authModalClose" aria-label="Close">&times;</button>' +
        '<h2 id="authModalTitle">Sign in</h2>' +
        '<p class="auth-modal-sub">Sign in to sync your progress, streak, and missed-question queue across devices. Everything still works without an account.</p>' +
        '<form id="authForm">' +
          '<label>Email<input type="email" id="authEmail" required autocomplete="email"></label>' +
          '<label>Password<input type="password" id="authPassword" required autocomplete="current-password" minlength="6"></label>' +
          '<label id="authConfirmLabel" hidden>Confirm password<input type="password" id="authConfirmPassword" autocomplete="new-password" minlength="6"></label>' +
          '<div class="auth-modal-msg" id="authModalMsg"></div>' +
          '<button type="submit" class="auth-modal-submit" id="authSubmitBtn">Sign in</button>' +
        '</form>' +
        '<p class="auth-modal-toggle">' +
          '<span id="authToggleText">Don’t have an account?</span> ' +
          '<button type="button" id="authToggleBtn">Create one</button>' +
        '</p>' +
      '</div>';
    document.body.appendChild(overlay);

    var mode = 'signin';
    function setMode(m){
      mode = m;
      var isSignup = m === 'signup';
      document.getElementById('authModalTitle').textContent = isSignup ? 'Create account' : 'Sign in';
      document.getElementById('authSubmitBtn').textContent = isSignup ? 'Create account' : 'Sign in';
      document.getElementById('authToggleText').textContent = isSignup ? 'Already have an account?' : 'Don’t have an account?';
      document.getElementById('authToggleBtn').textContent = isSignup ? 'Sign in instead' : 'Create one';
      document.getElementById('authPassword').autocomplete = isSignup ? 'new-password' : 'current-password';
      var confirmLabel = document.getElementById('authConfirmLabel');
      var confirmInput = document.getElementById('authConfirmPassword');
      confirmLabel.hidden = !isSignup;
      confirmInput.required = isSignup;
      if(!isSignup) confirmInput.value = '';
      var msgEl = document.getElementById('authModalMsg');
      msgEl.textContent = '';
      msgEl.className = 'auth-modal-msg';
    }

    document.getElementById('authModalClose').addEventListener('click', closeAuthModal);
    overlay.addEventListener('click', function(e){ if(e.target === overlay) closeAuthModal(); });
    document.getElementById('authToggleBtn').addEventListener('click', function(){
      setMode(mode === 'signin' ? 'signup' : 'signin');
    });

    document.getElementById('authForm').addEventListener('submit', function(e){
      e.preventDefault();
      var email = document.getElementById('authEmail').value.trim();
      var password = document.getElementById('authPassword').value;
      var msgEl = document.getElementById('authModalMsg');
      var submitBtn = document.getElementById('authSubmitBtn');
      var client = getClient();
      if(!client){
        msgEl.textContent = 'Accounts are unavailable right now — check your connection and try again.';
        msgEl.className = 'auth-modal-msg error';
        return;
      }
      if(mode === 'signup'){
        var confirmPassword = document.getElementById('authConfirmPassword').value;
        if(password !== confirmPassword){
          msgEl.textContent = 'Passwords do not match.';
          msgEl.className = 'auth-modal-msg error';
          return;
        }
      }
      submitBtn.disabled = true;
      msgEl.textContent = '';
      msgEl.className = 'auth-modal-msg';
      var action = mode === 'signin'
        ? client.auth.signInWithPassword({ email: email, password: password })
        : client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
      action.then(function(res){
        submitBtn.disabled = false;
        if(res.error){
          msgEl.textContent = res.error.message;
          msgEl.className = 'auth-modal-msg error';
          return;
        }
        if(mode === 'signup' && res.data && res.data.user && !res.data.session){
          msgEl.textContent = 'Check your email to confirm your account, then sign in.';
          msgEl.className = 'auth-modal-msg success';
          setMode('signin');
          return;
        }
        closeAuthModal();
      }).catch(function(){
        submitBtn.disabled = false;
        msgEl.textContent = 'Something went wrong. Please try again.';
        msgEl.className = 'auth-modal-msg error';
      });
    });
  }

  function openAuthModal(){
    ensureAuthModal();
    document.getElementById('authModalOverlay').classList.add('open');
    document.getElementById('authEmail').focus();
  }
  function closeAuthModal(){
    var overlay = document.getElementById('authModalOverlay');
    if(overlay) overlay.classList.remove('open');
  }

  function handleAuthChange(event, session){
    var wasSignedOut = !currentUser;
    currentUser = session ? session.user : null;
    renderAccountUI();
    if(event === 'SIGNED_IN' && wasSignedOut){
      pullProgressOrSeed(currentUser).then(function(){
        // A one-time reload after the first sync of a session means every
        // page's already-rendered stats (level badge, dashboard, streak)
        // reflect the freshly-synced data without needing every page to
        // separately listen for a sync event.
        if(!sessionStorage.getItem(RELOAD_ONCE_KEY)){
          sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
          location.reload();
        }
      });
      startSyncTimer();
    }
    if(event === 'SIGNED_OUT'){
      stopSyncTimer();
      sessionStorage.removeItem(RELOAD_ONCE_KEY);
    }
  }

  function initAccounts(){
    loadSupabaseSdk(function(){
      var client = getClient();
      if(!client) return;
      client.auth.onAuthStateChange(handleAuthChange);
      client.auth.getSession().then(function(res){
        var session = res.data && res.data.session;
        currentUser = session ? session.user : null;
        renderAccountUI();
        if(currentUser) startSyncTimer();
      });
    });
  }
  initAccounts();

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', renderHeader);
  } else {
    renderHeader();
  }
})();
