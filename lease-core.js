/*
 * Canopy agricultural lease screen: core logic (no DOM).
 *
 * Everything here is a pure function so it can be tested in Node
 * (see tests/lease-core.test.js) and rendered safely by lease-ui.js.
 * Rules are deterministic and are printed in every memo.
 */
(function(root, factory){
  if(typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeaseCore = factory();
})(typeof self !== 'undefined' ? self : this, function(){
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'canopy.leaseScreen.v1';
  const DEMO_LABEL = 'Fictional example \u2014 not an actual parcel assessment.';
  const NO_DOC_NOTICE = 'No lease document reviewed. Term flags are based on user-entered information.';
  const EXCERPT_LABEL = 'User-provided excerpt; not independently verified.';

  const STATUS = {
    hold: 'Hold pending evidence',
    advance: 'Advance to further diligence',
    fail: 'Does not meet stated requirements'
  };

  // ---------------------------------------------------------------- options
  const RESP = [['unknown','Unknown'],['landlord','Landlord'],['tenant','Tenant'],['shared','Shared']];
  const OPTIONS = {
    currentUse: [['unknown','Unknown'],['row_crop','Row crop'],['orchard','Orchard / permanent crop'],['pasture','Pasture / grazing'],['vacant','Vacant']],
    leaseDocStatus: [['none','No lease document'],['received_not_reviewed','Document received, not reviewed'],['reviewed','Document reviewed by me or my advisor']],
    rentBasis: [['per_acre','Per charged acre'],['flat','Flat annual amount']],
    usableAcresBasis: [['unknown','Not stated'],['owner_statement','Owner or broker statement'],['map_estimate','Map or preliminary estimate'],['user_confirmed','Confirmed by me (survey, inspection or records)']],
    renewal: [['unknown','Unknown'],['none','None'],['option','Stated option'],['other','Other']],
    waterSource: [['unknown','Unknown'],['well','Well'],['surface','Surface delivery'],['other','Other']],
    waterEvidence: [['not_provided','Not provided'],['owner_statement','Owner statement only'],['received_not_reviewed','Documents received, not reviewed'],['reviewed','Reviewed']],
    irrigationRequired: [['unknown','Unknown'],['yes','Yes'],['no','No']],
    pumpingPower: RESP, waterCharges: RESP, routineMaint: RESP, majorRepairs: RESP
  };
  const label = (key, value) => {
    const hit = (OPTIONS[key] || []).find(o => o[0] === value);
    return hit ? hit[1] : (value || '');
  };

  // ------------------------------------------------------------ form schema
  // type: text | textarea | num | select | date | fixed
  const FORM_SCHEMA = [
    { id: 'operation', title: 'Operation', fields: [
      { key: 'currentUse', label: 'Current use', type: 'select' },
      { key: 'intendedUse', label: 'Intended agricultural use', type: 'text' },
      { key: 'context', label: 'Context', type: 'fixed', value: 'Lease screening' },
      { key: 'minUsableAcres', label: 'Minimum usable acreage (optional)', type: 'num', min: 0, unit: 'acres' },
      { key: 'requirements', label: 'Requirements and non-negotiables', type: 'textarea', wide: true,
        help: 'Shown in the memo as written. Canopy does not check free text automatically.' }
    ]},
    { id: 'lease', title: 'Lease', fields: [
      { key: 'propertyName', label: 'Property name', type: 'text' },
      { key: 'parcelId', label: 'Parcel identifier (optional)', type: 'text' },
      { key: 'landlord', label: 'Owner / landlord (optional)', type: 'text' },
      { key: 'tenant', label: 'Proposed tenant (optional)', type: 'text' },
      { key: 'leaseDocStatus', label: 'Lease document', type: 'select' },
      { key: 'termYears', label: 'Proposed term (years)', type: 'num', positive: true, max: 99, unit: 'years' },
      { key: 'startDate', label: 'Proposed start date (optional)', type: 'date' },
      { key: 'rentBasis', label: 'Annual rent basis', type: 'select' },
      { key: 'rentAmount', label: 'Rent amount ($)', type: 'num', min: 0, unit: '$',
        help: 'Per charged acre per year, or the flat annual amount, depending on the basis.' },
      { key: 'chargedAcres', label: 'Charged acreage', type: 'num', min: 0, unit: 'acres' },
      { key: 'usableAcres', label: 'Reported usable acreage (optional)', type: 'num', min: 0, unit: 'acres' },
      { key: 'usableAcresBasis', label: 'Usable acreage basis', type: 'select' },
      { key: 'escalationPct', label: 'Annual escalation % (optional)', type: 'num', min: -99.99, max: 100, unit: '%',
        help: 'Leave blank if the escalation terms are not known.' },
      { key: 'renewal', label: 'Renewal arrangement', type: 'select' },
      { key: 'renewalNotes', label: 'Renewal notes', type: 'textarea', wide: true }
    ]},
    { id: 'water', title: 'Water and infrastructure', fields: [
      { key: 'waterSource', label: 'Claimed water source', type: 'select' },
      { key: 'waterEvidence', label: 'Water evidence status', type: 'select' },
      { key: 'irrigationRequired', label: 'Irrigation required', type: 'select' },
      { key: 'waterNotes', label: 'Water-supply notes', type: 'textarea', wide: true },
      { key: 'infrastructure', label: 'Included infrastructure', type: 'textarea', wide: true },
      { key: 'pumpingPower', label: 'Pumping electricity', type: 'select' },
      { key: 'waterCharges', label: 'Water charges', type: 'select' },
      { key: 'routineMaint', label: 'Routine maintenance', type: 'select' },
      { key: 'majorRepairs', label: 'Major repairs', type: 'select' }
    ]},
    { id: 'other', title: 'Other terms', fields: [
      { key: 'permittedUse', label: 'Permitted-use notes', type: 'textarea' },
      { key: 'access', label: 'Access notes', type: 'textarea' },
      { key: 'plannedImprovements', label: 'Planned improvements', type: 'textarea' },
      { key: 'improvementTreatment', label: 'Improvement treatment notes', type: 'textarea' },
      { key: 'earlyTermination', label: 'Early-termination notes', type: 'textarea' },
      { key: 'harvestEndTerm', label: 'Harvest / end-of-term notes', type: 'textarea' },
      { key: 'otherCostsAnnual', label: 'Other known annual occupancy costs ($, optional)', type: 'num', min: 0, unit: '$',
        help: 'Leave blank if unknown. Blank is shown as Unknown, never $0.' },
      { key: 'clauseExcerpt', label: 'Pasted clause text (optional)', type: 'textarea', wide: true, help: EXCERPT_LABEL },
      { key: 'notes', label: 'Additional notes', type: 'textarea', wide: true }
    ]}
  ];
  const FIELDS = FORM_SCHEMA.flatMap(g => g.fields).filter(f => f.type !== 'fixed');
  const NUMERIC = FIELDS.filter(f => f.type === 'num').map(f => f.key);
  const MAX_TEXT = 4000;

  function blankInputs(){
    const out = {};
    FIELDS.forEach(f => { out[f.key] = f.type === 'select' ? OPTIONS[f.key][0][0] : ''; });
    out.rentBasis = 'per_acre';
    out.leaseDocStatus = 'none';
    out.waterEvidence = 'not_provided';
    return out;
  }

  // ------------------------------------------------------------- validation
  // Blank stays null (never 0). "$1,200" and "3%" are accepted.
  function parseNumber(raw){
    const s = String(raw === null || raw === undefined ? '' : raw).trim();
    if(s === '') return { value: null, error: null };
    const cleaned = s.replace(/^\$/, '').replace(/,/g, '').replace(/%$/, '').trim();
    if(!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return { value: null, error: 'Enter a number, or leave it blank.' };
    const n = Number(cleaned);
    if(!Number.isFinite(n)) return { value: null, error: 'Enter a finite number.' };
    return { value: n, error: null };
  }

  function validateInputs(inputs){
    const values = {}, errors = {};
    FIELDS.forEach(f => {
      const raw = inputs[f.key];
      if(f.type === 'num'){
        const { value, error } = parseNumber(raw);
        if(error){ errors[f.key] = error; values[f.key] = null; return; }
        if(value !== null){
          if(f.positive && !(value > 0)) errors[f.key] = 'Must be greater than 0.';
          else if(f.min !== undefined && value < f.min) errors[f.key] = f.min === 0 ? 'Cannot be negative.' : 'Must be at least ' + f.min + '.';
          else if(f.max !== undefined && value > f.max) errors[f.key] = 'Must be ' + f.max + ' or less.';
        }
        values[f.key] = errors[f.key] ? null : value;
      } else if(f.type === 'select'){
        const ok = OPTIONS[f.key].some(o => o[0] === raw);
        values[f.key] = ok ? raw : OPTIONS[f.key][0][0];
      } else if(f.type === 'date'){
        const s = String(raw || '').trim();
        if(s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s)))) errors[f.key] = 'Use a valid date (YYYY-MM-DD).';
        values[f.key] = errors[f.key] ? '' : s;
      } else {
        values[f.key] = String(raw === null || raw === undefined ? '' : raw).slice(0, MAX_TEXT).trim();
      }
    });
    return { values, errors, valid: Object.keys(errors).length === 0 };
  }

  // ------------------------------------------------------------- rent math
  const round2 = n => Math.round(n * 100) / 100;

  // Escalation is applied once per lease anniversary. A fractional final
  // year is prorated at that year's rate.
  function rentSchedule(annualBase, termYears, escalationPct){
    if(annualBase === null || termYears === null) return null;
    const e = escalationPct === null ? 0 : escalationPct / 100;
    const rows = [];
    const full = Math.floor(termYears + 1e-9);
    const partial = round2(termYears - full);
    for(let i = 0; i < full; i++){
      rows.push({ year: i + 1, fraction: 1, annualRate: round2(annualBase * Math.pow(1 + e, i)), amount: round2(annualBase * Math.pow(1 + e, i)) });
    }
    if(partial > 0){
      const rate = annualBase * Math.pow(1 + e, full);
      rows.push({ year: full + 1, fraction: partial, annualRate: round2(rate), amount: round2(rate * partial) });
    }
    return { rows, total: round2(rows.reduce((a, r) => a + r.amount, 0)) };
  }

  function calcRent(v){
    const missing = [];
    let annualBase = null;
    if(v.rentAmount === null) missing.push('rent amount');
    if(v.rentBasis === 'per_acre'){
      if(v.chargedAcres === null) missing.push('charged acreage');
      if(v.rentAmount !== null && v.chargedAcres !== null) annualBase = round2(v.rentAmount * v.chargedAcres);
    } else if(v.rentAmount !== null){
      annualBase = round2(v.rentAmount);
    }
    if(v.termYears === null) missing.push('lease term');

    const schedule = rentSchedule(annualBase, v.termYears, v.escalationPct);
    const escalationNote = v.escalationPct === null
      ? 'No escalation modeled; escalation terms were not supplied.'
      : 'Escalation of ' + v.escalationPct + '% applied once per lease anniversary, as entered.';

    let perUsableAcre = null, perUsableNote = '';
    if(annualBase === null) perUsableNote = 'Annual base rent cannot be calculated.';
    else if(v.usableAcres === null) perUsableNote = 'Reported usable acreage not supplied.';
    else if(v.usableAcres === 0) perUsableNote = 'Reported usable acreage is zero; per-acre rent is undefined.';
    else perUsableAcre = round2(annualBase / v.usableAcres);

    const otherKnown = v.otherCostsAnnual;
    const knownSubtotal = annualBase === null ? null : round2(annualBase + (otherKnown || 0));
    const unknownCategories = [];
    if(otherKnown === null) unknownCategories.push('Other annual occupancy costs');
    [['pumpingPower','Pumping electricity'],['waterCharges','Water charges'],['routineMaint','Routine maintenance'],['majorRepairs','Major repairs']]
      .forEach(([k, name]) => { if(v[k] === 'tenant' || v[k] === 'shared' || v[k] === 'unknown') unknownCategories.push(name + ' (' + label(k, v[k]).toLowerCase() + ' responsibility, not quantified)'); });

    // Sensitivity: effective rent if usable acreage turns out different.
    const sensitivity = [];
    if(annualBase !== null && v.chargedAcres !== null && v.chargedAcres > 0){
      const seen = new Set();
      [1, 0.95, 0.9, 0.85, 0.8].forEach(f => {
        const acres = round2(v.chargedAcres * f);
        if(acres > 0 && !seen.has(acres)){ seen.add(acres); sensitivity.push({ label: Math.round(f * 100) + '% of charged', acres, perAcre: round2(annualBase / acres) }); }
      });
      if(v.usableAcres !== null && v.usableAcres > 0 && !seen.has(v.usableAcres)){
        sensitivity.push({ label: 'Reported usable', acres: v.usableAcres, perAcre: round2(annualBase / v.usableAcres) });
      }
      sensitivity.sort((a, b) => b.acres - a.acres);
    }
    return { annualBase, schedule, totalScheduled: schedule ? schedule.total : null, escalationNote,
      perUsableAcre, perUsableNote, otherKnown, knownSubtotal, unknownCategories, sensitivity, missing };
  }

  // ------------------------------------------------------------- hashing
  function hash(str){
    let h = 5381;
    for(let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const pick = (obj, keys) => keys.map(k => k + '=' + JSON.stringify(obj[k] === undefined ? null : obj[k])).join('&');

  // ------------------------------------------------------------- tasks
  const TASK_STATUS = [['open','Open'],['requested','Requested'],['received','Document received'],['reviewed','Reviewed'],['resolved','Resolved with recorded basis']];
  const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 };
  const has = s => typeof s === 'string' && s.trim() !== '';
  const cropUse = v => v.currentUse === 'row_crop' || v.currentUse === 'orchard' || /crop|orchard|vine|vegetable|grain|hay/i.test(v.intendedUse || '');

  const TASK_TEMPLATES = [
    { id: 'confirm-acreage', title: 'Confirm premises and rent acreage',
      keys: ['chargedAcres','usableAcres','usableAcresBasis','minUsableAcres','rentBasis'],
      applies: () => true,
      priority: () => 'High',
      critical: v => v.minUsableAcres !== null,
      reason: v => {
        const bits = [];
        if(v.chargedAcres === null) bits.push('charged acreage not entered');
        if(v.usableAcres === null) bits.push('usable acreage not reported');
        else if(v.usableAcresBasis !== 'user_confirmed') bits.push('usable acreage is ' + label('usableAcresBasis', v.usableAcresBasis).toLowerCase() + ', not confirmed');
        if(v.chargedAcres !== null && v.usableAcres !== null && v.usableAcres < v.chargedAcres) bits.push('rent is charged on ' + round2(v.chargedAcres - v.usableAcres) + ' more acres than reported usable');
        return bits.length ? 'Because ' + bits.join('; ') + '.' : 'Confirm the leased premises match the charged and usable acreage.';
      } },
    { id: 'water-requirement', title: "Establish the intended operation's water requirement",
      keys: ['irrigationRequired','intendedUse'],
      applies: v => v.irrigationRequired !== 'no',
      priority: () => 'High',
      critical: v => v.irrigationRequired === 'yes' || v.irrigationRequired === 'unknown',
      reason: v => v.irrigationRequired === 'unknown'
        ? 'Whether the operation needs irrigation is not established.'
        : 'Supply evidence can only be judged against a stated volume and timing need.' },
    { id: 'water-supply-docs', title: 'Request water-supply documentation',
      keys: ['irrigationRequired','waterSource','waterEvidence','waterNotes'],
      applies: v => v.irrigationRequired !== 'no' || v.waterSource !== 'unknown',
      priority: v => v.irrigationRequired === 'yes' ? 'High' : 'Medium',
      critical: v => v.irrigationRequired === 'yes',
      reason: v => 'Claimed source: ' + label('waterSource', v.waterSource).toLowerCase() + '. Evidence status entered: ' + label('waterEvidence', v.waterEvidence).toLowerCase() + '. Request records such as well logs, pump tests, delivery history or rights documents, then review them.' },
    { id: 'water-costs', title: 'Clarify water and pumping cost responsibility',
      keys: ['pumpingPower','waterCharges'],
      applies: v => v.pumpingPower === 'unknown' || v.waterCharges === 'unknown',
      priority: () => 'Medium', critical: () => false,
      reason: v => [v.pumpingPower === 'unknown' && 'pumping electricity', v.waterCharges === 'unknown' && 'water charges'].filter(Boolean).join(' and ') + ' responsibility not stated.' },
    { id: 'inspect-irrigation', title: 'Inspect included irrigation infrastructure',
      keys: ['infrastructure','irrigationRequired'],
      applies: v => has(v.infrastructure) || v.irrigationRequired === 'yes',
      priority: v => v.irrigationRequired === 'yes' ? 'High' : 'Medium', critical: () => false,
      reason: v => has(v.infrastructure) ? 'Infrastructure listed as included; condition and capacity are not verified.' : 'Irrigation is required but no included infrastructure was listed.' },
    { id: 'repair-allocation', title: 'Clarify routine versus major repair allocation',
      keys: ['routineMaint','majorRepairs'],
      applies: v => ['unknown','shared'].includes(v.routineMaint) || ['unknown','shared'].includes(v.majorRepairs),
      priority: v => v.majorRepairs === 'unknown' ? 'High' : 'Medium', critical: () => false,
      reason: v => 'Routine maintenance: ' + label('routineMaint', v.routineMaint).toLowerCase() + '. Major repairs: ' + label('majorRepairs', v.majorRepairs).toLowerCase() + '.' },
    { id: 'permitted-use', title: 'Review permitted use',
      keys: ['permittedUse','intendedUse'],
      applies: () => true, priority: v => has(v.permittedUse) ? 'Medium' : 'High', critical: () => false,
      reason: v => has(v.permittedUse) ? 'Confirm the permitted use covers the intended operation.' : 'Permitted use was not entered.' },
    { id: 'improvements', title: 'Clarify improvement ownership and end-of-term treatment',
      keys: ['plannedImprovements','improvementTreatment','infrastructure'],
      applies: v => has(v.plannedImprovements) || has(v.infrastructure),
      priority: v => has(v.improvementTreatment) ? 'Low' : 'Medium', critical: () => false,
      reason: v => has(v.improvementTreatment) ? 'Treatment notes entered; confirm against the lease.' : 'Improvements or infrastructure listed, but end-of-term treatment was not entered.' },
    { id: 'termination-harvest', title: 'Clarify early termination and harvest treatment',
      keys: ['earlyTermination','harvestEndTerm','currentUse','intendedUse'],
      applies: () => true,
      priority: v => (!has(v.earlyTermination) || (!has(v.harvestEndTerm) && cropUse(v))) ? 'Medium' : 'Low', critical: () => false,
      reason: v => [!has(v.earlyTermination) && 'early-termination terms not entered', !has(v.harvestEndTerm) && 'harvest / end-of-term treatment not entered'].filter(Boolean).join('; ') || 'Confirm the entered notes against the lease.' },
    { id: 'baseline', title: 'Record baseline condition',
      keys: [], applies: () => true, priority: () => 'Low', critical: () => false,
      reason: () => 'Photograph and document fields, fences, wells and structures at the start of the term.' }
  ];

  function blankTask(){
    return { id: '', title: '', reason: '', priority: 'Medium', critical: false, criticalByRule: false, criticalOverride: null,
      owner: '', status: 'open', evidenceNote: '', reviewer: '', reviewDate: '', resolutionBasis: '',
      reviewHash: null, history: [], stale: false, outdated: false };
  }
  const USER_FIELDS = ['owner','status','evidenceNote','reviewer','reviewDate','resolutionBasis','criticalOverride','reviewHash','history'];
  const hasUserEdits = t => t.status !== 'open' || has(t.owner) || has(t.evidenceNote) || has(t.reviewer) || has(t.reviewDate) || has(t.resolutionBasis) || t.criticalOverride !== null;

  // Regenerate derived task fields while keeping every user edit.
  // Tasks that no longer apply are kept (marked stale) if the user touched them.
  function generateTasks(values, existing){
    const prev = new Map((existing || []).map(t => [t.id, t]));
    const out = [];
    TASK_TEMPLATES.forEach(tpl => {
      const old = prev.get(tpl.id);
      prev.delete(tpl.id);
      if(!tpl.applies(values)){
        if(old && hasUserEdits(old)) out.push(Object.assign({}, old, { stale: true }));
        return;
      }
      const t = Object.assign(blankTask(), old || {});
      t.id = tpl.id; t.title = tpl.title; t.reason = tpl.reason(values); t.priority = tpl.priority(values);
      t.criticalByRule = !!tpl.critical(values);
      t.critical = t.criticalOverride === null ? t.criticalByRule : !!t.criticalOverride;
      t.stale = false;
      t.inputHash = hash(pick(values, tpl.keys));
      t.outdated = !!(t.reviewHash && t.reviewHash !== t.inputHash && ['reviewed','resolved'].includes(t.status));
      out.push(t);
    });
    prev.forEach(old => { if(hasUserEdits(old)) out.push(Object.assign({}, old, { stale: true })); }); // custom or retired
    return out;
  }

  // Status changes go through here so review history is kept.
  function updateTask(task, patch, now){
    const t = Object.assign({}, task, patch);
    if(patch.status && patch.status !== task.status){
      t.history = (task.history || []).concat([{ at: now || new Date().toISOString(), from: task.status, to: patch.status, by: t.reviewer || '' }]);
      if(patch.status === 'reviewed' || patch.status === 'resolved') t.reviewHash = task.inputHash || null;
    }
    if(patch.criticalOverride !== undefined) t.critical = patch.criticalOverride === null ? t.criticalByRule : !!patch.criticalOverride;
    t.outdated = !!(t.reviewHash && t.inputHash && t.reviewHash !== t.inputHash && ['reviewed','resolved'].includes(t.status));
    return t;
  }

  // Resolved only with a recorded basis and reviewer, and only for the inputs it was reviewed against.
  const isResolved = t => !!t && t.status === 'resolved' && has(t.resolutionBasis) && has(t.reviewer) && !t.outdated;
  const resolutionProblem = t => {
    if(!t || t.status !== 'resolved') return '';
    if(t.outdated) return 'Inputs changed after this was resolved. Review again.';
    if(!has(t.resolutionBasis) || !has(t.reviewer)) return 'Add a reviewer and a resolution basis to count this as resolved.';
    return '';
  };

  // ------------------------------------------------------------- screening
  const RULES = [
    { id: 'R1', status: 'hold', text: 'Hold if irrigation is required and the water-supply documentation task is not resolved with a recorded basis and reviewer.' },
    { id: 'R2', status: 'hold', text: 'Hold if the irrigation requirement itself is unknown.' },
    { id: 'R3', status: 'hold', text: 'Hold if the rent calculation lacks rent amount, charged acreage (per-acre basis) or term.' },
    { id: 'R4', status: 'hold', text: 'Hold if a minimum usable acreage is stated but usable acreage is unknown, or below the minimum without user confirmation.' },
    { id: 'R5', status: 'hold', text: 'Hold if any task marked critical is unresolved, or its resolution is outdated.' },
    { id: 'R6', status: 'hold', text: 'Hold if no parcel scan is attached, because physical suitability has not been screened.' },
    { id: 'R7', status: 'fail', text: 'Does not meet stated requirements only when the user records a confirmed fact that conflicts with an explicit requirement (for example, user-confirmed usable acreage below the stated minimum).' },
    { id: 'R8', status: 'advance', text: 'Advance to further diligence when none of the rules above apply. This is not approval to sign and not a certification of suitability.' }
  ];

  function screen(values, tasks, parcel, conflicts){
    const reasons = [];
    const find = id => (tasks || []).find(t => t.id === id && !t.stale);
    const rent = calcRent(values);

    if(values.irrigationRequired === 'yes' && !isResolved(find('water-supply-docs')))
      reasons.push({ rule: 'R1', kind: 'hold', text: 'Irrigation is required and water-supply evidence is unresolved (entered status: ' + label('waterEvidence', values.waterEvidence).toLowerCase() + ').' });
    if(values.irrigationRequired === 'unknown')
      reasons.push({ rule: 'R2', kind: 'hold', text: 'Whether the operation needs irrigation is unknown.' });
    if(rent.missing.length)
      reasons.push({ rule: 'R3', kind: 'hold', text: 'Rent cannot be fully calculated: missing ' + rent.missing.join(', ') + '.' });
    if(values.minUsableAcres !== null){
      if(values.usableAcres === null)
        reasons.push({ rule: 'R4', kind: 'hold', text: 'A minimum of ' + values.minUsableAcres + ' usable acres is required, but usable acreage is unknown.' });
      else if(values.usableAcres < values.minUsableAcres && values.usableAcresBasis !== 'user_confirmed')
        reasons.push({ rule: 'R4', kind: 'hold', text: 'Reported usable acreage (' + values.usableAcres + ', ' + label('usableAcresBasis', values.usableAcresBasis).toLowerCase() + ') is below the ' + values.minUsableAcres + '-acre minimum but is not confirmed.' });
      else if(values.usableAcres < values.minUsableAcres)
        reasons.push({ rule: 'R7', kind: 'fail', text: 'User-confirmed usable acreage (' + values.usableAcres + ') is below the stated minimum of ' + values.minUsableAcres + ' acres.' });
    }
    (conflicts || []).filter(c => has(c.requirement) && has(c.fact) && has(c.recordedBy))
      .forEach(c => reasons.push({ rule: 'R7', kind: 'fail', text: 'Recorded conflict: ' + c.fact + ' (requirement: ' + c.requirement + '; recorded by ' + c.recordedBy + (c.date ? ', ' + c.date : '') + ').' }));
    const openCritical = (tasks || []).filter(t => !t.stale && t.critical && !isResolved(t) && !(t.id === 'water-supply-docs' && values.irrigationRequired === 'yes'));
    if(openCritical.length)
      reasons.push({ rule: 'R5', kind: 'hold', text: 'Unresolved critical task' + (openCritical.length > 1 ? 's' : '') + ': ' + openCritical.map(t => t.title + (t.outdated ? ' (resolution outdated)' : '')).join('; ') + '.' });
    if(!parcel)
      reasons.push({ rule: 'R6', kind: 'hold', text: 'No parcel scan is attached, so physical suitability has not been screened.' });

    const status = reasons.some(r => r.kind === 'fail') ? 'fail' : reasons.some(r => r.kind === 'hold') ? 'hold' : 'advance';
    return { status, label: STATUS[status], reasons };
  }

  // What would clear each reason (Appendix G).
  const CHANGE_TEXT = {
    R1: 'Record a resolved water-supply documentation task with a reviewer and basis.',
    R2: 'Set whether irrigation is required.',
    R3: 'Enter the missing rent inputs.',
    R4: 'Enter usable acreage, or confirm it from a survey, inspection or records.',
    R5: 'Resolve the critical tasks with a reviewer and basis, or clear their critical flag with a reason in the task note.',
    R6: 'Run a parcel scan and attach it to this screen.',
    R7: 'Only new confirmed facts (for example, a corrected survey) or a changed requirement would change this.'
  };

  // ------------------------------------------------------------- evidence
  function buildEvidence(values, parcel, tasks, rent){
    const ev = [];
    if(parcel && Array.isArray(parcel.observations)){
      parcel.observations.forEach(o => ev.push(Object.assign({ category: o.category || 'public_data' }, o)));
    }
    if(rent.annualBase !== null) ev.push({ category: 'calculated', name: 'Annual base rent (year 1)', value: rent.annualBase, units: 'USD', source: 'Canopy calculation from user inputs' });
    if(rent.perUsableAcre !== null) ev.push({ category: 'calculated', name: 'Effective base rent per reported usable acre', value: rent.perUsableAcre, units: 'USD/acre', source: 'Canopy calculation from user inputs' });
    if(values.usableAcres !== null) ev.push({ category: values.usableAcresBasis === 'user_confirmed' ? 'user_conclusion' : 'user_statement', name: 'Usable acreage', value: values.usableAcres, units: 'acres', source: label('usableAcresBasis', values.usableAcresBasis) });
    if(values.waterSource !== 'unknown') ev.push({ category: 'user_statement', name: 'Claimed water source', value: label('waterSource', values.waterSource), source: 'User-entered', limitations: has(values.waterNotes) ? values.waterNotes : '' });
    if(values.waterEvidence === 'received_not_reviewed') ev.push({ category: 'document_received', name: 'Water-supply documents', value: 'Received, not reviewed', source: 'User-entered' });
    if(values.leaseDocStatus === 'received_not_reviewed') ev.push({ category: 'document_received', name: 'Lease document', value: 'Received, not reviewed', source: 'User-entered' });
    (tasks || []).forEach(t => {
      if(t.status === 'received') ev.push({ category: 'document_received', name: t.title, value: has(t.evidenceNote) ? t.evidenceNote : 'Document received', source: 'Task tracker' });
      if(isResolved(t)) ev.push({ category: 'user_conclusion', name: t.title, value: t.resolutionBasis, source: 'Recorded by ' + t.reviewer + (t.reviewDate ? ' on ' + t.reviewDate : ''), limitations: 'User-recorded conclusion, not a Canopy certification.' });
    });
    const missing = [];
    if(!parcel) missing.push('Parcel observations (no scan attached)');
    if(values.usableAcres === null) missing.push('Usable acreage');
    if(values.irrigationRequired === 'unknown') missing.push('Irrigation requirement');
    if(values.escalationPct === null) missing.push('Escalation terms');
    if(values.otherCostsAnnual === null) missing.push('Other annual occupancy costs');
    ['pumpingPower','waterCharges','routineMaint','majorRepairs'].forEach(k => { if(values[k] === 'unknown') missing.push(fieldLabel(k) + ' responsibility'); });
    if(values.leaseDocStatus !== 'reviewed') missing.push('Reviewed lease document');
    missing.forEach(m => ev.push({ category: 'missing', name: m, value: 'Not provided' }));
    return ev;
  }
  const CATEGORY_LABEL = { public_data: 'Public-data observation', calculated: 'Calculated value', user_statement: 'User-provided statement',
    document_received: 'Document received, not reviewed', user_conclusion: 'User-recorded conclusion', missing: 'Missing information' };
  function fieldLabel(key){ const f = FIELDS.find(x => x.key === key); return f ? f.label.replace(/ \(optional\)$/, '') : key; }

  // ------------------------------------------------------------- issues (Appendix E)
  function termIssues(v){
    const out = [];
    const add = (term, entered, issue) => out.push({ term, entered, issue });
    if(v.escalationPct === null) add('Escalation', 'Not entered', 'Escalation terms not supplied; none modeled.');
    if(v.renewal === 'unknown') add('Renewal', 'Unknown', 'Renewal arrangement not stated.');
    if(v.renewal === 'none') add('Renewal', 'None', 'No renewal option, as entered by the user.');
    if(v.majorRepairs === 'unknown') add('Major repairs', 'Unknown', 'Responsibility for major repairs not stated.');
    if(v.routineMaint === 'unknown') add('Routine maintenance', 'Unknown', 'Responsibility for routine maintenance not stated.');
    if(v.pumpingPower === 'unknown') add('Pumping electricity', 'Unknown', 'Responsibility not stated.');
    if(v.waterCharges === 'unknown') add('Water charges', 'Unknown', 'Responsibility not stated.');
    if(!has(v.permittedUse)) add('Permitted use', 'Not entered', 'Permitted use not stated.');
    if(!has(v.access)) add('Access', 'Not entered', 'Access arrangements not stated.');
    if(has(v.plannedImprovements) && !has(v.improvementTreatment)) add('Improvements', v.plannedImprovements, 'End-of-term treatment of improvements not stated.');
    if(!has(v.earlyTermination)) add('Early termination', 'Not entered', 'Early-termination terms not stated.');
    if(!has(v.harvestEndTerm) && cropUse(v)) add('Harvest / end of term', 'Not entered', 'Crop-in-ground treatment at end of term not stated.');
    if(v.chargedAcres !== null && v.usableAcres !== null && v.usableAcres < v.chargedAcres)
      add('Charged vs usable acreage', v.chargedAcres + ' charged / ' + v.usableAcres + ' usable', 'Rent is charged on acreage that is reported as not usable.');
    return out;
  }

  // ------------------------------------------------------------- memo model
  // A neutral structure rendered to DOM (lease-ui.js) and Markdown (below).
  // Blocks: {p}, {list}, {table: {head, rows}}, {kv: [[k, v]]}, {note}
  const fmtMoney = (n, cents) => n === null || n === undefined ? 'Unknown'
    : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const fmtNum = (n, unit) => n === null || n === undefined ? 'Not provided' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + (unit ? ' ' + unit : '');
  const or = (s, fallback) => has(s) ? s : (fallback || 'Not entered');
  const taskStatusLabel = s => (TASK_STATUS.find(x => x[0] === s) || [s, s])[1];

  function observationRow(parcel, key){
    if(!parcel) return ['Not available', 'Missing: no scan attached'];
    const o = (parcel.observations || []).find(x => x.key === key);
    if(!o) return ['Not available', 'Missing'];
    const kind = o.category === 'calculated' ? 'Calculated: ' : o.category === 'user_statement' ? 'User-provided: ' : 'Public data: ';
    if(o.status !== 'ok') return ['Unavailable', kind + o.source + ' (failed' + (o.error ? ': ' + o.error : '') + ')'];
    return [String(o.value) + (o.units ? ' ' + o.units : ''), kind + o.source];
  }

  function buildMemo(record){
    const { values } = validateInputs(record.inputs || {});
    const tasks = record.tasks || [];
    const parcel = record.parcel || null;
    const rent = calcRent(values);
    const result = screen(values, tasks, parcel, record.conflicts);
    const evidence = buildEvidence(values, parcel, tasks, rent);
    const issues = termIssues(values);
    const title = (has(values.propertyName) ? values.propertyName : 'Untitled property') + (has(values.parcelId) ? ' (' + values.parcelId + ')' : '');

    const header = [];
    if(record.isDemo) header.push({ note: DEMO_LABEL, tone: 'demo' });
    if(values.leaseDocStatus !== 'reviewed') header.push({ note: NO_DOC_NOTICE, tone: 'warn' });
    header.push({ kv: [
      ['Memo ID', record.id],
      ['Review scope', 'Agricultural lease screening from a parcel scan and user-entered lease terms. Not legal review, an appraisal or a suitability certification.'],
      ['Landlord', or(values.landlord)], ['Proposed tenant', or(values.tenant)],
      ['Parcel scan', parcel ? (parcel.label || 'Attached') + ' (scanned ' + (parcel.scannedAt || 'time not recorded') + ')' : 'None attached'],
      ['Generated', record.generatedAt || record.updatedAt || ''],
      ['Scoring model', record.scoringModelVersion || 'Not versioned in this prototype']
    ]});

    const questions = result.reasons.filter(r => r.kind === 'hold').map(r => r.text);
    const fitRows = [
      ['Current use', label('currentUse', values.currentUse), 'User-provided'],
      ['Intended use', or(values.intendedUse), 'User-provided'],
      ['Location', parcel ? (parcel.label || '') + (parcel.lat !== undefined ? ' (' + parcel.lat + ', ' + parcel.lon + ')' : '') : 'Not available', parcel ? 'Scan input' : 'Missing: no scan attached'],
      ['Scan acreage', ...observationRow(parcel, 'acreage')],
      ['Charged acreage', fmtNum(values.chargedAcres, 'acres'), 'User-provided'],
      ['Reported usable acreage', fmtNum(values.usableAcres, 'acres'), values.usableAcres === null ? 'Missing' : label('usableAcresBasis', values.usableAcresBasis)],
      ['Minimum usable acreage', values.minUsableAcres === null ? 'None stated' : fmtNum(values.minUsableAcres, 'acres'), 'User requirement'],
      ['Soil map unit', ...observationRow(parcel, 'soil')],
      ['Capability class and slope', ...observationRow(parcel, 'capability')],
      ['Farmland class', ...observationRow(parcel, 'farmClass')],
      ['Flood zone', ...observationRow(parcel, 'flood')],
      ['Land cover', ...observationRow(parcel, 'landcover')],
      ['Nearest stream or river', ...observationRow(parcel, 'stream')],
      ['Trailing 12-month precipitation', ...observationRow(parcel, 'precip')],
      ['Existing structures', ...observationRow(parcel, 'structures')],
      ['Buildings within 1 km', ...observationRow(parcel, 'nearbyBuildings')],
      ['Irrigation required', label('irrigationRequired', values.irrigationRequired), 'User-provided'],
      ['Claimed water source', label('waterSource', values.waterSource), 'User-provided statement']
    ];
    if(parcel && parcel.scores) fitRows.push(['Canopy scores (farm / water / housing)',
      ['farm','freshwater','housing'].map(k => parcel.scores[k] && parcel.scores[k].score !== null && parcel.scores[k].score !== undefined ? Math.round(parcel.scores[k].score) : 'n/a').join(' / '),
      'Calculated: unvalidated heuristic weights']);

    const rentRows = [
      ['Annual base rent (year 1)', fmtMoney(rent.annualBase), rent.annualBase === null ? 'Missing: ' + rent.missing.filter(m => m !== 'lease term').join(', ') : values.rentBasis === 'per_acre' ? fmtMoney(values.rentAmount, true) + ' x ' + fmtNum(values.chargedAcres, 'charged acres') : 'Flat annual amount'],
      ['Scheduled base rent across term', fmtMoney(rent.totalScheduled), rent.totalScheduled === null ? 'Needs annual rent and term' : fmtNum(values.termYears, 'years') + '; ' + rent.escalationNote],
      ['Effective base rent per usable acre', rent.perUsableAcre === null ? 'Not calculated' : fmtMoney(rent.perUsableAcre, true), rent.perUsableAcre === null ? rent.perUsableNote : 'Year-1 rent / reported usable acres'],
      ['Other known annual occupancy costs', values.otherCostsAnnual === null ? 'Unknown' : fmtMoney(values.otherCostsAnnual), 'User-provided'],
      ['Known-cost subtotal (year 1)', fmtMoney(rent.knownSubtotal), 'Excludes: ' + (rent.unknownCategories.length ? rent.unknownCategories.join('; ') : 'none listed')]
    ];

    const openTasks = tasks.filter(t => !t.stale && !isResolved(t))
      .sort((a, b) => (b.critical - a.critical) || (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]));

    const limitations = [
      'Not legal advice or legal review of a lease. Have the lease reviewed by a qualified advisor.',
      'Not an appraisal. No yield, profit, market-rent or land-value estimate is made.',
      'Public data describes points or sample points, not surveyed boundaries, and may be outdated or unavailable.',
      'Public data does not establish water rights, groundwater availability or supply reliability.',
      'Canopy scores use unvalidated, judgment-based weights.',
      'Costs not entered are excluded, so subtotals understate total occupancy cost.',
      'Saved in this browser only. Not shared with a team and not secure document storage.'
    ];

    const sections = [
      { id: 'status', title: 'Screening status', blocks: [
        { status: result.status, label: result.label },
        result.reasons.length ? { list: result.reasons.map(r => '[' + r.rule + '] ' + r.text) } : { p: 'No screening rule is triggered. This is not approval to sign and not a certification of suitability.' }
      ]},
      { id: 'questions', title: 'Critical unresolved questions', blocks: [ questions.length ? { list: questions } : { p: 'None under the configured rules.' } ]},
      { id: 'fit', title: 'Parcel and operational fit', blocks: [ { table: { head: ['Item','Value','Basis'], rows: fitRows } } ]},
      { id: 'rent', title: 'Rent and known costs', blocks: [ { table: { head: ['Measure','Amount','Basis'], rows: rentRows } } ]},
      { id: 'terms', title: 'Terms requiring attention', blocks: [ issues.length ? { list: issues.map(i => i.term + ': ' + i.issue) } : { p: 'No term issues flagged from the entered information.' } ]},
      { id: 'next', title: 'Highest-priority next steps', blocks: [ openTasks.length ? { list: openTasks.slice(0, 5).map(t => t.title + (t.critical ? ' (critical)' : '') + ': ' + t.reason) } : { p: 'All generated tasks are resolved.' } ]},
      { id: 'limits', title: 'Limitations', blocks: [ { list: limitations } ]}
    ];

    // ---- appendix
    const evRows = evidence.filter(e => e.key || e.category === 'calculated').map(e => [
      e.name, e.status && e.status !== 'ok' ? 'Unavailable' : (e.value === null || e.value === undefined ? '' : String(e.value)) + (e.units && e.status !== 'failed' ? ' ' + e.units : ''),
      CATEGORY_LABEL[e.category] || e.category, e.source || '', e.basis || '', e.retrievedAt || '', e.datasetDate || 'Not provided by scan',
      e.status ? (e.status === 'ok' ? 'Retrieved' : 'Failed' + (e.error ? ': ' + e.error : '')) : '', e.limitations || '']);
    const supplyTask = tasks.find(t => t.id === 'water-supply-docs' && !t.stale);
    const reqTask = tasks.find(t => t.id === 'water-requirement' && !t.stale);
    const statusOf = t => t ? taskStatusLabel(t.status) + (isResolved(t) ? ' (basis recorded)' : resolutionProblem(t) ? ' (' + resolutionProblem(t) + ')' : '') : 'Not generated';

    const appendix = [
      { id: 'A', title: 'A. Parcel description and acreage reconciliation', blocks: [
        { kv: [['Property', or(values.propertyName)], ['Parcel identifier', or(values.parcelId)], ['Landlord', or(values.landlord)], ['Proposed tenant', or(values.tenant)],
          ['Proposed start date', or(values.startDate)], ['Proposed term', fmtNum(values.termYears, 'years')]] },
        { table: { head: ['Acreage measure','Acres','Basis'], rows: [
          ['Scan acreage', ...observationRow(parcel, 'acreage')],
          ['Charged acreage', fmtNum(values.chargedAcres), 'User-provided'],
          ['Reported usable acreage', fmtNum(values.usableAcres), values.usableAcres === null ? 'Missing' : label('usableAcresBasis', values.usableAcresBasis)],
          ['Charged minus usable', values.chargedAcres !== null && values.usableAcres !== null ? fmtNum(round2(values.chargedAcres - values.usableAcres)) : 'Not calculated', 'Calculated'],
          ['Minimum usable requirement', values.minUsableAcres === null ? 'None stated' : fmtNum(values.minUsableAcres), 'User requirement']
        ]}}
      ]},
      { id: 'B', title: 'B. Physical suitability evidence register', blocks: [
        evRows.length ? { table: { head: ['Observation','Value','Category','Source','Geographic basis','Retrieved','Dataset date','Status','Limitations'], rows: evRows } }
          : { p: 'No parcel observations. Run a scan and attach it to this screen.' }
      ]},
      { id: 'C', title: 'C. Water and irrigation evidence checklist', blocks: [
        { table: { head: ['Item','Entry','Basis'], rows: [
          ['Irrigation required', label('irrigationRequired', values.irrigationRequired), 'User-provided'],
          ['Claimed water source', label('waterSource', values.waterSource), 'User-provided statement'],
          ['Water-supply notes', or(values.waterNotes), 'User-provided statement'],
          ['Evidence status (as entered)', label('waterEvidence', values.waterEvidence), 'User-provided'],
          ['Water requirement task', statusOf(reqTask), 'Task tracker'],
          ['Supply documentation task', statusOf(supplyTask), 'Task tracker'],
          ['Included infrastructure', or(values.infrastructure), 'User-provided statement'],
          ['Pumping electricity', label('pumpingPower', values.pumpingPower), 'User-provided'],
          ['Water charges', label('waterCharges', values.waterCharges), 'User-provided'],
          ['Nearest stream or river', ...observationRow(parcel, 'stream')],
          ['Trailing 12-month precipitation', ...observationRow(parcel, 'precip')]
        ]}},
        { note: 'Public data shown here is context only. It does not establish water rights, well yield or delivery reliability.', tone: 'info' }
      ]},
      { id: 'D', title: 'D. Rent and cost worksheet', blocks: [
        { kv: [['Rent basis', label('rentBasis', values.rentBasis)], ['Rent amount', values.rentAmount === null ? 'Not provided' : fmtMoney(values.rentAmount, true) + (values.rentBasis === 'per_acre' ? ' per charged acre per year' : ' per year')],
          ['Escalation', rent.escalationNote],
          ['USDA county average cash rent', parcel ? observationRow(parcel, 'countyRent')[0] + ' (context only; not a market-rent estimate for this parcel)' : 'Not available: no scan attached']] },
        rent.schedule ? { table: { head: ['Lease year','Share of year','Annual rate','Base rent'], rows: rent.schedule.rows.map(r => [String(r.year), r.fraction === 1 ? 'Full' : String(r.fraction), fmtMoney(r.annualRate, true), fmtMoney(r.amount, true)])
          .concat([['Total','', '', fmtMoney(rent.schedule.total, true)]]) } } : { p: 'Schedule not calculated: missing ' + rent.missing.join(', ') + '.' },
        rent.sensitivity.length ? { table: { head: ['Usable acreage case','Acres','Year-1 base rent per usable acre'], rows: rent.sensitivity.map(s => [s.label, fmtNum(s.acres), fmtMoney(s.perAcre, true)]) } } : { p: 'Acreage sensitivity needs annual rent and charged acreage.' },
        { table: { head: ['Cost category','Year-1 amount','Status'], rows: [
          ['Base rent', fmtMoney(rent.annualBase), rent.annualBase === null ? 'Missing inputs' : 'Calculated'],
          ['Other annual occupancy costs', values.otherCostsAnnual === null ? 'Unknown' : fmtMoney(values.otherCostsAnnual), values.otherCostsAnnual === null ? 'Not provided' : 'User-provided'],
          ...['pumpingPower','waterCharges','routineMaint','majorRepairs'].map(k => [fieldLabel(k), 'Not quantified', label(k, values[k]) + ' responsibility']),
          ['Known-cost subtotal', fmtMoney(rent.knownSubtotal), 'Known categories only']
        ]}}
      ]},
      { id: 'E', title: 'E. User-reported lease-term issue log', blocks: [
        values.leaseDocStatus !== 'reviewed' ? { note: NO_DOC_NOTICE, tone: 'warn' } : { p: 'Lease document marked as reviewed by the user.' },
        issues.length ? { table: { head: ['Term','Entered','Issue'], rows: issues.map(i => [i.term, i.entered, i.issue]) } } : { p: 'No issues flagged.' },
        { kv: [['Permitted use', or(values.permittedUse)], ['Access', or(values.access)], ['Planned improvements', or(values.plannedImprovements)], ['Improvement treatment', or(values.improvementTreatment)],
          ['Early termination', or(values.earlyTermination)], ['Harvest / end of term', or(values.harvestEndTerm)], ['Renewal', label('renewal', values.renewal) + (has(values.renewalNotes) ? ': ' + values.renewalNotes : '')], ['Additional notes', or(values.notes)]] },
        has(values.clauseExcerpt) ? { quote: values.clauseExcerpt, caption: EXCERPT_LABEL } : null
      ].filter(Boolean)},
      { id: 'F', title: 'F. Due-diligence action tracker', blocks: [
        tasks.length ? { table: { head: ['ID','Task','Priority','Critical','Owner','Status','Evidence note','Reviewer','Review date','Resolution basis','Flags'],
          rows: tasks.map(t => [t.id, t.title, t.priority, t.critical ? 'Yes' : 'No', or(t.owner, ''), taskStatusLabel(t.status), t.evidenceNote || '', t.reviewer || '', t.reviewDate || '', t.resolutionBasis || '',
            [t.stale && 'No longer triggered by inputs', t.outdated && 'Outdated: inputs changed after review', !t.outdated && resolutionProblem(t)].filter(Boolean).join('; ')]) } } : { p: 'Generate the memo to create tasks.' }
      ]},
      { id: 'G', title: 'G. Decision record and what could change the result', blocks: [
        { kv: [['Screening status', result.label], ['Rules applied', RULES.map(r => r.id + ': ' + r.text).join(' ')]] },
        { p: 'User-recorded conclusions (not Canopy certifications):' },
        tasks.filter(isResolved).length ? { list: tasks.filter(isResolved).map(t => t.title + ': ' + t.resolutionBasis + ' (recorded by ' + t.reviewer + (t.reviewDate ? ', ' + t.reviewDate : '') + ')') } : { p: 'None recorded.' },
        (record.conflicts || []).length ? { list: record.conflicts.map(c => 'Recorded conflict: ' + (c.fact || '') + ' vs requirement: ' + (c.requirement || '') + ' (' + (c.recordedBy || 'no recorder') + (c.date ? ', ' + c.date : '') + ')') } : null,
        { p: 'What could change the result:' },
        { list: result.reasons.length ? [...new Set(result.reasons.map(r => CHANGE_TEXT[r.rule]))] : ['New evidence contradicting entered statements, a failed review, or a confirmed conflict with a stated requirement.'] }
      ].filter(Boolean)}
    ];

    return { title, isDemo: !!record.isDemo, header, result, rules: RULES, sections, appendix, evidence, rent };
  }

  // ------------------------------------------------------------- Markdown
  // Escape Markdown syntax and raw HTML so user text renders as text.
  function mdEscape(s){
    return String(s === null || s === undefined ? '' : s)
      .replace(/\\/g, '\\\\').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/([`*_{}\[\]()#+!|~])/g, '\\$1').replace(/\r?\n/g, ' ');
  }
  function blockToMd(b){
    if(!b) return '';
    if(b.p) return mdEscape(b.p) + '\n';
    if(b.note) return '> **' + mdEscape(b.note) + '**\n';
    if(b.status) return '**Status: ' + mdEscape(b.label) + '**\n';
    if(b.list) return b.list.map(x => '- ' + mdEscape(x)).join('\n') + '\n';
    if(b.kv) return b.kv.map(([k, v]) => '- **' + mdEscape(k) + ':** ' + mdEscape(v)).join('\n') + '\n';
    if(b.quote) return '> ' + mdEscape(b.quote) + '\n>\n> _' + mdEscape(b.caption) + '_\n';
    if(b.table){
      const row = cells => '| ' + cells.map(mdEscape).join(' | ') + ' |';
      return [row(b.table.head), '| ' + b.table.head.map(() => '---').join(' | ') + ' |', ...b.table.rows.map(row)].join('\n') + '\n';
    }
    return '';
  }
  function toMarkdown(memo){
    const out = ['# Agricultural lease screen: ' + mdEscape(memo.title), ''];
    memo.header.forEach(b => out.push(blockToMd(b)));
    memo.sections.forEach(s => { out.push('## ' + mdEscape(s.title), ''); s.blocks.forEach(b => out.push(blockToMd(b))); });
    out.push('---', '', '# Supporting appendix', '');
    memo.appendix.forEach(s => { out.push('## ' + mdEscape(s.title), ''); s.blocks.forEach(b => out.push(blockToMd(b))); });
    out.push('---', '', '_Generated by the Canopy prototype. Saved reports may contain commercially sensitive information._', '');
    return out.join('\n');
  }

  // ------------------------------------------------------------- records & storage
  function newId(now){
    const d = (now || new Date()).toISOString().slice(0, 10).replace(/-/g, '');
    let rand = '';
    try {
      const a = new Uint32Array(1);
      (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null).getRandomValues(a);
      rand = a[0].toString(36);
    } catch(e){ rand = Math.floor(Math.random() * 1e9).toString(36); }
    return 'LS-' + d + '-' + rand.slice(0, 5).toUpperCase();
  }

  function newRecord(opts){
    const now = new Date().toISOString();
    return { id: newId(), schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now, generatedAt: null, generatedHash: null,
      scoringModelVersion: null, isDemo: false, parcel: null, inputs: blankInputs(), tasks: [], conflicts: [], screening: null,
      ...(opts || {}) };
  }

  function demoRecord(){
    const r = newRecord({ isDemo: true });
    Object.assign(r.inputs, {
      currentUse: 'row_crop', intendedUse: 'Irrigated row crops (fictional)', requirements: 'Fictional example requirements: reliable irrigation water.',
      propertyName: 'Example Farm, Parcel A', termYears: '3', rentBasis: 'per_acre', rentAmount: '300', chargedAcres: '100',
      usableAcres: '90', usableAcresBasis: 'owner_statement', escalationPct: '0', waterSource: 'well', waterNotes: 'Owner-reported well.',
      waterEvidence: 'owner_statement', irrigationRequired: 'yes', majorRepairs: 'unknown', otherCostsAnnual: ''
    });
    return generate(r);
  }

  // Generate (or regenerate) tasks and the screening result for a record.
  function generate(record, now){
    const { values } = validateInputs(record.inputs);
    const r = Object.assign({}, record);
    r.tasks = generateTasks(values, record.tasks);
    r.screening = screen(values, r.tasks, r.parcel, r.conflicts);
    r.generatedAt = now || new Date().toISOString();
    r.generatedHash = hash(JSON.stringify(values));
    r.updatedAt = r.generatedAt;
    return r;
  }
  const inputsChangedSinceGenerate = r => !!r.generatedHash && r.generatedHash !== hash(JSON.stringify(validateInputs(r.inputs).values));

  // Repair anything loaded from storage. Unknown fields are dropped, missing
  // ones get defaults, and bad types are coerced so the UI never crashes.
  function normalizeRecord(raw){
    if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const base = newRecord();
    const r = { ...base };
    ['id','createdAt','updatedAt','generatedAt','generatedHash','scoringModelVersion'].forEach(k => { if(typeof raw[k] === 'string') r[k] = raw[k]; });
    r.schemaVersion = SCHEMA_VERSION;
    r.isDemo = raw.isDemo === true;
    const inp = raw.inputs && typeof raw.inputs === 'object' ? raw.inputs : {};
    FIELDS.forEach(f => { const v = inp[f.key]; if(typeof v === 'string' || typeof v === 'number') r.inputs[f.key] = String(v).slice(0, MAX_TEXT); });
    r.parcel = raw.parcel && typeof raw.parcel === 'object' && Array.isArray(raw.parcel.observations) ? raw.parcel : null;
    r.tasks = Array.isArray(raw.tasks) ? raw.tasks.filter(t => t && typeof t === 'object' && typeof t.id === 'string').map(t => {
      const n = blankTask();
      Object.keys(n).forEach(k => { if(t[k] !== undefined && typeof t[k] === typeof n[k]) n[k] = t[k]; });
      if(t.criticalOverride === true || t.criticalOverride === false) n.criticalOverride = t.criticalOverride;
      if(typeof t.reviewHash === 'string') n.reviewHash = t.reviewHash;
      if(typeof t.inputHash === 'string') n.inputHash = t.inputHash;
      if(!TASK_STATUS.some(s => s[0] === n.status)) n.status = 'open';
      n.history = Array.isArray(t.history) ? t.history.filter(h => h && typeof h === 'object') : [];
      return n;
    }) : [];
    r.conflicts = Array.isArray(raw.conflicts) ? raw.conflicts.filter(c => c && typeof c === 'object').map(c => ({
      requirement: String(c.requirement || ''), fact: String(c.fact || ''), recordedBy: String(c.recordedBy || ''), date: String(c.date || '') })) : [];
    const { values } = validateInputs(r.inputs);
    r.screening = screen(values, r.tasks, r.parcel, r.conflicts);
    return r;
  }

  function parseStore(text){
    const empty = { schemaVersion: SCHEMA_VERSION, records: {}, currentId: null };
    if(!text) return { store: empty, warning: null };
    let raw;
    try { raw = JSON.parse(text); } catch(e){ return { store: empty, warning: 'Saved lease screens could not be read (corrupted data). Starting fresh; the old data was left in place.' }; }
    if(!raw || typeof raw !== 'object' || typeof raw.records !== 'object' || raw.records === null) return { store: empty, warning: 'Saved lease screens were in an unexpected format. Starting fresh.' };
    const store = { schemaVersion: SCHEMA_VERSION, records: {}, currentId: null };
    let dropped = 0;
    Object.values(raw.records).forEach(rec => { const n = normalizeRecord(rec); if(n) store.records[n.id] = n; else dropped++; });
    store.currentId = store.records[raw.currentId] ? raw.currentId : (Object.keys(store.records)[0] || null);
    const warning = dropped ? dropped + ' saved screen' + (dropped > 1 ? 's' : '') + ' could not be read and were skipped.'
      : (raw.schemaVersion && raw.schemaVersion > SCHEMA_VERSION ? 'Saved data is from a newer version; some fields may be ignored.' : null);
    return { store, warning };
  }

  return { SCHEMA_VERSION, STORAGE_KEY, DEMO_LABEL, NO_DOC_NOTICE, EXCERPT_LABEL, STATUS, OPTIONS, FORM_SCHEMA, FIELDS, NUMERIC, TASK_STATUS, RULES, CATEGORY_LABEL,
    label, blankInputs, parseNumber, validateInputs, rentSchedule, calcRent, generateTasks, updateTask, isResolved, resolutionProblem,
    screen, buildEvidence, termIssues, buildMemo, toMarkdown, mdEscape, newRecord, demoRecord, generate, inputsChangedSinceGenerate,
    normalizeRecord, parseStore, hash, fmtMoney };
});
