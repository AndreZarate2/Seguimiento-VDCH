let DATA = { projects: [] };
let CONTROL_DATE = new Date();
let GLOBAL_STATUS = 'all';

const LEGACY_CONFIRM_KEY = 'zc_confirmations';
const MANUAL_STATUS_KEY = 'zc_manual_task_status_v3';
const TREE_STATE_KEY = 'zc_tree_state_v5_independent';
const CONFIRM_SYNC_EVENT_KEY = 'zc_confirmation_sync_event_v2';
const REMOTE_REFRESH_INTERVAL_MS = 30000;
const MIN_REMOTE_REFRESH_INTERVAL_MS = 5000;

let confirms = safeJSON(localStorage.getItem(LEGACY_CONFIRM_KEY), {});
let manualStatus = safeJSON(localStorage.getItem(MANUAL_STATUS_KEY), {});
let treeState = safeJSON(localStorage.getItem(TREE_STATE_KEY), { signature: '', table: {}, gantt: {} });
let pendingConfirmationWrites = {};
let remoteRefreshTimer = null;
let remoteRefreshInFlight = null;
let remoteRefreshStarted = false;
let lastRemoteRefreshAt = 0;

function safeJSON(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch (_) { return fallback; }
}
function qs(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? '').replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m])); }
function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function d(v) { if (!v) return null; const x = new Date(v); return isNaN(x) ? null : x; }
function day(v) { const x = d(v); return x ? new Date(x.getFullYear(), x.getMonth(), x.getDate()) : null; }
function fmt(v) { const x = d(v); return x ? x.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Sin fecha'; }
function monthShort(v) {
  const x = d(v);
  const names = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  return x ? `${names[x.getMonth()]} - ${String(x.getFullYear()).slice(-2)}` : '';
}
function pct(n) { return Math.max(0, Math.min(100, Math.round(Number(n) || 0))); }
function projectById(id) { return DATA.projects.find(p => p.id === id); }
function isSummary(t) { return !!t?.is_summary || !!t?.summary || String(t?.type || '').toLowerCase() === 'summary'; }
function tasksOf(p) { return (p?.tasks || []).filter(t => String(t.outline || '') !== '0' && t.hidden !== true); }
function taskKey(t) { return t.project_id + '|' + (t.uid || t.unique_id || t.task_id || t.outline); }
function saveConfirm() { localStorage.setItem(LEGACY_CONFIRM_KEY, JSON.stringify(confirms)); }
function saveManualStatus() { localStorage.setItem(MANUAL_STATUS_KEY, JSON.stringify(manualStatus)); }
function saveTreeState() { localStorage.setItem(TREE_STATE_KEY, JSON.stringify(treeState)); }
function reloadLocalState() {
  confirms = safeJSON(localStorage.getItem(LEGACY_CONFIRM_KEY), {});
  manualStatus = safeJSON(localStorage.getItem(MANUAL_STATUS_KEY), {});
  treeState = safeJSON(localStorage.getItem(TREE_STATE_KEY), { signature: '', table: {}, gantt: {} });
}
function emitConfirmationSync(key, value) {
  localStorage.setItem(CONFIRM_SYNC_EVENT_KEY, JSON.stringify({ key, value, ts: Date.now() }));
}

function isRemoteData() {
  return DATA?.source === 'Supabase';
}
function setLoadedData(next) {
  DATA = next || { projects: [] };
  DATA.projects = (DATA.projects || []).map(normalizeProject);
  initializeTreeState();
  if (isRemoteData()) lastRemoteRefreshAt = Date.now();
}
function clearLocalConfirmationKey(key) {
  let changedManual = false;
  let changedConfirm = false;
  if (Object.prototype.hasOwnProperty.call(manualStatus, key)) {
    delete manualStatus[key];
    changedManual = true;
  }
  if (Object.prototype.hasOwnProperty.call(confirms, key)) {
    delete confirms[key];
    changedConfirm = true;
  }
  if (changedManual) saveManualStatus();
  if (changedConfirm) saveConfirm();
}
async function refreshDataFromSupabase({ force = false, silent = false } = {}) {
  if (!supabaseEnabled()) return false;
  const now = Date.now();
  if (!force && now - lastRemoteRefreshAt < MIN_REMOTE_REFRESH_INTERVAL_MS) return false;
  if (remoteRefreshInFlight) return remoteRefreshInFlight;
  lastRemoteRefreshAt = now;
  remoteRefreshInFlight = (async () => {
    try {
      setLoadedData(await loadDataFromSupabase());
      render();
      return true;
    } catch (err) {
      console.warn('No se pudo refrescar Supabase', err);
      if (!silent) showToast('Aviso de Supabase', 'No se pudo actualizar desde Supabase. Detalle: ' + esc(err.message || err));
      return false;
    } finally {
      remoteRefreshInFlight = null;
    }
  })();
  return remoteRefreshInFlight;
}
function startSupabaseAutoRefresh() {
  if (remoteRefreshStarted || !supabaseEnabled()) return;
  remoteRefreshStarted = true;
  remoteRefreshTimer = setInterval(() => {
    if (!document.hidden) refreshDataFromSupabase({ silent: true });
  }, REMOTE_REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshDataFromSupabase({ force: true, silent: true });
  });
  window.addEventListener('focus', () => refreshDataFromSupabase({ force: true, silent: true }));
}

async function loadData() {
  const cfg = window.ZC_CONFIG || {};
  if (cfg.useSupabaseData && cfg.supabaseUrl && cfg.supabaseKey) {
    try {
      setLoadedData(await loadDataFromSupabase(cfg));
      return;
    } catch (err) {
      console.error(err);
      showToast('Aviso de Supabase', 'No se pudo leer Supabase. Se cargara el JSON local como respaldo. Detalle: ' + esc(err.message || err));
    }
  }
  try {
    const r = await fetch('data/projects.json?ts=' + Date.now(), { cache: 'no-store' });
    setLoadedData(await r.json());
  } catch (err) {
    console.error(err);
    showToast('Error al cargar datos', 'No se pudo leer data/projects.json ni Supabase. Verifica la configuracion.');
  }
}

