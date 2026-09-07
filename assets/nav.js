/* Shared site header: renders the grouped nav into #site-header and
   highlights the current page. Keeps all 10 pages in sync from one file
   instead of each page hand-copying its own nav markup. */
(function(){
  var HOME_URL = 'https://testaolivier10-del.github.io/';

  var NAV_GROUPS = [
    { label: 'Practice', items: [
      { href: 'index.html', label: 'Practice Exam' },
      { href: 'study-plan.html', label: 'Study Plan' }
    ]},
    { label: 'Study', items: [
      { href: 'study-notes.html', label: 'Study Notes' },
      { href: 'mnemonics.html', label: 'Mnemonics' },
      { href: 'glossary.html', label: 'Glossary' },
      { href: 'flowcharts.html', label: 'Flow Diagrams' }
    ]},
    { label: 'Tools', items: [
      { href: 'body-map.html', label: 'Body Map' },
      { href: 'sound-trainer.html', label: 'Sound Trainer' },
      { href: 'scenario-sim.html', label: 'Scenarios' },
      { href: 'skillsheets.html', label: 'Skills Guide' }
    ]}
  ];

  function currentFile(){
    var p = location.pathname.split('/').pop();
    return p || 'index.html';
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  function renderHeader(){
    var mount = document.getElementById('site-header');
    if(!mount) return;
    var cur = currentFile();

    var groupsHtml = NAV_GROUPS.map(function(g){
      var hasActive = g.items.some(function(i){ return i.href === cur; });
      var itemsHtml = g.items.map(function(i){
        var active = i.href === cur;
        return '<a href="' + i.href + '"' +
          (active ? ' class="active" aria-current="page"' : '') +
          '>' + escapeHtml(i.label) + '</a>';
      }).join('');
      return '<details class="nav-group' + (hasActive ? ' has-active' : '') + '"' +
        (hasActive ? ' open' : '') + '>' +
        '<summary>' + escapeHtml(g.label) + '</summary>' +
        '<div class="nav-group__items">' + itemsHtml + '</div>' +
        '</details>';
    }).join('');

    mount.innerHTML =
      '<div class="site-header__inner">' +
        '<a class="site-header__brand" href="' + HOME_URL + '">' +
          '<span class="brand-mark" aria-hidden="true">+</span> NREMT Prep' +
        '</a>' +
        '<nav class="site-header__groups" aria-label="Site sections">' + groupsHtml + '</nav>' +
      '</div>';

    var fallback = document.querySelector('.site-nav-fallback');
    if(fallback) fallback.remove();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', renderHeader);
  } else {
    renderHeader();
  }
})();
