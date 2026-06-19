let DATA={projects:[]};
let CONTROL_DATE=new Date();
let GLOBAL_STATUS='all';
const confirms=JSON.parse(localStorage.getItem('zc_confirmations')||'{}');
const collapsed=JSON.parse(localStorage.getItem('zc_collapsed')||'{}');

function qs(id){return document.getElementById(id)}
function esc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function slug(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')}
function d(v){if(!v)return null; const x=new Date(v); return isNaN(x)?null:x}
function day(v){const x=d(v); return x?new Date(x.getFullYear(),x.getMonth(),x.getDate()):null}
function fmt(v){const x=d(v); return x?x.toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'}):'Sin fecha'}
function pct(n){return Math.max(0,Math.min(100,Math.round(Number(n)||0)))}
function projectById(id){return DATA.projects.find(p=>p.id===id)}
function tasksOf(p){return (p?.tasks||[]).filter(t=>String(t.outline||'')!=='0')}
function isSummary(t){return !!t.is_summary || !!t.summary || String(t.type||'').toLowerCase()==='summary'}
function hasChildren(p,t){const o=String(t.outline||''); return tasksOf(p).some(x=>x.uid!==t.uid && String(x.outline||'').startsWith(o+'.'))}
function parentOutlines(outline){const parts=String(outline||'').split('.'); const out=[]; for(let i=1;i<parts.length;i++)out.push(parts.slice(0,i).join('.')); return out}
function isHiddenByCollapse(t){return parentOutlines(t.outline).some(o=>collapsed[t.project_id+'|'+o])}
function taskKey(t){return t.project_id+'|'+(t.uid||t.unique_id||t.task_id||t.outline)}
function saveConfirm(){localStorage.setItem('zc_confirmations',JSON.stringify(confirms))}
function saveCollapse(){localStorage.setItem('zc_collapsed',JSON.stringify(collapsed))}

async function loadData(){
  const cfg=window.ZC_CONFIG||{};
  if(cfg.useSupabaseData && cfg.supabaseUrl && cfg.supabaseKey){
    try{
      DATA=await loadDataFromSupabase(cfg);
      DATA.projects=(DATA.projects||[]).map(normalizeProject);
      return;
    }catch(err){
      console.error(err);
      showToast('Aviso de Supabase','No se pudo leer Supabase. Se cargara el JSON local como respaldo. Detalle: '+esc(err.message||err));
    }
  }
  try{
    const r=await fetch('data/projects.json?ts='+Date.now(),{cache:'no-store'});
    DATA=await r.json();
    DATA.projects=(DATA.projects||[]).map(normalizeProject);
  }catch(err){console.error(err); showToast('Error al cargar datos','No se pudo leer data/projects.json ni Supabase. Verifica la configuracion.');}
}

async function supabaseRest(path){
  const cfg=window.ZC_CONFIG||{};
  const base=String(cfg.supabaseUrl||'').replace(/\/$/,'');
  const res=await fetch(base+'/rest/v1/'+path,{
    headers:{
      apikey:cfg.supabaseKey,
      Authorization:'Bearer '+cfg.supabaseKey,
      Accept:'application/json'
    },
    cache:'no-store'
  });
  if(!res.ok){
    const text=await res.text().catch(()=>'');
    throw new Error('REST '+res.status+' '+text);
  }
  return await res.json();
}

async function loadDataFromSupabase(){
  const [projects,tasks]=await Promise.all([
    supabaseRest('projects?select=*&active=eq.true&order=id.asc'),
    supabaseRest('v_tasks_web?select=*&order=project_id.asc,sort_order.asc,outline.asc')
  ]);
  const byProject=new Map();
  (projects||[]).forEach(p=>{
    byProject.set(p.id,{
      id:p.id,
      name:p.name,
      short:p.short||p.name,
      description:p.description,
      source_file:p.source_file,
      title:p.title,
      author:p.author,
      start:p.start_at,
      finish:p.finish_at,
      creation_date:p.creation_date,
      last_saved:p.last_saved_at,
      tasks:[],
      verification:{activities_total:0,summary_total:0,source:'Supabase'}
    });
  });
  (tasks||[]).forEach(t=>{
    const pid=t.project_id;
    if(!byProject.has(pid)){
      byProject.set(pid,{id:pid,name:t.project_name||pid,short:t.project_short||pid,tasks:[],verification:{activities_total:0,summary_total:0,source:'Supabase'}});
    }
    const row={
      ...t,
      start:t.start_at,
      finish:t.finish_at,
      duration_text:t.duration_text,
      responsible:t.responsible,
      predecessors:Array.isArray(t.predecessors)?t.predecessors:[],
      confirmed:!!t.confirmed
    };
    byProject.get(pid).tasks.push(row);
  });
  const out=Array.from(byProject.values());
  out.forEach(p=>{
    p.tasks.sort((a,b)=>outlineCompare(a.outline,b.outline));
    p.verification.activities_total=p.tasks.filter(t=>!isSummary(t)).length;
    p.verification.summary_total=p.tasks.filter(isSummary).length;
    p.start=p.start||minDate(p.tasks.map(t=>t.start));
    p.finish=p.finish||maxDate(p.tasks.map(t=>t.finish));
  });
  return {projects:out,generated_on:new Date().toISOString(),source:'Supabase'};
}
function normalizeProject(p){
  p.id=p.id||slug(p.short||p.name||'proyecto');
  p.short=p.short||p.name||p.id;
  p.tasks=(p.tasks||[]).map((t,i)=>({
    ...t,
    project_id:t.project_id||p.id,
    project_short:t.project_short||p.short,
    uid:t.uid||`${p.id}-${t.unique_id??t.task_id??i}`,
    task_id:t.task_id??i,
    unique_id:t.unique_id??i,
    outline:String(t.outline??(i+1)),
    outline_level:Number(t.outline_level??String(t.outline??'').split('.').length),
    name:t.name||'Sin nombre',
    predecessors:Array.isArray(t.predecessors)?t.predecessors:[]
  }));
  p.verification=p.verification||{activities_total:p.tasks.filter(t=>!isSummary(t)).length,summary_total:p.tasks.filter(isSummary).length};
  p.start=p.start||minDate(p.tasks.map(t=>t.start));
  p.finish=p.finish||maxDate(p.tasks.map(t=>t.finish));
  return p;
}
function minDate(values){const arr=values.map(d).filter(Boolean).sort((a,b)=>a-b); return arr[0]?.toISOString()||null}
function maxDate(values){const arr=values.map(d).filter(Boolean).sort((a,b)=>b-a); return arr[0]?.toISOString()||null}

function autoProgress(t){
  if(t.confirmed || confirms[taskKey(t)]) return 100;
  const s=day(t.start), f=day(t.finish), c=day(CONTROL_DATE);
  if(!s||!f) return pct(t.percent_complete||0);
  if(c<s) return 0;
  if(c>f) return 100;
  const total=Math.max(1,f-s), done=Math.max(0,c-s);
  return pct((done/total)*100);
}
function statusOf(t){
  if(t.confirmed || confirms[taskKey(t)]) return 'Terminado';
  const s=day(t.start), f=day(t.finish), c=day(CONTROL_DATE);
  if(!s||!f) return 'Sin fecha';
  if(c<s) return 'Pendiente';
  if(c>f) return 'Vencido';
  return 'En ejecución';
}
function statusClass(st){return st==='Terminado'?'done':st==='Vencido'?'overdue':st==='En ejecución'?'running':st==='Sin fecha'?'confirm':'pending'}
function progressClass(st){return st==='Terminado'?'done':st==='Vencido'?'overdue':st==='Pendiente'?'pending':''}
function summaryStats(tasks){const base=tasks.filter(t=>!isSummary(t)); const s={total:base.length,pendiente:0,ejecucion:0,vencido:0,terminado:0,sinfecha:0}; base.forEach(t=>{const st=statusOf(t); if(st==='Pendiente')s.pendiente++; else if(st==='En ejecución')s.ejecucion++; else if(st==='Vencido')s.vencido++; else if(st==='Terminado')s.terminado++; else s.sinfecha++}); return s}
function projectProgress(pid){const p=projectById(pid); const acts=tasksOf(p).filter(t=>!isSummary(t)); if(!acts.length)return 0; return acts.reduce((a,t)=>a+autoProgress(t),0)/acts.length}

function activeProjects(){
  const page=document.body.dataset.page||'home';
  if(page==='conexion') return DATA.projects.filter(p=>p.id==='conexion-vdch');
  if(page==='alimentador') return DATA.projects.filter(p=>p.id==='alimentador-sullana');
  return DATA.projects;
}
function render(){
  const dateLbl=qs('control-date-label'); if(dateLbl)dateLbl.textContent=fmt(CONTROL_DATE);
  renderGlobalMetrics(); renderVerification(); renderStatusSummary(); renderProjectSections(); renderAlerts();
}
function renderGlobalMetrics(){
  const el=qs('global-metrics'); if(!el)return;
  const ps=activeProjects(); const tasks=ps.flatMap(tasksOf); const acts=tasks.filter(t=>!isSummary(t)); const stats=summaryStats(tasks);
  el.innerHTML=[
    ['Proyectos',ps.length,'Cronogramas cargados'],['Actividades',acts.length,'Sin contar grupos'],['En ejecución',stats.ejecucion,'Dentro del plazo'],['Vencidos',stats.vencido,'Por confirmar'],['Avance promedio',pct(acts.reduce((a,t)=>a+autoProgress(t),0)/(acts.length||1))+'%','Según fecha de control']
  ].map(m=>`<div class="metric"><span>${m[0]}</span><strong>${m[1]}</strong><small>${m[2]}</small></div>`).join('')
}
function renderVerification(){
  if(!qs('verification-grid'))return; const ps=activeProjects(); const regs=ps.reduce((a,p)=>a+(p.tasks?.length||0),0); const acts=ps.reduce((a,p)=>a+(p.verification?.activities_total||p.tasks.filter(t=>!isSummary(t)).length),0); const sums=ps.reduce((a,p)=>a+(p.verification?.summary_total||p.tasks.filter(isSummary).length),0);
  qs('verification-grid').innerHTML=`<div class="metric"><span>Archivos fuente</span><strong>${ps.length}</strong><small>.mpp</small></div><div class="metric"><span>Registros</span><strong>${regs}</strong><small>Total importado</small></div><div class="metric"><span>Actividades</span><strong>${acts}</strong><small>Tareas ejecutables</small></div><div class="metric"><span>Fases</span><strong>${sums}</strong><small>Grupos y resumen</small></div>`;
  const tb=document.querySelector('#verification-table tbody'); if(tb)tb.innerHTML=ps.map(p=>`<tr><td><b>${esc(p.short)}</b></td><td>${esc(p.source_file||'')}</td><td>${p.tasks.length}</td><td>${p.verification.activities_total}</td><td>${p.verification.summary_total}</td><td>${fmt(p.start)} - ${fmt(p.finish)}</td></tr>`).join('');
}
function renderStatusSummary(){
  const el=qs('status-kpis'); if(!el)return; const tasks=activeProjects().flatMap(tasksOf); const s=summaryStats(tasks);
  el.innerHTML=`<div class="status-card"><span>Total</span><b>${s.total}</b></div><div class="status-card"><span>Pendientes</span><b>${s.pendiente}</b></div><div class="status-card"><span>En ejecución</span><b>${s.ejecucion}</b></div><div class="status-card"><span>Vencidos</span><b>${s.vencido}</b></div><div class="status-card"><span>Terminados</span><b>${s.terminado}</b></div><div class="status-card"><span>Sin fecha</span><b>${s.sinfecha}</b></div>`;
  fillMiniList('running-list',tasks.filter(t=>!isSummary(t)&&statusOf(t)==='En ejecución').slice(0,8));
  fillMiniList('overdue-list',tasks.filter(t=>!isSummary(t)&&statusOf(t)==='Vencido').slice(0,8));
  if(qs('running-count'))qs('running-count').textContent=s.ejecucion;
  if(qs('overdue-count'))qs('overdue-count').textContent=s.vencido;
}
function fillMiniList(id,items){const el=qs(id); if(!el)return; el.innerHTML=items.length?items.map(t=>`<div class="alert-item"><b>${esc(t.name)}</b><small>${esc(t.project_short)} · ${fmt(t.start)} - ${fmt(t.finish)}</small></div>`).join(''):'<div class="alert-item"><small>Sin registros.</small></div>'}
function setGlobalStatus(st){GLOBAL_STATUS=st; document.querySelectorAll('#quick-filters .tab').forEach(b=>b.classList.toggle('active',b.dataset.status===st)); renderProjectSections();}

function renderProjectSections(){
  const wrap=qs('project-sections'); if(!wrap)return; const ps=activeProjects(); const page=document.body.dataset.page||'home';
  if(page==='home'){
    wrap.innerHTML=`<div class="section-head"><div><h2>Acceso por proyecto</h2><p>Selecciona el cronograma para revisar Gantt, tabla, dependencias y confirmaciones.</p></div><span class="badge summary">${ps.length} proyectos</span></div><div class="project-home-grid">${ps.map(homeCard).join('')}</div>`; return;
  }
  wrap.innerHTML=ps.map(projectHTML).join(''); ps.forEach(p=>{renderProjectKPIs(p.id); renderTable(p.id); renderGantt(p.id)});
}
function homeCard(p){const stats=summaryStats(tasksOf(p)); const href=p.id==='conexion-vdch'?'conexion.html':'alimentador.html'; return `<article class="project-home-card"><span class="eyebrow">${esc(p.short)}</span><h3>${esc(p.name)}</h3><p>${esc(p.description||'Cronograma de seguimiento')}</p><div class="meta"><span class="badge pending">${fmt(p.start)} - ${fmt(p.finish)}</span><span class="badge running">${p.verification.activities_total} actividades</span><span class="badge summary">${pct(projectProgress(p.id))}% avance</span></div><div class="hero-actions"><a class="btn primary" href="${href}">Abrir Gantt y tabla</a><button class="btn" onclick="exportCSV('${p.id}')">Exportar CSV</button></div><p class="muted">Vencidos por confirmar: <b>${stats.vencido}</b> · En ejecución: <b>${stats.ejecucion}</b></p></article>`}
function projectHTML(p){return `<section id="p-${p.id}"><div class="project-header"><div class="project-card"><span class="eyebrow">${esc(p.short)}</span><h2>${esc(p.name)}</h2><p>${esc(p.description||'Cronograma de seguimiento')}</p><div class="meta"><span class="badge summary">${esc(p.source_file||'Archivo .mpp')}</span><span class="badge pending">${fmt(p.start)} - ${fmt(p.finish)}</span><span class="badge running">${p.verification.activities_total} actividades</span></div></div><div class="project-card"><h3>Avance del proyecto</h3><strong style="font-size:42px" id="project-progress-${p.id}">0%</strong><div class="progress"><i id="project-progress-bar-${p.id}"></i></div><p id="project-status-${p.id}" class="muted"></p></div></div><div class="kpi-row" id="kpis-${p.id}" style="margin-top:14px"></div><div class="section" style="box-shadow:none;margin-top:16px;padding:16px"><div class="section-head"><div><h3>Tabla de seguimiento plegable · ${esc(p.short)}</h3><p>Usa las flechas para expandir grupos y subgrupos. La tabla se alimenta de <b>data/projects.json</b>, que se actualiza automáticamente cuando GitHub Actions convierte el nuevo .mpp.</p></div><div class="toolbar"><button class="btn small" onclick="setProjectTree('${p.id}',false)">Expandir todo</button><button class="btn small" onclick="setProjectTree('${p.id}',true)">Contraer todo</button><button class="btn small" onclick="exportCSV('${p.id}')">CSV</button></div></div><div class="controls"><div class="field"><label>Buscar</label><input id="search-${p.id}" placeholder="Actividad, responsable o predecesor" oninput="renderTable('${p.id}')"></div><div class="field"><label>Estado</label><select id="filter-status-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option>Pendiente</option><option>En ejecución</option><option>Vencido</option><option>Terminado</option><option>Sin fecha</option></select></div><div class="field"><label>Tipo</label><select id="filter-type-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option value="summary">Grupos</option><option value="task">Actividades</option></select></div><div class="field"><label>Ruta crítica</label><select id="filter-critical-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option value="critical">Crítica</option><option value="noncritical">No crítica</option></select></div><div class="field"><label>Dependencia</label><select id="filter-dependency-${p.id}" onchange="renderTable('${p.id}')"><option value="all">Todos</option><option value="linked">Amarradas</option><option value="blocked">Bloqueadas</option><option value="free">Sin amarre</option></select></div></div><div class="table-wrap"><table class="table" id="table-${p.id}"><thead><tr><th>Código</th><th>Grupo / actividad</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Avance</th><th>Estado</th><th>Predecesores</th><th>Confirmación</th><th>Responsable / notas</th></tr></thead><tbody></tbody></table></div></div><div class="section" style="box-shadow:none;margin-top:16px;padding:16px"><div class="section-head"><div><h3>Gantt plegable con dependencias · ${esc(p.short)}</h3><p>Las barras se recalculan con las fechas del archivo convertido. Las relaciones del Project se dibujan como flechas.</p></div><div class="toolbar"><button class="btn small" onclick="setProjectTree('${p.id}',false)">Expandir todo</button><button class="btn small" onclick="setProjectTree('${p.id}',true)">Contraer todo</button></div></div><div class="gantt" id="gantt-${p.id}"></div></div></section>`}
function renderProjectKPIs(pid){const p=projectById(pid), s=summaryStats(tasksOf(p)), prog=pct(projectProgress(pid)); qs('project-progress-'+pid).textContent=prog+'%'; qs('project-progress-bar-'+pid).style.width=prog+'%'; qs('project-status-'+pid).textContent=`${s.terminado} terminadas · ${s.vencido} vencidas · ${s.ejecucion} en ejecución`; qs('kpis-'+pid).innerHTML=`<div class="status-card"><span>Pendientes</span><b>${s.pendiente}</b></div><div class="status-card"><span>En ejecución</span><b>${s.ejecucion}</b></div><div class="status-card"><span>Vencidos</span><b>${s.vencido}</b></div><div class="status-card"><span>Terminados</span><b>${s.terminado}</b></div><div class="status-card"><span>Sin fecha</span><b>${s.sinfecha}</b></div><div class="status-card"><span>Avance</span><b>${prog}%</b></div>`}

function filteredTasks(pid){const p=projectById(pid); let rows=tasksOf(p).sort((a,b)=>outlineCompare(a.outline,b.outline)); const search=(qs('search-'+pid)?.value||'').toLowerCase(); const st=qs('filter-status-'+pid)?.value||GLOBAL_STATUS; const type=qs('filter-type-'+pid)?.value||'all'; const crit=qs('filter-critical-'+pid)?.value||'all'; const dep=qs('filter-dependency-'+pid)?.value||'all'; rows=rows.filter(t=>!isHiddenByCollapse(t)); rows=rows.filter(t=>{
    if(search && ![t.name,t.responsible,t.resource_names,t.notes,t.predecessor_text].join(' ').toLowerCase().includes(search))return false;
    const status=statusOf(t); if(st&&st!=='all'&&status!==st)return false;
    if(type==='summary'&&!isSummary(t))return false; if(type==='task'&&isSummary(t))return false;
    if(crit==='critical'&&!t.critical)return false; if(crit==='noncritical'&&t.critical)return false;
    const ds=dependencyState(t); if(dep==='linked'&&!ds.has)return false; if(dep==='blocked'&&!ds.blocked)return false; if(dep==='free'&&ds.has)return false;
    return true;
  }); return rows}
function outlineCompare(a,b){const aa=String(a).split('.').map(Number), bb=String(b).split('.').map(Number); for(let i=0;i<Math.max(aa.length,bb.length);i++){const x=aa[i]||0,y=bb[i]||0;if(x!==y)return x-y}return 0}
function renderTable(pid){const p=projectById(pid); const tb=document.querySelector(`#table-${pid} tbody`); if(!tb)return; const rows=filteredTasks(pid); tb.innerHTML=rows.map(t=>{const st=statusOf(t), pr=autoProgress(t), group=isSummary(t), hc=hasChildren(p,t), col=collapsed[pid+'|'+t.outline]; const pad=Math.max(0,Number(t.outline_level||1)-1)*18; return `<tr class="${group?'table-group level-'+t.outline_level:''}"><td>${hc?`<button class="tree-toggle" onclick="toggleNode('${pid}','${esc(t.outline)}')">${col?'+':'−'}</button>`:'<span class="tree-toggle-spacer"></span>'}<span class="outline">${esc(t.outline)}</span></td><td class="name-cell" style="padding-left:${pad+10}px"><b>${esc(t.name)}</b>${t.critical?' <span class="badge confirm">Crítica</span>':''}</td><td>${fmt(t.start)}</td><td>${fmt(t.finish)}</td><td>${esc(t.duration_text||durationDays(t))}</td><td><div class="progress ${progressClass(st)}"><i style="width:${pr}%"></i></div><span class="progress-number">${pr}%</span></td><td><span class="badge ${statusClass(st)}">${st}</span></td><td>${dependencyHTML(t)}</td><td>${confirmHTML(t)}</td><td><b>${esc(t.responsible||t.resource_names||'')}</b><small class="muted">${esc(t.notes||'')}</small></td></tr>`}).join('') || '<tr><td colspan="10">Sin resultados.</td></tr>'; renderProjectKPIs(pid); renderGantt(pid)}
function durationDays(t){const s=day(t.start), f=day(t.finish); if(!s||!f)return ''; return Math.max(0,Math.round((f-s)/86400000)+1)+'d'}
function toggleNode(pid,outline){const k=pid+'|'+outline; if(collapsed[k])delete collapsed[k]; else collapsed[k]=true; saveCollapse(); renderTable(pid); renderGantt(pid)}
function setProjectTree(pid,close){const p=projectById(pid); tasksOf(p).filter(t=>hasChildren(p,t)).forEach(t=>{const k=pid+'|'+t.outline; if(close)collapsed[k]=true; else delete collapsed[k]}); saveCollapse(); renderTable(pid); renderGantt(pid)}
function confirmHTML(t){if(isSummary(t))return '<span class="muted">Grupo</span>'; if(t.confirmed || confirms[taskKey(t)])return `<button class="btn small green" onclick="toggleConfirm('${taskKey(t)}')">Terminado</button>`; return `<button class="btn small" onclick="toggleConfirm('${taskKey(t)}')">Confirmar</button>`}
function toggleConfirm(key){if(confirms[key])delete confirms[key]; else confirms[key]=new Date().toISOString(); saveConfirm(); render();}
function taskByUid(key){for(const p of DATA.projects){for(const t of p.tasks){if(taskKey(t)===key)return t}}return null}

function findPredecessorTask(t,pred){const p=projectById(t.project_id); if(!p||!pred)return null; return p.tasks.find(x=>Number(x.unique_id)===Number(pred.unique_id))||p.tasks.find(x=>String(x.outline)===String(pred.outline))||p.tasks.find(x=>Number(x.task_id)===Number(pred.task_id))||null}
function predecessorLinks(t){return (t.predecessors||[]).map(item=>{const pred=item.predecessor||{}; const task=findPredecessorTask(t,pred); return {type:item.type||'',lag:item.lag||'',outline:pred.outline||'',name:pred.name||'',task}})}
function dependencyState(t){const links=predecessorLinks(t); const pending=links.filter(l=>!l.task||statusOf(l.task)!=='Terminado'); return {has:links.length>0,links,pending,blocked:links.length>0&&pending.length>0}}
function dependencyHTML(t){const d=dependencyState(t); if(!d.has)return '<span class="dep-badge free">Sin amarre</span>'; const badge=`<span class="dep-badge ${d.blocked?'blocked':'linked'}">${d.blocked?'Dependiente':'Amarrada'}</span>`; return badge+'<div class="dep-list">'+d.links.map(l=>`<div class="dep-item"><b>${esc(l.task?.outline||l.outline||'-')} · ${esc(l.task?.name||l.name||'Predecesor')}</b><br>${esc(l.type||'FS')} ${esc(l.lag||'')} · ${esc(l.task?statusOf(l.task):'No ubicado')}</div>`).join('')+'</div>'}

function renderGantt(pid){const p=projectById(pid), el=qs('gantt-'+pid); if(!el)return; const rows=filteredTasks(pid); const dated=rows.filter(t=>d(t.start)&&d(t.finish)); const min=dated.length?Math.min(...dated.map(t=>d(t.start).getTime())):Date.now(); const max=dated.length?Math.max(...dated.map(t=>d(t.finish).getTime())):Date.now()+86400000; const total=Math.max(1,max-min); const todayPct=Math.max(0,Math.min(100,((day(CONTROL_DATE)-min)/total)*100));
  const rowHTML=rows.map((t,i)=>{const s=d(t.start), f=d(t.finish); const left=s?((s-min)/total)*100:0; const width=(s&&f)?Math.max(.3,((f-s)/total)*100):0; const st=statusOf(t); const pad=Math.max(0,Number(t.outline_level||1)-1)*12; return `<div class="gantt-row ${isSummary(t)?'group':''}" data-uid="${esc(t.uid)}" data-index="${i}"><div class="gantt-label" style="padding-left:${pad}px"><span class="outline">${esc(t.outline)}</span>${esc(t.name)}</div><div class="gantt-track"><i class="gantt-bar ${isSummary(t)?'summary':progressClass(st)}" style="left:${left}%;width:${width}%"></i></div></div>`}).join('');
  el.innerHTML=`<div class="gantt-inner"><div class="gantt-tree-wrap"><div class="gantt-scale"><div>Actividad</div><div>${fmt(min)} - ${fmt(max)}</div></div><div class="today-line" style="left:calc(var(--label-w) + var(--gap) + ${todayPct}%);"></div>${rowHTML}<svg class="gantt-dep-svg" viewBox="0 0 100 ${Math.max(1,rows.length*56)}" preserveAspectRatio="none">${dependencyArrowSVG(rows,min,total)}</svg></div></div>`}
function dependencyArrowSVG(rows,min,total){const pos=new Map(); rows.forEach((t,i)=>{if(d(t.finish))pos.set(String(t.unique_id),{t,i,x:((d(t.finish)-min)/total)*100});}); let out=''; rows.forEach((t,i)=>{const s=d(t.start); if(!s)return; const x2=((s-min)/total)*100; predecessorLinks(t).forEach(l=>{const pr=l.task?pos.get(String(l.task.unique_id)):null; if(!pr)return; const y1=pr.i*56+28,y2=i*56+28; const x1=pr.x; const mid=Math.max(x1+1,Math.min(99,(x1+x2)/2)); const blocked=statusOf(l.task)!=='Terminado'; out+=`<path class="gantt-dep-path ${blocked?'blocked':''}" d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}"/><polygon points="${x2},${y2} ${x2-1.2},${y2-2.5} ${x2-1.2},${y2+2.5}" fill="${blocked?'#b45309':'#475569'}" opacity=".75"/>`})}); return out}

function renderAlerts(){const tasks=activeProjects().flatMap(tasksOf).filter(t=>!isSummary(t)); const overdue=tasks.filter(t=>statusOf(t)==='Vencido').slice(0,10), running=tasks.filter(t=>statusOf(t)==='En ejecución').slice(0,10), start=tasks.filter(t=>sameDay(t.start,CONTROL_DATE)).slice(0,10); fillMiniList('alert-overdue',overdue); fillMiniList('alert-running',running); fillMiniList('alert-start',start); if(qs('alert-overdue-count'))qs('alert-overdue-count').textContent=overdue.length;if(qs('alert-running-count'))qs('alert-running-count').textContent=running.length;if(qs('alert-start-count'))qs('alert-start-count').textContent=start.length}
function sameDay(a,b){const x=day(a),y=day(b); return x&&y&&x.getTime()===y.getTime()}
function showOpeningAlerts(force=false){const tasks=activeProjects().flatMap(tasksOf).filter(t=>!isSummary(t)); const overdue=tasks.filter(t=>statusOf(t)==='Vencido').slice(0,8); if(force||overdue.length)showToast('Alertas del cronograma', overdue.length?`Hay ${overdue.length} actividades vencidas o por confirmar:<ul>${overdue.map(t=>`<li>${esc(t.project_short)} · ${esc(t.name)} (${fmt(t.finish)})</li>`).join('')}</ul>`:'No hay alertas vencidas en este momento.')}
function showToast(title,body){let t=qs('toast'); if(!t){document.body.insertAdjacentHTML('beforeend','<div class="toast" id="toast"><div class="toast-head"><h3></h3><button class="toast-close" onclick="document.getElementById(\'toast\').classList.remove(\'show\')">×</button></div><div class="toast-body"></div></div>');t=qs('toast')} t.querySelector('h3').textContent=title; t.querySelector('.toast-body').innerHTML=body; t.classList.add('show')}

function exportCSV(pid){const ps=pid?[projectById(pid)]:activeProjects(); const rows=[['Proyecto','Codigo','Actividad','Inicio','Fin','Duracion','Avance','Estado','Responsable','Predecesores']]; ps.forEach(p=>tasksOf(p).forEach(t=>rows.push([p.short,t.outline,t.name,fmt(t.start),fmt(t.finish),t.duration_text||durationDays(t),autoProgress(t)+'%',statusOf(t),t.responsible||t.resource_names||'',t.predecessor_text||'']))); const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(pid||'seguimiento-zc-piura')+'.csv'; a.click(); URL.revokeObjectURL(a.href)}
function applyDateSettings(){const mode=qs('date-mode')?.value; const val=qs('manual-date')?.value; CONTROL_DATE=(mode==='manual'&&val)?new Date(val+'T12:00:00'):new Date(); render()}

window.addEventListener('DOMContentLoaded',async()=>{await loadData(); applyDateSettings(); setTimeout(()=>showOpeningAlerts(false),600)});
