let ADMIN_DATA={projects:[]};
let ADMIN_CLIENT=null;
let ADMIN_SESSION=null;
let ADMIN_PROFILE=null;
let edited=false;

function aq(id){return document.getElementById(id)}
function aesc(s){return String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function adminMsg(id,msg,ok=false){const el=aq(id); if(el){el.innerHTML=msg; el.style.borderColor=ok?'#bbf7d0':'#fde68a'; el.style.background=ok?'#f0fdf4':'#fffbeb';}}
function cfg(){return window.ZC_CONFIG||{}}

async function adminLoad(){
  initSupabaseClient();
  await loadLocalJson();
  renderAdminMetrics();
  bindAdmin();
  await restoreSession();
  renderProcessBox();
}

function initSupabaseClient(){
  const c=cfg();
  if(!window.supabase){
    adminMsg('login-result','No se pudo cargar la libreria de Supabase. Revisa la conexion a internet.');
    return;
  }
  if(!c.supabaseUrl||!c.supabaseKey){
    adminMsg('login-result','Falta configurar Supabase en assets/js/config.js.');
    return;
  }
  ADMIN_CLIENT=window.supabase.createClient(c.supabaseUrl,c.supabaseKey);
}

async function restoreSession(){
  if(!ADMIN_CLIENT)return;
  const {data}=await ADMIN_CLIENT.auth.getSession();
  if(data?.session){
    ADMIN_SESSION=data.session;
    await loadAdminProfile(data.session.user);
  }
}

function bindAdmin(){
  aq('login-btn')?.addEventListener('click',loginAdmin);
  aq('logout-btn')?.addEventListener('click',logoutAdmin);
  aq('upload-mpp-btn')?.addEventListener('click',uploadMPPToSupabase);
  aq('refresh-imports')?.addEventListener('click',loadImports);
  aq('download-json')?.addEventListener('click',downloadJSON);
  aq('reset-local')?.addEventListener('click',()=>location.reload());
  aq('json-input')?.addEventListener('change',handleJSONFile);
  aq('load-json-text')?.addEventListener('click',()=>loadJSONText(true));
  aq('validate-json-text')?.addEventListener('click',()=>loadJSONText(false));
}

async function loginAdmin(){
  if(!ADMIN_CLIENT)return;
  const email=(aq('login-email')?.value||'').trim().toLowerCase();
  const password=aq('login-password')?.value||'';
  if(!email||!password){adminMsg('login-result','Ingresa correo y contrasena.');return;}
  adminMsg('login-result','Validando acceso...');
  const {data,error}=await ADMIN_CLIENT.auth.signInWithPassword({email,password});
  if(error){adminMsg('login-result','No se pudo iniciar sesion: '+aesc(error.message));return;}
  ADMIN_SESSION=data.session;
  await loadAdminProfile(data.user);
}

async function loadAdminProfile(user){
  const {data,error}=await ADMIN_CLIENT
    .from('admin_profiles')
    .select('user_id,email,username,display_name,role,active')
    .eq('user_id',user.id)
    .maybeSingle();
  if(error){
    adminMsg('login-result','Sesion iniciada, pero no se pudo validar perfil admin: '+aesc(error.message));
    await ADMIN_CLIENT.auth.signOut();
    return;
  }
  if(!data||!data.active||!['admin','superadmin'].includes(data.role)){
    adminMsg('login-result','El usuario existe en Auth, pero no esta autorizado como administrador en admin_profiles.');
    await ADMIN_CLIENT.auth.signOut();
    return;
  }
  ADMIN_PROFILE=data;
  adminMsg('login-result','Acceso correcto. Bienvenido, '+aesc(data.display_name||data.email)+'.',true);
  showAdminContent(true);
  await loadImports();
}

async function logoutAdmin(){
  if(ADMIN_CLIENT)await ADMIN_CLIENT.auth.signOut();
  ADMIN_SESSION=null;
  ADMIN_PROFILE=null;
  showAdminContent(false);
  adminMsg('login-result','Sesion cerrada.',true);
}

function showAdminContent(show){
  if(aq('admin-content'))aq('admin-content').style.display=show?'block':'none';
  if(aq('logout-btn'))aq('logout-btn').style.display=show?'inline-flex':'none';
  if(aq('login-section'))aq('login-section').style.display=show?'none':'block';
}

async function uploadMPPToSupabase(){
  if(!ADMIN_CLIENT||!ADMIN_SESSION){adminMsg('mpp-result','Primero inicia sesion como administrador.');return;}
  const input=aq('mpp-input');
  const file=input?.files?.[0];
  const projectId=aq('upload-project')?.value;
  if(!file){adminMsg('mpp-result','Selecciona un archivo .mpp.');return;}
  if(!file.name.toLowerCase().endsWith('.mpp')){adminMsg('mpp-result','El archivo debe tener extension .mpp.');return;}
  const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-');
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const path=`${projectId}/${stamp}-${safeName}`;
  const bucket=cfg().storageBucket||'mpp-files';
  adminMsg('mpp-result','Subiendo archivo a Supabase Storage...');
  const {error:upErr}=await ADMIN_CLIENT.storage.from(bucket).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type||'application/octet-stream'});
  if(upErr){adminMsg('mpp-result','Error al subir archivo: '+aesc(upErr.message));return;}
  adminMsg('mpp-result','Archivo subido. Registrando importacion...');
  const {error:insErr}=await ADMIN_CLIENT.from('mpp_imports').insert({
    project_id:projectId,
    project_slug:projectId,
    file_name:file.name,
    file_path:path,
    file_size:file.size,
    file_mime:file.type||'application/octet-stream',
    status:'pending',
    message:'Archivo subido desde admin.html. Pendiente de procesamiento.',
    created_by:ADMIN_SESSION.user.id
  });
  if(insErr){adminMsg('mpp-result','El archivo subio, pero no se pudo registrar en mpp_imports: '+aesc(insErr.message));return;}
  adminMsg('mpp-result',`Archivo subido correctamente:<br><b>${aesc(file.name)}</b><br>Ruta Storage: <code>${aesc(path)}</code><br>Estado: <b>pending</b>.`,true);
  input.value='';
  await loadImports();
}

