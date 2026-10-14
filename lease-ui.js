/*
 * Canopy agricultural lease screen: browser UI.
 * All user text is rendered with textContent / form values only. No user
 * string is ever assigned to innerHTML.
 */
(function(){
  'use strict';
  const C = window.LeaseCore;
  const root = document.getElementById('lease');
  if(!C || !root) return;

  const $ = id => document.getElementById(id);
  function el(tag, attrs, children){
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if(v === null || v === undefined || v === false) return;
      if(k === 'class') n.className = v;
      else if(k === 'text') n.textContent = v;
      else if(k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if(k in n && k !== 'list' && k !== 'form') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach(c => { if(c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return n;
  }

  // ------------------------------------------------------------ storage
  let storageOk = true;
  let store;
  function loadStore(){
    let text = null;
    try { text = window.localStorage.getItem(C.STORAGE_KEY); } catch(e){ storageOk = false; }
    const { store: s, warning } = C.parseStore(text);
    store = s;
    if(warning) notify(warning, 'warn');
    if(!storageOk) notify('This browser blocks local storage, so lease screens will not be saved after you leave the page.', 'warn');
  }
  let saveTimer = null;
  function saveNow(){
    clearTimeout(saveTimer);
    if(!storageOk) return;
    try { window.localStorage.setItem(C.STORAGE_KEY, JSON.stringify(store)); }
    catch(e){ notify('Could not save to this browser\u2019s storage (it may be full). Download JSON to keep a copy.', 'warn'); }
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); };

  const current = () => store.records[store.currentId];
  function setCurrent(rec){
    store.records[rec.id] = rec;
    store.currentId = rec.id;
  }
  function touch(rec){ rec.updatedAt = new Date().toISOString(); }

  // ------------------------------------------------------------ notices
  function notify(text, tone){
    const box = $('ls-alert');
    if(!box) return;
    box.replaceChildren(el('p', { class: 'ls-notice ls-notice-' + (tone || 'info'), text }));
  }

  // ------------------------------------------------------------ toolbar
  function renderToolbar(){
    const sel = $('ls-record');
    sel.replaceChildren(...Object.values(store.records)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map(r => el('option', { value: r.id, text: (r.isDemo ? '[Fictional] ' : '') + ((r.inputs.propertyName || '').trim() || 'Untitled property') + ' \u00b7 ' + r.id })));
    sel.value = store.currentId;
  }

  // ------------------------------------------------------------ step 1: parcel
  let lastScan = window.CanopyLastScan || null;
  function renderParcel(){
    const rec = current();
    const box = $('ls-parcel-body');
    const kids = [];
    if(rec.isDemo){
      kids.push(el('p', { class: 'ls-muted', text: 'Fictional example. Parcel observations are never attached to demo screens, so the memo shows them as missing.' }));
    } else if(rec.parcel){
      const ok = rec.parcel.observations.filter(o => o.status === 'ok').length;
      kids.push(el('p', {}, [el('strong', { text: rec.parcel.label || 'Attached scan' }), ' \u00b7 scanned ' + (rec.parcel.scannedAt || '') + ' \u00b7 ' + ok + ' of ' + rec.parcel.observations.length + ' observations retrieved']));
    } else {
      kids.push(el('p', { class: 'ls-muted', text: 'No parcel scan attached. You can fill in lease terms now; the memo will list parcel observations as missing and hold the screen until a scan is attached.' }));
    }
    const actions = el('div', { class: 'ls-actions' });
    if(!rec.isDemo){
      const isAttached = rec.parcel && lastScan && rec.parcel.scannedAt === lastScan.scannedAt;
      actions.append(el('button', { type: 'button', class: 'ls-btn', disabled: !lastScan || isAttached,
        text: isAttached ? 'Latest scan attached' : lastScan ? 'Attach latest scan (' + (lastScan.label || 'scan') + ')' : 'Attach latest scan',
        onclick: attachScan }));
      if(rec.parcel) actions.append(el('button', { type: 'button', class: 'ls-btn ls-btn-quiet', text: 'Detach scan', onclick: detachScan }));
    }
    actions.append(el('a', { class: 'ls-btn ls-btn-quiet', href: '#demo', text: 'Go to parcel scan' }));
    if(!lastScan && !rec.isDemo) kids.push(el('p', { class: 'ls-hint', text: 'Run a scan in the parcel scan section first; it will appear here.' }));
    kids.push(actions);
    box.replaceChildren(...kids);
  }
  function attachScan(){
    const rec = current();
    if(!lastScan || rec.isDemo) return;
    if(rec.parcel && !confirm('Replace the attached scan (' + (rec.parcel.label || 'scan') + ') with the latest one?')) return;
    rec.parcel = JSON.parse(JSON.stringify(lastScan));
    afterDataChange(rec, 'Scan attached.');
  }
  function detachScan(){
    const rec = current();
    if(!confirm('Detach the parcel scan from this screen?')) return;
    rec.parcel = null;
    afterDataChange(rec, 'Scan detached.');
  }
  // Parcel, task or conflict changes re-run screening immediately.
  function afterDataChange(rec, msg){
    const { values } = C.validateInputs(rec.inputs);
    if(rec.generatedAt) rec.screening = C.screen(values, rec.tasks, rec.parcel, rec.conflicts);
    touch(rec); saveNow();
    renderParcel(); renderReport();
    if(msg) notify(msg, 'info');
  }
  document.addEventListener('canopy:scan', e => {
    lastScan = e.detail;
    renderParcel();
    const rec = current();
    if(rec && !rec.isDemo) notify('New parcel scan available (' + (lastScan.label || 'scan') + '). Attach it in step 1 if it belongs to this screen.', 'info');
  });

  // ------------------------------------------------------------ step 2: form
  function buildForm(){
    const form = $('ls-form-body');
    form.replaceChildren(...C.FORM_SCHEMA.map(group => {
      const fs = el('fieldset', { class: 'ls-group' }, [el('legend', { text: group.title })]);
      const grid = el('div', { class: 'ls-fields' });
      group.fields.forEach(f => {
        const id = 'ls-in-' + f.key;
        const helpId = f.help ? id + '-help' : null;
        const errId = id + '-err';
        let control;
        if(f.type === 'fixed'){
          grid.append(el('div', { class: 'ls-field' }, [el('span', { class: 'ls-label', text: f.label }), el('p', { class: 'ls-fixed', text: f.value })]));
          return;
        }
        if(f.type === 'select'){
          control = el('select', { id, name: f.key }, C.OPTIONS[f.key].map(o => el('option', { value: o[0], text: o[1] })));
        } else if(f.type === 'textarea'){
          control = el('textarea', { id, name: f.key, rows: 3, maxLength: 4000 });
        } else {
          control = el('input', { id, name: f.key, type: f.type === 'date' ? 'date' : 'text', inputMode: f.type === 'num' ? 'decimal' : null, autocomplete: 'off', maxLength: f.type === 'text' ? 300 : null });
        }
        control.setAttribute('aria-describedby', [helpId, errId].filter(Boolean).join(' '));
        control.addEventListener(f.type === 'select' || f.type === 'date' ? 'change' : 'input', () => onInput(f, control));
        if(f.type === 'num') control.addEventListener('blur', () => showFieldError(f.key, C.validateInputs(current().inputs).errors[f.key]));
        grid.append(el('div', { class: 'ls-field' + (f.wide ? ' ls-wide' : '') }, [
          el('label', { for: id, text: f.label }),
          control,
          f.help ? el('p', { class: 'ls-help', id: helpId, text: f.help }) : null,
          el('p', { class: 'ls-error', id: errId })
        ]));
      });
      fs.append(grid);
      return fs;
    }));
  }
  function fillForm(){
    const rec = current();
    C.FIELDS.forEach(f => { const c = $('ls-in-' + f.key); if(c) c.value = rec.inputs[f.key] ?? ''; showFieldError(f.key, null); });
    updateRentHelp();
    $('ls-errors').replaceChildren();
    $('ls-errors').hidden = true;
  }
  function updateRentHelp(){
    const help = $('ls-in-rentAmount-help');
    if(help) help.textContent = current().inputs.rentBasis === 'flat' ? 'Flat dollars per year.' : 'Dollars per charged acre per year.';
  }
  function showFieldError(key, msg){
    const c = $('ls-in-' + key), e = $('ls-in-' + key + '-err');
    if(!c || !e) return;
    e.textContent = msg || '';
    if(msg) c.setAttribute('aria-invalid', 'true'); else c.removeAttribute('aria-invalid');
  }
  function onInput(f, control){
    const rec = current();
    rec.inputs[f.key] = control.value;
    touch(rec);
    if(f.key === 'rentBasis') updateRentHelp();
    if(f.key === 'propertyName') renderToolbar();
    if(f.type !== 'num') showFieldError(f.key, null);
    else if(!C.validateInputs(rec.inputs).errors[f.key]) showFieldError(f.key, null);
    saveSoon();
    renderStale();
  }
  function onGenerate(ev){
    ev.preventDefault();
    const rec = current();
    const { errors } = C.validateInputs(rec.inputs);
    C.FIELDS.forEach(f => showFieldError(f.key, errors[f.key]));
    const box = $('ls-errors');
    const keys = Object.keys(errors);
    if(keys.length){
      const fieldLabel = k => (C.FIELDS.find(f => f.key === k) || {}).label || k;
      box.replaceChildren(el('p', { text: 'Fix ' + keys.length + ' field' + (keys.length > 1 ? 's' : '') + ' before generating:' }),
        el('ul', {}, keys.map(k => el('li', {}, [el('a', { href: '#ls-in-' + k, text: fieldLabel(k) + ': ' + errors[k],
          onclick: e => { e.preventDefault(); $('ls-in-' + k).focus(); } })]))));
      box.hidden = false;
      box.focus();
      return;
    }
    box.hidden = true;
    const next = C.generate(rec);
    setCurrent(next);
    saveNow();
    renderReport(); renderTasks();
    notify('Memo generated. Screening status: ' + next.screening.label + '.', 'info');
    $('ls-report').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------ step 3: report
  function renderBlock(b){
    if(b.p) return el('p', { text: b.p });
    if(b.note) return el('p', { class: 'ls-notice ls-notice-' + (b.tone || 'info'), text: b.note });
    if(b.status) return el('p', { class: 'ls-status ls-status-' + b.status }, [el('span', { class: 'ls-status-mark', 'aria-hidden': 'true' }), el('span', { text: b.label })]);
    if(b.list) return el('ul', { class: 'ls-list' }, b.list.map(x => el('li', { text: x })));
    if(b.kv) return el('dl', { class: 'ls-kv' }, b.kv.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));
    if(b.quote) return el('figure', { class: 'ls-quote' }, [el('blockquote', { text: b.quote }), el('figcaption', { text: b.caption })]);
    if(b.table) return el('div', { class: 'ls-table-wrap', tabIndex: 0, role: 'region', 'aria-label': 'Table' }, [
      el('table', { class: 'ls-table' }, [
        el('thead', {}, [el('tr', {}, b.table.head.map(h => el('th', { scope: 'col', text: h })))]),
        el('tbody', {}, b.table.rows.map(r => el('tr', {}, r.map((c, i) => i === 0 ? el('th', { scope: 'row', text: c }) : el('td', { text: c })))))
      ])]);
    return null;
  }
  function renderStale(){
    const rec = current();
    const s = $('ls-stale');
    if(!s) return;
    s.hidden = !(rec.generatedAt && C.inputsChangedSinceGenerate(rec));
  }
  function renderReport(){
    const rec = current();
    const out = $('ls-report-body');
    renderStale();
    const exportBtns = ['ls-print', 'ls-md', 'ls-json'].map($);
    if(!rec.generatedAt){
      out.replaceChildren(el('p', { class: 'ls-empty', text: 'Enter lease terms in step 2 and select Generate memo. You can generate before attaching a scan; missing observations are listed in the memo.' }));
      exportBtns.forEach(b => b.disabled = true);
      return;
    }
    exportBtns.forEach(b => b.disabled = false);
    const memo = C.buildMemo(rec);
    const doc = el('article', { class: 'ls-memo', 'aria-labelledby': 'ls-memo-title' }, [
      el('h3', { id: 'ls-memo-title', class: 'ls-memo-title', text: 'Agricultural lease screen: ' + memo.title }),
      ...memo.header.map(renderBlock)
    ]);
    memo.sections.forEach(s => doc.append(el('section', { class: 'ls-sec' }, [el('h4', { text: s.title }), ...s.blocks.map(renderBlock)])));
    const app = el('div', { class: 'ls-appendix' }, [
      el('div', { class: 'ls-appendix-head' }, [
        el('h4', { text: 'Supporting appendix' }),
        el('div', { class: 'ls-actions ls-noprint' }, [
          el('button', { type: 'button', class: 'ls-btn ls-btn-quiet', text: 'Expand all', onclick: () => app.querySelectorAll('details').forEach(d => d.open = true) }),
          el('button', { type: 'button', class: 'ls-btn ls-btn-quiet', text: 'Collapse all', onclick: () => app.querySelectorAll('details').forEach(d => d.open = false) })
        ])
      ])
    ]);
    memo.appendix.forEach(s => app.append(el('details', { class: 'ls-details', open: s.id === 'G' }, [el('summary', { text: s.title }), ...s.blocks.map(renderBlock)])));
    doc.append(app);
    doc.append(el('p', { class: 'ls-foot', text: 'Generated by the Canopy prototype. Saved reports may contain commercially sensitive information.' }));
    out.replaceChildren(doc);
  }

  // ------------------------------------------------------------ step 4: tasks
  function setTask(id, patch){
    const rec = current();
    rec.tasks = rec.tasks.map(t => t.id === id ? C.updateTask(t, patch) : t);
    afterDataChange(rec);
    const t = rec.tasks.find(x => x.id === id);
    const flag = $('ls-task-flag-' + id);
    if(flag && t) flag.textContent = taskFlags(t);
    const crit = $('ls-task-crit-' + id);
    if(crit && t) crit.checked = t.critical;
  }
  function taskFlags(t){
    return [t.stale && 'No longer triggered by current inputs; kept because you edited it.', C.resolutionProblem(t)].filter(Boolean).join(' ');
  }
  function renderTasks(){
    const rec = current();
    const box = $('ls-tasks-body');
    if(!rec.generatedAt || !rec.tasks.length){
      box.replaceChildren(el('p', { class: 'ls-empty', text: 'Tasks appear after you generate the memo.' }));
      return;
    }
    const intro = el('p', { class: 'ls-muted', text: 'Move each task through Requested, Document received, Reviewed and Resolved. A task only counts as resolved when it has a reviewer and a resolution basis. These are your recorded conclusions, not Canopy certifications. If inputs change after a review, the conclusion is marked outdated.' });
    const list = el('ol', { class: 'ls-tasklist' }, rec.tasks.map(t => {
      const pre = 'ls-task-' + t.id + '-';
      const field = (key, lbl, control) => { control.id = pre + key; return el('div', { class: 'ls-field' }, [el('label', { for: control.id, text: lbl }), control]); };
      const text = (key, lbl, opts) => field(key, lbl, el(opts && opts.area ? 'textarea' : 'input', Object.assign({ value: t[key] || '', rows: opts && opts.area ? 2 : null, maxLength: 2000,
        type: opts && opts.date ? 'date' : (opts && opts.area ? null : 'text'),
        onchange: e => setTask(t.id, { [key]: e.target.value }) })));
      const status = el('select', { onchange: e => setTask(t.id, { status: e.target.value }) }, C.TASK_STATUS.map(s => el('option', { value: s[0], text: s[1] })));
      status.value = t.status;
      const crit = el('input', { type: 'checkbox', id: 'ls-task-crit-' + t.id, checked: t.critical,
        onchange: e => setTask(t.id, { criticalOverride: e.target.checked === t.criticalByRule ? null : e.target.checked }) });
      return el('li', { class: 'ls-task' + (t.stale ? ' is-stale' : '') }, [
        el('div', { class: 'ls-task-head' }, [
          el('h5', { text: t.title }),
          el('span', { class: 'ls-pill', text: t.priority + ' priority' }),
          el('label', { class: 'ls-check', for: crit.id }, [crit, ' Critical' + (t.criticalByRule ? ' (set by rule)' : '')])
        ]),
        el('p', { class: 'ls-task-reason', text: t.reason }),
        el('div', { class: 'ls-fields' }, [
          text('owner', 'Owner'),
          field('status', 'Status', status),
          text('reviewer', 'Reviewer'),
          text('reviewDate', 'Review date', { date: true }),
          el('div', { class: 'ls-wide' }, [text('evidenceNote', 'Evidence note', { area: true })]),
          el('div', { class: 'ls-wide' }, [text('resolutionBasis', 'Resolution basis', { area: true })])
        ]),
        el('p', { class: 'ls-error', id: 'ls-task-flag-' + t.id, 'aria-live': 'polite', text: taskFlags(t) }),
        t.history && t.history.length ? el('details', { class: 'ls-history' }, [el('summary', { text: 'Status history (' + t.history.length + ')' }),
          el('ul', {}, t.history.map(h => el('li', { text: (h.at || '').replace('T', ' ').slice(0, 16) + ': ' + h.from + ' \u2192 ' + h.to + (h.by ? ' (' + h.by + ')' : '') })))]) : null
      ]);
    }));
    box.replaceChildren(intro, list, renderConflicts());
  }

  // Recorded conflicts drive "Does not meet stated requirements".
  function renderConflicts(){
    const rec = current();
    const wrap = el('div', { class: 'ls-conflicts' }, [
      el('h5', { text: 'Record a confirmed conflict with a requirement' }),
      el('p', { class: 'ls-muted', text: 'Only record facts you have confirmed (for example, from a survey or reviewed document), not owner statements or estimates. A recorded conflict sets the status to Does not meet stated requirements.' })
    ]);
    if(rec.conflicts.length) wrap.append(el('ul', { class: 'ls-list' }, rec.conflicts.map((c, i) => el('li', {}, [
      (c.fact || '') + '. Requirement: ' + (c.requirement || '') + ' (' + (c.recordedBy || '') + (c.date ? ', ' + c.date : '') + ') ',
      el('button', { type: 'button', class: 'ls-btn ls-btn-quiet ls-btn-small', text: 'Remove', 'aria-label': 'Remove recorded conflict ' + (i + 1),
        onclick: () => { if(confirm('Remove this recorded conflict?')){ rec.conflicts.splice(i, 1); afterDataChange(rec); renderTasks(); } } })
    ]))));
    const inputs = { requirement: el('input', { id: 'ls-cf-req', type: 'text', maxLength: 500 }), fact: el('input', { id: 'ls-cf-fact', type: 'text', maxLength: 500 }),
      recordedBy: el('input', { id: 'ls-cf-by', type: 'text', maxLength: 200 }), date: el('input', { id: 'ls-cf-date', type: 'date' }) };
    const confirmBox = el('input', { type: 'checkbox', id: 'ls-cf-ok' });
    const err = el('p', { class: 'ls-error', 'aria-live': 'polite' });
    wrap.append(el('div', { class: 'ls-fields' }, [
      el('div', { class: 'ls-field' }, [el('label', { for: 'ls-cf-req', text: 'Requirement' }), inputs.requirement]),
      el('div', { class: 'ls-field' }, [el('label', { for: 'ls-cf-fact', text: 'Confirmed fact' }), inputs.fact]),
      el('div', { class: 'ls-field' }, [el('label', { for: 'ls-cf-by', text: 'Recorded by' }), inputs.recordedBy]),
      el('div', { class: 'ls-field' }, [el('label', { for: 'ls-cf-date', text: 'Date' }), inputs.date])
    ]), el('label', { class: 'ls-check', for: 'ls-cf-ok' }, [confirmBox, ' I confirm this fact is verified, not an estimate or owner statement']), err,
    el('button', { type: 'button', class: 'ls-btn', text: 'Record conflict', onclick: () => {
      const c = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value.trim()]));
      if(!c.requirement || !c.fact || !c.recordedBy){ err.textContent = 'Enter the requirement, the confirmed fact and who recorded it.'; return; }
      if(!confirmBox.checked){ err.textContent = 'Tick the confirmation box to record a conflict.'; return; }
      rec.conflicts.push(c); afterDataChange(rec, 'Conflict recorded.'); renderTasks();
    } }));
    return wrap;
  }

  // ------------------------------------------------------------ step 5: export
  const safeName = rec => 'canopy-lease-screen-' + String(rec.id).replace(/[^A-Za-z0-9_-]/g, '');
  function download(name, mime, text){
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportMd(){ const rec = current(); download(safeName(rec) + '.md', 'text/markdown;charset=utf-8', C.toMarkdown(C.buildMemo(rec))); }
  function exportJson(){
    const rec = current();
    const memo = C.buildMemo(rec);
    download(safeName(rec) + '.json', 'application/json', JSON.stringify(Object.assign({}, rec, { screening: memo.result, evidence: memo.evidence,
      note: 'Canopy prototype lease screen. May contain commercially sensitive information.' }), null, 2));
  }
  let reopen = [];
  function printReport(){
    document.body.classList.add('print-lease');
    window.print();
  }
  window.addEventListener('beforeprint', () => {
    if(!document.body.classList.contains('print-lease')) return;
    reopen = [...root.querySelectorAll('#ls-report details:not([open])')];
    reopen.forEach(d => d.open = true);
  });
  window.addEventListener('afterprint', () => {
    reopen.forEach(d => d.open = false); reopen = [];
    document.body.classList.remove('print-lease');
  });

  // ------------------------------------------------------------ record actions
  function showRecord(){
    renderToolbar(); fillForm(); renderParcel(); renderReport(); renderTasks();
  }
  function newScreen(){
    const r = C.newRecord();
    setCurrent(r); saveNow(); showRecord();
    notify('New lease screen started.', 'info');
    $('ls-in-propertyName').focus();
  }
  function loadDemo(){
    const existing = Object.values(store.records).find(r => r.isDemo);
    if(existing && !confirm('A fictional example is already saved. Replace it with a fresh copy? Your other screens are not affected.')) return;
    if(existing) delete store.records[existing.id];
    setCurrent(C.demoRecord()); saveNow(); showRecord();
    notify(C.DEMO_LABEL + ' Loaded as a separate screen; no saved screen was overwritten.', 'warn');
  }
  function deleteScreen(){
    const rec = current();
    if(!confirm('Delete "' + ((rec.inputs.propertyName || '').trim() || 'Untitled property') + '" (' + rec.id + ') from this browser? This cannot be undone.')) return;
    delete store.records[rec.id];
    const next = Object.values(store.records)[0];
    if(next) store.currentId = next.id; else setCurrent(C.newRecord());
    saveNow(); showRecord();
    notify('Screen deleted.', 'info');
  }

  // ------------------------------------------------------------ init
  loadStore();
  if(!current()){ setCurrent(C.newRecord()); saveNow(); }
  buildForm();
  $('ls-form').addEventListener('submit', onGenerate);
  $('ls-record').addEventListener('change', e => { store.currentId = e.target.value; saveNow(); showRecord(); });
  $('ls-new').addEventListener('click', newScreen);
  $('ls-demo').addEventListener('click', loadDemo);
  $('ls-delete').addEventListener('click', deleteScreen);
  $('ls-print').addEventListener('click', printReport);
  $('ls-md').addEventListener('click', exportMd);
  $('ls-json').addEventListener('click', exportJson);
  showRecord();
})();
