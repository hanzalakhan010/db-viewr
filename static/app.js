document.addEventListener("DOMContentLoaded", function () {

  // ── Tab strip (per connection, localStorage) ──────────────────────────────
  (function initTabStrip() {
    var strip = document.getElementById("tab-strip");
    if (!strip) return;
    var connId = strip.dataset.connId;
    if (!connId) return;
    var storageKey = "db-viewr:tabs:" + connId;

    var currentUrl = strip.dataset.currentUrl || "";
    var currentType = strip.dataset.currentType || "";
    var currentLabel = strip.dataset.currentLabel || "";
    var currentPinned = strip.dataset.currentPinned === "1";

    function load() {
      try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); }
      catch (e) { return []; }
    }
    function save(tabs) {
      try { localStorage.setItem(storageKey, JSON.stringify(tabs)); }
      catch (e) {}
    }

    var tabs = load();

    if (currentUrl && currentType && currentLabel) {
      var existingIdx = -1;
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].url === currentUrl) { existingIdx = i; break; }
      }
      if (existingIdx === -1) {
        tabs.push({
          url: currentUrl,
          type: currentType,
          label: currentLabel,
          pinned: currentPinned,
        });
        save(tabs);
      } else if (!tabs[existingIdx].pinned && currentPinned) {
        tabs[existingIdx].pinned = true;
        save(tabs);
      }
    }

    function render() {
      strip.innerHTML = "";
      tabs.forEach(function (t, idx) {
        var pill = document.createElement("a");
        pill.className = "tab-pill";
        if (t.url === currentUrl) pill.classList.add("active");
        pill.href = t.url;
        pill.title = t.url;

        var typeBadge = document.createElement("span");
        typeBadge.className = "tab-type tab-type-" + t.type;
        typeBadge.textContent = ({
          table: "T", query: "Q", erd: "E", root: "•",
        }[t.type] || "·");
        pill.appendChild(typeBadge);

        var label = document.createElement("span");
        label.className = "tab-label";
        label.textContent = t.label;
        pill.appendChild(label);

        if (!t.pinned) {
          var close = document.createElement("button");
          close.type = "button";
          close.className = "tab-close";
          close.title = "Close tab";
          close.textContent = "×";
          close.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            tabs.splice(idx, 1);
            save(tabs);
            if (t.url === currentUrl) {
              // Navigate to the remaining tab (or connection root)
              var fallback = tabs.length
                ? tabs[Math.max(0, idx - 1)].url
                : "/connections/" + connId + "/tables";
              window.location.href = fallback;
            } else {
              render();
            }
          });
          pill.appendChild(close);
        }

        strip.appendChild(pill);
      });
    }

    render();
  })();

  // ── Sidebar filter ─────────────────────────────────────────────────────────
  var sidebarFilter = document.getElementById("sidebar-filter");
  if (sidebarFilter) {
    sidebarFilter.addEventListener("input", function () {
      var query = sidebarFilter.value.toLowerCase();
      document.querySelectorAll(".conn-tree-item").forEach(function (item) {
        var link = item.querySelector(".conn-link");
        var name = link ? link.dataset.name || "" : "";
        item.style.display = name.indexOf(query) !== -1 ? "" : "none";
      });
    });
  }

  function parseCellValue(cell) {
    if (cell.dataset.null === "true") return null;
    if (cell.classList.contains("json-cell")) {
      var rawJson = cell.dataset.json || "";
      try {
        return JSON.stringify(JSON.parse(rawJson), null, 2);
      } catch (e) {
        return rawJson;
      }
    }
    return cell.getAttribute("title") || cell.textContent.trim();
  }

  // ── Ctrl+Enter submits the query form ──────────────────────────────────────
  var textarea = document.getElementById("query-textarea");
  var queryForm = document.getElementById("query-form");
  if (textarea && queryForm) {
    textarea.addEventListener("keydown", function (e) {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        queryForm.submit();
      }
    });
  }

  // ── Query history (server-rendered; click to load, absolute timestamps) ──
  if (textarea) {
    function formatTimestamp(ts) {
      var d = new Date(ts);
      var now = new Date();
      var sameDay = d.toDateString() === now.toDateString();
      var timeStr = d.toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
      if (sameDay) return "Today " + timeStr;
      var sameYear = d.getFullYear() === now.getFullYear();
      var dateStr = d.toLocaleDateString([], sameYear
        ? { month: "short", day: "numeric" }
        : { year: "numeric", month: "short", day: "numeric" });
      return dateStr + " " + timeStr;
    }

    document.querySelectorAll(".query-history-time").forEach(function (el) {
      var ts = parseInt(el.dataset.ts || "0", 10);
      if (ts) {
        var d = new Date(ts);
        el.textContent = formatTimestamp(ts);
        el.title = d.toLocaleString();
      }
    });

    document.querySelectorAll(".query-history-item").forEach(function (li) {
      li.addEventListener("click", function (e) {
        if (e.target.closest(".query-history-delete-form")) return;
        textarea.value = li.dataset.query || "";
        textarea.focus();
      });
    });
  }

  // ── Connection form: show/hide field groups based on db_type ──────────────
  var dbSelect = document.getElementById("db_type_select");
  if (dbSelect) {
    function updateFieldGroups() {
      var selected = dbSelect.value;
      document.querySelectorAll(".field-group").forEach(function (group) {
        var forTypes = (group.dataset.for || "").split(" ");
        group.style.display = forTypes.includes(selected) ? "" : "none";
      });
    }
    dbSelect.addEventListener("change", updateFieldGroups);
    updateFieldGroups(); // run immediately for edit form pre-selection
  }

  // ── Record modal for row details ───────────────────────────────────────────
  var recordModal = document.getElementById("record-modal");
  var recordModalFields = document.getElementById("record-modal-fields");

  var recordModalForm = document.getElementById("record-modal-form");

  function renderRecordField(label, value, dataType, colMeta, dbType) {
    colMeta = colMeta || {};
    var isSql = dbType === "postgresql" || dbType === "mysql" || dbType === "sqlite";
    var isPk = !!colMeta.primary_key;
    var isNullable = colMeta.nullable !== false;
    // Non-SQL: identify by _id (mongo) or HASH/RANGE (dynamo)
    var isIdentity = isPk || (!isSql && (label === "_id" || colMeta.key_type));

    var field = document.createElement("div");
    field.className = "record-field";

    var fieldHeader = document.createElement("div");
    fieldHeader.className = "record-field-header";

    var fieldLabel = document.createElement("label");
    fieldLabel.className = "record-field-label";
    fieldLabel.textContent = label;
    fieldHeader.appendChild(fieldLabel);

    if (dataType) {
      var fieldType = document.createElement("span");
      fieldType.className = "record-field-type";
      fieldType.textContent = dataType;
      fieldHeader.appendChild(fieldType);
    }

    if (isIdentity) {
      var pkBadge = document.createElement("span");
      pkBadge.className = "record-field-badge";
      pkBadge.textContent = isPk ? "PK" : (colMeta.key_type || "KEY");
      fieldHeader.appendChild(pkBadge);
    }

    field.appendChild(fieldHeader);

    var isNull = value === null;
    var rawValue = isNull ? "" : value;
    var useTextarea = rawValue.indexOf("\n") !== -1 || rawValue.length > 120;
    var input = document.createElement(useTextarea ? "textarea" : "input");

    input.className = "record-field-input";
    input.spellcheck = false;
    input.value = rawValue;
    if (useTextarea) {
      input.rows = Math.min(Math.max(rawValue.split("\n").length, 3), 12);
    } else {
      input.type = "text";
    }

    if (isIdentity) {
      input.readOnly = true;
      input.name = "identity_" + label;
    } else {
      input.name = "val_" + label;
    }

    var row = document.createElement("div");
    row.className = "record-field-row";
    row.appendChild(input);

    if (!isIdentity && isSql && isNullable) {
      var toggle = document.createElement("label");
      toggle.className = "record-null-toggle";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.name = "null_col";
      cb.value = label;
      toggle.appendChild(cb);
      toggle.appendChild(document.createTextNode(" NULL"));
      function applyNullState() {
        if (cb.checked) {
          if (!input.disabled) input.dataset.prevValue = input.value;
          input.value = "";
          input.disabled = true;
          input.placeholder = "NULL";
        } else {
          input.disabled = false;
          input.value = input.dataset.prevValue || "";
          input.placeholder = "";
        }
      }
      cb.addEventListener("change", applyNullState);
      if (isNull) {
        cb.checked = true;
        applyNullState();
      }
      row.appendChild(toggle);
    }

    field.appendChild(row);
    return field;
  }

  function openRecordModal(row) {
    if (!recordModal || !recordModalFields) return;

    var table = row.closest("table");
    if (!table) return;

    var headers = Array.from(table.querySelectorAll("thead th")).map(function (th) {
      return th.textContent.trim();
    });
    var columnTypes = {};
    try {
      columnTypes = JSON.parse(table.dataset.columnTypes || "{}");
    } catch (e) {
      columnTypes = {};
    }
    var schemaArr = [];
    try {
      schemaArr = JSON.parse(table.dataset.schema || "[]");
    } catch (e) {
      schemaArr = [];
    }
    var schemaByName = {};
    schemaArr.forEach(function (c) { schemaByName[c.name] = c; });
    var dbType = table.dataset.dbType || "";
    var updateUrl = table.dataset.updateUrl || "";

    if (recordModalForm) {
      recordModalForm.setAttribute("action", updateUrl);
    }

    var cells = Array.from(row.querySelectorAll("td"));

    recordModalFields.innerHTML = "";
    cells.forEach(function (cell, index) {
      var label = headers[index] || "Field " + (index + 1);
      recordModalFields.appendChild(
        renderRecordField(
          label,
          parseCellValue(cell),
          columnTypes[label] || "Unknown",
          schemaByName[label],
          dbType
        )
      );
    });

    recordModal.hidden = false;
    var firstField = recordModalFields.querySelector(
      ".record-field-input:not([readonly])"
    ) || recordModalFields.querySelector(".record-field-input");
    if (firstField) firstField.focus();
  }

  function closeRecordModal() {
    if (recordModal) {
      recordModal.hidden = true;
    }
  }

  if (recordModal) {
    document.getElementById("record-modal-close")
      .addEventListener("click", closeRecordModal);

    var recordCancel = document.getElementById("record-modal-cancel");
    if (recordCancel) recordCancel.addEventListener("click", closeRecordModal);

    document.querySelector(".record-modal-backdrop")
      .addEventListener("click", closeRecordModal);
  }

  document.querySelectorAll(".record-row").forEach(function (row) {
    row.addEventListener("click", function (e) {
      if (e.target.closest(".json-cell")) return;
      openRecordModal(row);
    });
  });

  // ── Metadata modal ────────────────────────────────────────────────────────
  var metadataModal = document.getElementById("metadata-modal");
  var metadataOpen = document.getElementById("metadata-open");
  var metadataCopy = document.getElementById("metadata-modal-copy");

  function openMetadataModal() {
    if (metadataModal) metadataModal.hidden = false;
  }

  function closeMetadataModal() {
    if (metadataModal) metadataModal.hidden = true;
  }

  if (metadataModal && metadataOpen) {
    metadataOpen.addEventListener("click", openMetadataModal);
    document.getElementById("metadata-modal-close")
      .addEventListener("click", closeMetadataModal);
    document.querySelector(".metadata-modal-backdrop")
      .addEventListener("click", closeMetadataModal);
  }

  function buildMetadataText() {
    if (!metadataModal) return "";
    var lines = [];

    var title = document.getElementById("metadata-modal-title");
    if (title) lines.push("Table: " + title.textContent.trim());

    var gridItems = metadataModal.querySelectorAll(".metadata-item");
    gridItems.forEach(function (item) {
      var label = item.querySelector(".metadata-label");
      var value = item.querySelector(".metadata-value");
      if (label && value) {
        lines.push(label.textContent.trim() + ": " + value.textContent.trim());
      }
    });

    var columnCards = metadataModal.querySelectorAll(".metadata-col-card");
    if (columnCards.length) {
      lines.push("");
      lines.push("Columns:");
      columnCards.forEach(function (card) {
        var name = card.querySelector(".metadata-col-name");
        var type = card.querySelector(".metadata-col-type");
        var meta = card.querySelector(".metadata-col-meta");
        var badges = Array.from(card.querySelectorAll(".metadata-col-badge")).map(function (b) {
          return b.textContent.trim();
        });
        var parts = [];
        if (type) parts.push(type.textContent.trim().replace(/\s+/g, " "));
        if (meta) parts.push(meta.textContent.trim().replace(/\s+/g, " "));
        if (badges.length) parts.push("[" + badges.join(", ") + "]");
        lines.push("- " + (name ? name.textContent.trim() : "Column") + " — " + parts.join(" "));
      });
    }

    return lines.join("\n").trim();
  }

  function copyMetadataToClipboard() {
    var text = buildMetadataText();
    if (!text) return;

    function showCopiedState() {
      if (!metadataCopy) return;
      var original = metadataCopy.textContent;
      metadataCopy.textContent = "Copied";
      metadataCopy.disabled = true;
      setTimeout(function () {
        metadataCopy.textContent = original;
        metadataCopy.disabled = false;
      }, 1400);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(showCopiedState)
        .catch(function () {});
      return;
    }

    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      showCopiedState();
    } catch (e) {}
    document.body.removeChild(textarea);
  }

  if (metadataCopy) {
    metadataCopy.addEventListener("click", copyMetadataToClipboard);
  }

  // ── Insert row modal ──────────────────────────────────────────────────────
  var insertModal = document.getElementById("insert-modal");
  var insertOpen = document.getElementById("insert-open");

  function openInsertModal() {
    if (insertModal) insertModal.hidden = false;
  }

  function closeInsertModal() {
    if (insertModal) insertModal.hidden = true;
  }

  if (insertModal && insertOpen) {
    insertOpen.addEventListener("click", openInsertModal);
    document.getElementById("insert-modal-close")
      .addEventListener("click", closeInsertModal);
    document.getElementById("insert-modal-cancel")
      .addEventListener("click", closeInsertModal);
    document.querySelector(".insert-modal-backdrop")
      .addEventListener("click", closeInsertModal);

    insertModal.querySelectorAll(".insert-null-toggle input").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var row = cb.closest(".insert-field");
        var input = row ? row.querySelector("input[type=text]") : null;
        if (!input) return;
        if (cb.checked) {
          input.dataset.prevValue = input.value;
          input.value = "";
          input.disabled = true;
          input.placeholder = "NULL";
        } else {
          input.disabled = false;
          input.value = input.dataset.prevValue || "";
        }
      });
    });
  }

  // ── JSON cell → modal ──────────────────────────────────────────────────────
  var jsonModal    = document.getElementById("json-modal");
  var jsonTextarea = document.getElementById("json-modal-textarea");

  function openJsonModal(raw) {
    var pretty;
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2);
    } catch (e) {
      pretty = raw; // not valid JSON — show as-is
    }
    jsonTextarea.value = pretty;
    jsonModal.hidden = false;
    jsonTextarea.focus();
  }

  function closeJsonModal() {
    jsonModal.hidden = true;
  }

  if (jsonModal) {
    document.getElementById("json-modal-close")
      .addEventListener("click", closeJsonModal);

    document.querySelector(".json-modal-backdrop")
      .addEventListener("click", closeJsonModal);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (recordModal && !recordModal.hidden) closeRecordModal();
      if (metadataModal && !metadataModal.hidden) closeMetadataModal();
      if (insertModal && !insertModal.hidden) closeInsertModal();
      if (!jsonModal.hidden) closeJsonModal();
    });
  }

  // Attach to any json-cells on the page
  document.querySelectorAll(".json-cell").forEach(function (td) {
    td.addEventListener("click", function () {
      openJsonModal(td.dataset.json);
    });
  });

  // ── Advanced filter modal ─────────────────────────────────────────────────
  var advModal = document.getElementById("adv-filter-modal");
  var advOpen = document.getElementById("adv-filter-open");
  var advHidden = document.getElementById("adv-filters-input");
  var filterForm = document.getElementById("filter-bar-form");

  if (advModal && advOpen && advHidden && filterForm) {
    var advColumns = [];
    try { advColumns = JSON.parse(advModal.dataset.columns || "[]"); } catch (e) {}
    var advInitial = { combinator: "AND", conditions: [] };
    try { advInitial = JSON.parse(advModal.dataset.initial || "{}"); } catch (e) {}

    var advRowsEl = document.getElementById("adv-filter-rows");
    var advAdd = document.getElementById("adv-filter-add");
    var advApply = document.getElementById("adv-filter-apply");
    var advCancel = document.getElementById("adv-filter-cancel");
    var advReset = document.getElementById("adv-filter-reset");
    var advClose = document.getElementById("adv-filter-close");
    var advBackdrop = advModal.querySelector(".adv-filter-backdrop");

    // [label, value, needs-value, needs-two-values]
    var OPS = [
      ["equals (=)",         "=",            true,  false],
      ["not equals (!=)",    "!=",           true,  false],
      ["greater than (>)",   ">",            true,  false],
      ["less than (<)",      "<",            true,  false],
      ["≥",                  ">=",           true,  false],
      ["≤",                  "<=",           true,  false],
      ["contains",           "contains",     true,  false],
      ["does not contain",   "not_contains", true,  false],
      ["starts with",        "starts_with",  true,  false],
      ["ends with",          "ends_with",    true,  false],
      ["LIKE (raw % wildcard)", "like",      true,  false],
      ["ILIKE (case-insensitive)", "ilike",  true,  false],
      ["regex match",        "regex",        true,  false],
      ["regex not match",    "not_regex",    true,  false],
      ["in (comma-separated)", "in",         true,  false],
      ["not in (comma-sep)", "not_in",       true,  false],
      ["between",            "between",      true,  true],
      ["is null",            "is_null",      false, false],
      ["is not null",        "is_not_null",  false, false],
    ];

    function buildRow(cond) {
      cond = cond || { column: "", op: "=", value: "", value2: "" };

      var row = document.createElement("div");
      row.className = "adv-filter-row";

      var colSel = document.createElement("select");
      colSel.className = "adv-col";
      var blank = document.createElement("option");
      blank.value = ""; blank.textContent = "— column —";
      colSel.appendChild(blank);
      advColumns.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c; o.textContent = c;
        if (cond.column === c) o.selected = true;
        colSel.appendChild(o);
      });

      var opSel = document.createElement("select");
      opSel.className = "adv-op";
      OPS.forEach(function (op) {
        var o = document.createElement("option");
        o.value = op[1]; o.textContent = op[0];
        if (cond.op === op[1]) o.selected = true;
        opSel.appendChild(o);
      });

      var valInput = document.createElement("input");
      valInput.type = "text";
      valInput.className = "adv-val";
      valInput.placeholder = "value";
      valInput.value = cond.value != null ? cond.value : "";

      var val2Input = document.createElement("input");
      val2Input.type = "text";
      val2Input.className = "adv-val2";
      val2Input.placeholder = "and";
      val2Input.value = cond.value2 != null ? cond.value2 : "";

      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "adv-rm";
      rm.title = "Remove condition";
      rm.textContent = "×";
      rm.addEventListener("click", function () {
        row.remove();
      });

      function syncInputs() {
        var sel = OPS.find(function (o) { return o[1] === opSel.value; });
        var needsVal = sel ? sel[2] : true;
        var needsTwo = sel ? sel[3] : false;
        valInput.style.display = needsVal ? "" : "none";
        val2Input.style.display = needsTwo ? "" : "none";
      }
      opSel.addEventListener("change", syncInputs);

      row.appendChild(colSel);
      row.appendChild(opSel);
      row.appendChild(valInput);
      row.appendChild(val2Input);
      row.appendChild(rm);
      advRowsEl.appendChild(row);
      syncInputs();
      return row;
    }

    function populate(state) {
      advRowsEl.innerHTML = "";
      var combinator = (state && state.combinator) || "AND";
      advModal.querySelectorAll("input[name='adv-combinator']").forEach(function (r) {
        r.checked = r.value === combinator;
      });
      var conds = (state && state.conditions) || [];
      if (!conds.length) {
        buildRow();
      } else {
        conds.forEach(function (c) { buildRow(c); });
      }
    }

    function collect() {
      var combinator = "AND";
      var sel = advModal.querySelector("input[name='adv-combinator']:checked");
      if (sel) combinator = sel.value;

      var conds = [];
      advRowsEl.querySelectorAll(".adv-filter-row").forEach(function (row) {
        var col = row.querySelector(".adv-col").value;
        var op = row.querySelector(".adv-op").value;
        var val = row.querySelector(".adv-val").value;
        var val2 = row.querySelector(".adv-val2").value;
        if (!col) return;
        var opDef = OPS.find(function (o) { return o[1] === op; });
        var needsVal = opDef ? opDef[2] : true;
        if (needsVal && val === "") return;
        var c = { column: col, op: op };
        if (needsVal) c.value = val;
        if (opDef && opDef[3]) c.value2 = val2;
        conds.push(c);
      });
      return { combinator: combinator, conditions: conds };
    }

    function openAdv() {
      var current = advInitial;
      // If user typed something in the simple bar already, don't clobber it on open — but the simple form is still submitted.
      advModal.hidden = false;
      populate(current);
    }
    function closeAdv() { advModal.hidden = true; }

    advOpen.addEventListener("click", openAdv);
    advClose.addEventListener("click", closeAdv);
    advCancel.addEventListener("click", closeAdv);
    advBackdrop.addEventListener("click", closeAdv);

    advAdd.addEventListener("click", function () { buildRow(); });
    advReset.addEventListener("click", function () {
      advRowsEl.innerHTML = "";
      buildRow();
    });

    advApply.addEventListener("click", function () {
      var state = collect();
      if (!state.conditions.length) {
        advHidden.value = "";
      } else {
        advHidden.value = JSON.stringify(state);
        // When advanced filter is active, clear simple-filter fields so
        // they don't shadow it in the URL.
        var simpleCol = filterForm.querySelector("select[name='filter_col']");
        var simpleOp = filterForm.querySelector("select[name='filter_op']");
        var simpleVal = filterForm.querySelector("input[name='filter_val']");
        if (simpleCol) simpleCol.value = "";
        if (simpleOp) simpleOp.value = "=";
        if (simpleVal) simpleVal.value = "";
      }
      closeAdv();
      filterForm.submit();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !advModal.hidden) closeAdv();
    });
  }

  // ── Test connection buttons (AJAX) ─────────────────────────────────────────
  document.querySelectorAll(".btn-test").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var connId = btn.dataset.connId;
      var originalText = btn.textContent;
      btn.textContent = "Testing…";
      btn.disabled = true;
      btn.className = btn.className.replace(/\b(success|error)\b/g, "").trim();

      fetch("/connections/" + connId + "/test", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            btn.textContent = "✓ OK";
            btn.classList.add("success");
          } else {
            btn.textContent = "✗ Failed";
            btn.classList.add("error");
            if (data.error) {
              alert("Connection failed:\n" + data.error);
            }
          }
        })
        .catch(function () {
          btn.textContent = "✗ Error";
          btn.classList.add("error");
        })
        .finally(function () {
          btn.disabled = false;
          // Reset label after 4 seconds
          setTimeout(function () {
            btn.textContent = originalText;
            btn.className = btn.className.replace(/\b(success|error)\b/g, "").trim();
          }, 4000);
        });
    });
  });

});