async function loadImports(){
  if(!ADMIN_CLIENT||!ADMIN_SESSION)return;
  const {data,error}=await ADMIN_CLIENT
    .from('mpp_imports')
    .select('created_at,project_slug,file_name,status,message')
    .order('created_at',{ascending:false})
    .limit(30);
  const tb=document.querySelector('#imports-table tbody');
  if(!tb)return;
  if(error){tb.innerHTML=`<tr><td colspan="5">Error: ${aesc(error.message)}</td></tr>`;return;}
  tb.innerHTML=(data||[]).length?(data||[]).map(r=>`<tr><td>${formatDate(r.created_at)}</td><td>${aesc(r.project_slug)}</td><td>${aesc(r.file_name)}</td><td><span class="badge ${r.status==='processed'?'done':r.status==='error'?'overdue':'confirm'}">${aesc(r.status)}</span></td><td>${aesc(r.message||'')}</td></tr>`).join(''):'<tr><td colspan="5">Sin importaciones registradas.</td></tr>';
}

function renderProcessBox(){
  const c=cfg(); const box=aq('process-box'); if(!box)return;
  let html=`<p>La carga al bucket <b>${aesc(c.storageBucket||'mpp-files')}</b> ya queda lista. Cada archivo se registra en <b>mpp_imports</b> como <b>pending</b>.</p>`;
  html+=`<p>Para convertir el .mpp y actualizar las tablas, configura los secrets de GitHub y ejecuta el workflow de procesamiento.</p>`;
  if(c.repoOwner&&c.repoName){
    const base=`https://github.com/${c.repoOwner}/${c.repoName}`;
    html+=`<p><b>Repositorio:</b> ${aesc(c.repoOwner+'/'+c.repoName)}</p>`;
    const a=aq('actions-link'); if(a){a.style.display='inline-flex'; a.href=`${base}/actions`;}
  }else{
    html+=`<pre class="code">Completar luego en assets/js/config.js:\nrepoOwner: "tu-usuario-o-empresa"\nrepoName: "tu-repositorio"</pre>`;
  }
  box.innerHTML=html;
}

async function loadLocalJson(){
  try{const r=await fetch('data/projects.json?ts='+Date.now(),{cache:'no-store'}); ADMIN_DATA=await r.json();}catch(e){ADMIN_DATA={projects:[]};}
}
function renderAdminMetrics(){
  const ps=ADMIN_DATA.projects||[]; const tasks=ps.flatMap(p=>p.tasks||[]); const acts=tasks.filter(t=>!t.is_summary).length;
  if(aq('admin-metrics'))aq('admin-metrics').innerHTML=`<div class="metric"><span>Proyectos</span><strong>${ps.length}</strong><small>Cronogramas</small></div><div class="metric"><span>Registros JSON</span><strong>${tasks.length}</strong><small>Respaldo local</small></div><div class="metric"><span>Actividades</span><strong>${acts}</strong><small>Sin resumen</small></div><div class="metric"><span>Administrador</span><strong>${ADMIN_PROFILE?'Activo':'Login'}</strong><small>Supabase Auth</small></div>`;
}
function validateData(x){if(!x||!Array.isArray(x.projects))throw new Error('El JSON debe tener un arreglo llamado projects.'); x.projects.forEach(p=>{if(!Array.isArray(p.tasks))throw new Error('Cada proyecto debe tener tasks.');}); return true;}
async function handleJSONFile(e){const f=e.target.files[0]; if(!f)return; try{const text=await f.text(); const obj=JSON.parse(text); validateData(obj); ADMIN_DATA=obj; edited=true; renderAdminMetrics(); adminMsg('json-result',`JSON cargado: <b>${aesc(f.name)}</b>. Puedes descargarlo como respaldo.`,true);}catch(err){adminMsg('json-result','Error: '+aesc(err.message));}}
function loadJSONText(apply){try{const obj=JSON.parse(aq('json-text').value); validateData(obj); if(apply){ADMIN_DATA=obj; edited=true; renderAdminMetrics();} adminMsg('json-text-result',apply?'JSON aplicado correctamente.':'JSON valido.',true);}catch(err){adminMsg('json-text-result','Error: '+aesc(err.message));}}
function downloadJSON(){const blob=new Blob([JSON.stringify(ADMIN_DATA,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='projects.json'; a.click(); URL.revokeObjectURL(a.href);}
function formatDate(v){const d=new Date(v); return isNaN(d)?'':d.toLocaleString('es-PE',{dateStyle:'short',timeStyle:'short'});}

window.addEventListener('DOMContentLoaded',adminLoad);
