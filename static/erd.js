/* db-viewr ERD renderer — vanilla JS + SVG, no dependencies */
(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────
  var TW    = 240;   // table box width
  var ROW_H = 26;    // column row height
  var HDR_H = 36;    // header height
  var GAP   = 64;    // gap between tables in auto-layout

  // ── State ───────────────────────────────────────────────────────────────────
  var data;           // parsed ERD JSON from server
  var pos;            // {tableName: {x, y}} — mutable positions
  var svg, vp;        // SVG root + viewport <g>
  var vx = 0, vy = 0, vs = 1;  // viewport translate + scale
  var dragState = null;         // {name, sx, sy, ox, oy}
  var panState  = null;         // {sx, sy, ovx, ovy}

  // ── Boot ────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var raw = document.getElementById('erd-data');
    if (!raw) return;

    try { data = JSON.parse(raw.textContent); }
    catch (e) { console.error('ERD: bad JSON', e); return; }

    svg = document.getElementById('erd-svg');
    vp  = document.getElementById('erd-vp');
    if (!svg || !vp) return;

    autoLayout();
    draw();
    bindEvents();
    // fit after first paint so getBoundingClientRect is correct
    requestAnimationFrame(function () { requestAnimationFrame(fitAll); });
  });

  // ── Auto-layout (grid, filling column by column) ────────────────────────────
  function autoLayout() {
    pos = {};
    var names = Object.keys(data.tables);
    if (!names.length) return;

    // Use more columns for larger schemas
    var numCols = Math.max(1, Math.ceil(Math.sqrt(names.length * 1.5)));
    var colY    = [];
    for (var i = 0; i < numCols; i++) colY.push(GAP);

    names.forEach(function (name, i) {
      var c = i % numCols;
      pos[name] = { x: GAP + c * (TW + GAP), y: colY[c] };
      colY[c] += tblH(name) + GAP;
    });
  }

  function tblH(name) {
    var cols = (data.tables[name] || {}).columns || [];
    return HDR_H + cols.length * ROW_H;
  }

  // ── Main draw ───────────────────────────────────────────────────────────────
  function draw() {
    vp.setAttribute('transform',
      'translate(' + vx + ',' + vy + ') scale(' + vs + ')');
    clearEl(vp);

    // Relations first (rendered behind tables)
    var relG = el('g', { class: 'erd-rels' });
    drawRelations(relG);
    vp.appendChild(relG);

    // Tables
    Object.keys(data.tables).forEach(function (name) {
      vp.appendChild(drawTable(name));
    });
  }

  // ── Table box ───────────────────────────────────────────────────────────────
  function drawTable(name) {
    var tbl  = data.tables[name];
    var p    = pos[name];
    var h    = tblH(name);
    var fkSet = {};
    (tbl.foreign_keys || []).forEach(function (fk) { fkSet[fk.column] = true; });

    var g = el('g', {
      class: 'erd-table',
      'data-table': name,
      transform: 'translate(' + p.x + ',' + p.y + ')'
    });

    // ── Background ────────────────────────────────────────────────────────────
    g.appendChild(el('rect', {
      class: 'erd-tbl-bg', x: 0, y: 0, width: TW, height: h, rx: 7
    }));

    // ── Header ────────────────────────────────────────────────────────────────
    // Two rects: one with rounded top corners, one square-bottom to fill the gap
    g.appendChild(el('rect', {
      class: 'erd-tbl-hdr', x: 0, y: 0, width: TW, height: HDR_H, rx: 7
    }));
    g.appendChild(el('rect', {
      class: 'erd-tbl-hdr', x: 0, y: HDR_H - 7, width: TW, height: 7
    }));

    // Transparent drag handle covering the header
    g.appendChild(el('rect', {
      class: 'erd-drag-handle',
      x: 0, y: 0, width: TW, height: HDR_H, fill: 'transparent'
    }));

    // Table name
    var tname = el('text', { class: 'erd-tbl-name', x: 12, y: HDR_H / 2 + 6 });
    tname.textContent = name;
    g.appendChild(tname);

    // Column count badge
    var badge = el('text', {
      class: 'erd-tbl-badge',
      x: TW - 10, y: HDR_H / 2 + 5,
      'text-anchor': 'end'
    });
    badge.textContent = tbl.columns.length + (tbl.columns.length === 1 ? ' col' : ' cols');
    g.appendChild(badge);

    // ── Column rows ───────────────────────────────────────────────────────────
    tbl.columns.forEach(function (col, i) {
      var ry  = HDR_H + i * ROW_H;
      var isPK = col.primary_key;
      var isFK = !!fkSet[col.name];
      var rowCls = 'erd-row' + (isPK ? ' pk' : isFK ? ' fk' : '');

      // Row background (transparent by default, tinted for PK/FK)
      g.appendChild(el('rect', {
        class: rowCls, x: 0, y: ry, width: TW, height: ROW_H
      }));

      // Divider above each row (not the first)
      if (i > 0) {
        g.appendChild(el('line', {
          class: 'erd-div', x1: 0, y1: ry, x2: TW, y2: ry
        }));
      }

      // Icon
      var icon = el('text', {
        class: 'erd-icon' + (isPK ? ' pk' : isFK ? ' fk' : ''),
        x: 9, y: ry + ROW_H - 8
      });
      icon.textContent = isPK ? '★' : isFK ? '◈' : '·';
      g.appendChild(icon);

      // Column name
      var cn = el('text', { class: 'erd-cname', x: 26, y: ry + ROW_H - 8 });
      cn.textContent = col.name;
      g.appendChild(cn);

      // Type (right-aligned, muted, truncated)
      var ct = el('text', {
        class: 'erd-ctype', x: TW - 8, y: ry + ROW_H - 8, 'text-anchor': 'end'
      });
      ct.textContent = shortType(col.type || '');
      g.appendChild(ct);
    });

    return g;
  }

  // ── FK relation lines ────────────────────────────────────────────────────────
  function drawRelations(group) {
    Object.keys(data.tables).forEach(function (fromName) {
      var tbl = data.tables[fromName];
      (tbl.foreign_keys || []).forEach(function (fk) {
        var toTbl = data.tables[fk.ref_table];
        if (!toTbl || !pos[fromName] || !pos[fk.ref_table]) return;

        var fromColIdx = tbl.columns.findIndex(function (c) {
          return c.name === fk.column;
        });
        var toColIdx = toTbl.columns.findIndex(function (c) {
          return c.name === fk.ref_column;
        });
        if (fromColIdx === -1) return; // FK col not found

        var fp = pos[fromName];
        var tp = pos[fk.ref_table];

        // Y centre of each column row
        var fy = fp.y + HDR_H + fromColIdx * ROW_H + ROW_H / 2;
        var ty = tp.y + HDR_H + (toColIdx !== -1 ? toColIdx : 0) * ROW_H + ROW_H / 2;

        // Choose exit/entry side based on horizontal midpoint of tables
        var fromCX = fp.x + TW / 2;
        var toCX   = tp.x + TW / 2;
        var fromX, toX, dir;

        if (fromCX <= toCX) {
          fromX = fp.x + TW; toX = tp.x; dir = 1;
        } else {
          fromX = fp.x; toX = tp.x + TW; dir = -1;
        }

        // Self-referencing table: route around top
        if (fromName === fk.ref_table) {
          var sx = fp.x + TW + 20;
          var d = 'M' + fromX + ',' + fy +
                  ' C' + sx + ',' + fy +
                  ' '  + sx + ',' + ty +
                  ' '  + toX + ',' + ty;
          group.appendChild(el('path', { class: 'erd-rel', d: d }));
        } else {
          var dx = Math.abs(toX - fromX);
          var cx = Math.max(40, dx * 0.45);
          var d = 'M' + fromX + ',' + fy +
                  ' C' + (fromX + dir * cx) + ',' + fy +
                  ' '  + (toX - dir * cx)   + ',' + ty +
                  ' '  + toX + ',' + ty;
          group.appendChild(el('path', { class: 'erd-rel', d: d }));
        }

        // FK end: filled dot (many-side)
        group.appendChild(el('circle', {
          class: 'erd-dot fk', cx: fromX, cy: fy, r: 4
        }));

        // PK end: filled arrowhead (one-side)
        var arrowLen = 9;
        var ax = toX - dir * arrowLen;
        group.appendChild(el('polygon', {
          class: 'erd-arrow',
          points: ax + ',' + (ty - 5) + ' ' + toX + ',' + ty + ' ' + ax + ',' + (ty + 5)
        }));
      });
    });
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  function bindEvents() {
    // Mouse-wheel zoom centred on cursor
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect  = svg.getBoundingClientRect();
      var mx    = e.clientX - rect.left;
      var my    = e.clientY - rect.top;
      var delta = e.deltaY < 0 ? 1.12 : 0.89;
      var ns    = Math.max(0.1, Math.min(4, vs * delta));
      vx = mx - (mx - vx) * (ns / vs);
      vy = my - (my - vy) * (ns / vs);
      vs = ns;
      draw();
    }, { passive: false });

    // Mousedown: drag table header OR pan background
    svg.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;

      var handle = e.target.closest && e.target.closest('.erd-drag-handle');
      if (handle) {
        var tableEl = handle.closest('[data-table]');
        var name    = tableEl && tableEl.getAttribute('data-table');
        if (!name || !pos[name]) return;
        var pt = svgCoord(e);
        dragState = { name: name, sx: pt.x, sy: pt.y,
                      ox: pos[name].x, oy: pos[name].y };
        svg.style.cursor = 'grabbing';
        e.preventDefault();
      } else if (!e.target.closest('.erd-table')) {
        // Clicking on empty SVG canvas → pan
        panState = { sx: e.clientX, sy: e.clientY, ovx: vx, ovy: vy };
        svg.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', function (e) {
      if (dragState) {
        var pt = svgCoord(e);
        pos[dragState.name].x = dragState.ox + (pt.x - dragState.sx);
        pos[dragState.name].y = dragState.oy + (pt.y - dragState.sy);
        draw();
      } else if (panState) {
        vx = panState.ovx + (e.clientX - panState.sx);
        vy = panState.ovy + (e.clientY - panState.sy);
        draw();
      }
    });

    window.addEventListener('mouseup', function () {
      dragState = null;
      panState  = null;
      svg.style.cursor = '';
    });

    // Touch pan (single finger)
    var lastTouch = null;
    svg.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) lastTouch = e.touches[0];
    }, { passive: true });
    svg.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1 && lastTouch) {
        vx += e.touches[0].clientX - lastTouch.clientX;
        vy += e.touches[0].clientY - lastTouch.clientY;
        lastTouch = e.touches[0];
        draw();
      }
    }, { passive: true });
    svg.addEventListener('touchend', function () { lastTouch = null; }, { passive: true });

    // Toolbar buttons
    document.getElementById('erd-zi').addEventListener('click', function () {
      zoomFromCenter(1.2);
    });
    document.getElementById('erd-zo').addEventListener('click', function () {
      zoomFromCenter(0.8);
    });
    document.getElementById('erd-zr').addEventListener('click', function () {
      vs = 1; vx = 0; vy = 0; draw();
    });
    document.getElementById('erd-fit').addEventListener('click', fitAll);
  }

  function zoomFromCenter(delta) {
    var rect = svg.getBoundingClientRect();
    var ns   = Math.max(0.1, Math.min(4, vs * delta));
    var mx   = rect.width  / 2;
    var my   = rect.height / 2;
    vx = mx - (mx - vx) * (ns / vs);
    vy = my - (my - vy) * (ns / vs);
    vs = ns;
    draw();
  }

  function fitAll() {
    var names = Object.keys(pos);
    if (!names.length) return;

    var minX =  1e9, minY =  1e9, maxX = -1e9, maxY = -1e9;
    names.forEach(function (n) {
      var p = pos[n];
      var h = tblH(n);
      if (p.x         < minX) minX = p.x;
      if (p.y         < minY) minY = p.y;
      if (p.x + TW    > maxX) maxX = p.x + TW;
      if (p.y + h     > maxY) maxY = p.y + h;
    });

    var rect = svg.getBoundingClientRect();
    var pad  = 48;
    var sx   = (rect.width  - pad * 2) / (maxX - minX);
    var sy   = (rect.height - pad * 2) / (maxY - minY);
    vs = Math.min(sx, sy, 1);   // never zoom in beyond 100% on fit
    vx = pad - minX * vs;
    vy = pad - minY * vs;
    draw();
  }

  // Convert screen coords → SVG viewport coords (accounts for zoom/pan)
  function svgCoord(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(vp.getScreenCTM().inverse());
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function el(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  function clearEl(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function shortType(t) {
    return t
      .replace(/character varying/gi, 'varchar')
      .replace(/without time zone/gi, '')
      .replace(/with time zone/gi, '+tz')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 16);
  }

}());