async function supabaseRest(path) {
  const cfg = window.ZC_CONFIG || {};
  const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
  const res = await fetch(base + '/rest/v1/' + path, {
    headers: {
      apikey: cfg.supabaseKey,
      Authorization: 'Bearer ' + cfg.supabaseKey,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('REST ' + res.status + ' ' + text);
  }
  return await res.json();
}

function supabaseEnabled() {
  const cfg = window.ZC_CONFIG || {};
  return !!(cfg.useSupabaseData && cfg.supabaseUrl && cfg.supabaseKey);
}
async function supabaseMutate(method, path, body = null, extraHeaders = {}) {
  const cfg = window.ZC_CONFIG || {};
  const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
  const headers = {
    apikey: cfg.supabaseKey,
    Authorization: 'Bearer ' + cfg.supabaseKey,
    Accept: 'application/json',
    ...extraHeaders
  };
  const opts = { method, headers, cache: 'no-store' };
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(base + '/rest/v1/' + path, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Supabase no acepto la confirmacion: ' + res.status + ' ' + text);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
function controlDateISO() {
  const x = day(CONTROL_DATE) || day(new Date());
  return x ? x.toISOString().slice(0, 10) : null;
}
async function persistConfirmationToSupabase(t, value) {
  if (!supabaseEnabled()) return { skipped: true };
  if (!t?.uid) throw new Error('La tarea no tiene uid para sincronizar con Supabase.');
  if (value) {
    await supabaseMutate(
      'POST',
      'task_confirmations?on_conflict=uid',
      {
        uid: t.uid,
        confirmed: true,
        confirmed_at: new Date().toISOString(),
        control_date: controlDateISO(),
        note: null
      },
      { Prefer: 'resolution=merge-duplicates,return=minimal' }
    );
  } else {
    await supabaseMutate(
      'DELETE',
      'task_confirmations?uid=eq.' + encodeURIComponent(t.uid),
      null,
      { Prefer: 'return=minimal' }
    );
  }
  return { synced: true };
}

async function loadDataFromSupabase() {
  const [projects, tasks] = await Promise.all([
    supabaseRest('projects?select=*&active=eq.true&order=id.asc'),
    supabaseRest('v_tasks_web?select=*&order=project_id.asc,sort_order.asc,outline.asc')
  ]);
  const byProject = new Map();
  (projects || []).forEach(p => {
    byProject.set(p.id, {
      id: p.id,
      name: p.name,
      short: p.short || p.name,
      description: p.description,
      source_file: p.source_file,
      title: p.title,
      author: p.author,
      start: p.start_at,
      finish: p.finish_at,
      creation_date: p.creation_date,
      last_saved: p.last_saved_at,
      tasks: [],
      verification: { activities_total: 0, summary_total: 0, source: 'Supabase' }
    });
  });
  (tasks || []).forEach(t => {
    const pid = t.project_id;
    if (!byProject.has(pid)) {
      byProject.set(pid, { id: pid, name: t.project_name || pid, short: t.project_short || pid, tasks: [], verification: { activities_total: 0, summary_total: 0, source: 'Supabase' } });
    }
    byProject.get(pid).tasks.push({
      ...t,
      start: t.start_at,
      finish: t.finish_at,
      responsible: t.responsible,
      predecessors: Array.isArray(t.predecessors) ? t.predecessors : [],
      confirmed: !!t.confirmed
    });
  });
  const out = Array.from(byProject.values());
  out.forEach(p => {
    p.tasks.sort((a, b) => outlineCompare(a.outline, b.outline));
    p.verification.activities_total = p.tasks.filter(t => !isSummary(t)).length;
    p.verification.summary_total = p.tasks.filter(isSummary).length;
    p.start = p.start || minDate(p.tasks.map(t => t.start));
    p.finish = p.finish || maxDate(p.tasks.map(t => t.finish));
  });
  return { projects: out, generated_on: new Date().toISOString(), source: 'Supabase' };
}

function normalizeProject(p) {
  p.id = p.id || slug(p.short || p.name || 'proyecto');
  p.short = p.short || p.name || p.id;
  p.tasks = (p.tasks || []).map((t, i) => ({
    ...t,
    project_id: t.project_id || p.id,
    project_short: t.project_short || p.short,
    uid: t.uid || `${p.id}-${t.unique_id ?? t.task_id ?? i}`,
    task_id: t.task_id ?? i,
    unique_id: t.unique_id ?? i,
    outline: String(t.outline ?? (i + 1)),
    outline_level: Number(t.outline_level ?? String(t.outline ?? '').split('.').length),
    name: t.name || 'Sin nombre',
    predecessors: Array.isArray(t.predecessors) ? t.predecessors : []
  }));
  p.tasks.sort((a, b) => outlineCompare(a.outline, b.outline));
  p.verification = p.verification || { activities_total: p.tasks.filter(t => !isSummary(t)).length, summary_total: p.tasks.filter(isSummary).length };
  p.start = p.start || minDate(p.tasks.map(t => t.start));
  p.finish = p.finish || maxDate(p.tasks.map(t => t.finish));
  return p;
}
function minDate(values) { const arr = values.map(d).filter(Boolean).sort((a, b) => a - b); return arr[0]?.toISOString() || null; }
function maxDate(values) { const arr = values.map(d).filter(Boolean).sort((a, b) => b - a); return arr[0]?.toISOString() || null; }

function outlineCompare(a, b) {
  const aa = String(a || '').split('.').map(Number);
  const bb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] || 0;
    const y = bb[i] || 0;
    if (x !== y) return x - y;
  }
  return String(a || '').localeCompare(String(b || ''));
}
function parentOutlines(outline) {
  const parts = String(outline || '').split('.').filter(Boolean);
  const out = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('.'));
  return out;
}
function hasChildren(p, t) {
  const o = String(t.outline || '');
  return tasksOf(p).some(x => x.uid !== t.uid && String(x.outline || '').startsWith(o + '.'));
}
function descendantsOf(p, t) {
  const o = String(t.outline || '');
  return tasksOf(p).filter(x => x.uid !== t.uid && String(x.outline || '').startsWith(o + '.'));
}

function treeSignature() {
  return (DATA.projects || []).map(p => `${p.id}:${tasksOf(p).length}:${tasksOf(p).map(t => t.uid + '@' + t.outline).join(',')}`).join('|');
}
function initializeTreeState(force = false) {
  const sig = treeSignature();
  if (!force && treeState.signature === sig && treeState.table && treeState.gantt) return;
  treeState.signature = sig;
  treeState.table = {};
  treeState.gantt = {};
  DATA.projects.forEach(p => {
    tasksOf(p).forEach(t => {
      if (hasChildren(p, t) && Number(t.outline_level || 1) >= 2) {
        treeState.table[p.id + '|' + t.outline] = true;
        treeState.gantt[p.id + '|' + t.outline] = true;
      }
    });
  });
  saveTreeState();
}
function treeMap(view) {
  if (!treeState[view]) treeState[view] = {};
  return treeState[view];
}
function isHiddenByCollapse(t, view = 'table') {
  const map = treeMap(view);
  return parentOutlines(t.outline).some(o => map[t.project_id + '|' + o]);
}
function toggleNode(pid, outline, view = 'table') {
  const map = treeMap(view);
  const k = pid + '|' + outline;
  if (map[k]) delete map[k]; else map[k] = true;
  saveTreeState();
  if (view === 'gantt') renderGantt(pid); else renderTable(pid);
}
function setProjectTree(pid, close, view = 'table') {
  const p = projectById(pid);
  const map = treeMap(view);
  tasksOf(p).filter(t => hasChildren(p, t)).forEach(t => {
    const k = pid + '|' + t.outline;
    if (close) map[k] = true; else delete map[k];
  });
  saveTreeState();
  if (view === 'gantt') renderGantt(pid); else renderTable(pid);
}
function resetProjectTree(pid, view = 'table') {
  const p = projectById(pid);
  const map = treeMap(view);
  Object.keys(map).filter(k => k.startsWith(pid + '|')).forEach(k => delete map[k]);
  tasksOf(p).filter(t => hasChildren(p, t) && Number(t.outline_level || 1) >= 2).forEach(t => { map[pid + '|' + t.outline] = true; });
  saveTreeState();
  if (view === 'gantt') renderGantt(pid); else renderTable(pid);
}

function manualState(t) {
  const k = taskKey(t);
  if (pendingConfirmationWrites[k]) return pendingConfirmationWrites[k];
  if (isRemoteData()) return '';
  if (manualStatus[k]) return manualStatus[k];
  if (confirms[k]) return 'confirmed';
  return '';
}
function isConfirmed(t) {
  const st = manualState(t);
  if (st === 'pending') return false;
  if (st === 'confirmed') return true;
  return !!t.confirmed;
}
function autoProgress(t) {
  if (isConfirmed(t)) return 100;
  const s = day(t.start), f = day(t.finish), c = day(CONTROL_DATE);
  if (!s || !f) return pct(t.percent_complete || 0);
  if (c < s) return 0;
  if (c > f) return 100;
  const total = Math.max(1, f - s), done = Math.max(0, c - s);
  return pct((done / total) * 100);
}
function statusOf(t) {
  if (isConfirmed(t)) return 'Terminado';
  const s = day(t.start), f = day(t.finish), c = day(CONTROL_DATE);
  if (!s || !f) return 'Sin fecha';
  if (c < s) return 'Pendiente';
  if (c > f) return 'Vencido';
  return 'En ejecución';
}
function statusClass(st) { return st === 'Terminado' ? 'done' : st === 'Vencido' ? 'overdue' : st === 'En ejecución' ? 'running' : st === 'Sin fecha' ? 'confirm' : 'pending'; }
function progressClass(st) { return st === 'Terminado' ? 'done' : st === 'Vencido' ? 'overdue' : st === 'Pendiente' ? 'pending' : ''; }
function summaryStats(tasks) {
  const base = tasks.filter(t => !isSummary(t));
  const s = { total: base.length, pendiente: 0, ejecucion: 0, vencido: 0, terminado: 0, sinfecha: 0 };
  base.forEach(t => { const st = statusOf(t); if (st === 'Pendiente') s.pendiente++; else if (st === 'En ejecución') s.ejecucion++; else if (st === 'Vencido') s.vencido++; else if (st === 'Terminado') s.terminado++; else s.sinfecha++; });
  return s;
}
function projectProgress(pid) {
  const p = projectById(pid);
  const acts = tasksOf(p).filter(t => !isSummary(t));
  if (!acts.length) return 0;
  return acts.reduce((a, t) => a + autoProgress(t), 0) / acts.length;
}

function activeProjects() {
  const page = document.body.dataset.page || 'home';
  if (page === 'conexion') return DATA.projects.filter(p => p.id === 'conexion-vdch');
  if (page === 'alimentador') return DATA.projects.filter(p => p.id === 'alimentador-sullana');
  return DATA.projects;
}
function render() {
  const dateLbl = qs('control-date-label');
  if (dateLbl) dateLbl.textContent = fmt(CONTROL_DATE);
  renderGlobalMetrics();
  renderVerification();
  renderStatusSummary();
  renderProjectSections();
  renderAlerts();
}
function renderGlobalMetrics() {
  const el = qs('global-metrics');
  if (!el) return;
  const ps = activeProjects();
  const tasks = ps.flatMap(tasksOf);
  const acts = tasks.filter(t => !isSummary(t));
  const stats = summaryStats(tasks);
  el.innerHTML = [
    ['Proyectos', ps.length, 'Cronogramas cargados'],
    ['Actividades', acts.length, 'Sin contar grupos'],
    ['En ejecución', stats.ejecucion, 'Dentro del plazo'],
    ['Vencidos', stats.vencido, 'Por confirmar'],
    ['Avance promedio', pct(acts.reduce((a, t) => a + autoProgress(t), 0) / (acts.length || 1)) + '%', 'Según fecha de control']
  ].map(m => `<div class="metric"><span>${m[0]}</span><strong>${m[1]}</strong><small>${m[2]}</small></div>`).join('');
}
function renderVerification() {
  if (!qs('verification-grid')) return;
  const ps = activeProjects();
  const regs = ps.reduce((a, p) => a + (p.tasks?.length || 0), 0);
  const acts = ps.reduce((a, p) => a + (p.verification?.activities_total || p.tasks.filter(t => !isSummary(t)).length), 0);
  const sums = ps.reduce((a, p) => a + (p.verification?.summary_total || p.tasks.filter(isSummary).length), 0);
  qs('verification-grid').innerHTML = `<div class="metric"><span>Archivos fuente</span><strong>${ps.length}</strong><small>.mpp</small></div><div class="metric"><span>Registros</span><strong>${regs}</strong><small>Total importado</small></div><div class="metric"><span>Actividades</span><strong>${acts}</strong><small>Tareas ejecutables</small></div><div class="metric"><span>Fases</span><strong>${sums}</strong><small>Grupos y resumen</small></div>`;
  const tb = document.querySelector('#verification-table tbody');
  if (tb) tb.innerHTML = ps.map(p => `<tr><td><b>${esc(p.short)}</b></td><td>${esc(p.source_file || '')}</td><td>${p.tasks.length}</td><td>${p.verification.activities_total}</td><td>${p.verification.summary_total}</td><td>${fmt(p.start)} - ${fmt(p.finish)}</td></tr>`).join('');
}
function renderStatusSummary() {
  const el = qs('status-kpis');
  if (!el) return;
  const tasks = activeProjects().flatMap(tasksOf);
  const s = summaryStats(tasks);
  el.innerHTML = `<div class="status-card"><span>Total</span><b>${s.total}</b></div><div class="status-card"><span>Pendientes</span><b>${s.pendiente}</b></div><div class="status-card"><span>En ejecución</span><b>${s.ejecucion}</b></div><div class="status-card"><span>Vencidos</span><b>${s.vencido}</b></div><div class="status-card"><span>Terminados</span><b>${s.terminado}</b></div><div class="status-card"><span>Sin fecha</span><b>${s.sinfecha}</b></div>`;
  fillMiniList('running-list', tasks.filter(t => !isSummary(t) && statusOf(t) === 'En ejecución').slice(0, 8));
  fillMiniList('overdue-list', tasks.filter(t => !isSummary(t) && statusOf(t) === 'Vencido').slice(0, 8));
  if (qs('running-count')) qs('running-count').textContent = s.ejecucion;
  if (qs('overdue-count')) qs('overdue-count').textContent = s.vencido;
}
function fillMiniList(id, items) {
  const el = qs(id);
  if (!el) return;
  el.innerHTML = items.length ? items.map(t => `<div class="alert-item"><b>${esc(t.name)}</b><small>${esc(t.project_short)} · ${fmt(t.start)} - ${fmt(t.finish)}</small></div>`).join('') : '<div class="alert-item"><small>Sin registros.</small></div>';
}
function setGlobalStatus(st) {
  GLOBAL_STATUS = st;
  document.querySelectorAll('#quick-filters .tab').forEach(b => b.classList.toggle('active', b.dataset.status === st));
  renderProjectSections();
}

function renderProjectSections() {
  const wrap = qs('project-sections');
  if (!wrap) return;
  const ps = activeProjects();
  const page = document.body.dataset.page || 'home';
  if (page === 'home') {
    wrap.innerHTML = `<div class="section-head"><div><h2>Acceso por proyecto</h2><p>Selecciona el cronograma para revisar Gantt, tabla, dependencias y confirmaciones.</p></div><span class="badge summary">${ps.length} proyectos</span></div><div class="project-home-grid">${ps.map(homeCard).join('')}</div>`;
    return;
  }
  wrap.innerHTML = ps.map(projectHTML).join('');
  ps.forEach(p => { renderProjectKPIs(p.id); renderTable(p.id); renderGantt(p.id); });
}
function homeCard(p) {
  const stats = summaryStats(tasksOf(p));
  const href = p.id === 'conexion-vdch' ? 'conexion.html' : 'alimentador.html';
  return `<article class="project-home-card"><span class="eyebrow">${esc(p.short)}</span><h3>${esc(p.name)}</h3><p>${esc(p.description || 'Cronograma de seguimiento')}</p><div class="meta"><span class="badge pending">${fmt(p.start)} - ${fmt(p.finish)}</span><span class="badge running">${p.verification.activities_total} actividades</span><span class="badge summary">${pct(projectProgress(p.id))}% avance</span></div><div class="hero-actions"><a class="btn primary" href="${href}">Abrir Gantt y tabla</a><button class="btn" onclick="exportCSV('${p.id}')">Exportar CSV</button></div><p class="muted">Vencidos por confirmar: <b>${stats.vencido}</b> · En ejecución: <b>${stats.ejecucion}</b></p></article>`;
}
function projectHTML(p) {
  return `<section id="p-${p.id}"><div class="project-header"><div class="project-card"><span class="eyebrow">${esc(p.short)}</span><h2>${esc(p.name)}</h2><p>${esc(p.description || 'Cronograma de seguimiento')}</p><div class="meta"><span class="badge summary">${esc(p.source_file || 'Archivo .mpp')}</span><span class="badge pending">${fmt(p.start)} - ${fmt(p.finish)}</span><span class="badge running">${p.verification.activities_total} actividades</span></div></div><div class="project-card"><h3>Avance del proyecto</h3><strong style="font-size:42px" id="project-progress-${p.id}">0%</strong><div class="progress"><i id="project-progress-bar-${p.id}"></i></div><p id="project-status-${p.id}" class="muted"></p></div></div><div class="kpi-row" id="kpis-${p.id}" style="margin-top:14px"></div><div class="section" style="box-shadow:none;margin-top:16px;padding:16px"><div class="section-head"><div><h3>Tabla de seguimiento plegable · ${esc(p.short)}</h3><p>Inicia agrupada por fases. Cada grupo y subgrupo se despliega de forma independiente.</p></div><div class="toolbar"><button class="btn small" onclick="setProjectTree('${p.id}',false,'table')">Expandir tabla</button><button class="btn small" onclick="setProjectTree('${p.id}',true,'table')">Contraer tabla</button><button class="btn small" onclick="resetProjectTree('${p.id}','table')">Vista agrupada</button><button class="btn small" onclick="exportCSV('${p.id}')">CSV</button></div></div><div class="controls"><div class="field"><label>Buscar</label><input id="search-${p.id}" placeholder="Actividad, responsable o predecesor" oninput="renderTable('${p.id}')"></div><div class="field"><label>Estado</label><select id="filter-status-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option>Pendiente</option><option>En ejecución</option><option>Vencido</option><option>Terminado</option><option>Sin fecha</option></select></div><div class="field"><label>Tipo</label><select id="filter-type-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option value="summary">Grupos</option><option value="task">Actividades</option></select></div><div class="field"><label>Ruta crítica</label><select id="filter-critical-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option value="critical">Crítica</option><option value="noncritical">No crítica</option></select></div><div class="field"><label>Dependencia</label><select id="filter-dependency-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option value="linked">Amarradas</option><option value="blocked">Bloqueadas</option><option value="free">Sin amarre</option></select></div></div><div class="table-wrap"><table class="table" id="table-${p.id}"><thead><tr><th>Código</th><th>Grupo / actividad</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Avance</th><th>Estado</th><th>Predecesores</th><th>Confirmación</th><th>Responsable / notas</th></tr></thead><tbody></tbody></table></div></div><div class="section" style="box-shadow:none;margin-top:16px;padding:16px"><div class="section-head"><div><h3>Gantt plegable con flechas de dependencia · ${esc(p.short)}</h3><p>El Gantt inicia agrupado. Las flechas muestran qué actividad está amarrada con cuál.</p></div><div class="toolbar"><button class="btn small" onclick="setProjectTree('${p.id}',false,'gantt')">Expandir Gantt</button><button class="btn small" onclick="setProjectTree('${p.id}',true,'gantt')">Contraer Gantt</button><button class="btn small" onclick="resetProjectTree('${p.id}','gantt')">Vista agrupada</button></div></div><div class="gantt-legend"><span><i class="legend-line"></i> Amarre liberado</span><span><i class="legend-line blocked"></i> Amarre pendiente</span></div><div class="gantt" id="gantt-${p.id}"></div></div></section>`;
}
function renderProjectKPIs(pid) {
  const p = projectById(pid), s = summaryStats(tasksOf(p)), prog = pct(projectProgress(pid));
  if (qs('project-progress-' + pid)) qs('project-progress-' + pid).textContent = prog + '%';
  if (qs('project-progress-bar-' + pid)) qs('project-progress-bar-' + pid).style.width = prog + '%';
  if (qs('project-status-' + pid)) qs('project-status-' + pid).textContent = `${s.terminado} terminadas · ${s.vencido} vencidas · ${s.ejecucion} en ejecución`;
  if (qs('kpis-' + pid)) qs('kpis-' + pid).innerHTML = `<div class="status-card"><span>Pendientes</span><b>${s.pendiente}</b></div><div class="status-card"><span>En ejecución</span><b>${s.ejecucion}</b></div><div class="status-card"><span>Vencidos</span><b>${s.vencido}</b></div><div class="status-card"><span>Terminados</span><b>${s.terminado}</b></div><div class="status-card"><span>Sin fecha</span><b>${s.sinfecha}</b></div><div class="status-card"><span>Avance</span><b>${prog}%</b></div>`;
}

function filteredTasks(pid, view = 'table') {
  const p = projectById(pid);
  let rows = tasksOf(p).sort((a, b) => outlineCompare(a.outline, b.outline));
  const search = (qs('search-' + pid)?.value || '').toLowerCase();
  const st = qs('filter-status-' + pid)?.value || GLOBAL_STATUS;
  const type = qs('filter-type-' + pid)?.value || 'all';
  const crit = qs('filter-critical-' + pid)?.value || 'all';
  const dep = qs('filter-dependency-' + pid)?.value || 'all';
  rows = rows.filter(t => !isHiddenByCollapse(t, view));
  rows = rows.filter(t => {
    if (search && ![t.name, t.responsible, t.resource_names, t.notes, t.predecessor_text].join(' ').toLowerCase().includes(search)) return false;
    const status = statusOf(t);
    if (st && st !== 'all' && status !== st) return false;
    if (type === 'summary' && !isSummary(t)) return false;
    if (type === 'task' && isSummary(t)) return false;
    if (crit === 'critical' && !t.critical) return false;
    if (crit === 'noncritical' && t.critical) return false;
    const ds = dependencyState(t);
    if (dep === 'linked' && !ds.has) return false;
    if (dep === 'blocked' && !ds.blocked) return false;
    if (dep === 'free' && ds.has) return false;
    return true;
  });
  return rows;
}
function renderTable(pid) {
  const p = projectById(pid);
  const tb = document.querySelector(`#table-${pid} tbody`);
  if (!tb) return;
  const rows = filteredTasks(pid, 'table');
  tb.innerHTML = rows.map(t => {
    const st = statusOf(t), pr = autoProgress(t), group = isSummary(t), hc = hasChildren(p, t), col = treeMap('table')[pid + '|' + t.outline];
    const pad = Math.max(0, Number(t.outline_level || 1) - 1) * 18;
    const ds = dependencyState(t);
    return `<tr class="${group ? 'table-group level-' + t.outline_level : ''} ${ds.blocked && !group ? 'table-blocked' : ''}"><td>${hc ? `<button class="tree-toggle ${col ? 'collapsed' : ''}" title="Desplegar / contraer" onclick="toggleNode('${pid}','${esc(t.outline)}','table')">${col ? '+' : '−'}</button>` : '<span class="tree-toggle-spacer"></span>'}<span class="outline">${esc(t.outline)}</span></td><td class="name-cell" style="padding-left:${pad + 10}px"><b>${esc(t.name)}</b>${t.critical ? ' <span class="badge confirm">Crítica</span>' : ''}</td><td>${fmt(t.start)}</td><td>${fmt(t.finish)}</td><td>${esc(t.duration_text || durationDays(t))}</td><td><div class="progress ${progressClass(st)}"><i style="width:${pr}%"></i></div><span class="progress-number">${pr}%</span></td><td><span class="badge ${statusClass(st)}">${st}</span></td><td>${dependencyHTML(t)}</td><td>${confirmHTML(t)}</td><td><b>${esc(t.responsible || t.resource_names || '')}</b><small class="muted">${esc(t.notes || '')}</small></td></tr>`;
  }).join('') || '<tr><td colspan="10">Sin resultados.</td></tr>';
  renderProjectKPIs(pid);
}
function durationDays(t) {
  const s = day(t.start), f = day(t.finish);
  if (!s || !f) return '';
  return Math.max(0, Math.round((f - s) / 86400000) + 1) + 'd';
}

function normalizePredecessorItem(item) {
  if (item === null || item === undefined || item === '') return null;
  if (typeof item === 'number' || typeof item === 'string') {
    const raw = String(item).trim();
    const m = raw.match(/^(\d+)([A-Z]{2})?(.*)$/i);
    return { task_id: m ? Number(m[1]) : raw, unique_id: m ? Number(m[1]) : raw, type: m?.[2] || 'FS', lag: (m?.[3] || '').trim(), raw };
  }
  const pred = item.predecessor || item.pred || item.from || item.source || item;
  return {
    uid: pred.uid || pred.task_uid || pred.predecessor_uid || item.uid || item.predecessor_uid,
    outline: pred.outline || pred.outline_number || pred.wbs || item.outline || item.predecessor_outline,
    task_id: pred.task_id ?? pred.id ?? pred.taskId ?? pred.predecessor_task_id ?? item.task_id ?? item.id ?? item.predecessor_task_id,
    unique_id: pred.unique_id ?? pred.uniqueId ?? pred.uniqueID ?? pred.predecessor_unique_id ?? pred.predecessorUniqueID ?? item.unique_id ?? item.uniqueID ?? item.predecessor_unique_id,
    name: pred.name || item.name || item.predecessor_name,
    type: item.type || item.relation || item.link_type || pred.type || 'FS',
    lag: item.lag || item.lag_text || pred.lag || '',
    raw: item
  };
}
function findPredecessorTask(t, pred) {
  const p = projectById(t.project_id);
  if (!p || !pred) return null;
  const candidates = p.tasks || [];
  const uid = pred.uid != null ? String(pred.uid) : '';
  const outline = pred.outline != null ? String(pred.outline) : '';
  const taskId = pred.task_id != null && pred.task_id !== '' ? Number(pred.task_id) : NaN;
  const uniqueId = pred.unique_id != null && pred.unique_id !== '' ? Number(pred.unique_id) : NaN;
  return candidates.find(x => uid && String(x.uid) === uid) ||
    candidates.find(x => outline && String(x.outline) === outline) ||
    candidates.find(x => !Number.isNaN(uniqueId) && Number(x.unique_id) === uniqueId) ||
    candidates.find(x => !Number.isNaN(taskId) && Number(x.task_id) === taskId) ||
    candidates.find(x => !Number.isNaN(taskId) && Number(x.unique_id) === taskId) ||
    null;
}
function parsePredecessorText(t) {
  const txt = String(t.predecessor_text || t.predecessors_text || '').trim();
  if (!txt) return [];
  return txt.split(/[;,]/).map(part => part.trim()).filter(Boolean).map(part => {
    const m = part.match(/^(\d+)([A-Z]{2})?(.*)$/i);
    if (!m) return null;
    const task_id = Number(m[1]);
    return { task_id, unique_id: task_id, type: m[2] || 'FS', lag: (m[3] || '').trim(), raw: part };
  }).filter(Boolean);
}
function predecessorLinks(t) {
  const jsonItems = Array.isArray(t.predecessors) ? t.predecessors : [];
  const normalized = jsonItems.map(normalizePredecessorItem).filter(Boolean);
  const parsedText = parsePredecessorText(t);
  const combined = [...normalized, ...parsedText];
  const seen = new Set();
  return combined.map(pred => {
    const task = findPredecessorTask(t, pred);
    const key = String(task?.uid || pred.uid || pred.outline || pred.unique_id || pred.task_id || pred.raw);
    if (seen.has(key)) return null;
    seen.add(key);
    return { type: pred.type || 'FS', lag: pred.lag || '', outline: pred.outline || '', name: pred.name || '', task, pred };
  }).filter(Boolean);
}
function isCompleteForDependency(task) {
  if (!task) return false;
  if (isConfirmed(task)) return true;
  if (isSummary(task)) {
    const p = projectById(task.project_id);
    const leaves = descendantsOf(p, task).filter(x => !isSummary(x));
    return leaves.length > 0 && leaves.every(isCompleteForDependency);
  }
  return false;
}
function dependencyState(t) {
  const links = predecessorLinks(t);
  const pending = links.filter(l => !l.task || !isCompleteForDependency(l.task));
  return { has: links.length > 0, links, pending, blocked: links.length > 0 && pending.length > 0 };
}
function dependencyHTML(t) {
  const dep = dependencyState(t);
  if (!dep.has) return '<span class="dep-badge free">Sin amarre</span>';
  const badge = `<span class="dep-badge ${dep.blocked ? 'blocked' : 'linked'}">${dep.blocked ? 'Amarre pendiente' : 'Amarrada'}</span>`;
  return badge + '<div class="dep-list">' + dep.links.map(l => {
    const ok = l.task && isCompleteForDependency(l.task);
    return `<div class="dep-item ${ok ? 'ok' : 'blocked'}"><b>${esc(l.task?.outline || l.pred?.outline || l.pred?.task_id || l.pred?.unique_id || '-')} · ${esc(l.task?.name || l.name || 'Predecesor')}</b><br>${esc(l.type || 'FS')} ${esc(l.lag || '')} · ${ok ? 'Liberado' : 'Pendiente'}</div>`;
  }).join('') + '</div>';
}
function canConfirmTask(t) {
  if (isSummary(t)) return { ok: false, reason: 'Es grupo' };
  if (!d(t.start) || !d(t.finish)) return { ok: false, reason: 'Sin fecha' };
  const dep = dependencyState(t);
  if (dep.blocked) {
    const names = dep.pending.slice(0, 3).map(l => l.task?.outline || l.outline || 'predecesor').join(', ');
    return { ok: false, reason: 'Pendiente: ' + names };
  }
  return { ok: true, reason: '' };
}
function confirmHTML(t) {
  if (isSummary(t)) return '<span class="muted">Grupo</span>';
  if (isConfirmed(t)) {
    return `<div class="confirm-actions"><span class="badge done">Terminado</span><button class="btn small red" onclick="setTaskConfirmation('${esc(taskKey(t))}', false)">Quitar terminado</button></div>`;
  }
  const chk = canConfirmTask(t);
  if (!chk.ok) {
    return `<div class="confirm-actions"><button class="btn small" disabled>No confirmable</button><small class="confirm-note">${esc(chk.reason)}</small></div>`;
  }
  return `<button class="btn small green" onclick="setTaskConfirmation('${esc(taskKey(t))}', true)">Confirmar terminado</button>`;
}
async function setTaskConfirmation(key, value) {
  const t = taskByKey(key);
  if (!t) return;
  if (value) {
    const chk = canConfirmTask(t);
    if (!chk.ok) { showToast('No se puede confirmar', esc(chk.reason)); return; }
  }

  const oldManual = manualStatus[key];
  const oldLocalConfirm = confirms[key];
  const oldServerConfirm = !!t.confirmed;
  const oldPending = pendingConfirmationWrites[key];

  pendingConfirmationWrites[key] = value ? 'confirmed' : 'pending';
  if (value) {
    manualStatus[key] = 'confirmed';
    confirms[key] = new Date().toISOString();
    t.confirmed = true;
  } else {
    manualStatus[key] = 'pending';
    delete confirms[key];
    t.confirmed = false;
  }
  saveManualStatus();
  saveConfirm();
  emitConfirmationSync(key, value);
  render();

  try {
    const result = await persistConfirmationToSupabase(t, value);
    if (oldPending === undefined) delete pendingConfirmationWrites[key]; else pendingConfirmationWrites[key] = oldPending;
    if (result?.synced) {
      clearLocalConfirmationKey(key);
      emitConfirmationSync(key, value);
      await refreshDataFromSupabase({ force: true, silent: true });
      showToast('Confirmacion actualizada', value ? 'La actividad quedo marcada como terminada en Supabase.' : 'La confirmacion fue retirada de Supabase.');
    } else {
      showToast('Confirmacion actualizada', 'La actividad quedo marcada en este navegador.');
    }
  } catch (err) {
    if (oldPending === undefined) delete pendingConfirmationWrites[key]; else pendingConfirmationWrites[key] = oldPending;
    if (oldManual === undefined) delete manualStatus[key]; else manualStatus[key] = oldManual;
    if (oldLocalConfirm === undefined) delete confirms[key]; else confirms[key] = oldLocalConfirm;
    t.confirmed = oldServerConfirm;
    saveManualStatus();
    saveConfirm();
    emitConfirmationSync(key, oldServerConfirm);
    render();
    showToast('No se pudo sincronizar con Supabase', `${esc(err.message || err)}<br><br>Ejecuta el SQL de permisos de confirmaciones incluido en el ZIP y vuelve a intentar.`);
  }
}
function taskByKey(key) {
  for (const p of DATA.projects) {
    for (const t of p.tasks) if (taskKey(t) === key) return t;
  }
  return null;
}

function monthStart(v) {
  const x = d(v) || new Date();
  return new Date(x.getFullYear(), x.getMonth(), 1);
}
function addMonths(v, n) {
  return new Date(v.getFullYear(), v.getMonth() + n, 1);
}
function ganttMonthScale(min, max, total) {
  const labels = [];
  const lines = [];
  let count = 0;
  let cursor = monthStart(min);
  const end = addMonths(monthStart(max), 1);
  while (cursor < end) {
    count++;
    const next = addMonths(cursor, 1);
    const left = Math.max(0, Math.min(100, ((cursor.getTime() - min) / total) * 100));
    const right = Math.max(0, Math.min(100, ((next.getTime() - min) / total) * 100));
    const width = Math.max(0, right - left);
    if (width > 0.25) {
      labels.push(`<span class="gantt-month" style="left:${left}%;width:${width}%">${monthShort(cursor)}</span>`);
    }
    if (left > 0 && left < 100) {
      lines.push(`<i class="gantt-month-line" style="left:${left}%"></i>`);
    }
    cursor = next;
  }
  return { labels: labels.join(''), lines: lines.join(''), count };
}

function renderGantt(pid) {
  const p = projectById(pid), el = qs('gantt-' + pid);
  if (!el) return;
  const rows = filteredTasks(pid, 'gantt');
  const dated = rows.filter(t => d(t.start) && d(t.finish));
  const min = dated.length ? Math.min(...dated.map(t => d(t.start).getTime())) : Date.now();
  const max = dated.length ? Math.max(...dated.map(t => d(t.finish).getTime())) : Date.now() + 86400000;
  const total = Math.max(1, max - min);
  const today = day(CONTROL_DATE);
  const todayPct = today ? Math.max(0, Math.min(100, ((today - min) / total) * 100)) : 0;
  const rowH = 56;
  const scale = ganttMonthScale(min, max, total);
  const timelineW = Math.max(980, scale.count * 120);
  const visibleByUid = new Map(rows.map((t, i) => [String(t.uid), { t, i }]));
  const visibleByOutline = new Map(rows.map((t, i) => [String(t.outline), { t, i }]));
  const rowHTML = rows.map((t, i) => {
    const s = d(t.start), f = d(t.finish);
    const left = s ? ((s - min) / total) * 100 : 0;
    const width = (s && f) ? Math.max(.3, ((f - s) / total) * 100) : 0;
    const st = statusOf(t);
    const pad = Math.max(0, Number(t.outline_level || 1) - 1) * 12;
    const hc = hasChildren(p, t);
    const col = treeMap('gantt')[pid + '|' + t.outline];
    const dep = dependencyState(t);
    return `<div class="gantt-row ${isSummary(t) ? 'group' : ''} ${dep.blocked && !isSummary(t) ? 'gantt-blocked' : ''}" data-uid="${esc(t.uid)}" data-index="${i}"><div class="gantt-label" style="padding-left:${pad}px">${hc ? `<button class="tree-toggle ${col ? 'collapsed' : ''}" onclick="toggleNode('${pid}','${esc(t.outline)}','gantt')">${col ? '+' : '−'}</button>` : '<span class="tree-toggle-spacer"></span>'}<span class="outline">${esc(t.outline)}</span><span class="gantt-label-name">${esc(t.name)}</span></div><div class="gantt-track"><i class="gantt-bar ${isSummary(t) ? 'summary' : progressClass(st)}" style="left:${left}%;width:${width}%"></i></div></div>`;
  }).join('');
  el.innerHTML = `<div class="gantt-inner"><div class="gantt-tree-wrap" style="--row-h:${rowH}px;--timeline-w:${timelineW}px"><div class="gantt-scale"><div>Actividad</div><div class="gantt-month-scale">${scale.labels}</div></div><div class="gantt-body"><div class="gantt-grid-lines">${scale.lines}</div><div class="today-line" style="left:calc(var(--label-w) + var(--gap) + ${todayPct}%);"></div>${rowHTML}<svg class="gantt-dep-svg" viewBox="0 0 100 ${Math.max(1, rows.length * rowH)}" preserveAspectRatio="none">${dependencyArrowSVG(rows, min, total, rowH, visibleByUid, visibleByOutline)}</svg></div></div></div>`;
}
function visibleEndpointForTask(task, visibleByUid, visibleByOutline) {
  if (!task) return null;
  if (visibleByUid.has(String(task.uid))) return visibleByUid.get(String(task.uid));
  const ancestors = parentOutlines(task.outline).reverse();
  for (const o of ancestors) if (visibleByOutline.has(o)) return visibleByOutline.get(o);
  return null;
}
function dependencyArrowSVG(rows, min, total, rowH, visibleByUid, visibleByOutline) {
  let out = '';
  rows.forEach((t, i) => {
    const s = d(t.start);
    if (!s) return;
    const x2 = Math.max(0, Math.min(100, ((s - min) / total) * 100));
    predecessorLinks(t).forEach(l => {
      const ep = visibleEndpointForTask(l.task, visibleByUid, visibleByOutline);
      if (!ep || !d(ep.t.finish)) return;
      const x1 = Math.max(0, Math.min(100, ((d(ep.t.finish) - min) / total) * 100));
      const y1 = ep.i * rowH + rowH / 2;
      const y2 = i * rowH + rowH / 2;
      const entry = Math.max(0, x2 - 1.6);
      const exit = Math.min(99, Math.max(x1 + 1.6, entry + 1.6));
      const blocked = !l.task || !isCompleteForDependency(l.task);
      out += `<path class="gantt-dep-path ${blocked ? 'blocked' : ''}" d="M ${x1} ${y1} H ${exit} V ${y2} H ${entry} L ${x2} ${y2}"/><circle class="gantt-dep-dot ${blocked ? 'blocked' : ''}" cx="${x1}" cy="${y1}" r="1.4"/><polygon class="gantt-dep-head ${blocked ? 'blocked' : ''}" points="${x2},${y2} ${x2 - 1.15},${y2 - 3.2} ${x2 - 1.15},${y2 + 3.2}"/>`;
    });
  });
  return out;
}

function renderAlerts() {
  const tasks = activeProjects().flatMap(tasksOf).filter(t => !isSummary(t));
  const overdue = tasks.filter(t => statusOf(t) === 'Vencido').slice(0, 10), running = tasks.filter(t => statusOf(t) === 'En ejecución').slice(0, 10), start = tasks.filter(t => sameDay(t.start, CONTROL_DATE)).slice(0, 10);
  fillMiniList('alert-overdue', overdue); fillMiniList('alert-running', running); fillMiniList('alert-start', start);
  if (qs('alert-overdue-count')) qs('alert-overdue-count').textContent = overdue.length;
  if (qs('alert-running-count')) qs('alert-running-count').textContent = running.length;
  if (qs('alert-start-count')) qs('alert-start-count').textContent = start.length;
}
function sameDay(a, b) { const x = day(a), y = day(b); return x && y && x.getTime() === y.getTime(); }
function showOpeningAlerts(force = false) {
  const tasks = activeProjects().flatMap(tasksOf).filter(t => !isSummary(t));
  const overdue = tasks.filter(t => statusOf(t) === 'Vencido').slice(0, 8);
  if (force || overdue.length) showToast('Alertas del cronograma', overdue.length ? `Hay ${overdue.length} actividades vencidas o por confirmar:<ul>${overdue.map(t => `<li>${esc(t.project_short)} · ${esc(t.name)} (${fmt(t.finish)})</li>`).join('')}</ul>` : 'No hay alertas vencidas en este momento.');
}
function showToast(title, body) {
  let t = qs('toast');
  if (!t) {
    document.body.insertAdjacentHTML('beforeend', '<div class="toast" id="toast"><div class="toast-head"><h3></h3><button class="toast-close" onclick="document.getElementById(\'toast\').classList.remove(\'show\')">×</button></div><div class="toast-body"></div></div>');
    t = qs('toast');
  }
  t.querySelector('h3').textContent = title;
  t.querySelector('.toast-body').innerHTML = body;
  t.classList.add('show');
}
function exportCSV(pid) {
  const ps = pid ? [projectById(pid)] : activeProjects();
  const rows = [['Proyecto', 'Codigo', 'Actividad', 'Inicio', 'Fin', 'Duracion', 'Avance', 'Estado', 'Responsable', 'Predecesores']];
  ps.forEach(p => tasksOf(p).forEach(t => rows.push([p.short, t.outline, t.name, fmt(t.start), fmt(t.finish), t.duration_text || durationDays(t), autoProgress(t) + '%', statusOf(t), t.responsible || t.resource_names || '', t.predecessor_text || ''])));
  const csv = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (pid || 'seguimiento-zc-piura') + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
function applyDateSettings() {
  const mode = qs('date-mode')?.value;
  const val = qs('manual-date')?.value;
  CONTROL_DATE = (mode === 'manual' && val) ? new Date(val + 'T12:00:00') : new Date();
  render();
}

window.addEventListener('storage', async (ev) => {
  if (![LEGACY_CONFIRM_KEY, MANUAL_STATUS_KEY, CONFIRM_SYNC_EVENT_KEY].includes(ev.key)) return;
  reloadLocalState();
  if (isRemoteData()) {
    await refreshDataFromSupabase({ force: true, silent: true });
    return;
  }
  render();
});

window.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  applyDateSettings();
  startSupabaseAutoRefresh();
  setTimeout(() => showOpeningAlerts(false), 600);
});
