/* The explorer page. Reads window.EXPLORER (written by pipeline/build.py) and draws
   either the national picture or one college against a comparison group.
   The college, the group, and the measure live in the page address, so a copied
   link opens the same view. No college is the default. */
(function () {
  'use strict';
  var D = window.EXPLORER, C = window.Charts, F = C.fmt, el = C.htmlEl;
  var $ = function (id) { return document.getElementById(id); };
  var meta = D.meta, LATEST = meta.latest_year, YEARS = meta.years;
  function season(y) { return y + '-' + String(y + 1).slice(2); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ---------- data access ---------- */
  var COL = {};
  D.school_columns.forEach(function (c, i) { COL[c] = i; });
  var M = {};
  D.measures.forEach(function (m, i) { M[m] = i; });
  function val(id, measure, year) {
    var block = D.values[year || LATEST], row = block && block[id];
    if (!row) return null;
    var v = row[M[measure]];
    return v === undefined ? null : v;
  }
  function norm(text) {
    return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  var byId = {};
  var schools = D.schools.map(function (r) {
    var s = {
      id: r[COL.unitid], name: r[COL.name], city: r[COL.city], state: r[COL.state], region: r[COL.region],
      div: r[COL.division_group], cls: r[COL.classification_name], aid: r[COL.allows_athletic_aid] === 1,
      four: r[COL.is_four_year] === 1, conf: r[COL.conference], note: r[COL.flag_note], stats: r[COL.in_group_stats] === 1
    };
    s.active = val(s.id, 'athletes') !== null;       // reported at least one athlete in the latest year
    s.key = norm(s.name + ' ' + (s.city || '') + ' ' + (s.state || ''));
    s.nameKey = norm(s.name);
    byId[s.id] = s;
    return s;
  }).filter(function (s) { return s.active; });

  /* ---------- measures ---------- */
  var MEASURES = [
    { key: 'athletes', label: 'Athletes', kind: 'int', group: 'Participation', help: 'Students on at least one varsity team, each counted once.' },
    { key: 'athlete_share', label: 'Athletes as a share of full-time undergraduates', short: 'Share of undergraduates', kind: 'pct', group: 'Participation', help: 'Athletes divided by full-time undergraduates.' },
    { key: 'teams', label: 'Teams', kind: 'int', group: 'Participation', help: "Men's and women's teams counted separately, as each college reports them." },
    { key: 'athletes_per_team', label: 'Athletes per team', kind: 'num1', group: 'Participation' },
    { key: 'expense_total', label: 'Total athletics expense', kind: 'usdM', group: 'Spending', help: 'All athletics expenses, including aid and costs not assigned to a team.' },
    { key: 'expense_per_athlete', label: 'Spending per athlete', kind: 'usd', group: 'Spending', help: 'Total athletics expense divided by athletes.' },
    { key: 'nonaid_expense_per_athlete', label: 'Spending per athlete, without athletic aid', short: 'Spending per athlete, no aid', kind: 'usd', group: 'Spending' },
    { key: 'recruiting_per_athlete', label: 'Recruiting spending per athlete', short: 'Recruiting per athlete', kind: 'usd', group: 'Spending' },
    { key: 'aid_per_athlete', label: 'Athletic aid per athlete', kind: 'usd', group: 'Athletic aid', aidOnly: true, help: 'Athletically related student aid divided by athletes.' },
    { key: 'aid_share_of_tuition', label: 'Aid per athlete as a share of tuition and fees', short: 'Aid as a share of tuition', kind: 'pct', group: 'Athletic aid', aidOnly: true },
    { key: 'full_ride_equiv_per_100', label: 'Full-cost scholarship equivalents per 100 athletes', short: 'Full rides per 100 athletes', kind: 'num1', group: 'Athletic aid', aidOnly: true, help: 'Athletic aid divided by the published cost of attendance: roughly how many full rides the aid budget would fund.' },
    { key: 'aid_share_of_expense', label: 'Athletic aid as a share of athletics expense', short: 'Aid as a share of expense', kind: 'pct', group: 'Athletic aid', aidOnly: true },
    { key: 'athletes_per_coach', label: 'Athletes per full-time-equivalent coach', short: 'Athletes per coach', kind: 'num1', group: 'Coaching', help: 'Head and assistant coaches, in full-time equivalents.' },
    { key: 'head_coach_salary_fte_men', label: "Average head coach salary per full-time equivalent, men's teams", short: "Head coach pay, men's teams", kind: 'usd', group: 'Coaching' },
    { key: 'head_coach_salary_fte_women', label: "Average head coach salary per full-time equivalent, women's teams", short: "Head coach pay, women's teams", kind: 'usd', group: 'Coaching' },
    { key: 'women_share_of_athletes', label: "Women's share of athletes", kind: 'pct', group: 'Gender equity' },
    { key: 'proportionality_gap', label: "Gap between women's share of undergraduates and of athletes", short: 'Proportionality gap', kind: 'pts', group: 'Gender equity', help: "Women's share of full-time undergraduates minus women's share of athletes, in share points. A larger gap means women are more under-represented among athletes." }
  ];
  var MBY = {};
  MEASURES.forEach(function (m) { MBY[m.key] = m; if (!m.short) m.short = m.label; });
  function show(kind, v, tight) {
    if (v === null || v === undefined) return 'n/a';
    if (kind === 'int') return F.int(v);
    if (kind === 'pct') return F.pct(v, tight ? 0 : 1);
    if (kind === 'usd') return F.usd(v);
    if (kind === 'usdM') return v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + Math.round(v / 1000) + 'K';
    if (kind === 'num1') return v.toFixed(1);
    if (kind === 'pts') return (v * 100).toFixed(tight ? 0 : 1) + (tight ? ' points' : ' pts');
    return String(v);
  }
  function axisFmt(kind) {
    return function (v) {
      if (kind === 'pct') return F.pct(v, 0);
      if (kind === 'pts') return (v * 100).toFixed(0) + ' pts';
      if (kind === 'usd') return Math.abs(v) >= 1000 ? '$' + (Math.round(v / 100) / 10) + 'K' : F.usd(v);
      if (kind === 'usdM') return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
      if (kind === 'num1') return String(Math.round(v * 10) / 10);
      return F.int(v);
    };
  }

  /* ---------- statistics ---------- */
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function stats(members, measure, focus, year) {
    var vals = [];
    members.forEach(function (s) { var v = val(s.id, measure, year); if (v !== null) vals.push(v); });
    vals.sort(function (a, b) { return a - b; });
    var out = { n: vals.length, median: quantile(vals, 0.5), q1: quantile(vals, 0.25), q3: quantile(vals, 0.75),
                min: vals[0], max: vals[vals.length - 1], sorted: vals, value: null, rank: null };
    if (focus) {
      out.value = val(focus.id, measure, year);
      if (out.value !== null) out.rank = 1 + vals.filter(function (v) { return v > out.value; }).length;   // 1 = highest
    }
    return out;
  }

  /* ---------- comparison groups ---------- */
  function hasConf(s) { return !!s.conf && s.conf !== 'Independent'; }
  function groupOptions(s) {
    var out = [];
    if (hasConf(s)) out.push({ key: 'conference', label: s.conf });
    out.push({ key: 'division', label: s.div + ', nationally' });
    if (s.region) out.push({ key: 'region', label: s.div + ', ' + s.region });
    out.push({ key: 'size', label: s.div + ', 20 closest in enrollment' });
    out.push({ key: 'custom', label: 'A group you build' });
    return out;
  }
  function groupOf(s, key, peers) {
    var pool = schools.filter(function (x) { return x.stats || x === s; });
    var members, name, noun;
    if (key === 'conference' && hasConf(s)) {
      members = pool.filter(function (x) { return x.conf === s.conf; });
      name = s.conf + ' members'; noun = 'conference';
    } else if (key === 'region' && s.region) {
      members = pool.filter(function (x) { return x.div === s.div && x.region === s.region; });
      name = s.div + ' colleges in the ' + s.region; noun = 'regional';
    } else if (key === 'size') {
      var ug = val(s.id, 'ft_undergrads') || 0;
      members = pool.filter(function (x) { return x.div === s.div && x !== s && val(x.id, 'ft_undergrads') !== null; })
        .sort(function (a, b) { return Math.abs(val(a.id, 'ft_undergrads') - ug) - Math.abs(val(b.id, 'ft_undergrads') - ug); })
        .slice(0, 20);
      members.push(s);
      name = 'the 20 ' + s.div + ' colleges closest in enrollment'; noun = 'peer';
    } else if (key === 'custom') {
      members = (peers || []).map(function (id) { return byId[id]; }).filter(function (x) { return x && x.active && x !== s; });
      members.push(s);
      name = 'the group you built'; noun = 'group';
    } else {
      key = 'division';
      members = pool.filter(function (x) { return x.div === s.div; });
      name = s.div + ' colleges nationally'; noun = 'division';
    }
    return { key: key, members: members, name: name, noun: noun, n: members.length };
  }

  /* ---------- state and address ---------- */
  var state = { school: null, group: null, measure: 'athlete_share', peers: [], sort: null };
  function readURL() {
    var q = new URLSearchParams(location.search);
    var id = parseInt(q.get('school'), 10);
    state.school = byId[id] && byId[id].active ? id : null;
    state.group = q.get('group');
    state.measure = MBY[q.get('measure')] ? q.get('measure') : 'athlete_share';
    state.peers = (q.get('peers') || '').split('.').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return byId[x]; });
  }
  function writeURL(push) {
    var q = new URLSearchParams();
    if (state.school) {
      q.set('school', state.school);
      if (state.group) q.set('group', state.group);
      if (state.measure !== 'athlete_share') q.set('measure', state.measure);
      if (state.peers.length) q.set('peers', state.peers.join('.'));
    }
    var url = location.pathname + (q.toString() ? '?' + q.toString() : '');
    if (url === location.pathname + location.search) return;
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }
  function pick(id, keepScroll) {
    state.school = id;
    state.sort = null;
    writeURL(true);
    render();
    if (!keepScroll) window.scrollTo(0, 0);
  }

  /* ---------- the finder: type a name, choose from the list ---------- */
  function search(text, exclude) {
    var tokens = norm(text).split(' ').filter(Boolean);
    if (!tokens.length) return [];
    var q = tokens.join(' ');
    var hits = [];
    schools.forEach(function (s) {
      if (exclude && exclude(s)) return;
      for (var i = 0; i < tokens.length; i++) if (s.key.indexOf(tokens[i]) < 0) return;
      var score = s.nameKey.indexOf(q) === 0 ? 0 : (' ' + s.nameKey).indexOf(' ' + q) >= 0 ? 1 : 2;
      hits.push({ s: s, score: score });
    });
    hits.sort(function (a, b) { return a.score - b.score || (b.s.four - a.s.four) || a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name); });
    return hits.slice(0, 12).map(function (h) { return h.s; });
  }
  function finder(inputId, onPick, exclude) {
    var input = $(inputId), list = $(inputId + '-list'), items = [], at = -1;
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); at = -1; }
    function mark() {
      Array.prototype.forEach.call(list.children, function (li, i) { li.setAttribute('aria-selected', i === at ? 'true' : 'false'); });
      if (at >= 0 && list.children[at]) {
        input.setAttribute('aria-activedescendant', list.children[at].id);
        list.children[at].scrollIntoView({ block: 'nearest' });
      }
    }
    function open() {
      items = search(input.value, exclude);
      clear(list);
      if (!input.value.trim()) { close(); return; }
      if (!items.length) {
        el('li', 'r-none', 'No college matches. Try part of the name, or the city.', list);
      } else {
        items.forEach(function (s, i) {
          var li = el('li', null, null, list);
          li.id = inputId + '-opt-' + i; li.setAttribute('role', 'option');
          el('span', 'r-name', s.name, li);
          el('span', 'r-sub', [s.city && s.state ? s.city + ', ' + s.state : s.state, s.div, hasConf(s) ? s.conf : null].filter(Boolean).join(' · '), li);
          li.addEventListener('mousedown', function (ev) { ev.preventDefault(); choose(i); });
        });
      }
      at = items.length ? 0 : -1;
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      mark();
    }
    function choose(i) {
      var s = items[i];
      if (!s) return;
      input.value = '';
      close();
      input.blur();
      onPick(s);
    }
    input.addEventListener('input', open);
    input.addEventListener('focus', function () { if (input.value.trim()) open(); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { if (list.hidden) open(); else { at = Math.min(items.length - 1, at + 1); mark(); } ev.preventDefault(); }
      else if (ev.key === 'ArrowUp') { at = Math.max(0, at - 1); mark(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { if (!list.hidden && at >= 0) { choose(at); ev.preventDefault(); } }
      else if (ev.key === 'Escape') { close(); }
    });
    return input;
  }

  /* ---------- shell: data status, sticky bar height, section marker ---------- */
  var checks = window.CHECKS;
  $('vintage').textContent = 'Federal data through ' + season(LATEST) +
    (checks ? ' · ' + (checks.total - checks.failed) + ' of ' + checks.total + ' accuracy checks passed' : '');
  if (checks && checks.failed === 0) $('vintage').className += ' ok';
  var bar = $('bar');
  function measureBar() {
    document.documentElement.style.setProperty('--bar-h', (bar.hidden ? 0 : Math.ceil(bar.getBoundingClientRect().height)) + 'px');
  }
  window.addEventListener('resize', measureBar);
  var tabLinks = Array.prototype.slice.call(document.querySelectorAll('#tabs a[href^="#"]'));
  function spy() {
    var line = (bar.hidden ? 0 : bar.getBoundingClientRect().height) + 24, current = null;
    tabLinks.forEach(function (a) {
      var sec = document.querySelector(a.getAttribute('href'));
      if (sec && sec.getBoundingClientRect().top <= line) current = a;
    });
    tabLinks.forEach(function (a) { if (a === current) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  }
  window.addEventListener('scroll', spy, { passive: true });

  /* ---------- measure selectors ---------- */
  function fillMeasures(select, allowAid, current) {
    clear(select);
    var groups = {};
    MEASURES.forEach(function (m) {
      if (m.aidOnly && !allowAid) return;
      if (!groups[m.group]) { groups[m.group] = document.createElement('optgroup'); groups[m.group].label = m.group; select.appendChild(groups[m.group]); }
      var o = document.createElement('option');
      o.value = m.key; o.textContent = m.label;
      groups[m.group].appendChild(o);
    });
    select.value = current;
    if (select.value !== current) select.selectedIndex = 0;
    return select.value;
  }

  /* =====================================================================
     No college picked: the national picture
     ===================================================================== */
  var NATIONAL = ['NCAA Division I FBS', 'NCAA Division I FCS', 'NCAA Division I, no football', 'NCAA Division II', 'NCAA Division III', 'NAIA', 'NJCAA'];
  var nationalMeasure = 'athlete_share';
  function divMedian(div, measure) {
    var d = D.division_medians[div], y = d && d[LATEST], m = y && y[measure];
    return m ? m[0] : null;
  }
  function divCount(div) {
    var d = D.division_medians[div], y = d && d[LATEST], m = y && y.athletes;
    return m ? m[1] : 0;
  }
  function renderHome() {
    $('home-years').textContent = season(meta.first_year) + ' through ' + season(LATEST);
    $('home-deck').textContent = 'Pick any of ' + F.int(schools.length) + ' colleges that file the federal athletics disclosure. See where it ranks in its conference or its division, how it has changed over ' + YEARS.length + ' years, and how each sport is funded.';

    var share = NATIONAL.map(function (d) { return { d: d, v: divMedian(d, 'athlete_share') }; }).filter(function (x) { return x.v !== null; })
      .sort(function (a, b) { return b.v - a.v; });
    var spend = NATIONAL.map(function (d) { return { d: d, v: divMedian(d, 'expense_per_athlete') }; }).filter(function (x) { return x.v !== null; })
      .sort(function (a, b) { return b.v - a.v; });
    $('national-finding').textContent = 'At the median ' + share[0].d + ' school, athletes are ' + F.pct(share[0].v, 0) +
      ' of full-time undergraduates. At the median ' + share[share.length - 1].d + ' school they are ' + F.pct(share[share.length - 1].v, 0) +
      '. Spending per athlete runs the other way: ' + F.usd(spend[0].v) + ' at the median ' + spend[0].d + ' school and ' +
      F.usd(spend[spend.length - 1].v) + ' at the median ' + spend[spend.length - 1].d + ' school.';

    nationalMeasure = fillMeasures($('national-measure'), true, nationalMeasure);
    drawNational();

    $('national-year').textContent = season(LATEST);
    var cols = ['athletes', 'athlete_share', 'expense_per_athlete', 'recruiting_per_athlete', 'aid_per_athlete', 'proportionality_gap'];
    var table = clear($('national-table'));
    var head = el('tr', null, null, el('thead', null, null, table));
    el('th', null, 'Division', head).setAttribute('scope', 'col');
    el('th', null, 'Colleges', head).setAttribute('scope', 'col');
    cols.forEach(function (k) { el('th', null, MBY[k].short, head).setAttribute('scope', 'col'); });
    var body = el('tbody', null, null, table);
    NATIONAL.forEach(function (d) {
      var tr = el('tr', null, null, body);
      el('span', 'name', d, el('td', null, null, tr));
      el('td', null, F.int(divCount(d)), tr);
      cols.forEach(function (k) {
        var v = divMedian(d, k);
        el('td', null, v === null ? (k === 'aid_per_athlete' ? 'not allowed' : 'n/a') : show(MBY[k].kind, v), tr);
      });
    });
    $('national-source').textContent = 'Each figure is the median college in the division for ' + season(LATEST) +
      ', computed in SQL (mart_group_medians). Division is the classification each college reports to the U.S. Department of Education. ' +
      'NCAA Division III does not allow athletic scholarships. Records that combine several athletic programs are left out. Source: EADA data files.';
  }
  function drawNational() {
    var m = MBY[nationalMeasure];
    var holder = clear($('national-chart'));
    var all = [];
    var rows = NATIONAL.map(function (d) {
      var dots = [];
      schools.forEach(function (s) {
        if (s.div !== d || !s.stats) return;
        var v = val(s.id, m.key);
        if (v === null) return;
        dots.push({ id: s.id, name: s.name, value: v, sub: s.state });
        all.push(v);
      });
      var sorted = dots.map(function (x) { return x.value; }).sort(function (a, b) { return a - b; });
      return { label: d, dots: dots, median: quantile(sorted, 0.5), n: dots.length };
    }).filter(function (r) { return r.n > 0; });
    all.sort(function (a, b) { return a - b; });
    var lo = Math.min(0, quantile(all, 0.01)), hi = quantile(all, 0.97);
    var ctx = C.card(holder, {
      title: m.label + ', by division',
      subtitle: 'Each dot is one college, ' + season(LATEST) + '. The dark line is the division median. Select a dot to open that college.',
      table: { columns: ['Division', 'Colleges', 'Median', 'Middle half'], rows: rows.map(function (r) {
        var sorted = r.dots.map(function (x) { return x.value; }).sort(function (a, b) { return a - b; });
        return [r.label, F.int(r.n), show(m.kind, r.median), show(m.kind, quantile(sorted, 0.25)) + ' to ' + show(m.kind, quantile(sorted, 0.75))];
      }) },
      source: 'A hollow dot at the edge is beyond the scale. Source: U.S. Department of Education, EADA data files, ' + season(LATEST) + '.'
    });
    C.stripRows(ctx, {
      rows: rows, lo: lo, hi: hi, fmt: axisFmt(m.kind),
      ariaLabel: m.label + ' by division, one dot per college',
      tipRows: function (d, row) { return [{ value: show(m.kind, d.value), name: m.short }, { value: show(m.kind, row.median), name: 'division median' }]; },
      onPick: function (d) { pick(d.id); }
    });
  }
  $('national-measure').addEventListener('change', function () { nationalMeasure = this.value; drawNational(); });

  /* =====================================================================
     A college is picked
     ===================================================================== */
  function ordinalRank(st) { return st.rank === null ? 'n/a' : st.rank + ' of ' + st.n; }
  function versus(value, median) {      // "12% above", "about the same as"
    if (value === null || median === null || !median) return null;
    var d = value / median - 1;
    if (Math.abs(d) < 0.03) return 'about the same as';
    return Math.round(Math.abs(d) * 100) + '% ' + (d > 0 ? 'above' : 'below');
  }

  function renderSchool() {
    var s = byId[state.school];
    var options = groupOptions(s);
    if (!options.some(function (o) { return o.key === state.group; })) state.group = options[0].key;
    var g = groupOf(s, state.group, state.peers);
    state.group = g.key;
    writeURL(false);

    // controls
    var sel = clear($('group'));
    options.forEach(function (o) { var op = document.createElement('option'); op.value = o.key; op.textContent = o.label; sel.appendChild(op); });
    sel.value = g.key;
    $('find-bar').placeholder = s.name;
    state.measure = fillMeasures($('measure'), s.aid, MBY[state.measure].aidOnly && !s.aid ? 'athlete_share' : state.measure);

    // header
    document.title = s.name + ' · Athletics Benchmarking Explorer';
    $('s-eyebrow').textContent = [s.cls, hasConf(s) ? s.conf : null, s.city && s.state ? s.city + ', ' + s.state : null].filter(Boolean).join(' · ');
    $('s-name').textContent = s.name;
    var others = g.n - 1;
    $('s-deck').textContent = 'Compared with ' + g.name + (others > 0 ? ' (' + F.int(others) + ' other college' + (others === 1 ? '' : 's') + ')' : '') +
      ', ' + season(LATEST) + '. Change the group in the bar above.';
    $('s-flag').hidden = !s.note;
    $('s-flag-text').textContent = s.note || '';

    // custom group builder
    $('custom').hidden = g.key !== 'custom';
    var chips = clear($('chips'));
    g.members.forEach(function (x) {
      if (x === s) return;
      var b = el('button', 'chip', x.name, el('li', null, null, chips));
      b.type = 'button';
      b.setAttribute('aria-label', 'Remove ' + x.name);
      b.addEventListener('click', function () {
        state.peers = state.peers.filter(function (id) { return id !== x.id; });
        writeURL(false); render();
      });
    });

    var enough = g.n >= 3;
    ['summary', 'standing', 'group-sec', 'trend', 'sports', 'gender'].forEach(function (id) { $(id).hidden = false; });

    /* ----- summary tiles ----- */
    var tiles = clear($('tiles'));
    function tile(href, label, value, delta) {
      var a = el('a', 'tile', null, tiles);
      a.href = href;
      el('span', 'label', label, a); el('span', 'value', value, a); el('span', 'delta', delta, a);
    }
    function tileFor(key, href) {
      var m = MBY[key], st = stats(g.members, key, s);
      tile(href, m.short, show(m.kind, st.value, true),
        enough && st.rank !== null ? 'Rank ' + ordinalRank(st) + '. Median ' + show(m.kind, st.median, true) + '.' : 'No comparison yet.');
      return st;
    }
    var stAth = tileFor('athletes', '#standing');
    var stShare = tileFor('athlete_share', '#group-sec');
    var stSpend = tileFor('expense_per_athlete', '#standing');
    var stAid = null;
    if (s.aid) stAid = tileFor('aid_per_athlete', '#standing');
    else tile('#limits', 'Athletic aid per athlete', 'None', 'NCAA Division III does not allow athletic scholarships.');
    var stRec = tileFor('recruiting_per_athlete', '#standing');
    var stGap = tileFor('proportionality_gap', '#gender');
    $('tiles-note').textContent = 'Rank 1 is the highest value in the group, which is not always the best. ' + season(LATEST) +
      ' is the most recent federal release. The group has ' + g.n + ' college' + (g.n === 1 ? '' : 's') + ' with data, counting this one.';

    /* ----- key findings ----- */
    var kf = clear($('kf'));
    function finding(href, text, go) {
      var a = el('a', null, null, el('li', null, null, kf));
      a.href = href;
      el('span', 'kf-text', text, a);
      el('span', null, go, el('span', 'kf-go', null, a));
    }
    var med = 'The ' + g.noun + ' median is ';
    if (stShare.value !== null) {
      finding('#group-sec', F.int(stAth.value) + ' athletes, ' + F.pct(stShare.value, 0) + ' of full-time undergraduates. ' +
        (enough ? med + F.pct(stShare.median, 0) + '.' : ''), 'The group');
    }
    if (stSpend.value !== null) {
      var vs = versus(stSpend.value, stSpend.median);
      finding('#standing', F.usd(stSpend.value) + ' spent per athlete' + (enough && vs ? ', ' + vs + ' the ' + g.noun + ' median of ' + F.usd(stSpend.median) + '.' : '.'), 'Standing');
    }
    if (s.aid && stAid.value !== null) {
      var tu = val(s.id, 'aid_share_of_tuition');
      finding('#standing', F.usd(stAid.value) + ' in athletic aid per athlete' + (tu !== null ? ', equal to ' + F.pct(tu, 0) + ' of tuition and fees' : '') + '. ' +
        (enough ? med + F.usd(stAid.median) + '.' : ''), 'Standing');
    } else if (!s.aid) {
      finding('#limits', 'No athletic scholarships. As an NCAA Division III college it may not award them, so athletes receive aid on the same terms as other students.', 'Limits');
    }
    if (stRec.value !== null) {
      finding('#standing', F.usd(stRec.value) + ' spent on recruiting per athlete' + (enough ? ', rank ' + ordinalRank(stRec) + '. ' + med + F.usd(stRec.median) + '.' : '.'), 'Standing');
    }
    var wa = val(s.id, 'women_share_of_athletes'), wu = val(s.id, 'women_share_of_undergrads');
    if (wa !== null && wu !== null) {
      finding('#gender', 'Women are ' + F.pct(wa, 0) + ' of athletes and ' + F.pct(wu, 0) + ' of full-time undergraduates, a gap of ' +
        show('pts', stGap.value, true) + '. ' + (enough ? med + show('pts', stGap.median, true) + '.' : ''), 'Gender equity');
    }

    renderStanding(s, g, enough);
    renderGroup(s, g, enough);
    renderTrend(s, g, enough);
    renderSports(s, g, enough);
    renderGender(s, g, enough);

    var lag = val(s.id, 'price_lag_years');
    $('limits-price').innerHTML = '';
    el('strong', null, 'Prices can be a year behind. ', $('limits-price'));
    $('limits-price').appendChild(document.createTextNode(
      meta.latest_price_year < LATEST
        ? 'Published prices for ' + season(LATEST) + ' had not been released when this was built, so aid as a share of tuition sets ' + season(LATEST) + ' aid against ' + season(meta.latest_price_year) + ' tuition and fees.'
        : 'Aid as a share of tuition uses the published in-state tuition and fees for the same year.' + (lag ? ' This college is an exception: its latest price is ' + lag + ' year' + (lag === 1 ? '' : 's') + ' older.' : '')));
  }

  /* ----- standing: one row per measure ----- */
  function renderStanding(s, g, enough) {
    $('standing-title').textContent = enough ? 'Where it ranks among ' + g.name : 'Its figures for ' + season(LATEST);
    var above = 0, below = 0, counted = 0;
    var table = clear($('standing-table'));
    var head = el('tr', null, null, el('thead', null, null, table));
    ['Measure', s.name, 'Group median', 'Rank (1 = highest)'].forEach(function (h, i) {
      var th = el('th', i === 1 ? 'me' : null, h, head); th.setAttribute('scope', 'col');
    });
    var body = el('tbody', null, null, table), lastGroup = null;
    MEASURES.forEach(function (m) {
      if (m.aidOnly && !s.aid) return;
      var st = stats(g.members, m.key, s);
      if (m.group !== lastGroup) {
        var gh = el('tr', 'group-head', null, body);
        el('td', null, m.group, gh).colSpan = 4;
        lastGroup = m.group;
      }
      var tr = el('tr', null, null, body);
      var td = el('td', null, m.label, tr);
      if (m.help) td.title = m.help;
      el('td', 'me', show(m.kind, st.value), tr);
      el('td', null, enough ? show(m.kind, st.median) : 'n/a', tr);
      var rk = el('td', null, enough ? ordinalRank(st) : 'n/a', tr);
      if (enough && st.rank !== null && st.n > 1) {
        var barEl = el('span', 'rankbar', null, rk), mark = el('i', null, null, barEl);
        mark.style.left = 'calc(' + ((st.n - st.rank) / (st.n - 1) * 100).toFixed(1) + '% - 2px)';
        barEl.setAttribute('aria-hidden', 'true');
        counted++;
        if (st.value > st.median) above++; else if (st.value < st.median) below++;
      }
    });
    $('standing-finding').textContent = enough
      ? s.name + ' is above the group median on ' + above + ' of ' + counted + ' measures and below it on ' + below + '. The marker in the last column shows its position in the group, low on the left and high on the right.'
      : 'Add at least two colleges to the group to see medians and ranks.';
    $('standing-source').textContent = 'Figures are for ' + season(LATEST) + '. The median is the middle college in the group, counting this one. ' +
      'A measure is left blank when a college did not report what it needs. Hover over a measure for its definition; full definitions are on the methods page.';
  }

  /* ----- the group: one measure across every member ----- */
  function drawDistribution(holder, s, g, m, opts) {
    clear(holder);
    var rows = [];
    g.members.forEach(function (x) {
      var v = val(x.id, m.key);
      if (v !== null) rows.push({ id: x.id, name: x.name, label: x.name, value: v, focus: x === s });
    });
    if (rows.length < 2) { el('p', 'empty', 'Not enough colleges in the group report this measure.', holder); return; }
    rows.sort(function (a, b) { return b.value - a.value; });
    var st = stats(g.members, m.key, s);
    var table = { columns: ['Rank', 'College', m.short], rows: rows.map(function (r, i) { return [String(i + 1), r.name, show(m.kind, r.value)]; }) };
    var source = 'Source: U.S. Department of Education, EADA data files, ' + season(LATEST) + '.';
    if (rows.length <= 30) {
      var ctx = C.card(holder, { title: opts.title || m.label, subtitle: g.name.charAt(0).toUpperCase() + g.name.slice(1) + ', ' + season(LATEST) + '. The dashed line is the group median.', table: table, source: source });
      C.rankBars(ctx, {
        items: rows, median: st.median, fmt: function (v) { return show(m.kind, v); },
        ariaLabel: m.label + ' for each college in the group',
        tipRows: function (d) { return [{ value: show(m.kind, d.value), name: m.short }, { value: show(m.kind, st.median), name: 'group median' }]; },
        onPick: function (d) { if (d.id !== s.id) pick(d.id, true); }
      });
    } else {
      var sorted = st.sorted, lo = Math.min(0, quantile(sorted, 0.01)), hi = quantile(sorted, 0.97);
      if (st.value !== null) { hi = Math.max(hi, st.value * 1.04); lo = Math.min(lo, st.value); }
      var ctx2 = C.card(holder, { title: opts.title || m.label, subtitle: 'Each dot is one of ' + F.int(rows.length) + ' colleges, ' + season(LATEST) + '. The dark line is the group median. Select a dot to open that college.', table: table, source: 'A hollow dot at the edge is beyond the scale. ' + source });
      C.stripRows(ctx2, {
        rows: [{ label: g.name, dots: rows, median: st.median }], lo: lo, hi: hi, rowH: 96, fmt: axisFmt(m.kind),
        ariaLabel: m.label + ', one dot per college in the group',
        tipRows: function (d) { return [{ value: show(m.kind, d.value), name: m.short }, { value: show(m.kind, st.median), name: 'group median' }]; },
        onPick: function (d) { if (d.id !== s.id) pick(d.id, true); }
      });
    }
  }
  var TABLE_COLS = ['athletes', 'athlete_share', 'expense_per_athlete', 'aid_per_athlete', 'recruiting_per_athlete', 'athletes_per_coach', 'proportionality_gap'];
  function renderGroup(s, g, enough) {
    var m = MBY[state.measure], st = stats(g.members, m.key, s);
    $('group-title').textContent = m.label + ': ' + (enough && st.rank !== null ? 'rank ' + ordinalRank(st) : 'no rank available');
    $('group-finding').textContent = !enough ? 'Add at least two colleges to the group to compare.'
      : st.value === null ? s.name + ' did not report what this measure needs.'
      : s.name + ' is at ' + show(m.kind, st.value) + '. The middle half of the group runs from ' + show(m.kind, st.q1) + ' to ' + show(m.kind, st.q3) +
        ', with a median of ' + show(m.kind, st.median) + '.' + (m.help ? ' ' + m.help : '');
    drawDistribution($('group-chart'), s, g, m, {});

    // size against cost
    var holder = clear($('group-scatter'));
    var pts = [];
    g.members.forEach(function (x) {
      var a = val(x.id, 'athlete_share'), b = val(x.id, 'expense_per_athlete');
      if (a === null || b === null) return;
      pts.push({ id: x.id, name: x.name, x: a, y: b, cls: x === s ? 'focus' : 'context', directLabel: x === s ? x.name : null });
    });
    if (pts.length >= 3) {
      var xs = pts.map(function (p) { return p.x; }).sort(function (a, b) { return a - b; });
      var ys = pts.map(function (p) { return p.y; }).sort(function (a, b) { return a - b; });
      var me = pts.filter(function (p) { return p.cls === 'focus'; })[0];
      var cut = pts.length > 40 ? 0.98 : 1;      // a large group is trimmed so a few outliers do not flatten the rest
      var xMax = Math.max(quantile(xs, cut), me ? me.x : 0), yMax = Math.max(quantile(ys, cut), me ? me.y : 0);
      var shown = pts.filter(function (p) { return p.x <= xMax && p.y <= yMax; });
      var ctx = C.card(holder, {
        title: 'Participation against spending',
        subtitle: 'Across: athletes as a share of full-time undergraduates. Up: spending per athlete. Select a dot to open that college.',
        legend: [{ label: s.name, color: 'var(--series-1)', kind: 'dot' }, { label: 'Other colleges in the group', color: 'var(--context)', kind: 'dot' }],
        table: { columns: ['College', 'Share of undergraduates', 'Spending per athlete'], rows: pts.slice().sort(function (a, b) { return b.y - a.y; }).map(function (p) { return [p.name, F.pct(p.x, 1), F.usd(p.y)]; }) },
        source: (shown.length < pts.length ? (pts.length - shown.length) + ' college' + (pts.length - shown.length === 1 ? '' : 's') + ' beyond the scale are in the table only. ' : '') + 'Source: EADA data files, ' + season(LATEST) + '.'
      });
      C.scatterChart(ctx, {
        points: shown, xMin: 0, xMax: xMax, yMin: 0, yMax: yMax,
        xFmt: function (v) { return F.pct(v, 0); }, yFmt: axisFmt('usd'),
        xTitle: 'Athletes as a share of full-time undergraduates', yTitle: '',
        ariaLabel: 'Scatter of participation share against spending per athlete for the group',
        tipRows: function (p) { return [{ value: F.pct(p.x, 1), name: 'of undergraduates are athletes' }, { value: F.usd(p.y), name: 'spent per athlete' }]; },
        onPick: function (p) { if (p.id !== s.id) pick(p.id, true); }
      });
    }

    // table of members
    var cols = TABLE_COLS.filter(function (k) { return !MBY[k].aidOnly || s.aid; });
    if (cols.indexOf(m.key) < 0) cols.unshift(m.key);
    if (!state.sort || cols.indexOf(state.sort.key) < 0) state.sort = { key: m.key, dir: -1 };
    $('group-table-title').textContent = F.int(g.n) + ' college' + (g.n === 1 ? '' : 's') + ' in the group, ' + season(LATEST);
    var table = clear($('group-table'));
    var head = el('tr', null, null, el('thead', null, null, table));
    el('th', null, 'College', head).setAttribute('scope', 'col');
    cols.forEach(function (k) {
      var th = el('th', null, null, head); th.setAttribute('scope', 'col');
      var b = el('button', null, MBY[k].short, th); b.type = 'button';
      if (state.sort.key === k) th.setAttribute('aria-sort', state.sort.dir < 0 ? 'descending' : 'ascending');
      b.addEventListener('click', function () {
        state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
        renderGroup(s, g, enough);
      });
    });
    var body = el('tbody', null, null, table);
    g.members.slice().sort(function (a, b) {
      var va = val(a.id, state.sort.key), vb = val(b.id, state.sort.key);
      if (va === null) return 1; if (vb === null) return -1;
      return (va - vb) * state.sort.dir || a.name.localeCompare(b.name);
    }).forEach(function (x) {
      var tr = el('tr', x === s ? 'me' : null, null, body);
      tr.tabIndex = 0;
      el('td', null, x.name, tr).title = x.name + (x.state ? ', ' + x.state : '');
      cols.forEach(function (k) { el('td', null, show(MBY[k].kind, val(x.id, k)), tr); });
      if (x !== s) {
        tr.addEventListener('click', function () { pick(x.id); });
        tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') pick(x.id); });
      }
    });
  }

  /* ----- trend ----- */
  function trendCard(holder, s, g, m, enough) {
    clear(holder);
    var mine = YEARS.map(function (y) { return val(s.id, m.key, y); });
    var gs = YEARS.map(function (y) { return stats(g.members, m.key, null, y); });
    var hasGroup = enough && gs.some(function (x) { return x.n >= 3; });
    var series = [{ label: s.name, endLabel: 'This college', color: 'var(--series-1)', values: mine, primary: true }];
    if (hasGroup) series.push({ label: 'Group median', color: 'var(--ink-2)', values: gs.map(function (x) { return x.n >= 3 ? x.median : null; }), strong: false });
    var legend = [{ label: s.name, color: 'var(--series-1)' }];
    if (hasGroup) { legend.push({ label: 'Group median', color: 'var(--ink-2)' }); legend.push({ label: 'Middle half of the group', kind: 'band' }); }
    var ctx = C.card(holder, {
      title: m.label, subtitle: season(YEARS[0]) + ' through ' + season(LATEST), legend: legend,
      table: { columns: ['Year', s.name, 'Group median', 'Colleges'], rows: YEARS.map(function (y, i) { return [season(y), show(m.kind, mine[i]), hasGroup ? show(m.kind, gs[i].median) : 'n/a', String(gs[i].n)]; }) },
      source: 'Source: EADA data files.'
    });
    C.lineChart(ctx, {
      x: YEARS.map(season), series: series, yFmt: axisFmt(m.kind), tipFmt: function (v) { return show(m.kind, v); },
      band: hasGroup ? { lo: gs.map(function (x) { return x.n >= 3 ? x.q1 : null; }), hi: gs.map(function (x) { return x.n >= 3 ? x.q3 : null; }), label: 'middle half' } : null,
      yMin: m.kind === 'pts' ? undefined : 0, leftPad: 54, labelWidth: 96, minTickGap: 56,
      ariaLabel: m.label + ' by year for ' + s.name + ' and the group median'
    });
    return { mine: mine, gs: gs };
  }
  function renderTrend(s, g, enough) {
    var a = MBY[state.measure];
    var bKey = a.key === 'expense_per_athlete' ? 'athlete_share' : 'expense_per_athlete';
    var ra = trendCard($('trend-a'), s, g, a, enough);
    trendCard($('trend-b'), s, g, MBY[bKey], enough);
    var first = null, last = null, fi = -1, li = -1;
    ra.mine.forEach(function (v, i) { if (v !== null) { if (first === null) { first = v; fi = i; } last = v; li = i; } });
    $('trend-title').textContent = 'How it has moved over ' + YEARS.length + ' years';
    if (first !== null && li > fi) {
      var text = a.label + ' went from ' + show(a.kind, first) + ' in ' + season(YEARS[fi]) + ' to ' + show(a.kind, last) + ' in ' + season(YEARS[li]) + '.';
      var g0 = ra.gs[fi], g1 = ra.gs[li];
      if (enough && g0.n >= 3 && g1.n >= 3) text += ' Over the same years the group median went from ' + show(a.kind, g0.median) + ' to ' + show(a.kind, g1.median) + '.';
      $('trend-finding').textContent = text;
    } else {
      $('trend-finding').textContent = s.name + ' has fewer than two years of data for this measure.';
    }
    $('trend-note').textContent = 'The first chart follows the measure chosen under The group. The group is its ' + season(LATEST) +
      ' membership in every year, and a college missing a year is skipped for that year. ' + season(2020) + ' is left out because many programs cut or cancelled seasons.';
  }

  /* ----- sport by sport ----- */
  function renderSports(s, g, enough) {
    var holder = clear($('sports-chart'));
    var mine = (D.sports[s.id] || []).map(function (r) { return { sport: D.sport_names[r[0]], idx: r[0], participants: r[1], expense: r[2] }; })
      .filter(function (r) { return r.participants > 0; })
      .sort(function (a, b) { return b.expense - a.expense; });
    $('sports-title').textContent = 'How each sport is funded';
    if (!mine.length) { $('sports-finding').textContent = s.name + ' reported no sport-level detail for ' + season(LATEST) + '.'; return; }
    var bySport = {};
    g.members.forEach(function (x) {
      (D.sports[x.id] || []).forEach(function (r) {
        if (r[1] > 0) (bySport[r[0]] = bySport[r[0]] || []).push(r[2] / r[1]);
      });
    });
    var rows = mine.map(function (r) {
      var peers = (bySport[r.idx] || []).slice().sort(function (a, b) { return a - b; });
      var per = r.expense / r.participants;
      var med = enough && peers.length >= 3 ? quantile(peers, 0.5) : null;
      return { label: r.sport, b: per, a: med, n: peers.length, participants: r.participants, expense: r.expense, ratio: med ? per / med : null };
    });
    var compared = rows.filter(function (r) { return r.ratio !== null; });
    var below = compared.filter(function (r) { return r.ratio < 0.97; });
    var text = s.name + ' reports ' + rows.length + ' sport' + (rows.length === 1 ? '' : 's') + '.';
    if (compared.length) {
      var low = compared.slice().sort(function (a, b) { return a.ratio - b.ratio; })[0];
      var high = compared.slice().sort(function (a, b) { return b.ratio - a.ratio; })[0];
      text += ' In ' + below.length + ' of the ' + compared.length + ' that can be compared, it spends less per participant than the group median. ' +
        'The lowest against the median is ' + low.label.toLowerCase() + ' at ' + Math.round(low.ratio * 100) + '%, and the highest is ' + high.label.toLowerCase() + ' at ' + Math.round(high.ratio * 100) + '%.';
    }
    $('sports-finding').textContent = text;
    var ctx = C.card(holder, {
      title: 'Spending per participant, by sport',
      subtitle: "Total expense for the sport, men's and women's teams together, divided by participants. " + season(LATEST) + '. The right column is this college as a percentage of the group median.',
      legend: [{ label: s.name, color: 'var(--series-1)', kind: 'dot' }, { label: 'Group median', color: 'var(--context)', kind: 'dot' }],
      table: { columns: ['Sport', 'Participants', 'Total expense', 'Per participant', 'Group median', 'Colleges in group with the sport'],
        rows: rows.map(function (r) { return [r.label, F.int(r.participants), F.usd(r.expense), F.usd(r.b), r.a === null ? 'n/a' : F.usd(r.a), String(r.n)]; }) },
      source: 'Source: EADA data files, ' + season(LATEST) + '.'
    });
    C.compareRows(ctx, {
      rows: rows, fmt: axisFmt('usd'), ariaLabel: 'Spending per participant by sport, this college against the group median',
      note: function (r) { return r.ratio === null ? '' : Math.round(r.ratio * 100) + '%'; },
      tipRows: function (r) {
        var out = [{ value: F.usd(r.b), name: 'per participant here', color: 'var(--series-1)', kind: 'dot' }];
        if (r.a !== null) out.push({ value: F.usd(r.a), name: 'group median (' + r.n + ' colleges)', color: 'var(--context)', kind: 'dot' });
        out.push({ value: F.int(r.participants), name: 'participants' });
        return out;
      }
    });
    $('sports-note').textContent = 'A participant is counted once for each team. Track and cross country are combined into one line, so a runner on cross country and both track teams counts three times there. ' +
      'A sport needs at least three colleges in the group to show a median. Colleges also differ in how they assign shared costs to teams.';
  }

  /* ----- gender ----- */
  function renderGender(s, g, enough) {
    var wa = val(s.id, 'women_share_of_athletes'), wu = val(s.id, 'women_share_of_undergrads');
    var stGap = stats(g.members, 'proportionality_gap', s), stWa = stats(g.members, 'women_share_of_athletes', s), stWu = stats(g.members, 'women_share_of_undergrads', s);
    $('gender-title').textContent = "Women's share of athletes against their share of students";
    var text = wa === null || wu === null ? s.name + ' did not report what this measure needs.'
      : 'Women are ' + F.pct(wa, 1) + ' of athletes at ' + s.name + ' and ' + F.pct(wu, 1) + ' of full-time undergraduates, a gap of ' + show('pts', stGap.value) + '.';
    if (enough && stGap.rank !== null) text += ' The group median gap is ' + show('pts', stGap.median) + ', and this gap ranks ' + ordinalRank(stGap) + ' (1 is the widest).';
    var aidW = s.aid ? val(s.id, 'women_share_of_aid') : null;
    if (aidW !== null) text += ' Women receive ' + F.pct(aidW, 0) + ' of athletic aid.';
    $('gender-finding').textContent = text;

    var a = clear($('gender-a'));
    var rows = [{ label: 'This college', a: wu, b: wa }];
    if (enough) rows.push({ label: 'Group median', a: stWu.median, b: stWa.median });
    var ctx = C.card(a, {
      title: "Women's share, athletes against undergraduates", subtitle: season(LATEST) + '. The line between the dots is the gap.',
      legend: [{ label: "Women's share of athletes", color: 'var(--series-1)', kind: 'dot' }, { label: "Women's share of full-time undergraduates", color: 'var(--context)', kind: 'dot' }],
      table: { columns: ['', "Women's share of athletes", "Women's share of undergraduates", 'Gap'], rows: rows.map(function (r) {
        return [r.label, F.pct(r.b, 1), F.pct(r.a, 1), r.a === null || r.b === null ? 'n/a' : show('pts', r.a - r.b)];
      }) },
      source: 'Source: EADA data files, ' + season(LATEST) + '.'
    });
    C.compareRows(ctx, {
      rows: rows, xMax: 0.7, fmt: function (v) { return F.pct(v, 0); }, ariaLabel: "Women's share of athletes and of undergraduates",
      tipRows: function (r) { return [{ value: F.pct(r.b, 1), name: 'of athletes are women', color: 'var(--series-1)', kind: 'dot' }, { value: F.pct(r.a, 1), name: 'of undergraduates are women', color: 'var(--context)', kind: 'dot' }]; }
    });
    drawDistribution($('gender-b'), s, g, MBY.proportionality_gap, { title: 'Proportionality gap across the group' });
  }

  /* =====================================================================
     Wiring
     ===================================================================== */
  function render() {
    var has = !!state.school;
    $('home').hidden = has; $('school').hidden = !has; bar.hidden = !has;
    if (has) renderSchool(); else { document.title = 'Athletics Benchmarking Explorer'; renderHome(); }
    measureBar(); spy();
  }
  finder('find-home', function (s) { pick(s.id); });
  finder('find-bar', function (s) { pick(s.id); });
  finder('find-peer', function (s) {
    if (state.peers.indexOf(s.id) < 0) state.peers.push(s.id);
    writeURL(false); render();
    $('find-peer').focus();
  }, function (x) { return x.id === state.school || state.peers.indexOf(x.id) >= 0; });
  $('group').addEventListener('change', function () { state.group = this.value; state.sort = null; writeURL(true); render(); });
  $('measure').addEventListener('change', function () {
    state.measure = this.value; state.sort = null; writeURL(false);
    var s = byId[state.school], g = groupOf(s, state.group, state.peers);
    renderGroup(s, g, g.n >= 3); renderTrend(s, g, g.n >= 3);
  });
  $('random').addEventListener('click', function () {
    var pool = schools.filter(function (s) { return s.four && hasConf(s) && s.stats; });
    pick(pool[Math.floor(Math.random() * pool.length)].id);
  });
  $('clear').addEventListener('click', function () { state.school = null; state.group = null; state.peers = []; writeURL(true); render(); window.scrollTo(0, 0); });
  window.addEventListener('popstate', function () { readURL(); render(); });

  $('foot-source').textContent = 'Data: U.S. Department of Education, Equity in Athletics Disclosure Act (EADA) data files, ' + season(meta.first_year) + ' through ' + season(LATEST) +
    '; NCES IPEDS published prices through ' + season(meta.latest_price_year) + '; conference membership for 2024-25 from Wikipedia (CC BY-SA 4.0), matched to federal unit IDs. Built ' + meta.built_on + '.';

  readURL();
  render();
})();
