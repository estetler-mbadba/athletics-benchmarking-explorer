/* Small SVG chart helpers. No libraries, no build step.
   Every chart gets a hover and keyboard readout, a legend when it has more than
   one series, and a data-table twin, so no value is reachable by color or hover alone. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    for (var key in attrs) {
      if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }
  function htmlEl(name, cls, text, parent) {
    var node = document.createElement(name);
    if (cls) node.className = cls;
    if (text !== null && text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  var fmt = {
    int: function (v) { return v === null || v === undefined ? 'n/a' : Math.round(v).toLocaleString('en-US'); },
    pct: function (v, d) { return v === null || v === undefined ? 'n/a' : (v * 100).toFixed(d === undefined ? 1 : d) + '%'; },
    pct0: function (v) { return fmt.pct(v, 0); },
    usd: function (v) { return v === null || v === undefined ? 'n/a' : '$' + Math.round(v).toLocaleString('en-US'); },
    usdK: function (v) { return v === null || v === undefined ? 'n/a' : '$' + Math.round(v / 1000) + 'K'; },
    k: function (v) { return v === null || v === undefined ? 'n/a' : v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K' : String(Math.round(v)); },
    idx: function (v) { return v === null || v === undefined ? 'n/a' : v.toFixed(0); }
  };

  function niceTicks(lo, hi, target) {
    var span = hi - lo || 1;
    var raw = span / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var start = Math.floor(lo / step + 1e-9) * step;
    var end = Math.ceil(hi / step - 1e-9) * step;
    var out = [];
    for (var v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  function scale(d0, d1, r0, r1) {
    return function (v) { return r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); };
  }

  /* ---------- card, legend, table view, tooltip ---------- */
  function card(parent, o) {
    var fig = htmlEl('figure', 'card', null, parent);
    htmlEl('h3', null, o.title, fig);
    if (o.subtitle) htmlEl('p', 'sub', o.subtitle, fig);
    if (o.legend && o.legend.length > 1) {
      var ul = htmlEl('ul', 'legend', null, fig);
      o.legend.forEach(function (item) {
        var li = htmlEl('li', null, null, ul);
        var key = htmlEl('span', 'key-' + (item.kind || 'line'), null, li);
        if (item.kind === 'band') { /* styled in CSS */ }
        else if (item.kind === 'dot' || item.kind === 'rect') key.style.background = item.color;
        else key.style.borderTopColor = item.color;
        htmlEl('span', null, item.label, li);
      });
    }
    var plot = htmlEl('div', 'plot', null, fig);
    var tip = htmlEl('div', 'tooltip', null, plot);
    tip.setAttribute('role', 'status');
    if (o.table) tableView(fig, o.table);
    if (o.source) htmlEl('p', 'source', o.source, fig);
    return { figure: fig, plot: plot, tip: tip };
  }

  function tableView(parent, t) {
    var details = htmlEl('details', 'table-view', null, parent);
    htmlEl('summary', null, 'Show the data as a table', details);
    var wrap = htmlEl('div', 'table-scroll', null, details);
    var table = htmlEl('table', null, null, wrap);
    if (t.caption) htmlEl('caption', null, t.caption, table).style.cssText = 'text-align:left;caption-side:top;color:var(--ink-2);padding-bottom:6px';
    var head = htmlEl('tr', null, null, htmlEl('thead', null, null, table));
    t.columns.forEach(function (c) { htmlEl('th', null, c, head).setAttribute('scope', 'col'); });
    var body = htmlEl('tbody', null, null, table);
    t.rows.forEach(function (row) {
      var tr = htmlEl('tr', null, null, body);
      row.forEach(function (cell) { htmlEl('td', null, cell, tr); });
    });
  }

  function showTip(ctx, x, y, head, rows) {
    var tip = ctx.tip;
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    if (head) htmlEl('div', 'tt-head', head, tip);
    rows.forEach(function (r) {
      var line = htmlEl('div', 'tt-row', null, tip);
      if (r.color) {
        var key = htmlEl('span', r.kind === 'dot' ? 'key-dot' : 'key-line', null, line);
        if (r.kind === 'dot') key.style.background = r.color; else key.style.borderTopColor = r.color;
      }
      htmlEl('span', 'tt-val', r.value, line);
      if (r.name) htmlEl('span', 'tt-name', r.name, line);
    });
    tip.classList.add('on');
    var w = ctx.plot.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    var left = x + 14;
    if (left + tw > w) left = Math.max(0, x - tw - 14);
    var top = Math.max(0, y - th - 10);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip(ctx) { ctx.tip.classList.remove('on'); }

  /* Redraw on width or color-scheme change. The page rebuilds its charts whenever the
     reader picks another college, so charts register here and are dropped once their
     element leaves the page. One set of observers serves every chart. */
  var live = [];
  var sizer = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (e) {
      live.forEach(function (c) { if (c.plot === e.target && Math.round(c.plot.clientWidth) !== c.last) c.run(); });
    });
  }) : null;
  function redrawAll() {
    live = live.filter(function (c) {
      if (c.plot.isConnected) return true;
      if (sizer) sizer.unobserve(c.plot);
      return false;
    });
    live.forEach(function (c) { c.run(); });
  }
  if (!sizer) window.addEventListener('resize', redrawAll);
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', redrawAll);
  }
  if (window.MutationObserver) {
    new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function mount(ctx, draw) {
    var entry = { plot: ctx.plot, last: -1 };
    entry.run = function () {
      var w = Math.round(ctx.plot.clientWidth);
      if (!w) return;
      entry.last = w;
      var old = ctx.plot.querySelector('svg');
      if (old) ctx.plot.removeChild(old);
      hideTip(ctx);
      draw(w);
    };
    live = live.filter(function (c) { return c.plot.isConnected; });
    live.push(entry);
    entry.run();
    if (sizer) sizer.observe(ctx.plot);
  }

  function axes(root, o) {
    // horizontal gridlines with y tick labels, then the baseline
    var g = svgEl('g', { 'class': 'tick' }, root);
    o.yTicks.forEach(function (t) {
      var y = o.y(t);
      svgEl('line', { x1: o.left, x2: o.right, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }, g);
      svgEl('text', { x: o.left - 8, y: y + 4, 'text-anchor': 'end' }, g).textContent = o.yFmt(t);
    });
    svgEl('line', { x1: o.left, x2: o.right, y1: o.bottom, y2: o.bottom, stroke: 'var(--axis)', 'stroke-width': 1 }, root);
  }

  /* ---------- line chart: crosshair readout lists every series ---------- */
  function lineChart(ctx, o) {
    mount(ctx, function (W) {
      var narrow = W < 430;
      var H = o.height || 290;
      var labels = o.endLabels !== false && !narrow;
      var m = { t: o.shade ? 28 : 16, r: labels ? (o.labelWidth || 104) : 18, b: 30, l: o.leftPad || 46 };
      var xs = o.x, n = xs.length;
      var all = [];
      o.series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null && v !== undefined) all.push(v); }); });
      if (o.band) { o.band.lo.concat(o.band.hi).forEach(function (v) { if (v !== null && v !== undefined) all.push(v); }); }
      var lo = o.yMin !== undefined ? o.yMin : Math.min.apply(null, all);
      var hi = o.yMax !== undefined ? o.yMax : Math.max.apply(null, all);
      var yTicks = niceTicks(lo, hi, 4);
      var y = scale(yTicks[0], yTicks[yTicks.length - 1], H - m.b, m.t);
      var x = scale(0, n - 1, m.l + 6, W - m.r - 6);
      var root = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', tabindex: 0, 'aria-label': o.ariaLabel || '' , 'class': 'hit' }, null);
      ctx.plot.insertBefore(root, ctx.tip);
      axes(root, { yTicks: yTicks, y: y, yFmt: o.yFmt, left: m.l, right: W - m.r, bottom: H - m.b });

      var every = (W - m.l - m.r) / n < (o.minTickGap || 40) ? 2 : 1;
      var gx = svgEl('g', { 'class': 'tick' }, root);
      xs.forEach(function (label, i) {
        if ((n - 1 - i) % every !== 0) return;
        svgEl('text', { x: x(i), y: H - m.b + 18, 'text-anchor': 'middle' }, gx).textContent = label;
      });

      if (o.shade) {
        var step = (W - m.r - m.l - 12) / (n - 1);
        var sx = x(o.shade.from) - step / 2;
        svgEl('rect', { x: sx, y: m.t, width: W - m.r - sx, height: H - m.b - m.t, fill: 'var(--band)' }, root);
        svgEl('text', { x: W - m.r, y: m.t - 8, 'text-anchor': 'end' }, root).textContent = o.shade.label;
      }
      if (o.band) {
        var pts = [];
        o.band.hi.forEach(function (v, i) { if (v !== null) pts.push(x(i) + ',' + y(v)); });
        for (var j = n - 1; j >= 0; j--) { if (o.band.lo[j] !== null) pts.push(x(j) + ',' + y(o.band.lo[j])); }
        svgEl('polygon', { points: pts.join(' '), fill: 'var(--band)' }, root);
      }

      var ends = [];
      o.series.forEach(function (s) {
        var d = '', lastI = -1, penDown = false;
        s.values.forEach(function (v, i) {
          if (v === null || v === undefined) { penDown = false; return; }   // a missing year breaks the line
          d += (penDown ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
          penDown = true;
          lastI = i;
        });
        svgEl('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.strong === false ? 1.5 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, root);
        s.values.forEach(function (v, i) {            // a year with no neighbor on either side still gets a mark
          var has = function (k) { return s.values[k] !== null && s.values[k] !== undefined; };
          if (has(i) && !has(i - 1) && !has(i + 1) && i !== lastI) {
            svgEl('circle', { cx: x(i), cy: y(v), r: 3.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, root);
          }
        });
        if (lastI >= 0) {
          if (s.noEndLabel) return;     // context lines carry no end dot or label
          svgEl('circle', { cx: x(lastI), cy: y(s.values[lastI]), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, root);
          ends.push({ s: s, x: x(lastI), y: y(s.values[lastI]) });
        }
      });

      if (labels) {
        // A label that would collide with one already placed is dropped; the legend and readout carry it.
        ends.sort(function (a, b) { return (b.s.primary ? 1 : 0) - (a.s.primary ? 1 : 0) || a.y - b.y; });
        var placed = [];
        ends.forEach(function (e) {
          if (placed.some(function (py) { return Math.abs(py - e.y) < 15; })) return;
          placed.push(e.y);
          var t = svgEl('text', { x: e.x + 10, y: e.y + 4, 'class': 'direct' + (e.s.primary ? ' strong' : '') }, root);
          t.textContent = e.s.endLabel || e.s.label;
        });
      }

      // crosshair layer
      var hair = svgEl('line', { y1: m.t, y2: H - m.b, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' }, root);
      var dots = o.series.map(function (s) {
        return svgEl('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, root);
      });
      var current = -1;
      function show(i) {
        current = i;
        hair.setAttribute('x1', x(i)); hair.setAttribute('x2', x(i)); hair.setAttribute('visibility', 'visible');
        var rows = [], topY = H;
        o.series.forEach(function (s, k) {
          var v = s.values[i];
          if (v === null || v === undefined) { dots[k].setAttribute('visibility', 'hidden'); return; }
          dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(v)); dots[k].setAttribute('visibility', 'visible');
          topY = Math.min(topY, y(v));
          rows.push({ color: s.color, value: s.tips ? s.tips[i] : (o.tipFmt || o.yFmt)(v), name: s.label });
        });
        if (o.band && o.band.lo[i] !== null) {
          rows.push({ value: (o.tipFmt || o.yFmt)(o.band.lo[i]) + ' to ' + (o.tipFmt || o.yFmt)(o.band.hi[i]), name: o.band.label });
        }
        showTip(ctx, x(i), topY, o.tipHeads ? o.tipHeads[i] : (o.xTitle ? o.xTitle + ' ' : '') + xs[i], rows);
      }
      function hide() {
        current = -1;
        hair.setAttribute('visibility', 'hidden');
        dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
        hideTip(ctx);
      }
      var overlay = svgEl('rect', { x: m.l, y: 0, width: W - m.l - m.r + 12, height: H, fill: 'transparent' }, root);
      overlay.addEventListener('pointermove', function (ev) {
        var box = root.getBoundingClientRect();
        var px = (ev.clientX - box.left) * (W / box.width);
        var i = Math.max(0, Math.min(n - 1, Math.round((px - m.l - 6) / ((W - m.r - m.l - 12) / (n - 1)))));
        if (i !== current) show(i);
      });
      overlay.addEventListener('pointerleave', hide);
      root.addEventListener('focus', function () { show(n - 1); });
      root.addEventListener('blur', hide);
      root.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowLeft') { show(Math.max(0, (current < 0 ? n : current) - 1)); ev.preventDefault(); }
        if (ev.key === 'ArrowRight') { show(Math.min(n - 1, current + 1)); ev.preventDefault(); }
        if (ev.key === 'Escape') hide();
      });
    });
  }

  /* ---------- scatter: the nearest point answers, so no pinpoint aiming ---------- */
  function scatterChart(ctx, o) {
    mount(ctx, function (W) {
      var H = o.height || (W < 500 ? 340 : 400);
      var m = { t: 16, r: 22, b: 46, l: 54 };
      var xT = niceTicks(o.xMin, o.xMax, W < 500 ? 4 : 7), yT = niceTicks(o.yMin, o.yMax, 5);
      var x = scale(xT[0], xT[xT.length - 1], m.l, W - m.r);
      var y = scale(yT[0], yT[yT.length - 1], H - m.b, m.t);
      var root = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.ariaLabel || '' }, null);
      ctx.plot.insertBefore(root, ctx.tip);
      axes(root, { yTicks: yT, y: y, yFmt: o.yFmt, left: m.l, right: W - m.r, bottom: H - m.b });
      var gx = svgEl('g', { 'class': 'tick' }, root);
      xT.forEach(function (t) {
        svgEl('text', { x: x(t), y: H - m.b + 18, 'text-anchor': 'middle' }, gx).textContent = o.xFmt(t);
      });
      svgEl('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle' }, root).textContent = o.xTitle;
      svgEl('text', { x: 14, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (m.t + H - m.b) / 2 + ')' }, root).textContent = o.yTitle;

      var order = { context: 0, named: 1, focus: 2 };
      var pts = o.points.slice().sort(function (a, b) { return order[a.cls] - order[b.cls]; });

      if (o.trail && o.trail.length > 1) {
        var d = o.trail.map(function (p, i) { return (i ? 'L' : 'M') + x(p.x).toFixed(1) + ',' + y(p.y).toFixed(1); }).join('');
        svgEl('path', { d: d, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 1.5, 'stroke-linejoin': 'round', opacity: 0.55 }, root);
        o.trail.slice(0, -1).forEach(function (p) {
          svgEl('circle', { cx: x(p.x), cy: y(p.y), r: 2.5, fill: 'var(--series-1)', opacity: 0.7 }, root);
        });
        var first = o.trail[0];
        svgEl('text', { x: x(first.x) - 8, y: y(first.y) - 8, 'text-anchor': 'end', 'class': 'direct' }, root).textContent = first.label;
      }

      var style = {
        context: { r: 4, fill: 'var(--context)' },
        named: { r: 4.5, fill: 'var(--ink-2)' },
        focus: { r: 6.5, fill: 'var(--series-1)' }
      };
      pts.forEach(function (p) {
        var s = style[p.cls];
        p.px = x(p.x); p.py = y(p.y);
        svgEl('circle', { cx: p.px, cy: p.py, r: s.r, fill: p.color || s.fill, stroke: 'var(--surface)', 'stroke-width': 2 }, root);
      });
      pts.forEach(function (p) {
        if (!p.directLabel) return;
        if (W < 520 && p.cls !== 'focus') return;   // narrow screens: legend, readout, and table carry the rest
        var side = p.side || (p.px + 150 < W - m.r ? 'right' : 'left');
        var dx = side === 'right' ? 10 : side === 'left' ? -10 : 0;
        var anchor = side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle';
        var t = svgEl('text', { x: p.px + dx, y: p.py + (p.dy === undefined ? 4 : p.dy), 'text-anchor': anchor, 'class': 'direct' + (p.cls === 'focus' ? ' strong' : '') }, root);
        t.textContent = p.directLabel;
      });

      var ring = svgEl('circle', { r: 9, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, visibility: 'hidden' }, root);
      var overlay = svgEl('rect', { x: m.l - 10, y: 0, width: W - m.l - m.r + 20, height: H - m.b + 10, fill: 'transparent' }, root);
      overlay.addEventListener('pointermove', function (ev) {
        var box = root.getBoundingClientRect();
        var px = (ev.clientX - box.left) * (W / box.width), py = (ev.clientY - box.top) * (H / box.height);
        var best = null, bestD = 1e9;
        pts.forEach(function (p) {
          var dd = (p.px - px) * (p.px - px) + (p.py - py) * (p.py - py);
          if (dd < bestD) { bestD = dd; best = p; }
        });
        if (!best || bestD > 60 * 60) { ring.setAttribute('visibility', 'hidden'); hideTip(ctx); return; }
        ring.setAttribute('cx', best.px); ring.setAttribute('cy', best.py); ring.setAttribute('visibility', 'visible');
        showTip(ctx, best.px, best.py, best.name, o.tipRows(best));
      });
      overlay.addEventListener('pointerleave', function () { ring.setAttribute('visibility', 'hidden'); hideTip(ctx); });
      if (o.onPick) {
        overlay.setAttribute('class', 'pick');
        overlay.addEventListener('click', function (ev) {
          var box = root.getBoundingClientRect();
          var px = (ev.clientX - box.left) * (W / box.width), py = (ev.clientY - box.top) * (H / box.height);
          var best = null, bestD = 1e9;
          pts.forEach(function (p) {
            var dd = (p.px - px) * (p.px - px) + (p.py - py) * (p.py - py);
            if (dd < bestD) { bestD = dd; best = p; }
          });
          if (best && bestD <= 60 * 60) o.onPick(best);
        });
      }
    });
  }

  function clip(text, px) {            // SVG text has no ellipsis; cut by an average glyph width
    var max = Math.max(4, Math.floor(px / 6.3));
    return text.length > max ? text.slice(0, max - 1).replace(/\s+$/, '') + '…' : text;
  }

  /* ---------- ranked bars: every school in a small group, the picked one in color ---------- */
  function rankBars(ctx, o) {
    mount(ctx, function (W) {
      var rowH = 26, labelW = W < 430 ? 124 : Math.min(230, Math.round(W * 0.34));
      var m = { t: 26, r: 62, b: 8, l: labelW };
      var H = m.t + m.b + rowH * o.items.length;
      var vals = o.items.map(function (d) { return d.value; });
      var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max.apply(null, vals.concat([o.median || 0]));
      var x = scale(lo, hi || 1, m.l, W - m.r);
      var root = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.ariaLabel || '' }, null);
      ctx.plot.insertBefore(root, ctx.tip);
      if (o.median !== null && o.median !== undefined) {
        var mx = x(o.median);
        svgEl('line', { x1: mx, x2: mx, y1: m.t - 4, y2: H - m.b, stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3', 'pointer-events': 'none' }, root);
        var right = mx + 120 < W;
        svgEl('text', { x: mx + (right ? 0 : 0), y: m.t - 10, 'text-anchor': mx > W - 70 ? 'end' : mx < m.l + 50 ? 'start' : 'middle', 'class': 'direct' }, root).textContent = 'Median ' + o.fmt(o.median);
      }
      o.items.forEach(function (d, i) {
        var cy = m.t + rowH * (i + 0.5), x0 = x(Math.min(0, d.value)), x1 = x(Math.max(0, d.value));
        var w = Math.max(2, x1 - x0), h = 12, r = Math.min(4, w / 2);
        var t = svgEl('text', { x: m.l - 10, y: cy + 4, 'text-anchor': 'end', 'class': 'direct' + (d.focus ? ' strong' : '') }, root);
        t.textContent = clip(d.label, labelW - 16);
        var path = 'M' + x0 + ',' + (cy - h / 2) + 'H' + (x0 + w - r) + 'Q' + (x0 + w) + ',' + (cy - h / 2) + ' ' + (x0 + w) + ',' + (cy - h / 2 + r) +
                   'V' + (cy + h / 2 - r) + 'Q' + (x0 + w) + ',' + (cy + h / 2) + ' ' + (x0 + w - r) + ',' + (cy + h / 2) + 'H' + x0 + 'Z';
        var bar = svgEl('path', { d: path, fill: d.focus ? 'var(--series-1)' : 'var(--context)' }, root);
        svgEl('text', { x: x0 + w + 8, y: cy + 4, 'class': 'direct halo' + (d.focus ? ' strong' : '') }, root).textContent = o.fmt(d.value);
        var hit = svgEl('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent', tabindex: 0, 'class': 'hit' + (o.onPick ? ' pick' : ''), role: 'img', 'aria-label': d.label + ': ' + o.fmt(d.value) }, root);
        function on() { bar.setAttribute('opacity', 0.78); showTip(ctx, x0 + w, cy, d.label, o.tipRows(d)); }
        function off() { bar.removeAttribute('opacity'); hideTip(ctx); }
        hit.addEventListener('pointermove', on); hit.addEventListener('pointerleave', off);
        hit.addEventListener('focus', on); hit.addEventListener('blur', off);
        if (o.onPick) {
          hit.addEventListener('click', function () { o.onPick(d); });
          hit.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') o.onPick(d); });
        }
      });
    });
  }

  /* ---------- strips: one row of dots per group, to show a whole distribution ----------
     Dots are spread up and down by a fixed amount per school so they overlap less. A value
     beyond the scale is drawn hollow at the edge; the readout gives its true figure. */
  function stripRows(ctx, o) {
    mount(ctx, function (W) {
      var narrow = W < 480;
      var rowH = o.rowH || 46, labelW = o.rows.length > 1 ? (narrow ? 0 : 206) : 0;
      var m = { t: (narrow && o.rows.length > 1) ? 4 : 10, r: 18, b: 34, l: labelW + 14 };
      var headH = (narrow && o.rows.length > 1) ? 18 : 0;         // on a phone the row label sits above its dots
      var H = m.t + m.b + (rowH + headH) * o.rows.length;
      var x = scale(o.lo, o.hi, m.l, W - m.r);
      var xT = niceTicks(o.lo, o.hi, narrow ? 3 : 6).filter(function (t) { return t >= o.lo && t <= o.hi; });
      var root = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.ariaLabel || '' }, null);
      ctx.plot.insertBefore(root, ctx.tip);
      var gx = svgEl('g', { 'class': 'tick' }, root);
      xT.forEach(function (t) {
        svgEl('line', { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, stroke: 'var(--grid)', 'stroke-width': 1 }, gx);
        svgEl('text', { x: x(t), y: H - m.b + 18, 'text-anchor': 'middle' }, gx).textContent = o.fmt(t);
      });
      var pts = [];
      o.rows.forEach(function (row, i) {
        var top = m.t + (rowH + headH) * i + headH, cy = top + rowH / 2;
        if (o.rows.length > 1) {
          if (narrow) svgEl('text', { x: m.l, y: top - 5, 'class': 'direct' }, root).textContent = row.label;
          else svgEl('text', { x: labelW, y: cy + 4, 'text-anchor': 'end', 'class': 'direct' }, root).textContent = clip(row.label, labelW - 6);
          if (i) svgEl('line', { x1: narrow ? m.l : 0, x2: W - m.r, y1: top - headH, y2: top - headH, stroke: 'var(--grid)', 'stroke-width': 1 }, root);
        }
        var g = svgEl('g', null, root), spread = rowH / 2 - 7;
        row.dots.forEach(function (d) {
          var over = d.value > o.hi, under = d.value < o.lo;
          var px = x(Math.max(o.lo, Math.min(o.hi, d.value)));
          var jitter = ((d.id * 2654435761 >>> 0) % 1000 / 1000 - 0.5) * 2 * spread;
          var py = d.focus ? cy : cy + jitter;
          pts.push({ d: d, px: px, py: py, row: row });
          if (d.focus) return;
          svgEl('circle', { cx: px, cy: py, r: 2.6, fill: (over || under) ? 'none' : 'var(--context)', stroke: (over || under) ? 'var(--context)' : 'none', 'stroke-width': 1.2, opacity: 0.75 }, g);
        });
        if (row.median !== null && row.median !== undefined) {
          var mx = x(Math.max(o.lo, Math.min(o.hi, row.median)));
          svgEl('line', { x1: mx, x2: mx, y1: cy - rowH / 2 + 4, y2: cy + rowH / 2 - 4, stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-linecap': 'round' }, root);
        }
      });
      pts.filter(function (p) { return p.d.focus; }).forEach(function (p) {
        svgEl('circle', { cx: p.px, cy: p.py, r: 6.5, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2 }, root);
        var right = p.px + 170 < W;
        svgEl('text', { x: p.px + (right ? 11 : -11), y: p.py - 9, 'text-anchor': right ? 'start' : 'end', 'class': 'direct strong' }, root).textContent = clip(p.d.name, 190);
      });
      var ring = svgEl('circle', { r: 7, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, visibility: 'hidden' }, root);
      var overlay = svgEl('rect', { x: 0, y: 0, width: W, height: H - m.b + 6, fill: 'transparent', 'class': o.onPick ? 'pick' : null }, root);
      function nearest(ev) {
        var box = root.getBoundingClientRect();
        var px = (ev.clientX - box.left) * (W / box.width), py = (ev.clientY - box.top) * (H / box.height);
        var best = null, bestD = 1e9;
        pts.forEach(function (p) {
          var dd = (p.px - px) * (p.px - px) + (p.py - py) * (p.py - py) * 1.6;
          if (dd < bestD) { bestD = dd; best = p; }
        });
        return bestD <= 40 * 40 ? best : null;
      }
      overlay.addEventListener('pointermove', function (ev) {
        var p = nearest(ev);
        if (!p) { ring.setAttribute('visibility', 'hidden'); hideTip(ctx); return; }
        ring.setAttribute('cx', p.px); ring.setAttribute('cy', p.py); ring.setAttribute('visibility', 'visible');
        showTip(ctx, p.px, p.py, p.d.name, o.tipRows(p.d, p.row));
      });
      overlay.addEventListener('pointerleave', function () { ring.setAttribute('visibility', 'hidden'); hideTip(ctx); });
      if (o.onPick) overlay.addEventListener('click', function (ev) { var p = nearest(ev); if (p) o.onPick(p.d); });
    });
  }

  /* ---------- compare rows: the picked school against a reference, one row per item ---------- */
  function compareRows(ctx, o) {
    mount(ctx, function (W) {
      var rowH = 30, noteW = o.note ? (W < 430 ? 52 : 96) : 16;
      var m = { t: 8, r: noteW, b: 30, l: W < 430 ? 108 : 176 };
      var H = m.t + m.b + rowH * o.rows.length;
      var all = [];
      o.rows.forEach(function (r) { [r.a, r.b].forEach(function (v) { if (v !== null && v !== undefined) all.push(v); }); });
      var hi = Math.max.apply(null, all.concat([o.xMax || 0]));
      var xT = niceTicks(0, hi, W < 430 ? 3 : 5);
      var x = scale(0, xT[xT.length - 1], m.l, W - m.r - 8);
      var root = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.ariaLabel || '' }, null);
      ctx.plot.insertBefore(root, ctx.tip);
      var gx = svgEl('g', { 'class': 'tick' }, root);
      xT.forEach(function (t) {
        svgEl('line', { x1: x(t), x2: x(t), y1: m.t, y2: H - m.b, stroke: 'var(--grid)', 'stroke-width': 1 }, gx);
        svgEl('text', { x: x(t), y: H - m.b + 18, 'text-anchor': 'middle' }, gx).textContent = o.fmt(t);
      });
      o.rows.forEach(function (r, i) {
        var cy = m.t + rowH * (i + 0.5);
        svgEl('text', { x: m.l - 12, y: cy + 4, 'text-anchor': 'end', 'class': 'direct' }, root).textContent = clip(r.label, m.l - 18);
        var hasA = r.a !== null && r.a !== undefined, hasB = r.b !== null && r.b !== undefined;
        if (hasA && hasB) svgEl('line', { x1: x(r.a), x2: x(r.b), y1: cy, y2: cy, stroke: 'var(--axis)', 'stroke-width': 2 }, root);
        if (hasA) svgEl('circle', { cx: x(r.a), cy: cy, r: 5, fill: 'var(--context)', stroke: 'var(--surface)', 'stroke-width': 2 }, root);
        if (hasB) svgEl('circle', { cx: x(r.b), cy: cy, r: 5.5, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2 }, root);
        if (o.note) svgEl('text', { x: W - 2, y: cy + 4, 'text-anchor': 'end', 'class': 'tick' }, root).textContent = o.note(r) || '';
        var hit = svgEl('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent', tabindex: 0, 'class': 'hit', role: 'img', 'aria-label': r.label + ': ' + o.tipRows(r).map(function (t) { return t.value + ' ' + t.name; }).join(', ') }, root);
        function on() { showTip(ctx, Math.max(hasA ? x(r.a) : 0, hasB ? x(r.b) : 0), cy, r.label, o.tipRows(r)); }
        function off() { hideTip(ctx); }
        hit.addEventListener('pointermove', on); hit.addEventListener('pointerleave', off);
        hit.addEventListener('focus', on); hit.addEventListener('blur', off);
      });
    });
  }

  window.Charts = {
    fmt: fmt, card: card, htmlEl: htmlEl, tableView: tableView,
    lineChart: lineChart, scatterChart: scatterChart,
    rankBars: rankBars, stripRows: stripRows, compareRows: compareRows
  };
})();
