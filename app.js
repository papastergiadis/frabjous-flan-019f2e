/* ================================================================
   B&E Solutions – Project Management v2.1  |  Secure Client Delivery Fix 8
   Backend: Supabase (PostgreSQL + Storage)
   ================================================================ */
'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const nowTS = () => new Date().toISOString();
const fmt   = d => d ? new Date(d).toLocaleDateString('el-GR') : '—';
const fmtDT = d => d ? new Date(d).toLocaleString('el-GR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const el    = id => document.getElementById(id);
const esc   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const TASK_STATUSES = {
  not_started:         { label:'Δεν έχει ξεκινήσει',    cls:'ts-ns',  color:'#64748b' },
  in_progress:         { label:'Σε εξέλιξη',             cls:'ts-ip',  color:'#1d4ed8' },
  waiting_client:      { label:'Αναμονή πελάτη',         cls:'ts-wc',  color:'#b45309' },
  internal_processing: { label:'Εσωτερική επεξεργασία',  cls:'ts-int', color:'#0c1a2e' },
  under_review:        { label:'Σε έλεγχο',              cls:'ts-rev', color:'#7c3aed' },
  completed:           { label:'Ολοκληρώθηκε',           cls:'ts-done',color:'#059669' },
  cancelled:           { label:'Ακυρώθηκε',              cls:'ts-canc',color:'#dc2626' },
  not_required:        { label:'Δεν Απαιτείται',          cls:'ts-nr',  color:'#9ca3af' },
  waiting_public:      { label:'Αναμονή - Δημόσιος Φορέας', cls:'ts-wp', color:'#0891b2' },
};

const TERMINAL_TASK_STATUSES = new Set(['completed','cancelled','not_required']);
const WAITING_TASK_STATUSES = new Set([
  'waiting_client', 'waiting_public', 'waiting_third_party',
  'waiting_approval', 'under_review', 'blocked'
]);

const ROLE_INFO = {
  admin:           { label:'Διαχειριστής',   cls:'role-admin',  level:4 },
  management:      { label:'Διοίκηση',        cls:'role-mgmt',   level:3 },
  project_manager: { label:'Υπ. Έργου',      cls:'role-pm',     level:2 },
  team_member:     { label:'Μέλος Ομάδας',   cls:'role-team',   level:1 },
  client:          { label:'Πελάτης',         cls:'role-client', level:0 },
};

// Simplified statuses shown to clients (hides internal states)
const CLIENT_STATUSES = {
  not_started:         { label:'Δεν έχει ξεκινήσει', cls:'ts-ns' },
  in_progress:         { label:'Σε εξέλιξη',          cls:'ts-ip' },
  waiting_client:      { label:'Απαιτείται ενέργεια σας', cls:'ts-wc' },
  internal_processing: { label:'Σε εξέλιξη',          cls:'ts-ip' },  // hidden internal detail
  under_review:        { label:'Σε εξέλιξη',          cls:'ts-ip' },  // hidden
  completed:           { label:'Ολοκληρώθηκε',        cls:'ts-done' },
  cancelled:           { label:'Ακυρώθηκε',            cls:'ts-canc' },
  not_required:        { label:'Δεν Απαιτείται',       cls:'ts-nr' },
};

const DOC_TYPES = {
  client:      'Πελάτης',
  team:        'Εσωτερικό',
  third_party: 'Τρίτος',
};

// ── SUPABASE / TRANSITION AUTH ────────────────────────────────────
// `sb` is initialized in index.html before this script loads.
// Phase 2F progressive Auth:
// - every role may use Supabase Auth once an Auth account exists;
// - Admin/Management MUST use Supabase Auth;
// - Project Manager / Team Member / Client retain a temporary legacy fallback
//   until the final organization-wide Auth cutover.
const AUTH_REQUIRED_ROLES = new Set(['admin','management']);
let AUTH_MODE = 'legacy'; // 'legacy' | 'supabase'

function emptyDbState() {
  return {
    users:[], categories:[], timesheetCategories:[], projects:[], auditLog:[],
    templates:[], timesheets:[], clientCalendar:[],
    crmCompanies:[], crmContacts:[], offers:[]
  };
}

function isSupabaseAuthMode() { return AUTH_MODE === 'supabase'; }
// sb is initialized in index.html before this script loads

// ── DB OPERATIONS (Supabase) ──────────────────────────────────────
async function loadCurrentAppUser() {
  const {data, error} = await sb.rpc('app_me');
  if (error) throw error;
  return data || null;
}

async function fetchAllTimesheets() {
  const pageSize = 5000;
  let from = 0;
  const rows = [];

  while (true) {
    const {data, error} = await sb
      .from('be_timesheets')
      .select('data')
      .order('id', {ascending:false})
      .range(from, from + pageSize - 1);

    if (error) return {data:null, error};
    const batch = data || [];
    rows.push(...batch);

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return {data:rows, error:null};
}

async function fetchTimesheetCategoryDirectory() {
  if (!isSupabaseAuthMode()) return {data:null, error:null};
  return sb.rpc('app_timesheet_category_directory');
}


let _tsLoadToken=0;

async function loadTimesheetPage(page=1) {
  page=Math.max(1,parseInt(page||1,10));
  if(!isSupabaseAuthMode()) {
    state.tsPage=page; state.tsLoaded=true; state.tsLoading=false;
    if(state.view==='timesheet') render();
    return;
  }

  const token=++_tsLoadToken;
  state.tsLoading=true;
  if(state.view==='timesheet') render();

  const {data,error}=await sb.rpc('app_timesheet_page',{
    p_page:page,
    p_page_size:100,
    p_user_id:state.tsFilterUser||null,
    p_project_id:state.tsFilterProj||null,
    p_date_from:state.tsFilterFrom||null,
    p_date_to:state.tsFilterTo||null,
    p_sort_key:state.tsSortKey||'date',
    p_sort_dir:state.tsSortDir||'desc'
  });

  if(token!==_tsLoadToken) return;
  if(error) {
    state.tsLoading=false; state.tsLoaded=true;
    console.error('Timesheet page load:',error);
    showToast('Σφάλμα φόρτωσης Timesheet: '+(error.message||error),'error');
    if(state.view==='timesheet') render();
    return;
  }

  const totalCount=Number(data?.totalCount||0);
  const maxPage=Math.max(1,Math.ceil(totalCount/100));
  if(page>maxPage && totalCount>0) {
    state.tsLoading=false;
    return loadTimesheetPage(maxPage);
  }

  state.db.timesheets=Array.isArray(data?.rows)?data.rows:[];
  state.tsPage=page;
  state.tsTotalCount=totalCount;
  state.tsTotalHours=Number(data?.totalHours||0);
  state.tsLoaded=true;
  state.tsLoading=false;
  if(state.view==='timesheet') render();
}

window.setTimesheetFilter=function(key,value){
  const fields={user:'tsFilterUser',project:'tsFilterProj',from:'tsFilterFrom',to:'tsFilterTo'};
  if(!fields[key]) return;
  state[fields[key]]=value||'';
  state.tsPage=1;
  if(isSupabaseAuthMode()) loadTimesheetPage(1); else render();
};

window.clearTimesheetFilters=function(){
  state.tsFilterUser=''; state.tsFilterProj=''; state.tsFilterFrom=''; state.tsFilterTo=''; state.tsPage=1;
  if(isSupabaseAuthMode()) loadTimesheetPage(1); else render();
};

window.goTimesheetPage=function(page){
  page=Math.max(1,parseInt(page||1,10));
  if(isSupabaseAuthMode()) loadTimesheetPage(page); else {state.tsPage=page;render();}
};

async function refreshTimesheetAfterMutation(page=null){
  if(isSupabaseAuthMode()) await loadTimesheetPage(page||state.tsPage||1); else render();
}

async function fetchTimesheetRowsForBilling(projectId,dateFrom,dateTo){
  if(!isSupabaseAuthMode()) {
    return (state.db.timesheets||[]).filter(e=>e.projectId===projectId&&e.date>=dateFrom&&e.date<=dateTo);
  }
  const all=[]; let page=1;
  while(true){
    const {data,error}=await sb.rpc('app_timesheet_page',{
      p_page:page,p_page_size:500,p_user_id:null,p_project_id:projectId,
      p_date_from:dateFrom,p_date_to:dateTo,p_sort_key:'date',p_sort_dir:'asc'
    });
    if(error) throw error;
    const rows=Array.isArray(data?.rows)?data.rows:[];
    all.push(...rows);
    const total=Number(data?.totalCount||0);
    if(all.length>=total||rows.length===0) break;
    page++;
  }
  return all;
}

async function loadFromDB() {
  try {
    if (isSupabaseAuthMode()) {
      const [u, c, p, a, t, ts, tc, cc, comp, cont, off, notif, deliveries] = await Promise.all([
        sb.rpc('app_user_directory'),
        sb.from('be_categories').select('data'),
        sb.from('be_projects').select('data'),
        sb.from('be_audit_log').select('data').order('ts', {ascending:false}).limit(200),
        sb.from('be_templates').select('data'),
        Promise.resolve({data:[], error:null}),
        fetchTimesheetCategoryDirectory(),
        sb.from('be_client_calendar').select('data').order('id', {ascending:false}),
        sb.rpc('app_crm_companies_safe'),
        sb.rpc('app_crm_contacts_safe'),
        sb.from('be_offers').select('data').order('id', {ascending:false}),
        sb.rpc('app_notifications_list',{p_limit:50}),
        Promise.resolve(sb.rpc('app_client_deliveries_list',{p_project_id:null}))
          .catch(error=>({data:[],error:null,_deliveryError:error})),
      ]);

      for (const [label,res] of Object.entries({
        users:u,categories:c,projects:p,audit:a,templates:t,
        timesheets:ts,timesheetCategories:tc,clientCalendar:cc,companies:comp,contacts:cont,offers:off,notifications:notif,deliveries
      })) {
        if (res?.error) throw new Error(`${label}: ${res.error.message||res.error}`);
      }

      state.db = {
        users:           (u.data||[]).map(r=>r.data ?? r),
        categories:      (c.data||[]).map(r=>r.data),
        timesheetCategories: (tc.data||[]).map(r=>({id:r.category_id, name:r.category_name})),
        projects:        (p.data||[]).map(r=>r.data),
        auditLog:        (a.data||[]).map(r=>r.data),
        templates:       (t.data||[]).map(r=>r.data),
        timesheets:      (ts.data||[]).map(r=>r.data),
        clientCalendar:  (cc.data||[]).map(r=>r.data),
        crmCompanies:    (comp.data||[]).map(r=>r.data ?? r),
        crmContacts:     (cont.data||[]).map(r=>r.data ?? r),
        offers:          (off.data||[]).map(r=>r.data),
        notifications:   (notif.data||[]).map(r=>({
          id:String(r.id),
          recipientUserId:r.recipient_user_id,
          actorUserId:r.actor_user_id,
          type:r.type,
          priority:r.priority||'normal',
          projectId:r.project_id,
          phaseId:r.phase_id,
          taskId:r.task_id,
          subtaskId:r.subtask_id,
          title:r.title,
          message:r.message||'',
          createdAt:r.created_at,
          readAt:r.read_at||null,
          source:'table'
        })),
        clientDeliveries: (deliveries.data||[]).map(r=>({
          id:String(r.id), projectId:r.project_id, phaseId:r.phase_id,
          taskId:r.task_id, documentId:r.document_id,
          storagePath:r.storage_path, fileName:r.file_name,
          mimeType:r.mime_type, sizeBytes:Number(r.size_bytes||0),
          version:Number(r.version||1), publishedAt:r.published_at,
          publishedBy:r.published_by, active:r.active!==false
        })),
      };
    } else {
      // Temporary legacy loader for users not yet migrated to Supabase Auth.
      const [u, c, p, a, t, ts, cc, comp, cont, off] = await Promise.all([
        sb.from('be_users').select('data'),
        sb.from('be_categories').select('data'),
        sb.from('be_projects').select('data'),
        sb.from('be_audit_log').select('data').order('ts', {ascending:false}).limit(200),
        sb.from('be_templates').select('data'),
        fetchAllTimesheets(),
        sb.from('be_client_calendar').select('data').order('id', {ascending:false}),
        sb.from('companies').select('*').is('deleted_at', null).order('company_name').limit(10000),
        sb.from('contacts').select('*').is('deleted_at', null).order('last_name').limit(10000),
        sb.from('be_offers').select('data').order('id', {ascending:false}),
      ]);

      for (const [label,res] of Object.entries({
        users:u,categories:c,projects:p,audit:a,templates:t,
        timesheets:ts,clientCalendar:cc,companies:comp,contacts:cont,offers:off
      })) {
        if (res?.error) throw new Error(`${label}: ${res.error.message||res.error}`);
      }

      state.db = {
        users:           (u.data||[]).map(r=>r.data),
        categories:      (c.data||[]).map(r=>r.data),
        timesheetCategories: (c.data||[]).map(r=>r.data).map(cat=>({id:cat.id,name:cat.name})),
        projects:        (p.data||[]).map(r=>r.data),
        auditLog:        (a.data||[]).map(r=>r.data),
        templates:       (t.data||[]).map(r=>r.data),
        timesheets:      (ts.data||[]).map(r=>r.data),
        clientCalendar:  (cc.data||[]).map(r=>r.data),
        crmCompanies:    comp.data||[],
        crmContacts:     cont.data||[],
        offers:          (off.data||[]).map(r=>r.data),
        notifications:   [],
        clientDeliveries: [],
      };

      // SECURITY: never auto-seed demo credentials in production.
      // Empty user tables must be handled explicitly by an administrator.
    }

    if (state.cu) {
      const fresh = state.db.users.find(u=>u.id===state.cu.id);
      if (fresh) state.cu.notifications = fresh.notifications||[];
    }
  } catch(err) {
    console.error('DB load error:', err);
    showToast(
      (isSupabaseAuthMode() ? 'Σφάλμα ασφαλούς φόρτωσης δεδομένων: ' : 'Σφάλμα σύνδεσης με τη βάση δεδομένων: ')
      + (err.message||err),
      'error'
    );
    throw err;
  }
}

async function dbSaveUser(user) {
  if (isSupabaseAuthMode()) {
    const safeUser={...user};
    delete safeUser.password;
    const {data,error}=await sb.rpc('app_admin_update_user',{
      p_app_user_id:user.id,
      p_data:safeUser
    });
    if (error) {
      showToast('Σφάλμα ασφαλούς ενημέρωσης χρήστη.','error');
      throw error;
    }
    return data;
  }
  const {error} = await sb.from('be_users').upsert({id:user.id, data:user});
  if (error) { showToast('Σφάλμα αποθήκευσης χρήστη.','error'); throw error; }
}
async function dbSaveCategory(cat) {
  const {error} = await sb.from('be_categories').upsert({id:cat.id, data:cat});
  if (error) { showToast('Σφάλμα αποθήκευσης κατηγορίας.','error'); throw error; }
}
async function dbSaveProject(proj) {
  if (isSupabaseAuthMode()) {
    const role=state.cu?.role;

    if (role==='project_manager') {
      const {data,error}=await sb.rpc('app_project_save_managed',{
        p_project_id:proj.id,
        p_data:proj
      });
      if (error) {
        showToast('Η ασφαλής αποθήκευση έργου απορρίφθηκε.','error');
        throw error;
      }
      const idx=(state.db.projects||[]).findIndex(p=>p.id===proj.id);
      if(idx>=0) state.db.projects[idx]=data; else state.db.projects.push(data);
      return data;
    }

    if (!['admin','management'].includes(role)) {
      throw new Error('Ο ρόλος σας δεν επιτρέπεται να αντικαταστήσει ολόκληρο έργο.');
    }
  }

  const {error} = await sb.from('be_projects').upsert({id:proj.id, data:proj});
  if (error) { showToast('Σφάλμα αποθήκευσης έργου.','error'); throw error; }
}

// Phase 2E: refresh the authoritative server copy after a narrow mutation RPC.
async function refreshProjectFromServer(projectId) {
  const {data,error}=await sb.from('be_projects').select('data').eq('id',projectId).single();
  if (error) throw error;
  const fresh=data?.data;
  if (!fresh) throw new Error('Το έργο δεν επιστράφηκε από τη βάση.');
  const idx=(state.db.projects||[]).findIndex(p=>p.id===projectId);
  if (idx>=0) state.db.projects[idx]=fresh;
  else state.db.projects.push(fresh);
  return fresh;
}

async function secureProjectRpc(rpcName,args,projectId) {
  const {data,error}=await sb.rpc(rpcName,args);
  if (error) throw error;
  if (projectId) await refreshProjectFromServer(projectId);
  return data;
}
async function dbSaveTemplate(tpl) {
  const {error} = await sb.from('be_templates').upsert({id:tpl.id, data:tpl});
  if (error) { showToast('Σφάλμα αποθήκευσης προτύπου.','error'); throw error; }
}
async function dbDeleteTemplate(tplId) {
  const {error} = await sb.from('be_templates').delete().eq('id',tplId);
  if (error) { showToast('Σφάλμα διαγραφής προτύπου.','error'); throw error; }
}
async function dbSaveTimesheet(entry) {
  const {error} = await sb.from('be_timesheets').upsert({id:entry.id, data:entry});
  if (error) { showToast('Σφάλμα αποθήκευσης εγγραφής.','error'); throw error; }
}
async function dbDeleteTimesheet(entryId) {
  const {error} = await sb.from('be_timesheets').delete().eq('id',entryId);
  if (error) { showToast('Σφάλμα διαγραφής εγγραφής.','error'); throw error; }
}
async function dbDeleteProject(pid) {
  if (isSupabaseAuthMode()) {
    const {error}=await sb.rpc('app_project_delete_managed',{p_project_id:pid});
    if(error) throw error;
    return;
  }
  const {error}=await sb.from('be_projects').delete().eq('id',pid);
  if(error) throw error;
}
async function dbDeleteUser(uid) {
  if (isSupabaseAuthMode()) {
    throw new Error('Η διαγραφή χρήστη είναι προσωρινά απενεργοποιημένη κατά τη μετάβαση Auth, ώστε να μη δημιουργηθεί ορφανός Auth λογαριασμός.');
  }
  const {error}=await sb.from('be_users').delete().eq('id', uid);
  if(error) throw error;
}
async function dbDeleteCategory(cid) {
  await sb.from('be_categories').delete().eq('id', cid);
}
async function dbSaveClientCalEntry(entry) {
  const {error} = await sb.from('be_client_calendar').upsert({id:entry.id, data:entry});
  if (error) { showToast('Σφάλμα αποθήκευσης εγγραφής.','error'); throw error; }
}
async function dbDeleteClientCalEntry(entryId) {
  const {error} = await sb.from('be_client_calendar').delete().eq('id',entryId);
  if (error) { showToast('Σφάλμα διαγραφής εγγραφής.','error'); throw error; }
}

// ── CRM DB ────────────────────────────────────────────────────────
async function crmSaveCompany(data) {
  if (!data.id) data.id = crypto.randomUUID();
  data.updated_at = new Date().toISOString();
  const {error} = await sb.from('companies').upsert(data);
  if (error) { showToast('Σφάλμα αποθήκευσης εταιρείας.','error'); throw error; }
  // update local state
  const idx = (state.db.crmCompanies||[]).findIndex(x=>x.id===data.id);
  if (idx>=0) state.db.crmCompanies[idx]=data;
  else state.db.crmCompanies.push(data);
  return data;
}
async function crmDeleteCompany(id) {
  if (!confirm('Διαγραφή εταιρείας;')) return;
  const now = new Date().toISOString();
  const {error} = await sb.from('companies').update({deleted_at:now}).eq('id',id);
  if (error) { showToast('Σφάλμα διαγραφής.','error'); throw error; }
  state.db.crmCompanies = (state.db.crmCompanies||[]).filter(x=>x.id!==id);
  if (state.view==='crm-company') navigate('crm-companies');
  else render();
  showToast('Εταιρεία διαγράφηκε.','');
}
async function crmSaveContact(data) {
  if (!data.id) data.id = crypto.randomUUID();
  data.updated_at = new Date().toISOString();
  const {error} = await sb.from('contacts').upsert(data);
  if (error) { showToast('Σφάλμα αποθήκευσης επαφής.','error'); throw error; }
  // Push to Google Contacts asynchronously (non-blocking; won't affect save if it fails)
  pushContactToGoogle(data).catch(e => console.error('[google-contacts] push error:', e));
  const idx = (state.db.crmContacts||[]).findIndex(x=>x.id===data.id);
  if (idx>=0) state.db.crmContacts[idx]=data;
  else state.db.crmContacts.push(data);
  return data;
}
async function crmDeleteContact(id) {
  if (!confirm('Διαγραφή επαφής;')) return;
  const now = new Date().toISOString();
  const {error} = await sb.from('contacts').update({deleted_at:now}).eq('id',id);
  if (error) { showToast('Σφάλμα διαγραφής.','error'); throw error; }
  state.db.crmContacts = (state.db.crmContacts||[]).filter(x=>x.id!==id);
  if (state.view==='crm-contact') navigate('crm-contacts');
  else render();
  showToast('Επαφή διαγράφηκε.','');
}
// ── OFFERS DB ─────────────────────────────────────────────────────
async function dbSaveOffer(offer) {
  if (!offer.id) offer.id = uid();
  offer.updatedAt = nowTS();
  const {error} = await sb.from('be_offers').upsert({id:offer.id, data:offer});
  if (error) { showToast('Σφάλμα αποθήκευσης offer.','error'); throw error; }
  const idx = (state.db.offers||[]).findIndex(x=>x.id===offer.id);
  if (idx>=0) state.db.offers[idx]=offer;
  else (state.db.offers=state.db.offers||[]).unshift(offer);
  return offer;
}
async function dbDeleteOffer(id) {
  if (!confirm('Διαγραφή offer;')) return;
  const {error} = await sb.from('be_offers').delete().eq('id',id);
  if (error) { showToast('Σφάλμα διαγραφής.','error'); throw error; }
  state.db.offers = (state.db.offers||[]).filter(x=>x.id!==id);
  render();
  showToast('Offer διαγράφηκε.','');
}

async function dbClearAudit() {
  if (isSupabaseAuthMode()) {
    throw new Error('Το audit trail δεν εκκαθαρίζεται από το Auth-enabled περιβάλλον.');
  }
  const {error}=await sb.from('be_audit_log').delete().neq('id','__none__');
  if(error) throw error;
}

// Fire-and-forget audit (never blocks UI)
function auditLog(action, details='') {
  if (!state.cu || !sb) return;
  const entry = { id:uid(), userId:state.cu.id, userName:state.cu.name, role:state.cu.role, timestamp:nowTS(), action, details };
  state.db.auditLog = state.db.auditLog || [];
  state.db.auditLog.unshift(entry);
  if (state.db.auditLog.length > 500) state.db.auditLog = state.db.auditLog.slice(0,500);
  try {
    if (isSupabaseAuthMode()) {
      Promise.resolve(
        sb.rpc('app_write_audit',{p_action:action,p_details:details})
      ).then(({error})=>{if(error)console.error('auditLog RPC:',error);},e=>console.error('auditLog RPC:',e));
    } else {
      Promise.resolve(
        sb.from('be_audit_log').upsert({id:entry.id, data:entry, ts:entry.timestamp})
      ).then(()=>{},e=>console.error('auditLog:',e));
    }
  } catch(e){ console.error('auditLog:', e); }
}

// ── FILE STORAGE (Supabase Storage) ───────────────────────────────
const BUCKET = 'documents';

async function fileSave(fileId, file) {
  const contentType=file.type||_documentMime(file.name);
  const {error} = await sb.storage.from(BUCKET).upload(fileId, file, {upsert:true,contentType});
  if (error) throw error;
}
async function fileGet(fileId) {
  const {data, error} = await sb.storage.from(BUCKET).download(fileId);
  if (error) throw error;
  return data; // Blob
}
async function fileDelete(fileId) {
  await sb.storage.from(BUCKET).remove([fileId]).catch(()=>{});
}

// ── SEED DATA ─────────────────────────────────────────────────────
function getSeedData() {
  return {
    users: [
      { id:'u_admin', name:'Διαχειριστής',            username:'admin',  password:'admin',  role:'admin',           email:'admin@be-solutions.gr',   categoryIds:[],              projectIds:[] },
      { id:'u_mgmt',  name:'Γ. Παπαστεργιάδης',       username:'mgmt',   password:'mgmt',   role:'management',      email:'g.p@be-solutions.gr',      categoryIds:[],              projectIds:[] },
      { id:'u_pm1',   name:'Μαρία Κωνσταντίνου',       username:'pm1',    password:'pm1',    role:'project_manager', email:'m.k@be-solutions.gr',      categoryIds:['cat_vehicles'],projectIds:[] },
      { id:'u_pm2',   name:'Νίκος Αθανασίου',          username:'pm2',    password:'pm2',    role:'project_manager', email:'n.a@be-solutions.gr',      categoryIds:['cat_permits'], projectIds:[] },
      { id:'u_tm1',   name:'Ελένη Δημητρίου',          username:'tm1',    password:'tm1',    role:'team_member',     email:'e.d@be-solutions.gr',      categoryIds:[],              projectIds:['proj_1'] },
      { id:'u_cl1',   name:'Παπαδόπουλος Γεώργιος',   username:'papado', password:'papado', role:'client',          email:'g.papadopoulos@email.com', categoryIds:[],              projectIds:['proj_1'] },
    ],
    categories: [
      {
        id:'cat_vehicles', name:'Έγκριση Οχημάτων', icon:'🚗',
        color:'#e87010', bgLight:'#fff3e6',
        desc:'Μεταβιβάσεις, εγγραφές και εγκρίσεις κυκλοφορίας οχημάτων',
        managerIds:['u_pm1'],
        template:{ phases:[
          { name:'Συγκέντρωση Δικαιολογητικών', tasks:[
            { name:'Συλλογή Προσωπικών Εγγράφων', parallel:false, subtasks:['Έλεγχος ταυτότητας','Επαλήθευση ΑΦΜ'],
              docs:[{cat:'Ταυτότητα',name:'Αστυνομική Ταυτότητα',required:true},{cat:'Φορολογικά',name:'ΑΦΜ',required:true},{cat:'Φορολογικά',name:'ΑΜΚΑ',required:true}] },
            { name:'Συλλογή Εγγράφων Οχήματος', parallel:false, subtasks:[],
              docs:[{cat:'Άδεια',name:'Άδεια Κυκλοφορίας',required:true},{cat:'ΚΤΕΟ',name:'Βεβαίωση ΚΤΕΟ',required:true},{cat:'Ασφάλεια',name:'Ασφαλιστήριο Συμβόλαιο',required:true}] },
          ]},
          { name:'Υπογραφή & Έλεγχος Εγγράφων', tasks:[
            { name:'Σύνταξη & Υπογραφή Σύμβασης', parallel:false, subtasks:[],
              docs:[{cat:'Σύμβαση',name:'Σύμβαση Αγοράς/Πώλησης',required:true},{cat:'Πιστοποιητικό',name:'Πιστοποιητικό Ιδιοκτησίας',required:true}] },
          ]},
          { name:'Κατάθεση στην Αρχή', tasks:[
            { name:'Κατάθεση Δικαιολογητικών', parallel:false, subtasks:[],
              docs:[{cat:'Κατάθεση',name:'Αριθμός Πρωτοκόλλου',required:true},{cat:'Κατάθεση',name:'Αποδεικτικό Κατάθεσης',required:true}] },
          ]},
          { name:'Παραλαβή Νέας Άδειας', tasks:[
            { name:'Παραλαβή & Επαλήθευση Άδειας', parallel:false, subtasks:[],
              docs:[{cat:'Άδεια',name:'Νέα Άδεια Κυκλοφορίας',required:true}] },
          ]},
        ]}
      },
      {
        id:'cat_permits', name:'Οικοδομικές Άδειες', icon:'🏗️',
        color:'#059669', bgLight:'#ecfdf5',
        desc:'Διαχείριση αδειών δόμησης και οικοδομικών εγκρίσεων',
        managerIds:['u_pm2'],
        template:{ phases:[
          { name:'Προμελέτη & Αρχιτεκτονικά', tasks:[
            { name:'Συλλογή Τεχνικών Σχεδίων', parallel:false, subtasks:[],
              docs:[{cat:'Σχέδια',name:'Αρχιτεκτονικά Σχέδια',required:true},{cat:'Σχέδια',name:'Τοπογραφικό Διάγραμμα',required:true},{cat:'Μελέτη',name:'Στατική Μελέτη',required:true}] },
          ]},
          { name:'Κατάθεση στην Πολεοδομία', tasks:[
            { name:'Υποβολή Αίτησης Αδείας', parallel:false, subtasks:[],
              docs:[{cat:'Κατάθεση',name:'Αίτηση Αδείας',required:true},{cat:'Κατάθεση',name:'Απόδειξη Παράβολου',required:true}] },
          ]},
          { name:'Παραλαβή Οικοδομικής Αδείας', tasks:[
            { name:'Παραλαβή Εγκεκριμένης Αδείας', parallel:false, subtasks:[],
              docs:[{cat:'Άδεια',name:'Οικοδομική Άδεια',required:true}] },
          ]},
        ]}
      },
    ],
    projects: [
      {
        id:'proj_1', categoryId:'cat_vehicles', code:'OX-2024-001',
        name:'Μεταβίβαση – Παπαδόπουλος Γ.',
        clientId:'u_cl1', clientName:'Παπαδόπουλος Γεώργιος',
        managerId:'u_pm1', memberIds:['u_tm1'],
        status:'in_progress', startDate:'2024-06-10', completedDate:null,
        phases:[
          { id:'ph_1', name:'Συγκέντρωση Δικαιολογητικών', order:1, tasks:[
            { id:'task_1', name:'Συλλογή Προσωπικών Εγγράφων',
              assigneeId:'u_tm1', status:'waiting_client', parallel:false, dependsOn:[],
              startDate:'2024-06-10', completedDate:null,
              subtasks:[{id:'st_1',name:'Έλεγχος ταυτότητας',done:false},{id:'st_2',name:'Επαλήθευση ΑΦΜ',done:false}],
              docs:[
                {id:'d1',cat:'Ταυτότητα',name:'Αστυνομική Ταυτότητα',required:true,done:false,type:'client',url:null,at:null},
                {id:'d2',cat:'Φορολογικά',name:'ΑΦΜ',required:true,done:false,type:'client',url:null,at:null},
                {id:'d3',cat:'Φορολογικά',name:'ΑΜΚΑ',required:true,done:false,type:'client',url:null,at:null},
              ]},
            { id:'task_2', name:'Συλλογή Εγγράφων Οχήματος',
              assigneeId:'u_pm1', status:'not_started', parallel:false, dependsOn:['task_1'],
              startDate:null, completedDate:null, subtasks:[],
              docs:[
                {id:'d4',cat:'Άδεια',name:'Άδεια Κυκλοφορίας',required:true,done:false,type:'client',url:null,at:null},
                {id:'d5',cat:'ΚΤΕΟ',name:'Βεβαίωση ΚΤΕΟ',required:true,done:false,type:'client',url:null,at:null},
                {id:'d6',cat:'Ασφάλεια',name:'Ασφαλιστήριο',required:true,done:false,type:'client',url:null,at:null},
              ]},
          ]},
          { id:'ph_2', name:'Υπογραφή & Έλεγχος Εγγράφων', order:2, tasks:[
            { id:'task_3', name:'Σύνταξη & Υπογραφή Σύμβασης',
              assigneeId:'u_pm1', status:'not_started', parallel:false, dependsOn:[],
              startDate:null, completedDate:null, subtasks:[],
              docs:[
                {id:'d7',cat:'Σύμβαση',name:'Σύμβαση Αγοράς/Πώλησης',required:true,done:false,type:'client',url:null,at:null},
                {id:'d8',cat:'Πιστοποιητικό',name:'Πιστοποιητικό Ιδιοκτησίας',required:true,done:false,type:'client',url:null,at:null},
              ]},
          ]},
          { id:'ph_3', name:'Κατάθεση στην Αρχή', order:3, tasks:[
            { id:'task_4', name:'Κατάθεση Δικαιολογητικών',
              assigneeId:'u_pm1', status:'not_started', parallel:false, dependsOn:[],
              startDate:null, completedDate:null, subtasks:[],
              docs:[
                {id:'d9',cat:'Κατάθεση',name:'Αριθμός Πρωτοκόλλου',required:true,done:false,type:'client',url:null,at:null},
                {id:'d10',cat:'Κατάθεση',name:'Αποδεικτικό Κατάθεσης',required:true,done:false,type:'client',url:null,at:null},
              ]},
          ]},
          { id:'ph_4', name:'Παραλαβή Νέας Άδειας', order:4, tasks:[
            { id:'task_5', name:'Παραλαβή & Επαλήθευση Άδειας',
              assigneeId:'u_pm1', status:'not_started', parallel:false, dependsOn:[],
              startDate:null, completedDate:null, subtasks:[],
              docs:[
                {id:'d11',cat:'Άδεια',name:'Νέα Άδεια Κυκλοφορίας',required:true,done:false,type:'client',url:null,at:null},
              ]},
          ]},
        ]
      }
    ],
    auditLog:[]
  };
}

async function seedAndPush() {
  const seed = getSeedData();
  state.db = { ...seed, templates: [] };
  showToast('Πρώτη εκκίνηση — φόρτωση demo δεδομένων…','');
  await Promise.all([
    ...seed.users.map(u => sb.from('be_users').upsert({id:u.id, data:u})),
    ...seed.categories.map(c => sb.from('be_categories').upsert({id:c.id, data:c})),
    ...seed.projects.map(p => sb.from('be_projects').upsert({id:p.id, data:p})),
  ]);
}

// ── GOOGLE CONTACTS SYNC ─────────────────────────────────────────
// Maps CRM phone/email labels to Google API types
const _G_PHONE = {
  'mobile':'mobile','κινητό':'mobile','iphone':'mobile',
  'home':'home','σπίτι':'home',
  'work':'work','εργασία':'work',
  'main':'main','κύριο':'main',
  'fax':'workFax','φαξ':'workFax',
  'other':'other','άλλο':'other',
};
const _G_EMAIL = {
  'work':'work','εργασία':'work',
  'home':'home','σπίτι':'home','personal':'home','προσωπικό':'home',
  'other':'other','άλλο':'other',
};

// Convert a site2 contact row → Google People API Person object
function contactToGooglePerson(c) {
  const p = {};
  if (c.first_name || c.last_name) {
    p.names = [{ givenName: c.first_name||undefined, familyName: c.last_name||undefined }];
  }
  if (c.organization_name || c.organization_title) {
    p.organizations = [{
      name: c.organization_name||undefined,
      title: c.organization_title||undefined,
    }];
  }
  const phones = [];
  [[c.phone_1_label,c.phone_1_value],[c.phone_2_label,c.phone_2_value],
   [c.phone_3_label,c.phone_3_value],[c.phone_4_label,c.phone_4_value],
   [c.phone_5_label,c.phone_5_value]].forEach(([lbl,val])=>{
    if (val) phones.push({ value:val, type:_G_PHONE[(lbl||'').toLowerCase()]||'other' });
  });
  if (phones.length) p.phoneNumbers = phones;
  const emails = [];
  [[c.email_1_label,c.email_1_value],[c.email_2_label,c.email_2_value],
   [c.email_3_label,c.email_3_value]].forEach(([lbl,val])=>{
    if (val) emails.push({ value:val, type:_G_EMAIL[(lbl||'').toLowerCase()]||'other' });
  });
  if (emails.length) p.emailAddresses = emails;
  if (c.address_1_street||c.address_1_city||c.address_1_postal_code) {
    p.addresses = [{
      streetAddress: c.address_1_street||undefined,
      city: c.address_1_city||undefined,
      postalCode: c.address_1_postal_code||undefined,
      type: 'work',
    }];
  }
  if (c.birthday) {
    const pts = c.birthday.split('-');
    if (pts.length===3) {
      p.birthdays = [{ date:{ year:+pts[0], month:+pts[1], day:+pts[2] } }];
    }
  }
  if (c.notes) p.biographies = [{ value:c.notes, contentType:'TEXT_PLAIN' }];
  return p;
}

// Token state (persisted in localStorage)
let _googleTokenClient = null;
let _googleAccessToken = localStorage.getItem('g_access_token')||null;
let _googleTokenExpiry = Number(localStorage.getItem('g_token_expiry')||0);

// Called by GIS script onload
function gsiLoaded() {
  const cid = localStorage.getItem('google_client_id');
  if (!cid) return;
  try {
    _googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: 'https://www.googleapis.com/auth/contacts',
      callback: (resp) => {
        if (resp.error) { console.error('[gsi]', resp.error); showToast('Google OAuth σφάλμα: '+resp.error,'error'); return; }
        if (resp.access_token) {
          _googleAccessToken = resp.access_token;
          _googleTokenExpiry = Date.now() + ((resp.expires_in||3600) - 60)*1000;
          localStorage.setItem('g_access_token', _googleAccessToken);
          localStorage.setItem('g_token_expiry', String(_googleTokenExpiry));
          showToast('Google Contacts συνδέθηκε ✓','success');
          render(); // refresh button state
        }
      },
    });
  } catch(e) { console.error('[gsi] initTokenClient error:', e); }
}

// Returns true if we have a valid (non-expired) Google access token
function googleConnected() {
  return !!(  _googleAccessToken && Date.now() < _googleTokenExpiry);
}

// Show OAuth popup to connect / refresh Google token
window.connectGoogle = function() {
  let cid = localStorage.getItem('google_client_id');
  if (!cid) {
    cid = prompt('Εισάγετε το Google OAuth Client ID:\n(Βρίσκεται στο Google Cloud Console → APIs & Services → Credentials)');
    if (!cid?.trim()) return;
    cid = cid.trim();
    localStorage.setItem('google_client_id', cid);
    // Need to re-init the token client with the new ID
    _googleTokenClient = null;
  }
  if (!_googleTokenClient) {
    if (typeof google === 'undefined' || !google.accounts) {
      showToast('Το Google API δεν φορτώθηκε ακόμα, δοκιμάστε πάλι σε λίγο.','error'); return;
    }
    try {
      _googleTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: 'https://www.googleapis.com/auth/contacts',
        callback: (resp) => {
          if (resp.error) { console.error('[gsi]', resp.error); showToast('Google OAuth σφάλμα: '+resp.error,'error'); return; }
          if (resp.access_token) {
            _googleAccessToken = resp.access_token;
            _googleTokenExpiry = Date.now() + ((resp.expires_in||3600) - 60)*1000;
            localStorage.setItem('g_access_token', _googleAccessToken);
            localStorage.setItem('g_token_expiry', String(_googleTokenExpiry));
            showToast('Google Contacts συνδέθηκε ✓','success');
            render();
          }
        },
      });
    } catch(e) { showToast('Σφάλμα αρχικοποίησης Google: '+e.message,'error'); return; }
  }
  _googleTokenClient.requestAccessToken({ prompt: googleConnected() ? '' : 'consent' });
};

// Disconnect Google
window.disconnectGoogle = function() {
  if (!confirm('Αποσύνδεση από Google Contacts;')) return;
  if (_googleAccessToken) {
    try { google.accounts.oauth2.revoke(_googleAccessToken); } catch(e) {}
  }
  _googleAccessToken = null; _googleTokenExpiry = 0;
  localStorage.removeItem('g_access_token');
  localStorage.removeItem('g_token_expiry');
  showToast('Google Contacts αποσυνδέθηκε.','');
  render();
};

// Low-level authenticated fetch to Google People API
async function _googleFetch(method, url, body) {
  if (!googleConnected()) return null;
  const opts = {
    method,
    headers: { 'Authorization':'Bearer '+_googleAccessToken, 'Content-Type':'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    if (res.status === 401) {
      // Token expired mid-session
      _googleAccessToken = null; _googleTokenExpiry = 0;
      localStorage.removeItem('g_access_token'); localStorage.removeItem('g_token_expiry');
      return null;
    }
    if (!res.ok) { console.error('[google-contacts]', method, res.status, await res.text()); return null; }
    return await res.json();
  } catch(e) { console.error('[google-contacts]', e); return null; }
}

// Push a saved contact to Google (create or update). Updates google_resource_name in Supabase.
async function pushContactToGoogle(contact) {
  if (!googleConnected()) return; // silent — user hasn't connected Google
  const person = contactToGooglePerson(contact);
  let result;
  if (contact.google_resource_name) {
    // Fetch current etag (required by People API for updates)
    const cur = await _googleFetch('GET',
      `https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=names`, undefined);
    if (!cur) return;
    person.etag = cur.etag;
    result = await _googleFetch('PATCH',
      `https://people.googleapis.com/v1/${contact.google_resource_name}:updateContact`+
      `?updatePersonFields=names,organizations,phoneNumbers,emailAddresses,addresses,birthdays,biographies`,
      person);
  } else {
    result = await _googleFetch('POST',
      'https://people.googleapis.com/v1/people:createContact', person);
  }
  if (result?.resourceName) {
    const updates = {
      google_resource_name: result.resourceName,
      google_etag: result.etag||null,
      google_synced_at: new Date().toISOString(),
    };
    // Update Supabase
    Promise.resolve(sb.from('contacts').update(updates).eq('id', contact.id))
      .then(()=>{}, e=>console.error('[google-contacts] supabase update error:', e));
    // Update in-memory state
    const c = (state.db.crmContacts||[]).find(x=>x.id===contact.id);
    if (c) Object.assign(c, updates);
  }
}

// ── AUTH ──────────────────────────────────────────────────────────
function getCurrentUser() {
  if (isSupabaseAuthMode()) return state?.cu || null;
  try { return JSON.parse(sessionStorage.getItem('be_pm_user')); } catch { return null; }
}
function setCurrentUser(u) {
  if (!isSupabaseAuthMode()) sessionStorage.setItem('be_pm_user', JSON.stringify(u));
}
function clearCurrentUser() {
  sessionStorage.removeItem('be_pm_user');
}

function isAdmin()  { return ['admin','management'].includes(state.cu?.role); }
function isPM()     { return state.cu?.role === 'project_manager'; }
function isClient() { return state.cu?.role === 'client'; }
function canEdit()  { return ['admin','management','project_manager','team_member'].includes(state.cu?.role); }

// ── STATE ─────────────────────────────────────────────────────────
const state = {
  db:           { users:[], categories:[], projects:[], auditLog:[], notifications:[], clientDeliveries:[] },
  cu:           getCurrentUser(),
  view:         'login',
  categoryId:   null,
  projectId:    null,
  search:       '',
  expandedTasks:{},
  filter:       { status:'' },
  sortByPriority: false,
  ganttView:    false,
  ganttScale:   'month',
  calViewMode:  'month',
  calYear:      null,
  calMonth:     null,
  calWeekStart: null,
  calDayDate:   null,
  commentsOpen:    {},
  clientExpanded:  {},
  notifOpen:    false,
  notificationFilter: 'all',
  onlineUsers:  new Set(),
  storageStats: null, // { usedBytes, fileCount } loaded async
  offersSearch: '',
  offersStatus: '',
  ccalSort: 'date-asc',
  dashFilter: null, // 'all' | 'in_progress' | 'on_hold' | 'completed' | 'pending_docs'
  tsPage: 1,
  tsPageSize: 100,
  tsTotalCount: 0,
  tsTotalHours: 0,
  tsLoaded: false,
  tsLoading: false,
  tsFilterUser: '',
  tsFilterProj: '',
  tsFilterFrom: '',
  tsFilterTo: '',
  tsSortKey: 'date',
  tsSortDir: 'desc',
};

// ── PRESENCE ──────────────────────────────────────────────────────
let _presenceChannel = null;

function initPresence() {
  if (!state.cu || _presenceChannel) return;
  _presenceChannel = sb.channel('be-presence', {
    config: { presence: { key: state.cu.id } }
  });
  _presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const ps = _presenceChannel.presenceState();
      state.onlineUsers = new Set(Object.keys(ps));
      // refresh users view if open
      if (state.view === 'users') {
        const main = document.getElementById('main-content');
        if (main) main.innerHTML = renderUsers();
      }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await _presenceChannel.track({
          userId: state.cu.id,
          name:   state.cu.name,
          role:   state.cu.role,
          at:     new Date().toISOString(),
        });
      }
    });
}

let _notificationRealtimeChannel = null;
let _legacyNotificationPollTimer = null;

function normalizeDbNotification(r) {
  if(!r) return null;
  return {
    id:String(r.id),
    recipientUserId:r.recipient_user_id,
    actorUserId:r.actor_user_id,
    type:r.type||'info',
    priority:r.priority||'normal',
    projectId:r.project_id||null,
    phaseId:r.phase_id||null,
    taskId:r.task_id||null,
    subtaskId:r.subtask_id||null,
    title:r.title||'Ειδοποίηση',
    message:r.message||'',
    createdAt:r.created_at||nowTS(),
    readAt:r.read_at||null,
    source:'table'
  };
}

function cleanupNotificationCenter() {
  if(_notificationRealtimeChannel){
    sb.removeChannel(_notificationRealtimeChannel);
    _notificationRealtimeChannel=null;
  }
  if(_legacyNotificationPollTimer){
    clearInterval(_legacyNotificationPollTimer);
    _legacyNotificationPollTimer=null;
  }
}

async function reloadNotificationCenter() {
  if(!isSupabaseAuthMode() || !state.cu) return;
  const {data,error}=await sb.rpc('app_notifications_list',{p_limit:50});
  if(error){
    console.warn('notifications list:',error);
    return;
  }
  state.db.notifications=(data||[]).map(normalizeDbNotification).filter(Boolean);
  updateHeaderUser();
  if(state.view==='notifications') render();
}

function upsertRealtimeNotification(raw) {
  const n=normalizeDbNotification(raw);
  if(!n) return;

  const idx=(state.db.notifications||[]).findIndex(x=>x.id===n.id);
  if(idx>=0) state.db.notifications[idx]=n;
  else state.db.notifications.unshift(n);

  state.db.notifications=(state.db.notifications||[])
    .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
    .slice(0,50);

  updateHeaderUser();
  if(state.view==='notifications') render();
}

function startNotificationPolling() {
  cleanupNotificationCenter();
  if(!state.cu) return;

  if(isSupabaseAuthMode()){
    reloadNotificationCenter().catch(()=>{});

    // Dedicated table + RLS + Realtime gives authenticated users immediate alerts.
    _notificationRealtimeChannel=sb
      .channel('be-notifications-'+state.cu.id)
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'be_notifications',
          filter:`recipient_user_id=eq.${state.cu.id}`
        },
        payload=>{
          if(payload.eventType==='DELETE'){
            const id=String(payload.old?.id||'');
            state.db.notifications=(state.db.notifications||[]).filter(n=>n.id!==id);
            updateHeaderUser();
            if(state.view==='notifications') render();
            return;
          }
          const incoming=normalizeDbNotification(payload.new);
          const wasKnown=(state.db.notifications||[]).some(n=>n.id===incoming?.id);
          upsertRealtimeNotification(payload.new);

          if(incoming && !wasKnown && !incoming.readAt){
            const toastType=incoming.priority==='urgent'?'error':incoming.priority==='action'?'info':'success';
            showToast(incoming.title,toastType);
          }
        }
      )
      .subscribe();

    // Temporary hybrid bridge: an unmigrated legacy user can still write a
    // notification into be_users.notifications. Auth users check that small
    // legacy array every 15 seconds until the Auth rollout is complete.
    _legacyNotificationPollTimer=setInterval(async()=>{
      try{
        const {data,error}=await sb.rpc('app_me');
        if(error || !data || data.id!==state.cu?.id) return;
        state.cu.notifications=data.notifications||[];
        const dbUser=(state.db.users||[]).find(u=>u.id===state.cu.id);
        if(dbUser) dbUser.notifications=state.cu.notifications;
        updateHeaderUser();
        if(state.view==='notifications') render();
      }catch(e){
        console.warn('legacy notification bridge:',e);
      }
    },15000);
  }
}

let _projectsRealtimeChannel = null;
function initProjectsRealtime() {
  if (_projectsRealtimeChannel) return;
  _projectsRealtimeChannel = sb.channel('projects-realtime-reviews')
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'be_projects'}, async (payload) => {
      const rowId = payload.new?.id; if (!rowId) return;
      try {
        const {data} = await sb.from('be_projects').select('data').eq('id', rowId).single();
        if (!data?.data) return;
        const updated = data.data;
        const idx = state.db.projects.findIndex(p=>p.id===updated.id);
        if (idx>=0) state.db.projects[idx]=updated; else state.db.projects.push(updated);
        // Refresh bell and current view if relevant
        updateHeaderUser();
        if (state.view==='project'&&state.projectId===updated.id) {
          const main=document.getElementById('main-content'); if(main) main.innerHTML=renderProject();
        }
        if (state.view==='dashboard') render();
      } catch(e) { console.error('Realtime project refresh:', e); }
    })
    .subscribe();
}

function cleanupPresence() {
  if (_presenceChannel) {
    sb.removeChannel(_presenceChannel);
    _presenceChannel = null;
  }
  state.onlineUsers = new Set();
}

// ── STORAGE STATS ─────────────────────────────────────────────────
async function loadStorageStats() {
  try {
    const { data } = await sb.storage.from(BUCKET).list('', { limit: 1000 });
    const files = data || [];
    const usedBytes = files.reduce((sum, f) => sum + (f.metadata?.size || 0), 0);
    state.storageStats = { usedBytes, fileCount: files.length };
    // refresh dashboard if open
    if (state.view === 'dashboard') {
      const main = document.getElementById('main-content');
      if (main) main.innerHTML = renderDashboard();
      attachEventListeners();
    }
  } catch(e) { console.warn('Storage stats error:', e); }
}

// ── HELPERS ───────────────────────────────────────────────────────
function getUser(id)     { return state.db.users.find(u=>u.id===id); }
function getCategory(id) { return state.db.categories.find(c=>c.id===id); }
function getProject(id)  { return state.db.projects.find(p=>p.id===id); }
// ── PHASE DATE HELPERS ────────────────────────────────────────────
// Planned dates: auto από min plannedStart / max plannedEnd των tasks
function phasePlannedDates(ph) {
  const starts = (ph.tasks||[]).map(t=>t.plannedStart).filter(Boolean).sort();
  const ends   = (ph.tasks||[]).map(t=>t.plannedEnd).filter(Boolean).sort();
  return {
    start: starts.length ? starts[0] : null,
    end:   ends.length   ? ends[ends.length-1] : null
  };
}
// Actual dates: auto από min startDate / max completedDate των tasks
function phaseActualDates(ph) {
  const starts = (ph.tasks||[]).map(t=>t.startDate).filter(Boolean).sort();
  const ends   = (ph.tasks||[]).map(t=>t.completedDate).filter(Boolean).sort();
  return {
    start: starts.length ? starts[0] : null,
    end:   ends.length   ? ends[ends.length-1] : null
  };
}
// Project planned dates: auto από min/max των φάσεων
function projectPlannedDates(proj) {
  const starts = (proj.phases||[]).map(ph=>phasePlannedDates(ph).start).filter(Boolean).sort();
  const ends   = (proj.phases||[]).map(ph=>phasePlannedDates(ph).end).filter(Boolean).sort();
  return {
    start: starts.length ? starts[0] : null,
    end:   ends.length   ? ends[ends.length-1] : null
  };
}

function getStandingProjects() {
  return (state.db.projects||[]).filter(p=>p.standing===true)
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','el'));
}
function sortByCode(projects) {
  return [...projects].sort((a,b) => {
    const ca = (a.code||'').toLowerCase(), cb = (b.code||'').toLowerCase();
    if (ca && cb) return ca.localeCompare(cb, 'el');
    if (ca) return -1;
    if (cb) return  1;
    return (a.name||'').localeCompare(b.name||'', 'el');
  });
}
function sortByName(arr, key='name') {
  return [...arr].sort((a,b) => (a[key]||'').localeCompare(b[key]||'', 'el'));
}
function buildTsProjectOptions(regularProjects, selectedId='', selectedName='') {
  const standing = getStandingProjects(); // already sorted A-Z by name
  const regular  = sortByCode(regularProjects.filter(p=>!p.standing));
  const opt = p => `<option value="${p.id}" ${p.id===selectedId?'selected':''}>${p.code ? esc(p.code+' – '+p.name) : esc(p.name)}</option>`;
  const knownSelected = [...standing,...regular].some(p=>p.id===selectedId);
  const historical = selectedId && !knownSelected
    ? `<optgroup label="── Ιστορικό Έργο ──"><option value="${esc(selectedId)}" selected>${esc(selectedName||selectedId)}</option></optgroup>`
    : '';
  return `<option value="">— Επιλέξτε έργο —</option>`
    + historical
    + (standing.length ? `<optgroup label="── Μόνιμα Έργα ──">${standing.map(opt).join('')}</optgroup>` : '')
    + `<optgroup label="── Ενεργά Έργα ──">${regular.map(opt).join('')}</optgroup>`;
}
function getTemplate(id) { return (state.db.templates||[]).find(t=>t.id===id); }
// backward compat: projects may have managerId (old) or managerIds (new)
function projManagerIds(proj) { return proj.managerIds || (proj.managerId ? [proj.managerId] : []); }
function projManagerNames(proj) { return projManagerIds(proj).map(id=>getUser(id)?.name||'—').join(', ') || '—'; }
function canManageTemplates() { return state.cu && ['admin','management'].includes(state.cu.role); }
function canViewTemplates()   { return state.cu && state.cu.role !== 'client'; }

// Returns the effective role of a user for a given category.
// Per-category override takes precedence over global role,
// but admin/management/client are always global and cannot be overridden.
function effectiveRole(user, catId) {
  if (!user) return null;
  if (['admin','management','client'].includes(user.role)) return user.role;
  const override = (user.categoryRoles||{})[catId];
  return override || user.role;
}
function cuEffectiveRole(catId) { return effectiveRole(state.cu, catId); }

function visibleProjects() {
  if (!state.cu) return [];
  const cu = state.cu;
  // Admin & Management see everything
  if (['admin','management'].includes(cu.role)) return state.db.projects;
  // Client: only projects explicitly assigned to them
  if (cu.role === 'client')
    return state.db.projects.filter(p => p.clientId===cu.id);
  // project_manager / team_member: only projects where they are directly involved
  return state.db.projects.filter(p => {
    // Named project manager on this project
    if (projManagerIds(p).includes(cu.id)) return true;
    // Explicit member of the project
    if ((p.memberIds||[]).includes(cu.id)) return true;
    // Explicit per-project access grant (admin manually gave access)
    if ((cu.projectIds||[]).includes(p.id)) return true;
    // Task-level involvement: assignee or member of any task
    return (p.phases||[]).some(ph =>
      (ph.tasks||[]).some(t => t.assigneeId===cu.id || (t.memberIds||[]).includes(cu.id))
    );
  });
}

function canAccessProject(proj) { return visibleProjects().some(p=>p.id===proj.id); }
function canModifyProject(proj) {
  if (!state.cu) return false;
  if (['admin','management'].includes(state.cu.role)) return true;
  if (state.cu.role !== 'project_manager') return false;

  if (projManagerIds(proj).includes(state.cu.id)) return true;

  const catId=proj.categoryId;
  if ((state.cu.categoryIds||[]).includes(catId)) return true;
  if ((state.cu.categoryRoles||{})[catId]==='project_manager') return true;
  return false;
}

// Team members (globally or per-category) see only tasks assigned to them
function visibleTasksInPhase(phase, catId) {
  const tasks = phase.tasks || [];
  if (cuEffectiveRole(catId) === 'team_member') return tasks.filter(t => t.assigneeId === state.cu.id || (t.memberIds||[]).includes(state.cu.id));
  return tasks;
}

function isTaskUnlocked(phase, task) {
  if (!task.dependsOn || !task.dependsOn.length) return true;
  return task.dependsOn.every(depId => { const dep=phase.tasks.find(t=>t.id===depId); return dep && dep.status==='completed'; });
}

function taskWaitingState(proj, phase, task) {
  const status=task?.status||'not_started';
  if (status==='waiting_client') return {key:'client',label:'Αναμονή πελάτη'};
  if (status==='waiting_public'||status==='waiting_third_party') return {key:'third_party',label:'Αναμονή τρίτου / φορέα'};
  if (status==='under_review'||status==='waiting_approval'||task?.reviewStatus==='pending') return {key:'approval',label:'Αναμονή ελέγχου / έγκρισης'};
  if (status==='blocked'||((proj?.enforceDeps||task?.enforceDeps)&&!isTaskUnlocked(phase,task))) {
    return {key:'dependency',label:'Αναμονή εξάρτησης'};
  }
  if (WAITING_TASK_STATUSES.has(status)) return {key:'waiting',label:'Σε αναμονή'};
  return null;
}

// One visible action per active project. If that action is waiting, preserve it
// for context and expose only the next executable action for the same user.
function assignedRowsForProject(proj, userId) {
  const ph=currentActionPhase(proj);
  if(!ph) return [];
  const candidates=(ph.tasks||[]).filter(task=>
    (task.assigneeId===userId||(task.memberIds||[]).includes(userId)) &&
    !TERMINAL_TASK_STATUSES.has(task.status)
  );
  if(!candidates.length) return [];

  const first=candidates[0];
  const firstWaiting=taskWaitingState(proj,ph,first);
  if(!firstWaiting) return [{proj,ph,task:first,waiting:null,isAssignee:first.assigneeId===userId}];

  const rows=[{proj,ph,task:first,waiting:firstWaiting,isAssignee:first.assigneeId===userId}];
  const next=candidates.slice(1).find(task=>!taskWaitingState(proj,ph,task));
  if(next) rows.push({proj,ph,task:next,waiting:null,isAssignee:next.assigneeId===userId});
  return rows;
}

function assignedProjectOrder(projects, user) {
  const categoryOrder=new Map((state.db.categories||[]).map((c,i)=>[c.id,i]));
  return [...projects].sort((a,b)=>{
    const ca=categoryOrder.get(a.categoryId)??9999;
    const cb=categoryOrder.get(b.categoryId)??9999;
    if(ca!==cb) return ca-cb;
    const pref=(user?.categoryPriority||{})[a.categoryId]||[];
    const ia=pref.indexOf(a.id), ib=pref.indexOf(b.id);
    const pa=ia<0?9999:ia, pb=ib<0?9999:ib;
    if(pa!==pb) return pa-pb;
    return (a.name||'').localeCompare(b.name||'','el');
  });
}

function canSetTaskUrgent(proj,task) {
  const uid2=state.cu?.id;
  if(!uid2||!proj||!task) return false;
  return projManagerIds(proj).includes(uid2)||task.assigneeId===uid2;
}

function canPublishClientDelivery(proj,task) {
  const cu=state.cu;
  if(!cu||!proj||!task||cu.role==='client') return false;
  return cu.role==='management'||projManagerIds(proj).includes(cu.id)||task.assigneeId===cu.id;
}

function deliveryForDocument(projectId,taskId,documentId) {
  return (state.db.clientDeliveries||[]).find(d=>
    d.active!==false&&d.projectId===projectId&&d.taskId===taskId&&d.documentId===documentId
  )||null;
}
function isPhaseComplete(phase) {
  return phase.tasks.length>0 && phase.tasks.every(t=>t.status==='completed'||t.status==='cancelled'||t.status==='not_required');
}
function isPhaseUnlocked(proj, phaseIndex) {
  return true; // phases always accessible; progress shown but not enforced
}

// Ελέγχει αν ο χρήστης έχει κάτι να κάνει ΤΩΡΑ σε ένα έργο
// Ισχύει μόνο για project_manager και team_member
function userHasActionInProject(proj, userId) {
  const role = state.cu?.role;
  if (!['project_manager','team_member'].includes(role)) return true;
  const isPM = projManagerIds(proj).includes(userId);
  // Βρες την τρέχουσα ενεργή φάση (πρώτη μη ολοκληρωμένη)
  const currentPhase = (proj.phases||[]).find(ph => !isPhaseComplete(ph));
  if (!currentPhase) return false; // έργο ολοκληρωμένο
  const tasks = currentPhase.tasks || [];
  // 1. Έχω εργασία assigned σε μένα που δεν έχει ολοκληρωθεί
  if (tasks.some(t =>
    (t.assigneeId===userId || (t.memberIds||[]).includes(userId)) &&
    !['completed','cancelled','not_required'].includes(t.status)
  )) return true;
  // 2. Είμαι PM και υπάρχει εργασία waiting_client (πρέπει να κυνηγήσω πελάτη)
  if (isPM && tasks.some(t => t.status==='waiting_client')) return true;
  // 3. Έχω αίτημα ελέγχου που απορρίφθηκε
  if (tasks.some(t =>
    (t.assigneeId===userId || (t.memberIds||[]).includes(userId)) &&
    t.reviewStatus==='rejected'
  )) return true;
  // 4. Είμαι PM και υπάρχει απαιτούμενο έγγραφο που δεν έχει ανέβει
  if (isPM && tasks.some(t => (t.docs||[]).some(d => d.required && !d.done))) return true;
  return false;
}
function currentActionPhase(proj) {
  return (proj?.phases||[]).find(ph=>!isPhaseComplete(ph)) || null;
}

async function pushLegacyNotificationToUser(userId, notification) {
  const target=(state.db.users||[]).find(u=>u.id===userId);
  if(!target) return;

  if(!target.notifications) target.notifications=[];
  target.notifications.unshift({...notification});
  if(target.notifications.length>50) target.notifications=target.notifications.slice(0,50);
  await dbSaveUser(target).catch(e=>console.warn('legacy notification save:',e));
}

function projectManagerRecipientIds(proj) {
  return [...new Set(projManagerIds(proj).filter(Boolean))];
}

function managementRecipientIds() {
  return (state.db.users||[])
    .filter(u=>u.role==='management' && u.active!==false)
    .map(u=>u.id);
}

function taskResponsibleIds(task) {
  // "Υπεύθυνος εργασίας" = primary Assigned To.
  return task?.assigneeId ? [task.assigneeId] : [];
}

function uniqRecipients(ids, actorId=state.cu?.id) {
  return [...new Set((ids||[]).filter(Boolean))].filter(id=>id!==actorId);
}

function notificationPriorityLabel(priority) {
  return priority==='urgent'?'ΕΠΕΙΓΟΝ':priority==='action'?'ΑΠΑΙΤΕΙ ΕΝΕΡΓΕΙΑ':'ΕΝΗΜΕΡΩΣΗ';
}

async function emitProjectNotification(eventType, proj, ph=null, task=null, subtask=null, message='') {
  if(!proj || !state.cu) return;

  if(isSupabaseAuthMode()){
    if(eventType==='action_scan'){
      const {error}=await sb.rpc('app_action_scan_fix8',{p_project_id:proj.id});
      if(error) console.warn('app_action_scan_fix8:',error);
      return;
    }
    // These two events are emitted atomically by their secure mutation RPCs.
    if(eventType==='urgent_changed'||eventType==='client_delivery_published') return;
    const {error}=await sb.rpc('app_notification_emit',{
      p_event_type:eventType,
      p_project_id:proj.id,
      p_phase_id:ph?.id||null,
      p_task_id:task?.id||null,
      p_subtask_id:subtask?.id||null,
      p_message:message||null
    });
    if(error) console.warn('app_notification_emit:',eventType,error);
    return;
  }

  // Legacy compatibility routing. These notifications are stored in the
  // recipient's be_users JSON until that recipient migrates to Supabase Auth.
  const actor=state.cu;
  const managers=projectManagerRecipientIds(proj);
  const management=managementRecipientIds();
  const responsible=taskResponsibleIds(task);
  let recipients=[];
  let priority='normal';
  let title='Ειδοποίηση';
  let body=message||'';

  if(eventType==='action_scan'){
    const active=currentActionPhase(proj);
    if(!active) return;
    const assignees=[...new Set((active.tasks||[]).map(t=>t.assigneeId).filter(Boolean))];
    for(const assignedUserId of assignees){
      const executable=assignedRowsForProject(proj,assignedUserId).find(row=>!row.waiting);
      if(!executable) continue;
      const t=executable.task;
      for(const uid2 of uniqRecipients([assignedUserId],actor.id)){
        await pushLegacyNotificationToUser(uid2,{
          id:'n_'+uid(),type:'action_ready',priority:t.urgent?'urgent':'action',
          title:`Νέα ενέργεια: ${t.name}`,
          sub:`${proj.name} › ${active.name}`,
          projId:proj.id,phaseId:active.id,taskId:t.id,
          at:nowTS(),read:false
        });
      }
    }
    return;
  }

  if(eventType==='review_requested'){
    recipients=uniqRecipients([...managers,...management],actor.id);
    priority='action';
    title=task ? `Αίτημα ελέγχου: ${task.name}` : `Αίτημα ελέγχου φάσης: ${ph?.name||''}`;
    body=`${actor.name} · ${proj.name}${ph?' › '+ph.name:''}`;
  } else if(eventType==='review_resolved'){
    recipients=uniqRecipients([...responsible,...managers],actor.id);
    priority=message==='rejected'?'action':'normal';
    title=message==='rejected'?'Ζητήθηκαν διορθώσεις':'Ο έλεγχος εγκρίθηκε';
    body=`${proj.name}${task?' › '+task.name:ph?' › '+ph.name:''}`;
  } else if(eventType==='comment'){
    const actorIsManagement=actor.role==='management'||actor.role==='admin';
    const actorIsManager=managers.includes(actor.id)||actor.role==='project_manager';
    if(actorIsManagement){
      recipients=uniqRecipients([...responsible,...managers],actor.id);
      priority='action';
      title=`Σχόλιο Διοίκησης: ${task?.name||proj.name}`;
    } else if(actorIsManager){
      recipients=uniqRecipients(responsible,actor.id);
      title=`Σχόλιο Υπεύθυνου Έργου: ${task?.name||proj.name}`;
    } else {
      recipients=uniqRecipients(managers,actor.id);
      title=`Νέο σχόλιο εργασίας: ${task?.name||proj.name}`;
    }
    body=message||'';
  } else if(eventType==='client_document_uploaded'){
    recipients=uniqRecipients([...responsible,...managers],actor.id);
    title=`Νέο έγγραφο πελάτη: ${task?.name||proj.name}`;
    body=message||`${proj.name}${task?' › '+task.name:''}`;
  } else if(eventType==='urgent_changed'){
    recipients=uniqRecipients([...responsible,...managers,...management],actor.id);
    priority=message==='true'?'urgent':'normal';
    title=message==='true'?`Επείγουσα εργασία: ${task?.name||proj.name}`:`Άρση επείγοντος: ${task?.name||proj.name}`;
    body=`${proj.name}${ph?' › '+ph.name:''}`;
  } else if(eventType==='client_delivery_published'){
    recipients=uniqRecipients([proj.clientId],actor.id);
    priority='normal';
    title=`Νέο έγγραφο προς παράδοση: ${message||task?.name||proj.name}`;
    body=`${proj.name}${task?' › '+task.name:''}`;
  } else {
    return;
  }

  for(const uid2 of recipients){
    await pushLegacyNotificationToUser(uid2,{
      id:'n_'+uid(),
      type:eventType,
      priority,
      title,
      sub:body,
      projId:proj.id,
      phaseId:ph?.id||null,
      taskId:task?.id||null,
      at:nowTS(),
      read:false
    });
  }
}

async function notifyPhaseActivation(proj, previousPhaseId) {
  // New server-side notification router scans the currently active phase and
  // emits only tasks whose dependencies are satisfied. Unread action alerts
  // are de-duplicated by the database.
  await emitProjectNotification('action_scan',proj,null,null,null,'');
}


function taskDocProgress(task) {
  const total=task.docs.length, done=task.docs.filter(d=>d.done).length;
  return { total, done, pct: total===0?100:Math.round(done/total*100) };
}
function taskProgress(task) {
  // Cancelled tasks are excluded from progress (caller checks)
  // Progress = 100% subtasks-based
  const subs = task.subtasks||[];
  if (subs.length > 0) return Math.round(subs.filter(s=>s.done).length / subs.length * 100);
  // No subtasks → status-based fallback
  if (task.status==='completed')          return 100;
  if (task.status==='under_review')       return 90;
  if (task.status==='in_progress')        return task.manualPct != null ? task.manualPct : 50;
  if (task.status==='waiting_client')     return 30;
  if (task.status==='internal_processing')return 60;
  return 0; // not_started, cancelled, not_required
}

function projectProgress(proj) {
  // Equal phase weight: project% = avg(phase%) where phase% = avg(task%) excluding cancelled
  let phTotal=0, phPctSum=0, tTotal=0, tDone=0, dTotal=0, dDone=0;
  (proj.phases||[]).forEach(ph=>{
    const activeTasks = (ph.tasks||[]).filter(t => t.status!=='cancelled' && t.status!=='not_required');
    activeTasks.forEach(t=>{ tTotal++; if(t.status==='completed') tDone++; });
    const phPctSum2 = activeTasks.reduce((s,t)=>s+taskProgress(t), 0);
    const phPct     = activeTasks.length===0 ? 0 : Math.round(phPctSum2/activeTasks.length);
    phTotal++; phPctSum += phPct;
    (ph.tasks||[]).forEach(t=>(t.docs||[]).forEach(d=>{ dTotal++; if(d.done) dDone++; }));
  });
  const tasksPct = phTotal===0 ? 0 : Math.round(phPctSum/phTotal);
  const docsPct  = dTotal===0 ? 100 : Math.round(dDone/dTotal*100);
  // Total = tasks only (docs are prerequisite, not progress %)
  return {
    tasks:{ total:tTotal, done:tDone, pct:tasksPct },
    docs :{ total:dTotal, done:dDone, pct:docsPct },
    total:{ pct:tasksPct },
  };
}
function dashStats() {
  const projs=visibleProjects().filter(p=>!p.standing);
  let pendingDocs=0, pendingReviews=0;
  projs.forEach(p=>(p.phases||[]).forEach(ph=>{
    (ph.tasks||[]).forEach(t=>(t.docs||[]).forEach(d=>{ if(!d.done) pendingDocs++; }));
    if(ph.reviewStatus==='pending') pendingReviews++;
    (ph.tasks||[]).forEach(t=>{
      if(t.reviewStatus==='pending') pendingReviews++;
      (t.subtasks||[]).forEach(st=>{ if(st.reviewStatus==='pending') pendingReviews++; });
    });
  }));
  return { total:projs.length, active:projs.filter(p=>p.status==='in_progress').length, onHold:projs.filter(p=>p.status==='on_hold').length, done:projs.filter(p=>p.status==='completed').length, pendingDocs, pendingReviews };
}
function findDoc(did, tid) {
  for (const proj of state.db.projects)
    for (const ph of (proj.phases||[]))
      for (const task of (ph.tasks||[]))
        if (task.id===tid) { const doc=task.docs.find(d=>d.id===did); if(doc) return {proj,ph,task,doc}; }
  return null;
}

// ── NAVIGATION ────────────────────────────────────────────────────
function navigate(view, opts={}) {
  if (view!=='login' && !state.cu) { state.view='login'; render(); return; }
  state.view=view;
  if (opts.categoryId  !==undefined) state.categoryId  =opts.categoryId;
  if (opts.projectId   !==undefined) { if(opts.projectId!==state.projectId) state.ganttView=false; state.projectId=opts.projectId; }
  if (opts.templateId  !==undefined) state.templateId  =opts.templateId;
  if (opts.crmCompanyId!==undefined) state.crmCompanyId=opts.crmCompanyId;
  if (opts.crmContactId!==undefined) state.crmContactId=opts.crmContactId;
  render();
  if(view==='timesheet' && isSupabaseAuthMode()) {
    state.tsLoaded=false;
    state.tsPage=1;
    loadTimesheetPage(1);
  }
  // Load storage stats for admin/management on dashboard
  if (view==='dashboard' && state.cu && ['admin','management'].includes(state.cu.role)) {
    loadStorageStats();
  }
}

// ── RENDER ROUTER ─────────────────────────────────────────────────
function render() {
  try {
    const main=el('main-content');
    if (!main) return;
    const loggedIn = !!state.cu;
    main.classList.toggle('ts-fullwidth-page', loggedIn && state.view==='timesheet');
    const sidebar  = document.querySelector('.sidebar');
    const mainWrap = document.querySelector('.main-wrap');

    if (!loggedIn || state.view==='login') {
      if (sidebar) sidebar.style.display='none';
      if (mainWrap) { mainWrap.style.marginLeft='0'; mainWrap.style.minHeight=''; }
      document.body.style.background='var(--navy)';
      main.innerHTML=renderLogin();
      _updateSidebarFooter();
      bindEvents(); return;
    }

    document.body.style.background='';
    if (state.cu.role==='client') {
      if (sidebar) sidebar.style.display='none';
      if (mainWrap) { mainWrap.style.marginLeft='0'; mainWrap.style.minHeight=''; }
      main.innerHTML=renderClientPortalFix8();
      _updateSidebarFooter();
      bindEvents(); return;
    }

    if (sidebar) sidebar.style.display='';
    if (mainWrap) { mainWrap.style.marginLeft=''; mainWrap.style.minHeight=''; }
    updateNav(); updateBreadcrumb(); updateHeaderUser();

    // Save focused search input state before re-render
    const activeEl = document.activeElement;
    const savedFocusSel = activeEl && activeEl.classList.contains('crm-search') ? activeEl.className : null;
    const savedSelStart = savedFocusSel ? activeEl.selectionStart : null;
    const savedSelEnd   = savedFocusSel ? activeEl.selectionEnd   : null;

    switch (state.view) {
      case 'dashboard':  main.innerHTML=renderDashboard();  break;
      case 'categories': main.innerHTML=renderCategories(); break;
      case 'projects':   main.innerHTML=renderProjects();   break;
      case 'project':    main.innerHTML=renderProject();    break;
      case 'notifications': main.innerHTML=renderNotifications(); break;
      case 'users':      main.innerHTML=renderUsers();      break;
      case 'audit':      main.innerHTML=renderAudit();      break;
      case 'templates':  main.innerHTML=renderTemplates();  break;
      case 'template':   main.innerHTML=renderTemplateDetail(); break;
      case 'timesheet':        main.innerHTML=renderTimesheet();      break;
      case 'calendar':         main.innerHTML=renderCalendar();       break;
      case 'client-calendar':  main.innerHTML=renderClientCalendar(); break;
      case 'crm-companies':    main.innerHTML=renderCrmCompanies();  break;
      case 'crm-contacts':     main.innerHTML=renderCrmContacts();   break;
      case 'crm-company':      main.innerHTML=renderCrmCompany();    break;
      case 'crm-contact':      main.innerHTML=renderCrmContact();    break;
      case 'offers':           main.innerHTML=renderOffers();        break;
      case 'assigned':         main.innerHTML=renderAssigned();      break;
      default:                 main.innerHTML=renderDashboard();
    }
    _updateSidebarFooter();
    bindEvents();

    // Restore focus to search input if it was active
    if (savedFocusSel) {
      const restored = main.querySelector('.crm-search');
      if (restored) { restored.focus(); restored.setSelectionRange(savedSelStart, savedSelEnd); }
    }
  } catch(err) {
    console.error('render() error:', err);
    showToast('Σφάλμα εμφάνισης: ' + (err.message||err), 'error');
  }
}

// Update sidebar footer + header logout (called inside render so always runs)
function _updateSidebarFooter() {
  const cu = state.cu;
  const footer = el('sidebar-user-footer');
  const logoutBtn = el('header-logout-btn');
  if (footer) {
    if (cu && cu.role !== 'client') {
      const ri = ROLE_INFO[cu.role] || {};
      footer.innerHTML = `<div class="sidebar-footer-user">
        <div style="font-size:.72rem;font-weight:700;color:rgba(255,255,255,.85);margin-bottom:2px">${esc(cu.name)}</div>
        <div style="font-size:.65rem;color:rgba(255,255,255,.4);font-family:var(--mono);margin-bottom:8px">@${esc(cu.username)}</div>
        <div style="margin-bottom:10px"><span class="role-badge ${ri.cls||''}" style="font-size:.58rem">${ri.label||cu.role}</span></div>
        <div style="display:flex;gap:6px">
          <button class="logout-btn" style="flex:1" data-action="my-account">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd"/></svg>
            Λογαριασμός
          </button>
          <button class="logout-btn" style="flex:1" data-action="logout">
            <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd"/></svg>
            Έξοδος
          </button>
        </div>
      </div>`;
    } else { footer.innerHTML=''; }
  }
  if (logoutBtn) logoutBtn.style.display = (cu && cu.role!=='client') ? '' : 'none';
}

function updateNav() {
  document.querySelectorAll('.nav-link[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===state.view));
  document.querySelectorAll('[data-admin-only]').forEach(e2=>{ e2.style.display=isAdmin()?'':'none'; });
  document.querySelectorAll('[data-mgmt-only]').forEach(e2=>{ e2.style.display=canViewTemplates()?'':'none'; });
  document.querySelectorAll('[data-noClient-only]').forEach(e2=>{ e2.style.display=(state.cu&&state.cu.role!=='client')?'':'none'; });
  const ni=el('nav-count'); if(ni) ni.textContent=visibleProjects().filter(p=>p.status==='in_progress').length;
  const sb2=el('header-search-btn'); if(sb2) sb2.style.display=(state.cu&&state.cu.role!=='client')?'':'none';
}
function updateBreadcrumb() {
  const bc=el('breadcrumb'); if(!bc||!state.cu) return;
  let html=''; const sep='<span class="bc-sep">›</span>';
  if (state.view==='dashboard') html='<span class="bc-item current">Dashboard</span>';
  else if (state.view==='categories') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Κατηγορίες</span>`;
  else if (state.view==='projects') {
    const cat=getCategory(state.categoryId);
    html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item" data-action="nav-categories">Κατηγορίες</span>${sep}<span class="bc-item current">${esc(cat?.name||'')}</span>`;
  } else if (state.view==='project') {
    const proj=getProject(state.projectId); const cat=proj?getCategory(proj.categoryId):null;
    html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item" data-action="nav-categories">Κατηγορίες</span>`;
    if (cat) html+=`${sep}<span class="bc-item" data-action="nav-projects" data-cid="${cat.id}">${esc(cat.name)}</span>`;
    if (proj) html+=`${sep}<span class="bc-item current">${esc(proj.name)}</span>`;
  } else if (state.view==='notifications') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Ειδοποιήσεις</span>`;
  else if (state.view==='users') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Χρήστες</span>`;
  else if (state.view==='audit') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Ιστορικό</span>`;
  else if (state.view==='templates') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Πρότυπα</span>`;
  else if (state.view==='template') { const tpl=getTemplate(state.templateId); html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item" data-action="nav-templates">Πρότυπα</span>${sep}<span class="bc-item current">${esc(tpl?.name||'Πρότυπο')}</span>`; }
  else if (state.view==='calendar') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Ημερολόγιο</span>`;
  else if (state.view==='client-calendar') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Client Calendar</span>`;
  else if (state.view==='crm-companies') html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Εταιρείες</span>`;
  else if (state.view==='crm-contacts')  html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Επαφές</span>`;
  else if (state.view==='crm-company') {
    const co=(state.db.crmCompanies||[]).find(x=>x.id===state.crmCompanyId);
    html=`<span class="bc-item" data-action="nav-crm-companies">Εταιρείες</span>${sep}<span class="bc-item current">${esc(co?.company_name||'Εταιρεία')}</span>`;
  } else if (state.view==='crm-contact') {
    const ct=(state.db.crmContacts||[]).find(x=>x.id===state.crmContactId);
    html=`<span class="bc-item" data-action="nav-crm-contacts">Επαφές</span>${sep}<span class="bc-item current">${esc([ct?.first_name,ct?.last_name].filter(Boolean).join(' ')||'Επαφή')}</span>`;
  } else if (state.view==='assigned') {
    html=`<span class="bc-item" data-action="nav-dashboard">Dashboard</span>${sep}<span class="bc-item current">Assigned To</span>`;
  }
  bc.innerHTML=html;
}
function getNotifications() {
  if(!state.cu || state.cu.role==='client') return [];

  const items=[];

  // Authenticated users: dedicated notification table.
  if(isSupabaseAuthMode()){
    (state.db.notifications||[]).forEach(n=>{
      items.push({
        ...n,
        read:!!n.readAt,
        source:'table',
        sub:n.message||'',
        projId:n.projectId,
        phid:n.phaseId,
        tid:n.taskId
      });
    });
  }

  // Hybrid compatibility notifications created by still-unmigrated users.
  (state.cu.notifications||[]).forEach(n=>{
    items.push({
      id:String(n.id),
      type:n.type||'info',
      priority:n.priority||'normal',
      title:n.title||'Ειδοποίηση',
      sub:n.sub||'',
      projId:n.projId||null,
      phid:n.phaseId||null,
      tid:n.taskId||null,
      createdAt:n.at||n.createdAt||'',
      read:!!n.read,
      source:'legacy'
    });
  });

  // Existing client-reminder workflow is kept separate from user notifications.
  (state.db.pendingReminders||[]).forEach(r=>{
    items.push({
      id:r.id,type:'reminder',priority:'action',
      title:`Υπενθύμιση προς πελάτη: ${r.clientName}`,
      sub:r.message,rid:r.id,read:false,source:'reminder',
      createdAt:r.createdAt||''
    });
  });

  const priorityRank={urgent:0,action:1,normal:2};
  return items.sort((a,b)=>{
    if(a.read!==b.read) return a.read?1:-1;
    const pr=(priorityRank[a.priority]??2)-(priorityRank[b.priority]??2);
    if(pr!==0) return pr;
    return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
  });
}

function ensureNotificationCenterStyles() {
  if(document.getElementById('notification-center-fix2-styles')) return;
  const style=document.createElement('style');
  style.id='notification-center-fix2-styles';
  style.textContent=`
    .notification-center-page{max-width:1180px;margin:0 auto}
    .notification-center-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:18px 0 12px}
    .notification-filter-tabs{display:flex;gap:8px;flex-wrap:wrap}
    .notification-filter-tab{border:1px solid var(--slate-200);background:#fff;color:var(--slate-600);border-radius:7px;padding:7px 12px;font-size:.75rem;font-weight:700;cursor:pointer}
    .notification-filter-tab.active{background:var(--navy);border-color:var(--navy);color:#fff}
    .notification-list-card{background:#fff;border:1px solid var(--slate-200);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .notification-list-scroll{max-height:calc(100vh - 285px);min-height:230px;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
    .notification-center-row{display:grid;grid-template-columns:42px minmax(0,1fr) 24px;gap:13px;align-items:start;padding:17px 18px;border-bottom:1px solid var(--slate-200);background:#fff;transition:background .15s ease}
    .notification-center-row:last-child{border-bottom:0}
    .notification-center-row.is-unread{background:#fffdfa}
    .notification-center-row.is-clickable{cursor:pointer}
    .notification-center-row.is-clickable:hover{background:#f8fafc}
    .notification-center-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.78rem;color:#fff;margin-top:1px}
    .notification-center-icon.urgent{background:#ef4444}
    .notification-center-icon.action{background:#f97316}
    .notification-center-icon.info{background:#2563eb}
    .notification-center-title{display:flex;align-items:center;gap:8px;color:var(--navy);font-size:.85rem;font-weight:800;line-height:1.35}
    .notification-unread-dot{width:7px;height:7px;border-radius:50%;background:#2563eb;flex:0 0 auto}
    .notification-center-message{color:var(--slate-600);font-size:.75rem;line-height:1.45;margin-top:3px}
    .notification-center-time{color:var(--slate-400);font-size:.67rem;margin-top:7px}
    .notification-center-arrow{color:#f97316;font-size:1.45rem;line-height:1;margin-top:7px;text-align:right}
    .notification-center-empty{padding:58px 20px;text-align:center;color:var(--slate-400)}
    @media(max-width:700px){
      .notification-center-toolbar{align-items:flex-start;flex-direction:column}
      .notification-center-row{grid-template-columns:36px minmax(0,1fr) 18px;padding:14px 12px;gap:10px}
      .notification-list-scroll{max-height:calc(100vh - 330px)}
    }
  `;
  document.head.appendChild(style);
}

function notificationCategory(n) {
  if((n.priority||'normal')==='urgent') return 'urgent';
  if((n.priority||'normal')==='action') return 'action';
  return 'info';
}

function renderNotifications() {
  ensureNotificationCenterStyles();
  const all=getNotifications();
  const filter=state.notificationFilter||'all';
  const counts={
    all:all.length,
    action:all.filter(n=>notificationCategory(n)==='action').length,
    urgent:all.filter(n=>notificationCategory(n)==='urgent').length,
    info:all.filter(n=>notificationCategory(n)==='info').length
  };
  const shown=filter==='all'?all:all.filter(n=>notificationCategory(n)===filter);
  const filters=[['all','Όλες'],['action','Ενέργεια'],['urgent','Επείγον'],['info','Ενημέρωση']];
  const tabs=filters.map(([key,label])=>`<button class="notification-filter-tab${filter===key?' active':''}" data-action="filter-notifications" data-val="${key}">${label} <span>${counts[key]}</span></button>`).join('');
  const rows=shown.map(n=>{
    const category=notificationCategory(n);
    const icon=category==='urgent'?'!':category==='action'?'⚡':'i';
    const hasTarget=!!(n.projId||n.tid);
    const isReminder=n.type==='reminder';
    const action=isReminder
      ? ''
      : hasTarget
        ? `data-action="open-notification" data-nid="${esc(n.id)}" data-source="${esc(n.source||'table')}" data-pid="${esc(n.projId||'')}" data-phid="${esc(n.phid||'')}" data-tid="${esc(n.tid||'')}"`
        : `data-action="mark-notification-read" data-nid="${esc(n.id)}" data-source="${esc(n.source||'table')}"`;
    const approvalBtns=isReminder && (isAdmin()||isPM())
      ? `<div class="notif-reminder-acts" style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="event.stopPropagation();approveReminder('${esc(n.rid)}')">✓ Έγκριση</button> <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();dismissReminder('${esc(n.rid)}')">✕</button></div>`
      : '';
    return `<div class="notification-center-row${n.read?'':' is-unread'}${action?' is-clickable':''}" ${action}>
      <div class="notification-center-icon ${category}">${icon}</div>
      <div>
        <div class="notification-center-title">${!n.read?'<span class="notification-unread-dot"></span>':''}<span>${esc(n.title)}</span></div>
        <div class="notification-center-message">${esc(n.sub||'')}</div>
        <div class="notification-center-time">${fmtDT(n.createdAt)}</div>
        ${approvalBtns}
      </div>
      <div class="notification-center-arrow">${hasTarget&&!isReminder?'›':''}</div>
    </div>`;
  }).join('');
  return `<div class="notification-center-page">
    <div class="page-hd">
      <div><h1>Ειδοποιήσεις</h1><div class="page-hd-sub">Όλες οι ενημερώσεις και οι ενέργειες που απαιτούν την προσοχή σας.</div></div>
      <div class="page-hd-actions"><button class="btn btn-ghost btn-sm" data-action="mark-all-notifications-read" ${!all.some(n=>!n.read)?'disabled':''}>✓ Όλα διαβασμένα</button></div>
    </div>
    <div class="notification-center-toolbar"><div class="notification-filter-tabs">${tabs}</div></div>
    <div class="notification-list-card"><div class="notification-list-scroll">${rows||'<div class="notification-center-empty">Δεν υπάρχουν ειδοποιήσεις σε αυτή την κατηγορία.</div>'}</div></div>
  </div>`;
}

async function markOneNotificationRead(nid, source='table') {
  if(source==='table' && isSupabaseAuthMode()){
    const {error}=await sb.rpc('app_notifications_mark_read',{p_notification_ids:[nid]});
    if(error) console.warn('notification read:',error);
    const n=(state.db.notifications||[]).find(x=>x.id===String(nid));
    if(n) n.readAt=nowTS();
    updateHeaderUser();
    if(state.view==='notifications') render();
    return;
  }

  if(source==='legacy'){
    const arr=state.cu?.notifications||[];
    const n=arr.find(x=>String(x.id)===String(nid));
    if(n) n.read=true;
    const dbu=(state.db.users||[]).find(u=>u.id===state.cu?.id);
    if(dbu) dbu.notifications=arr;

    if(isSupabaseAuthMode()){
      // Transitional legacy JSON RPC marks the small legacy array read.
      await Promise.resolve(sb.rpc('app_mark_notifications_read')).catch(()=>{});
    }else if(dbu){
      await dbSaveUser(dbu).catch(()=>{});
    }
    updateHeaderUser();
    if(state.view==='notifications') render();
  }
}

window.markAllProjectNotificationsRead = async function() {
  if(isSupabaseAuthMode()){
    await Promise.resolve(sb.rpc('app_notifications_mark_read',{p_notification_ids:null})).catch(()=>{});
    (state.db.notifications||[]).forEach(n=>n.readAt=n.readAt||nowTS());
    if((state.cu.notifications||[]).some(n=>!n.read)){
      await Promise.resolve(sb.rpc('app_mark_notifications_read')).catch(()=>{});
      state.cu.notifications.forEach(n=>n.read=true);
    }
  }else{
    (state.cu.notifications||[]).forEach(n=>n.read=true);
    const dbu=(state.db.users||[]).find(u=>u.id===state.cu.id);
    if(dbu){
      dbu.notifications=state.cu.notifications;
      await dbSaveUser(dbu).catch(()=>{});
    }
  }
  updateHeaderUser();
  if(state.view==='notifications') render();
};

function notificationTargetValue(notification, keys) {
  for(const key of keys){
    const value=notification?.[key];
    if(value!==undefined && value!==null && String(value).trim()!=='') return String(value);
  }
  return null;
}

function findNotificationForOpen(nid, source) {
  const id=String(nid||'');
  return getNotifications().find(n=>
    String(n.id)===id && (!source || !n.source || n.source===source)
  ) || getNotifications().find(n=>String(n.id)===id) || null;
}

function findNotificationTarget(notification, pid, phid, tid) {
  let resolvedPid=String(pid||notificationTargetValue(notification,['projId','projectId','project_id'])||'')||null;
  let resolvedPhid=String(phid||notificationTargetValue(notification,['phid','phaseId','phase_id'])||'')||null;
  let resolvedTid=String(tid||notificationTargetValue(notification,['tid','taskId','task_id'])||'')||null;
  const resolvedStid=notificationTargetValue(notification,['stid','subtaskId','subtask_id']);
  let proj=resolvedPid?getProject(resolvedPid):null;
  let phase=null;
  let task=null;

  const inspectProject=candidate=>{
    for(const candidatePhase of (candidate?.phases||[])){
      const candidateTask=(candidatePhase.tasks||[]).find(t=>
        (resolvedTid && String(t.id)===resolvedTid) ||
        (resolvedStid && (t.subtasks||[]).some(st=>String(st.id)===resolvedStid))
      );
      if(candidateTask) return {proj:candidate,phase:candidatePhase,task:candidateTask};
    }
    return null;
  };

  if(proj && (resolvedTid||resolvedStid)){
    const found=inspectProject(proj);
    if(found){ phase=found.phase; task=found.task; }
  }
  if(!task && (resolvedTid||resolvedStid)){
    for(const candidate of (state.db.projects||[])){
      const found=inspectProject(candidate);
      if(found){ ({proj,phase,task}=found); break; }
    }
  }

  if(!phase && resolvedPhid){
    const candidates=proj?[proj]:(state.db.projects||[]);
    for(const candidate of candidates){
      const candidatePhase=(candidate.phases||[]).find(p=>String(p.id)===resolvedPhid);
      if(candidatePhase){ proj=candidate; phase=candidatePhase; break; }
    }
  }

  // Compatibility for old notification rows that contain names but no IDs.
  if(!proj){
    const text=`${notification?.title||''} ${notification?.sub||notification?.message||''}`.toLocaleLowerCase('el');
    const matches=[];
    for(const candidate of (state.db.projects||[])){
      for(const candidatePhase of (candidate.phases||[])){
        for(const candidateTask of (candidatePhase.tasks||[])){
          const taskName=String(candidateTask.name||'').trim().toLocaleLowerCase('el');
          if(taskName.length>2 && text.includes(taskName)) matches.push({proj:candidate,phase:candidatePhase,task:candidateTask});
        }
      }
    }
    if(matches.length===1) ({proj,phase,task}=matches[0]);
    if(!proj){
      const projectMatches=(state.db.projects||[]).filter(candidate=>{
        const name=String(candidate.name||'').trim().toLocaleLowerCase('el');
        return name.length>2 && text.includes(name);
      });
      if(projectMatches.length===1) proj=projectMatches[0];
    }
  }

  if(proj) resolvedPid=String(proj.id);
  if(phase) resolvedPhid=String(phase.id);
  if(task) resolvedTid=String(task.id);
  return {proj,phase,task,resolvedPid,resolvedPhid,resolvedTid};
}

window.openNotificationTarget = async function(nid, source, pid, phid, tid) {
  const notification=findNotificationForOpen(nid,source);
  const target=findNotificationTarget(notification,pid,phid,tid);

  if(target.resolvedPid && target.proj){
    if(target.resolvedPhid) state.expandedPhases={...(state.expandedPhases||{}),[target.resolvedPhid]:true};
    if(target.resolvedTid){
      state.expandedTasks[target.resolvedTid]=true;
      if(!state.commentsOpen) state.commentsOpen={};
      state.commentsOpen[target.resolvedTid]=true;
    }

    // Navigation must never wait for the database mark-read request.
    state.notifOpen=false;
    navigate('project',{projectId:target.resolvedPid});
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(!target.resolvedTid) return;
      const node=document.getElementById('task-'+target.resolvedTid);
      if(node) node.scrollIntoView({behavior:'smooth',block:'center'});
    }));
  }else{
    state.notifOpen=false;
    updateHeaderUser();
    if(state.view==='notifications') render();
    showToast('Το σχετικό έργο ή task δεν είναι πλέον διαθέσιμο.','error');
  }

  try{
    await markOneNotificationRead(nid,source);
  }catch(error){
    console.warn('notification click mark-read:',error);
  }

  return !!(target.resolvedPid && target.proj);
};

function updateHeaderUser() {
  const hui=el('header-user'); if(!hui||!state.cu) return;
  const ri=ROLE_INFO[state.cu.role]||{};
  const notifs=getNotifications();
  const unread=notifs.filter(n=>!n.read);
  const nc=unread.length;
  const isClient=state.cu.role==='client';
  const roleAndName=isClient?'':`<span class="role-badge ${ri.cls}">${ri.label}</span>&nbsp;<strong>${esc(state.cu.name)}</strong>`;
  const bellHtml=isClient?'':`<div class="notif-wrap" style="position:relative;display:inline-block"><button class="notif-bell${nc?' notif-has':''}" data-action="nav-notifications" title="Ειδοποιήσεις">${nc?`<span class="notif-count">${nc}</span>`:''}🔔</button></div>`;
  hui.innerHTML=`${bellHtml}${roleAndName}`;
}

// Create a reminder for client (goes into pending queue for PM approval)
function queueClientReminder(proj, message) {
  if (!state.db.pendingReminders) state.db.pendingReminders=[];
  const r={id:'rem_'+uid(),projId:proj.id,clientName:proj.clientName||'Πελάτης',message,createdAt:nowTS(),createdBy:state.cu?.name};
  state.db.pendingReminders.push(r);
  showToast('Η υπενθύμιση στάλθηκε για έγκριση στον ΥΕ.','success');
}
window.approveReminder=function(rid){
  if (!state.db.pendingReminders) return;
  const r=state.db.pendingReminders.find(x=>x.id===rid); if(!r) return;
  state.db.pendingReminders=state.db.pendingReminders.filter(x=>x.id!==rid);
  auditLog('Έγκριση υπενθύμισης',`Προς: ${r.clientName} – "${r.message}"`);
  showToast(`Υπενθύμιση εγκρίθηκε για ${r.clientName}.`,'success');
  state.notifOpen=false; updateHeaderUser();
};
window.dismissReminder=function(rid){
  if (!state.db.pendingReminders) return;
  state.db.pendingReminders=state.db.pendingReminders.filter(x=>x.id!==rid);
  showToast('Υπενθύμιση ακυρώθηκε.','');
  state.notifOpen=false; updateHeaderUser();
};


// ── VIEW: LOGIN ───────────────────────────────────────────────────
function renderLogin() {
  return `
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-logo"><img src="logo.jpg" alt="B&E Solutions" onerror="this.style.display='none'"></div>
      <h2 class="login-title">Project Management</h2>
      <p class="login-sub">Συνδεθείτε για να συνεχίσετε</p>
      <div class="form-group">
        <label class="form-label">Email ή Όνομα χρήστη</label>
        <input class="form-control" id="login-user" placeholder="email ή username" autocomplete="username">
      </div>
      <div class="form-group">
        <label class="form-label">Κωδικός πρόσβασης</label>
        <input class="form-control" type="password" id="login-pass" placeholder="••••••••" autocomplete="current-password">
      </div>
      <div id="login-err" class="login-err" style="display:none"></div>
      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:11px 0;font-size:.9rem" data-action="do-login">Σύνδεση</button>
      <div class="login-hint">
        Η σύνδεση γίνεται αποκλειστικά μέσω ασφαλούς λογαριασμού (Supabase Auth)
      </div>
    </div>
  </div>`;
}

// ── VIEW: DASHBOARD ───────────────────────────────────────────────
function renderPriorityWidget() {
  const cu = state.cu;
  const categoryPriority = cu.categoryPriority || {};
  const catIds = Object.keys(categoryPriority).filter(cid => (categoryPriority[cid]||[]).length);
  if (!catIds.length) return '';
  let html = `<div class="section-hd mb-12" style="margin-top:24px"><h3>Σειρά Προτεραιότητας</h3><span class="text-sm text-muted">Ορίστηκε από τη διοίκηση</span></div>`;
  for (const catId of catIds) {
    const cat = getCategory(catId); if (!cat) continue;
    const priority = categoryPriority[catId];
    const catProjs = state.db.projects.filter(p => p.categoryId===catId && priority.includes(p.id) && p.status!=='completed');
    const ordered = [...catProjs].sort((a,b) => priority.indexOf(a.id)-priority.indexOf(b.id));
    if (!ordered.length) continue;
    html += `<div style="margin-bottom:4px;font-size:.72rem;font-weight:800;color:var(--steel);text-transform:uppercase;letter-spacing:.08em;padding-left:2px">${esc(cat.name)}</div>
    <div class="cases-table" style="margin-bottom:18px">
      <div class="cases-table-head" style="grid-template-columns:36px 2fr 130px 30px"><div>#</div><div>Έργο</div><div>Πρόοδος</div><div></div></div>
      ${ordered.map((p,i)=>{const prog=projectProgress(p);const inactive=!userHasActionInProject(p,state.cu?.id);return`<div class="case-row${inactive?' proj-inactive':''}" style="grid-template-columns:36px 2fr 130px 30px;cursor:pointer" data-action="open-project" data-pid="${p.id}" title="${inactive?'Δεν απαιτείται ενέργεια από εσάς αυτή τη στιγμή':''}"><div style="display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9rem;color:${i===0?'var(--orange)':'var(--steel)'}">${i+1}</div><div><div class="case-row-title">${esc(p.name)}</div><div class="case-row-sub">${esc(p.clientName||'')}</div></div><div class="case-row-prog"><div class="row-prog-bar"><div class="row-prog-fill" style="width:${prog.tasks.pct}%;background:${i===0?'var(--orange)':'var(--slate-400)'}"></div></div><span class="row-prog-pct">${prog.tasks.pct}%</span></div><div class="row-arrow">${inactive?'<span style="font-size:.6rem;color:var(--muted)">αναμονή</span>':'›'}</div></div>`;}).join('')}
    </div>`;
  }
  return html;
}

function renderStorageWidget() {
  if (!state.cu || !['admin','management'].includes(state.cu.role)) return '';
  const DB_LIMIT  = 500 * 1024 * 1024;   // 500 MB
  const STG_LIMIT = 1024 * 1024 * 1024;  // 1 GB
  const fmtMB = b => b < 1024*1024 ? (b/1024).toFixed(1)+' KB' : (b/1024/1024).toFixed(2)+' MB';

  // Estimate DB size from in-memory data
  const dbBytes = new Blob([JSON.stringify(state.db)]).size;
  const dbPct   = Math.min(100, (dbBytes/DB_LIMIT*100)).toFixed(2);
  const dbColor = dbPct > 80 ? 'var(--red)' : dbPct > 50 ? 'var(--amber)' : 'var(--green)';

  let stgHtml = '';
  if (state.storageStats) {
    const { usedBytes, fileCount } = state.storageStats;
    const stgPct  = Math.min(100, (usedBytes/STG_LIMIT*100)).toFixed(2);
    const stgColor = stgPct > 80 ? 'var(--red)' : stgPct > 50 ? 'var(--amber)' : 'var(--green)';
    stgHtml = `
    <div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:.8rem;font-weight:700">📁 Storage Αρχείων</span>
        <span style="font-size:.78rem;color:var(--steel)">${fmtMB(usedBytes)} / 1 GB &nbsp;·&nbsp; ${fileCount} αρχεία</span>
      </div>
      <div style="height:7px;background:var(--slate-200);border-radius:999px;overflow:hidden">
        <div style="height:100%;width:${stgPct}%;background:${stgColor};border-radius:999px;transition:width .4s"></div>
      </div>
      <div style="font-size:.7rem;color:var(--muted);margin-top:3px">Απομένει ${fmtMB(STG_LIMIT-usedBytes)}</div>
    </div>`;
  } else {
    stgHtml = `<div style="font-size:.78rem;color:var(--muted);margin-bottom:14px">📁 Storage: φόρτωση…</div>`;
  }

  return `
  <div style="background:var(--paper-2);border:1px solid var(--navy-line);border-radius:10px;padding:16px 20px;margin-top:24px">
    <div style="font-size:.82rem;font-weight:800;color:var(--steel);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px">Χρήση Supabase (Free Tier)</div>
    ${stgHtml}
    <div>
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:.8rem;font-weight:700">🗄️ Βάση Δεδομένων</span>
        <span style="font-size:.78rem;color:var(--steel)">${fmtMB(dbBytes)} / 500 MB <span style="color:var(--muted)">(εκτίμηση)</span></span>
      </div>
      <div style="height:7px;background:var(--slate-200);border-radius:999px;overflow:hidden">
        <div style="height:100%;width:${dbPct}%;background:${dbColor};border-radius:999px;transition:width .4s"></div>
      </div>
      <div style="font-size:.7rem;color:var(--muted);margin-top:3px">Απομένει ~${fmtMB(DB_LIMIT-dbBytes)}</div>
    </div>
  </div>`;
}

// Επιστρέφει την πρώτη φάση (κατά σειρά) που δεν έχει φτάσει 100% πρόοδο
function nextActivePhase(proj) {
  for (const ph of (proj.phases||[])) {
    const active = (ph.tasks||[]).filter(t => t.status!=='cancelled' && t.status!=='not_required');
    const pct = active.length===0 ? 0 : Math.round(active.reduce((s,t)=>s+taskProgress(t),0)/active.length);
    if (pct < 100) return ph;
  }
  return null;
}

// Επιστρέφει την πρώτη χρονολογικά προγραμματισμένη ημερομηνία ανοιχτής εργασίας του έργου
function earliestActiveTaskDate(proj) {
  let earliest = null;
  (proj.phases||[]).forEach(ph => {
    (ph.tasks||[]).forEach(t => {
      if (['completed','cancelled'].includes(t.status)) return;
      const d = t.plannedStart || t.plannedEnd;
      if (d && (!earliest || d < earliest)) earliest = d;
    });
  });
  return earliest || '9999-99-99';
}

function _dashProjTable(projs) {
  if (!projs.length) return `<div class="empty-state" style="padding:32px 0"><div class="es-icon" style="font-size:2rem">—</div><p>Δεν υπάρχουν έργα σε αυτή την κατηγορία.</p></div>`;
  const cols = '2fr 1fr 1fr 1.5fr 110px 110px 130px 30px';
  return `<div class="cases-table">
    <div class="cases-table-head" style="grid-template-columns:${cols}">
      <div>Έργο</div><div>Κατηγορία</div><div>Υπεύθυνος</div><div>Επόμενη Φάση</div><div>Έναρξη</div><div>Λήξη</div><div>Ποσοστό</div><div></div>
    </div>
    ${projs.map(p=>{
      const cat  = getCategory(p.categoryId);
      const ph   = nextActivePhase(p);
      const phName  = ph ? esc(ph.name) : '<span style="color:var(--green);font-weight:600">✓ Ολοκληρ.</span>';
      const phDates2 = ph ? phasePlannedDates(ph) : null;
      const phStart = phDates2?.start ? fmt(phDates2.start) : '—';
      const phEnd   = phDates2?.end   ? fmt(phDates2.end)   : '—';
      const inactive = !userHasActionInProject(p, state.cu?.id);
      const pct = projectProgress(p).total.pct;
      const pctColor = pct===100 ? 'var(--green)' : 'var(--orange)';
      return`<div class="case-row${inactive?' proj-inactive':''}" style="grid-template-columns:${cols}" data-action="open-project" data-pid="${p.id}" title="${inactive?'Δεν απαιτείται ενέργεια από εσάς αυτή τη στιγμή':''}">
        <div class="case-row-title">${esc(p.name)}</div>
        <div class="text-sm">${esc(cat?.name||'—')}</div>
        <div class="text-sm">${esc(projManagerNames(p))}</div>
        <div class="text-sm">${phName}</div>
        <div class="text-sm text-muted">${phStart}</div>
        <div class="text-sm text-muted">${phEnd}</div>
        <div class="case-row-prog"><div class="row-prog-bar"><div class="row-prog-fill" style="width:${pct}%;background:${pctColor}"></div></div><span class="row-prog-pct">${pct}%</span></div>
        <div class="row-arrow">${inactive?'<span style="font-size:.65rem;color:var(--muted)">αναμονή</span>':'›'}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function _reviewAuditMeta(entityType, proj, ph, task, st) {
  const signatures={
    phase:{action:'Αίτημα Ελέγχου Φάσης',details:`"${ph?.name||''}" – ${proj?.name||''}`},
    task:{action:'Αίτημα Ελέγχου Εργασίας',details:`"${task?.name||''}" – ${ph?.name||''}`},
    subtask:{action:'Αίτημα Ελέγχου Υποεργασίας',details:`"${st?.name||''}" – "${task?.name||''}"`}
  };
  const sig=signatures[entityType];
  if(!sig) return null;
  return (state.db.auditLog||[]).find(entry=>entry.action===sig.action&&entry.details===sig.details)||null;
}

function collectPendingReviewRequests() {
  const rows=[];
  const add=(entityType,proj,ph,task,st,entity)=>{
    if(entity?.reviewStatus!=='pending') return;
    const audit=_reviewAuditMeta(entityType,proj,ph,task,st);
    const requesterId=entity.reviewRequestedBy||entity.reviewRequesterId||audit?.userId||null;
    const requester=entity.reviewRequestedByName||entity.reviewRequesterName||getUser(requesterId)?.name||audit?.userName||'—';
    const requestedAt=entity.reviewRequestedAt||entity.reviewRequestAt||audit?.timestamp||null;
    rows.push({
      entityType,proj,ph,task,st,requester,requestedAt,
      sortAt:requestedAt&&Number.isFinite(Date.parse(requestedAt))?Date.parse(requestedAt):0
    });
  };

  visibleProjects().filter(proj=>!proj.standing).forEach(proj=>{
    (proj.phases||[]).forEach(ph=>{
      add('phase',proj,ph,null,null,ph);
      (ph.tasks||[]).forEach(task=>{
        add('task',proj,ph,task,null,task);
        (task.subtasks||[]).forEach(st=>add('subtask',proj,ph,task,st,st));
      });
    });
  });
  return rows.sort((a,b)=>b.sortAt-a.sortAt);
}

function _reviewDecisionHandler(row,decision) {
  const pid=JSON.stringify(String(row.proj.id));
  const phid=JSON.stringify(String(row.ph.id));
  const tid=row.task?JSON.stringify(String(row.task.id)):null;
  const stid=row.st?JSON.stringify(String(row.st.id)):null;
  if(row.entityType==='phase') return `resolvePhaseReview(${pid},${phid},'${decision}')`;
  if(row.entityType==='task') return `resolveTaskReview(${pid},${phid},${tid},'${decision}')`;
  return `resolveSubtaskReview(${pid},${phid},${tid},${stid},'${decision}')`;
}

function renderPendingReviewQueue() {
  const rows=collectPendingReviewRequests();
  const projectCount=new Set(rows.map(row=>row.proj.id)).size;
  if(!rows.length) return `<div style="margin-top:24px"><div class="section-hd mb-12"><div><h3>Εκκρεμή Αιτήματα Ελέγχου</h3><div class="text-sm text-muted">Δεν υπάρχει απόφαση σε αναμονή.</div></div><button class="btn btn-secondary btn-sm" data-action="nav-categories">Όλες οι Κατηγορίες</button></div><div class="empty-state" style="padding:32px 0"><div class="es-icon">✓</div><h3>Όλα έχουν ελεγχθεί</h3><p>Δεν υπάρχουν εκκρεμή αιτήματα για τη Διοίκηση.</p></div></div>`;

  const cols='minmax(180px,1.15fr) minmax(280px,1.75fr) minmax(140px,.8fr) 145px minmax(285px,auto)';
  const labels={phase:'Φάση',task:'Εργασία',subtask:'Υποεργασία'};
  const colors={phase:'#7c3aed',task:'#1d4ed8',subtask:'#b45309'};
  return `<div style="margin-top:24px">
    <div class="section-hd mb-12"><div><h3>Εκκρεμή Αιτήματα Ελέγχου</h3><div class="text-sm text-muted">${rows.length} ${rows.length===1?'αίτημα':'αιτήματα'} σε ${projectCount} ${projectCount===1?'έργο':'έργα'} · μία γραμμή ανά απόφαση</div></div><button class="btn btn-secondary btn-sm" data-action="nav-categories">Όλες οι Κατηγορίες</button></div>
    <div style="overflow-x:auto;border-radius:8px">
      <div class="cases-table" style="min-width:1050px">
        <div class="cases-table-head" style="grid-template-columns:${cols}">
          <div>Έργο</div><div>Τι χρειάζεται έλεγχο</div><div>Αιτών</div><div>Ημερομηνία αιτήματος</div><div>Ενέργειες</div>
        </div>
        ${rows.map(row=>{
          const entityName=row.st?.name||row.task?.name||row.ph?.name||'—';
          const path=row.entityType==='phase'
            ? `Φάση ${esc(row.ph.name)}`
            : row.entityType==='task'
              ? `${esc(row.ph.name)} › ${esc(row.task.name)}`
              : `${esc(row.ph.name)} › ${esc(row.task.name)} › ${esc(row.st.name)}`;
          return `<div class="case-row" style="grid-template-columns:${cols};cursor:default">
            <div><div class="case-row-title">${esc(row.proj.name)}</div><div class="text-sm text-muted">${esc(getCategory(row.proj.categoryId)?.name||'—')}</div></div>
            <div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.65rem;font-weight:700;color:#fff;background:${colors[row.entityType]};padding:2px 7px;border-radius:999px">${labels[row.entityType]}</span><strong style="font-size:.82rem">${esc(entityName)}</strong></div><div class="text-sm text-muted" style="margin-top:4px">${path}</div></div>
            <div class="text-sm">${esc(row.requester)}</div>
            <div class="text-sm text-muted">${row.requestedAt?fmtDT(row.requestedAt):'—'}</div>
            <div style="display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" onclick="openPendingReview('${row.proj.id}','${row.ph.id}','${row.task?.id||''}')">Άνοιγμα</button>
              <button class="btn btn-primary btn-sm" onclick="${_reviewDecisionHandler(row,'approved')}">✓ Αποδοχή</button>
              <button class="btn btn-danger btn-sm" onclick="${_reviewDecisionHandler(row,'rejected')}">✕ Απόρριψη</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

window.openPendingReview = function(pid,phid,tid) {
  if(phid) state.expandedPhases={...(state.expandedPhases||{}),[phid]:true};
  if(tid) state.expandedTasks[tid]=true;
  navigate('project',{projectId:pid});
  if(tid) requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const node=document.getElementById('task-'+tid);
    if(node) node.scrollIntoView({behavior:'smooth',block:'center'});
  }));
};

function _dashFilteredProjs() {
  const f = state.dashFilter;
  if (!f) return '';
  const all = visibleProjects().filter(p=>!p.standing);
  const isAdminMgmt = ['admin','management'].includes(state.cu?.role);
  let projs, title;
  if (f==='all')          { projs=all; title='Όλα τα Έργα'; }
  else if (f==='in_progress') { projs=all.filter(p=>p.status==='in_progress'); title='Έργα σε Εξέλιξη'; }
  else if (f==='on_hold')     { projs=all.filter(p=>p.status==='on_hold');     title='Έργα σε Αναστολή'; }
  else if (f==='completed')   { projs=all.filter(p=>p.status==='completed');   title='Ολοκληρωμένα Έργα'; }
  else if (f==='pending_docs'){
    projs=all.filter(p=>(p.phases||[]).some(ph=>(ph.tasks||[]).some(t=>(t.docs||[]).some(d=>!d.done))));
    title='Έργα με Εκκρεμή Έγγραφα';
  }
  else if (f==='pending_reviews'){
    if(!isAdminMgmt) return '';
    return renderPendingReviewQueue();
  }
  // Ταξινόμηση βάσει ημερομηνίας έναρξης επόμενης ενεργής φάσης (nulls τελευταία)
  projs = [...projs].sort((a,b) => {
    const da = nextActivePhase(a)?.startDate || '9999-99-99';
    const db = nextActivePhase(b)?.startDate || '9999-99-99';
    return da.localeCompare(db);
  });

  return `<div class="section-hd mb-12" style="margin-top:24px"><h3>${esc(title)}</h3><button class="btn btn-secondary btn-sm" data-action="nav-categories">Όλες οι Κατηγορίες</button></div>
  ${_dashProjTable(projs)}`;
}

function renderDashboard() {
  const s=dashStats();
  const f=state.dashFilter;
  const isAdminMgmt = ['admin','management'].includes(state.cu?.role);
  const priorityWidget = ['project_manager','team_member'].includes(state.cu?.role) ? renderPriorityWidget() : '';
  const storageWidget  = renderStorageWidget();

  const card=(val,label,icon,num,numColor,trend)=>`
    <div class="stat-card${f===val?' stat-card-active':''}" data-action="dash-filter" data-val="${val}" style="cursor:pointer">
      <div class="stat-card-top"><div class="stat-card-label">${label}</div>${icon}</div>
      <div class="stat-card-num"${numColor?` style="color:${numColor}"`:''}>${num}</div>
      <div class="stat-card-trend">${trend}</div>
    </div>`;

  return `
  <div class="dash-welcome mb-12"><h2>Καλωσήρθατε, ${esc(state.cu.name)}</h2><p>Επισκόπηση έργων · ${new Date().toLocaleDateString('el-GR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></div>
  <div class="stats-grid">
    ${card('all','Έργα',`<div class="stat-card-icon" style="background:var(--orange-light)"><svg width="16" height="16" viewBox="0 0 20 20" fill="var(--orange)"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg></div>`,s.total,'','Συνολικά ορατά')}
    ${card('in_progress','Σε Εξέλιξη',`<div class="stat-card-icon" style="background:var(--amber-bg)"><svg width="16" height="16" viewBox="0 0 20 20" fill="var(--amber)"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg></div>`,s.active,'var(--orange)','Ενεργά έργα')}
    ${card('on_hold','Αναστολή',`<div class="stat-card-icon" style="background:#ede9fe"><svg width="16" height="16" viewBox="0 0 20 20" fill="#7c3aed"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></div>`,s.onHold,'#7c3aed','Σε αναστολή')}
    ${card('completed','Ολοκληρωμένα',`<div class="stat-card-icon" style="background:var(--green-bg)"><svg width="16" height="16" viewBox="0 0 20 20" fill="var(--green)"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></div>`,s.done,'var(--green)','Επιτυχώς κλεισμένα')}
    ${card('pending_docs','Εκκρεμή Έγγραφα',`<div class="stat-card-icon" style="background:var(--red-bg)"><svg width="16" height="16" viewBox="0 0 20 20" fill="var(--red)"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/></svg></div>`,s.pendingDocs,'var(--red)','Σε όλα τα έργα')}
    ${isAdminMgmt?card('pending_reviews','Εκκρεμή Ελέγχου',`<div class="stat-card-icon" style="background:#fdf2ff"><svg width="16" height="16" viewBox="0 0 20 20" fill="#9333ea"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clip-rule="evenodd"/></svg></div>`,s.pendingReviews,'#9333ea','Αιτήματα ελέγχου'):''}
  </div>
  ${_dashFilteredProjs()}
  ${priorityWidget}
  ${storageWidget}`;
}

// ── VIEW: CATEGORIES ──────────────────────────────────────────────
function renderCategories() {
  let cats=isAdmin()?state.db.categories:state.db.categories.filter(c=>
    (c.managerIds||[]).includes(state.cu.id) ||
    visibleProjects().some(p=>p.categoryId===c.id) ||
    (state.cu.categoryRoles&&state.cu.categoryRoles[c.id])
  );
  const canManageCats=!!state.cu && ['admin','management'].includes(state.cu.role);
  // Εφαρμογή αποθηκευμένης σειράς (drag & drop)
  const savedOrder = JSON.parse(localStorage.getItem('be_cat_order')||'[]');
  if (savedOrder.length) {
    cats = [...cats].sort((a,b)=>{
      const ai=savedOrder.indexOf(a.id); const bi=savedOrder.indexOf(b.id);
      if(ai===-1&&bi===-1) return 0; if(ai===-1) return 1; if(bi===-1) return -1;
      return ai-bi;
    });
  }
  const canDrag = isAdmin();
  return `
  <div class="page-hd"><div><h1>Κατηγορίες Έργων</h1><div class="page-hd-sub">${cats.length} κατηγορίες${canDrag?' · <span style="font-size:.75rem;color:var(--muted)">σύρε για αναδιάταξη</span>':''}</div></div>${canManageCats?`<div class="page-hd-actions"><button class="btn btn-primary" data-action="modal-add-category">+ Νέα Κατηγορία</button></div>`:''}</div>
  <div class="projects-grid" id="cat-grid">
    ${cats.map(cat=>{const projs=visibleProjects().filter(p=>p.categoryId===cat.id);const active=projs.filter(p=>p.status==='in_progress').length;const done=projs.filter(p=>p.status==='completed').length;const mgrIds=[...new Set([...(cat.managerIds||[]),...state.db.users.filter(u=>u.categoryRoles&&u.categoryRoles[cat.id]==='project_manager').map(u=>u.id)])];const mgrs=mgrIds.map(id=>getUser(id)?.name).filter(Boolean).join(', ');const init=cat.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();const canDelCat=canManageCats;
const dragAttrs=canDrag?`draggable="true" ondragstart="catDragStart(event,'${cat.id}')" ondragover="catDragOver(event)" ondragleave="catDragLeave(event)" ondrop="catDrop(event,'${cat.id}')" ondragend="catDragEnd()"`:''
return`<div class="project-card cat-card${canDrag?' cat-draggable':''}" data-action="open-category" data-cid="${cat.id}" ${dragAttrs}><div class="project-card-accent" style="background:${cat.color}"></div>${canDrag?`<div class="cat-drag-handle" title="Σύρε για αναδιάταξη">⠿</div>`:''}<div class="project-card-body"><div class="project-monogram" style="background:${cat.bgLight};color:${cat.color}">${init}</div><div class="project-card-name">${esc(cat.name)}</div></div><div class="project-card-stats"><div class="pstat"><div class="pstat-num">${projs.length}</div><div class="pstat-label">Έργα</div></div><div class="pstat"><div class="pstat-num" style="color:var(--orange)">${active}</div><div class="pstat-label">Ενεργά</div></div><div class="pstat"><div class="pstat-num" style="color:var(--green)">${done}</div><div class="pstat-label">Ολοκλ.</div></div></div><div class="project-card-footer" style="justify-content:space-between"><span class="text-sm text-muted">${(cat.template?.phases||[]).length} φάσεις στο πρότυπο</span>${canDelCat?`<button class="btn btn-danger btn-sm" data-action="delete-category" data-cid="${cat.id}">Διαγραφή</button>`:'<span class="text-sm text-muted">Προβολή →</span>'}</div></div>`;}).join('')}
    ${canManageCats?`<div class="card-add" data-action="modal-add-category"><div class="card-add-icon">+</div><p>Νέα Κατηγορία</p></div>`:''}
  </div>`;
}

// ── CATEGORY DRAG & DROP ──────────────────────────────────────────
let _catDragId = null;
window.catDragStart = function(e, catId) {
  _catDragId = catId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', catId);
  setTimeout(()=>{ const el=document.querySelector(`.project-card[data-cid="${catId}"]`); if(el) el.classList.add('cat-dragging'); }, 0);
};
window.catDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('cat-drag-over');
};
window.catDragLeave = function(e) {
  e.currentTarget.classList.remove('cat-drag-over');
};
window.catDrop = function(e, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove('cat-drag-over');
  if (!_catDragId || _catDragId === targetId) return;
  const allCats = state.db.categories;
  const saved = JSON.parse(localStorage.getItem('be_cat_order')||'[]');
  // Φτιάξε την τρέχουσα σειρά
  let order = saved.length
    ? [...allCats].sort((a,b)=>{ const ai=saved.indexOf(a.id),bi=saved.indexOf(b.id); if(ai===-1&&bi===-1)return 0; if(ai===-1)return 1; if(bi===-1)return -1; return ai-bi; }).map(c=>c.id)
    : allCats.map(c=>c.id);
  // Αν λείπουν κατηγορίες, πρόσθεσέ τες στο τέλος
  allCats.forEach(c=>{ if(!order.includes(c.id)) order.push(c.id); });
  const fi=order.indexOf(_catDragId), ti=order.indexOf(targetId);
  if(fi===-1||ti===-1) return;
  order.splice(fi,1); order.splice(ti,0,_catDragId);
  localStorage.setItem('be_cat_order', JSON.stringify(order));
  render();
};
window.catDragEnd = function() {
  document.querySelectorAll('.project-card').forEach(el=>el.classList.remove('cat-dragging','cat-drag-over'));
  _catDragId = null;
};

// ── VIEW: PROJECTS ────────────────────────────────────────────────
function renderProjects() {
  const cat=getCategory(state.categoryId); if(!cat){navigate('categories');return'';}
  const vis=state.db.projects.filter(p=>p.categoryId===cat.id).filter(p=>canAccessProject(p));
  const search=state.search.toLowerCase();
  let filtered=search?vis.filter(p=>p.name.toLowerCase().includes(search)||(p.clientName||'').toLowerCase().includes(search)||(p.code||'').toLowerCase().includes(search)):vis;
  if (state.filter.status) filtered=filtered.filter(p=>p.status===state.filter.status);
  // Ταξινόμηση βάσει πρώτης προγραμματισμένης ημερομηνίας ανοιχτής εργασίας
  filtered = [...filtered].sort((a,b) => earliestActiveTaskDate(a).localeCompare(earliestActiveTaskDate(b)));
  const canCreate = state.cu && ['admin','management','project_manager'].includes(state.cu.role);
  const statusTabs=[{k:'',l:'Όλα',n:vis.length},{k:'in_progress',l:'Σε εξέλιξη',n:vis.filter(p=>p.status==='in_progress').length},{k:'completed',l:'Ολοκληρωμένα',n:vis.filter(p=>p.status==='completed').length}];
  const cols = '2fr 1fr 1.5fr 110px 110px 130px 30px';
  return `
  <div class="page-hd"><div><h1>${esc(cat.name)}</h1><div class="page-hd-sub">${esc(cat.desc)}</div></div><div class="page-hd-actions">${canCreate?`<button class="btn btn-ghost btn-sm" data-action="modal-edit-category" data-cid="${cat.id}" title="Επεξεργασία κατηγορίας">✏ Επεξεργασία</button>`:''}<button class="btn btn-secondary btn-sm" data-action="export-category" data-cid="${cat.id}" title="Εξαγωγή κατηγορίας σε Excel">⬇ Excel</button>${canCreate?`<button class="btn btn-primary" data-action="modal-add-project" data-cid="${cat.id}">+ Νέο Έργο</button>`:''}</div></div>
  <div class="filter-bar mb-12">
    <div class="filter-tabs">${statusTabs.map(t=>`<button class="filter-tab${state.filter.status===t.k?' active':''}" data-action="filter-status" data-val="${t.k}">${t.l} <span class="filter-tab-count">${t.n}</span></button>`).join('')}</div>
    <div class="search-bar"><span class="search-icon">⌕</span><input type="text" placeholder="Αναζήτηση…" id="search-input" value="${esc(state.search)}"></div>
  </div>
  ${filtered.length?`
  <div class="cases-table">
    <div class="cases-table-head" style="grid-template-columns:${cols}">
      <div>Έργο</div><div>Υπεύθυνος</div><div>Επόμενη Φάση</div><div>Έναρξη</div><div>Λήξη</div><div>Ποσοστό</div><div></div>
    </div>
    ${filtered.map(p=>{
      const mgrNames = projManagerNames(p);
      const ph = nextActivePhase(p);
      const phName  = ph ? esc(ph.name) : '<span style="color:var(--green);font-weight:600">✓ Ολοκληρ.</span>';
      const phDates = ph ? phasePlannedDates(ph) : null;
      const phStart = phDates?.start ? fmt(phDates.start) : '—';
      const phEnd   = phDates?.end   ? fmt(phDates.end)   : '—';
      const inactive = !userHasActionInProject(p, state.cu?.id);
      const pct = projectProgress(p).total.pct;
      const pctColor = pct===100 ? 'var(--green)' : 'var(--orange)';
      return`<div class="case-row${inactive?' proj-inactive':''}" style="grid-template-columns:${cols}" data-action="open-project" data-pid="${p.id}" data-proj-id="${p.id}" title="${inactive?'Δεν απαιτείται ενέργεια από εσάς αυτή τη στιγμή':''}">
        <div class="case-row-title">${esc(p.name)}</div>
        <div class="text-sm">${esc(mgrNames)}</div>
        <div class="text-sm">${phName}</div>
        <div class="text-sm text-muted">${phStart}</div>
        <div class="text-sm text-muted">${phEnd}</div>
        <div class="case-row-prog"><div class="row-prog-bar"><div class="row-prog-fill" style="width:${pct}%;background:${pctColor}"></div></div><span class="row-prog-pct">${pct}%</span></div>
        <div class="row-arrow">${inactive?'<span style="font-size:.65rem;color:var(--muted)">αναμονή</span>':'›'}</div>
      </div>`;}).join('')}
  </div>`:`<div class="empty-state"><div class="es-icon">—</div><h3>Δεν βρέθηκαν έργα</h3><p>${canCreate?'Δημιουργήστε το πρώτο έργο.':'Δεν υπάρχουν ορατά έργα.'}</p>${canCreate?`<button class="btn btn-primary" data-action="modal-add-project" data-cid="${cat.id}">+ Νέο Έργο</button>`:''}</div>`}`;
}

// ── PROJECT PROGRESS CHART ────────────────────────────────────────
function renderProjectProgressChart(proj, prog) {
  const phases = proj.phases || [];

  // ── Progress bars ─────────────────────────────────────────────
  const totalPct = prog.total.pct;
  const totalColor = totalPct === 100 ? 'var(--green)' : 'var(--orange)';

  const phaseRows = phases.map((ph, i) => {
    const active = (ph.tasks||[]).filter(t => t.status !== 'cancelled' && t.status !== 'not_required');
    const pct    = active.length === 0 ? 0 : Math.round(active.reduce((s,t)=>s+taskProgress(t),0) / active.length);
    const color  = pct === 100 ? 'var(--green)' : pct > 0 ? 'var(--orange)' : 'var(--slate-300,#cbd5e1)';
    const label  = ph.name.length > 30 ? ph.name.slice(0, 29) + '…' : ph.name;
    return `<div class="ppc-row">
      <div class="ppc-label" title="${esc(ph.name)}"><span class="ppc-phase-num">${i+1}</span>${esc(label)}</div>
      <div class="ppc-bar-wrap"><div class="ppc-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="ppc-pct">${pct}%</div>
    </div>`;
  }).join('');

  // ── Timeline (mini-Gantt) ─────────────────────────────────────
  const allDates = phases.flatMap(ph => [
    ...(()=>{const _pd=phasePlannedDates(ph);return[_pd.start,_pd.end];})(),
    ...(ph.tasks||[]).flatMap(t => [t.plannedStart, t.plannedEnd])
    // completedDate εξαιρείται — δεν πρέπει να επηρεάζει το εύρος του timeline
  ]).filter(Boolean).sort();

  const hasDates = allDates.length >= 2;
  let timelineHtml = '';

  if (phases.length > 0) {
    let markers = '';
    let phBars  = '';

    if (hasDates) {
      // ── Date-based positioning ──
      const minD   = new Date(allDates[0]);
      const maxD   = new Date(allDates[allDates.length - 1]);
      maxD.setDate(maxD.getDate() + 5); // right padding so last bar doesn't get clipped
      const span   = Math.max(1, Math.round((maxD - minD) / 86400000)) + 1;
      const toLeft = d => Math.max(0, Math.min(100, Math.round((new Date(d) - minD) / 86400000 / span * 100)));

      const GR_MONTHS = ['Ιαν','Φεβ','Μάρ','Απρ','Μάι','Ιούν','Ιούλ','Αύγ','Σεπ','Οκτ','Νοε','Δεκ'];
      const step = span <= 14 ? 2 : span <= 45 ? 5 : span <= 120 ? 10 : 30;
      for (let d = 0; d <= span; d += step) {
        const dt = new Date(minD); dt.setDate(dt.getDate() + d);
        const lbl = step >= 30
          ? GR_MONTHS[dt.getMonth()]                                   // "Μάι"
          : `${dt.getDate()} ${GR_MONTHS[dt.getMonth()]}`;            // "1 Αύγ"
        markers += `<div class="ppc-tl-mark" style="left:${Math.round(d/span*100)}%">${lbl}</div>`;
      }

      phBars = phases.map((ph, i) => {
        // Χρησιμοποιούμε ΜΟΝΟ τις ημερομηνίες φάσης (όχι completedDate) για τα όρια μπάρας
        const _phPDM = phasePlannedDates(ph);
        const phStarts = [_phPDM.start, ...(ph.tasks||[]).map(t=>t.plannedStart)].filter(Boolean).sort();
        const phEnds   = [_phPDM.end,   ...(ph.tasks||[]).map(t=>t.plannedEnd)].filter(Boolean).sort();
        const active   = (ph.tasks||[]).filter(t=>t.status!=='cancelled'&&t.status!=='not_required');
        const pct      = active.length===0 ? 0 : Math.round(active.filter(t=>t.status==='completed').length/active.length*100);
        const isDone   = pct === 100;

        let barHtml;
        if (!phStarts.length) {
          // No dates for this phase — show as full-width placeholder
          barHtml = `<div class="ppc-tl-bar ppc-tl-nodate-bar" style="left:0%;width:100%;opacity:.25"></div>`;
        } else {
          // Αν υπάρχει endDate φάσης, αυτό κερδίζει — δεν αφήνουμε task dates να το παρακάμψουν
          const ps    = _phPDM.start || phStarts[0];
          const pe    = _phPDM.end   || (phEnds.length ? phEnds[phEnds.length-1] : ps);
          const left  = toLeft(ps);
          const right = toLeft(pe);
          const w     = Math.max(2, right - left);
          barHtml = `<div class="ppc-tl-bar${isDone?' ppc-tl-done':''}" style="left:${left}%;width:${w}%">
            ${pct>0&&pct<100?`<span class="ppc-tl-pct">${pct}%</span>`:''}
          </div>`;
        }
        const tlLabel = ph.name.length > 16 ? ph.name.slice(0,15)+'…' : ph.name;
        return `<div class="ppc-tl-row">
          <div class="ppc-tl-label" title="${esc(ph.name)}"><span class="ppc-phase-num">${i+1}</span>${esc(tlLabel)}</div>
          <div class="ppc-tl-area">${barHtml}</div>
        </div>`;
      }).join('');

    } else {
      // ── No dates: equal-width sequential bars ──
      const n = phases.length;
      phases.forEach((ph, i) => {
        const active = (ph.tasks||[]).filter(t=>t.status!=='cancelled'&&t.status!=='not_required');
        const pct    = active.length===0 ? 0 : Math.round(active.filter(t=>t.status==='completed').length/active.length*100);
        const isDone = pct === 100;
        const left   = Math.round(i / n * 100);
        const w      = Math.round(100 / n) - 1;
        const tlLabel2 = ph.name.length > 16 ? ph.name.slice(0,15)+'…' : ph.name;
        phBars += `<div class="ppc-tl-row">
          <div class="ppc-tl-label" title="${esc(ph.name)}"><span class="ppc-phase-num">${i+1}</span>${esc(tlLabel2)}</div>
          <div class="ppc-tl-area">
            <div class="ppc-tl-bar${isDone?' ppc-tl-done':''}" style="left:${left}%;width:${w}%">
              ${pct>0&&pct<100?`<span class="ppc-tl-pct">${pct}%</span>`:''}
            </div>
          </div>
        </div>`;
        markers += `<div class="ppc-tl-mark" style="left:${left + w/2}%" title="${esc(ph.name)}">Φ${i+1}</div>`;
      });
    }

    timelineHtml = `<div class="ppc-timeline">
      <div class="ppc-tl-row ppc-tl-head-row">
        <div class="ppc-tl-label" style="color:rgba(255,255,255,.4);font-size:.6rem">Φάσεις</div>
        <div class="ppc-tl-area ppc-tl-markers">${markers}</div>
      </div>
      ${phBars}
    </div>`;
  }

  return `<div class="proj-progress-chart">
    <div class="ppc-row ppc-total-row">
      <div class="ppc-label"><strong>Συνολικό έργο</strong></div>
      <div class="ppc-bar-wrap"><div class="ppc-bar-fill" style="width:${totalPct}%;background:${totalColor}"></div></div>
      <div class="ppc-pct"><strong>${totalPct}%</strong></div>
    </div>
    ${phaseRows}
    ${timelineHtml}
  </div>`;
}

function ensureCompactProjectDocsStyle() {
  if(document.getElementById('be-project-docs-compact-style')) return;
  const style=document.createElement('style');
  style.id='be-project-docs-compact-style';
  style.textContent=`
    .docs-grid.docs-grid-compact{
      display:block;
    }
    .doc-category-head-compact{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      padding:7px 0 4px;
      border-bottom:1px solid var(--slate-200);
      margin-top:5px;
    }
    .doc-category-head-compact .doc-category-label{
      margin:0;
      padding:0;
      border:0;
      flex:1 1 auto;
    }
    .task-documents-block{
      border:1px solid var(--slate-200);
      border-radius:10px;
      padding:10px 12px;
      background:rgba(248,250,252,.72);
    }
    .task-documents-toolbar{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      flex-wrap:wrap;
    }
    .task-documents-title{
      display:flex;
      align-items:center;
      gap:7px;
      font-size:.78rem;
      font-weight:800;
      color:var(--navy);
    }
    .task-documents-count{
      min-width:20px;
      height:20px;
      padding:0 6px;
      border-radius:999px;
      display:inline-flex;
      align-items:center;
      justify-content:center;
      background:var(--slate-200);
      color:var(--steel);
      font-size:.66rem;
      font-weight:800;
    }
    .task-documents-empty{
      margin:9px 0 0;
      padding:9px 10px;
      border-radius:7px;
      background:#fff;
      color:var(--muted);
      font-size:.75rem;
    }
    .doc-row.doc-row-compact{
      display:grid;
      grid-template-columns:24px minmax(180px,1fr) auto;
      align-items:center;
      gap:8px;
      min-height:36px;
      padding:5px 0;
    }
    .doc-row.doc-row-compact .doc-info{
      display:flex;
      align-items:center;
      gap:7px;
      min-width:0;
      flex-wrap:wrap;
    }
    .doc-row.doc-row-compact .doc-name{
      margin:0;
    }
    .doc-row.doc-row-compact .doc-filename{
      margin:0;
      font-size:.68rem;
    }
    .doc-row.doc-row-compact .doc-type-badge{
      margin:0;
      white-space:nowrap;
    }
    .doc-row.doc-row-compact .doc-acts{
      display:flex;
      align-items:center;
      justify-content:flex-end;
      gap:4px;
      flex-wrap:wrap;
    }
    @media(max-width:850px){
      .doc-row.doc-row-compact{
        grid-template-columns:24px 1fr;
      }
      .doc-row.doc-row-compact .doc-acts{
        grid-column:2;
        justify-content:flex-start;
      }
    }
  `;
  document.head.appendChild(style);
}

// ── VIEW: PROJECT DETAIL ──────────────────────────────────────────
function renderProject() {
  ensureCompactProjectDocsStyle();
  const proj=getProject(state.projectId); if(!proj) return '<p>Έργο not found.</p>';
  const cat=getCategory(proj.categoryId); const mgrNames=projManagerNames(proj);
  const prog=projectProgress(proj); const isComp=proj.status==='completed'; const canMod=canModifyProject(proj);
  const isAdminOrMgmt = ['admin','management'].includes(state.cu?.role);
  const init=proj.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();

  const phases=(proj.phases||[]).map((ph,phIdx)=>{
    const phUnlocked=isPhaseUnlocked(proj,phIdx); const phDone=isPhaseComplete(ph);
    const phTasks=ph.tasks||[];
    const myTasks=visibleTasksInPhase(ph, proj.categoryId); // filtered for team_member role
    const activeTasks=phTasks.filter(t=>t.status!=='cancelled'&&t.status!=='not_required');
    const phPct=activeTasks.length===0?0:Math.round(activeTasks.reduce((s,t)=>s+taskProgress(t),0)/activeTasks.length);
    const tasksHtml=myTasks.map(t=>{
      const unlocked=(proj.enforceDeps||t.enforceDeps) ? isTaskUnlocked(ph,t) : true;
      const dp=taskDocProgress(t); const stInfo=TASK_STATUSES[t.status]||TASK_STATUSES.not_started;
      const assignee=getUser(t.assigneeId);
      const taskMembers=(t.memberIds||[]).map(mid=>getUser(mid)).filter(Boolean);
      const isExp=state.expandedTasks[t.id];
      const depNames=(t.dependsOn||[]).map(depId=>{const dep=phTasks.find(tt=>tt.id===depId);return dep?.name||'';}).filter(Boolean);
      const taskDocs=t.docs||[];
      const docGroups={}; taskDocs.forEach(d=>{if(!docGroups[d.cat])docGroups[d.cat]=[];docGroups[d.cat].push(d);});
      const canAddTaskDocument=canMod&&unlocked&&!isComp;
      const addTaskDocumentBtn=canAddTaskDocument
        ? `<button class="btn btn-secondary btn-sm" data-action="modal-add-doc" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${t.id}">+ Προσθήκη εγγράφου</button>`
        : '';
      const docsListHtml=Object.keys(docGroups).length===0
        ? '<div class="task-documents-empty">Δεν υπάρχουν έγγραφα σε αυτή την εργασία.</div>'
        :`<div class="docs-grid docs-grid-compact">${Object.entries(docGroups).map(([cat2,docs])=>`<div class="doc-category-head-compact"><div class="doc-category-label">${esc(cat2)}</div></div>${docs.map(d=>{
          const dropboxSources = _dropboxDocumentSources(d.url);
          const hasOpenSource = !!(d.file || d.url || d.folderPath);
          const docOpenBtn = d.done&&hasOpenSource
            ? `<button class="btn btn-secondary btn-sm" data-action="open-task-document" data-did="${d.id}" data-tid="${t.id}" title="Άνοιγμα του εγγράφου">📄 Άνοιγμα</button>`
            : '';
          const docDropboxBtn = d.done&&dropboxSources.localPath&&dropboxSources.onlineUrl
            ? `<button class="btn btn-ghost btn-sm" data-action="open-task-document-online" data-did="${d.id}" data-tid="${t.id}" title="Άνοιγμα του επίσημου αρχείου online στο Dropbox">☁ Dropbox</button>`
            : '';
          const canRemove = d.done&&unlocked&&!isComp&&(canMod||(d.manualCheck&&!d.file&&!d.url&&state.cu));
          const docRemoveBtn = canRemove
            ? `<button class="btn btn-danger btn-icon btn-sm" data-action="remove-doc-url" data-did="${d.id}" data-tid="${t.id}" title="${d.manualCheck&&!d.file&&!d.url?'Αναίρεση τικ':'Αφαίρεση αρχείου'}">✕</button>`
            : '';
          const docDeleteBtn = canMod&&unlocked&&!isComp
            ? `<button class="btn btn-danger btn-icon btn-sm" data-action="delete-doc" data-did="${d.id}" data-tid="${t.id}" title="Διαγραφή εγγράφου">🗑</button>`
            : '';
          const docRenameBtn = canMod&&unlocked&&!isComp
            ? `<button class="btn btn-ghost btn-icon btn-sm" data-action="doc-rename" data-did="${d.id}" data-tid="${t.id}" title="Μετονομασία εγγράφου">✏️</button>`
            : '';
          const docSourceEditBtn = d.done&&unlocked&&!isComp&&canMod&&!d.file
            ? `<button class="btn btn-ghost btn-icon btn-sm" data-action="edit-doc-source" data-did="${d.id}" data-tid="${t.id}" title="Αλλαγή διαδρομής ή Dropbox link">🗂️</button>`
            : '';
          const docAddBtn = !d.done&&unlocked&&!isComp&&state.cu
            ? `<button class="btn btn-secondary btn-sm" data-action="add-doc-url" data-did="${d.id}" data-tid="${t.id}">+ Σύνδεση Dropbox</button>`
            : '';
          const docManualCheckBtn = !d.done&&unlocked&&!isComp&&state.cu
            ? `<button class="btn btn-ghost btn-sm doc-manual-btn" data-action="doc-manual-check" data-did="${d.id}" data-tid="${t.id}" title="Σήμανση ως ολοκληρωμένο χωρίς αρχείο">✓ Τικ</button>`
            : '';
          const delivered=deliveryForDocument(proj.id,t.id,d.id);
          const clientDeliveryBtn=d.done&&canPublishClientDelivery(proj,t)
            ? `<button class="btn ${delivered?'btn-ghost':'btn-secondary'} btn-sm" data-action="client-delivery" data-did="${d.id}" data-tid="${t.id}" title="${delivered?'Χειροκίνητη ενημέρωση της παράδοσης':'Παράδοση επιλεγμένου αντιγράφου στον πελάτη'}">${delivered?'🔄 Ενημέρωση παράδοσης':'📤 Παράδοση στον πελάτη'}</button>`
            : '';
          const deliveryBadge=delivered
            ? `<span class="badge badge-green" style="font-size:.58rem" title="Έκδοση ${delivered.version} · ${fmtDT(delivered.publishedAt)}">👤 Παραδόθηκε v${delivered.version}</span>`
            : '';
          const clientBadge = d.clientUploaded ? `<span class="doc-client-badge">👤 Από πελάτη</span>` : '';
          const manualBadge = d.done&&d.manualCheck&&!d.file&&!d.url ? `<div class="doc-filename">✓ Ολοκληρώθηκε χειροκίνητα${d.checkedBy?` · ${esc(d.checkedBy)}`:''}</div>` : '';
          const linkedLabel = d.done&&d.url
            ? `<div class="doc-filename">${dropboxSources.localPath&&dropboxSources.onlineUrl?'🖥 Τοπικά · ☁ Dropbox':(dropboxSources.localPath?'🖥 Dropbox τοπικά':(_isDropboxDocumentUrl(dropboxSources.onlineUrl)?'☁ Dropbox':'🔗 Online σύνδεσμος'))}</div>`
            : '';
          const fileLabel = d.done&&d.file ? `<div class="doc-filename">📄 ${esc(d.file)}${clientBadge}</div>` : (linkedLabel||manualBadge);
          return `<div class="doc-row doc-row-compact ${d.done?'dr-done':''}" id="doc-${d.id}"><div class="doc-status ${d.done?'ds-done':''}">${d.done?'✓':''}</div><div class="doc-info"><div class="doc-name">${esc(d.name)} ${d.required?'<span style="color:var(--red);font-size:.65rem">✱</span>':''}</div>${fileLabel}${d.type?`<span class="doc-type-badge doc-type-${d.type}">${DOC_TYPES[d.type]||d.type}</span>`:''}${deliveryBadge}</div><div class="doc-acts">${d.done&&d.at?`<span class="doc-date">${fmt(d.at)}</span>`:''} ${docOpenBtn}${docDropboxBtn}${clientDeliveryBtn}${docRemoveBtn}${docAddBtn}${docManualCheckBtn}${docSourceEditBtn}${docRenameBtn}${docDeleteBtn}</div></div>`;
        }).join('')}`).join('')}</div>`;
      const docsHtml=`<div class="task-documents-block mt-8"><div class="task-documents-toolbar"><div class="task-documents-title"><span>📎 Έγγραφα</span><span class="task-documents-count">${taskDocs.length}</span></div>${addTaskDocumentBtn}</div>${docsListHtml}</div>`;
      const canMoveTsk = state.cu && state.cu.role !== 'client' && !isComp;
      const canMoveToPhase = canMoveTsk && (proj.phases||[]).length > 1;
      const phaseMoveButtons = canMoveToPhase ? `<div class="task-phase-arrows">
        <button class="task-phase-arr${phIdx===0?' tpl-arr-disabled':''}" data-action="task-phase-prev" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${t.id}" ${phIdx===0?'disabled':''} title="Μετακίνηση στην προηγούμενη φάση">◀</button>
        <button class="task-phase-arr${phIdx===(proj.phases||[]).length-1?' tpl-arr-disabled':''}" data-action="task-phase-next" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${t.id}" ${phIdx===(proj.phases||[]).length-1?'disabled':''} title="Μετακίνηση στην επόμενη φάση">▶</button>
      </div>` : '';
      return `<div class="task-row ${t.status==='completed'?'task-done':''} ${!unlocked?'task-locked':''}" id="task-${t.id}"
        ${canMoveTsk?`draggable="true" ondragstart="projTaskDragStart(event,this,'${t.id}','${ph.id}','${proj.id}')" ondragend="projTaskDragEnd(this)" ondragover="projTaskRowDragOver(event,this)" ondragleave="projTaskRowDragLeave(this)" ondrop="projTaskRowDrop(event,this,'${t.id}','${ph.id}','${proj.id}')"`:''}>
        <div class="task-row-head" data-action="toggle-task" data-tid="${t.id}">
          ${canMoveTsk?'<div class="tpl-drag-handle" title="Σύρετε για αναδιάταξη">⠿</div>':''}
          <div class="task-status-dot" style="background:${stInfo.color}"></div>
          <div class="task-info">
            <div class="task-name">${esc(t.name)}${t.urgent?' <span class="badge badge-red" style="font-size:.58rem;padding:1px 7px">⚡ ΕΠΕΙΓΟΝ</span>':''}${t.parallel?' <span class="badge badge-gray" style="font-size:.58rem;padding:1px 6px">Παράλληλη</span>':''}${t.mgmtCheck?' <span class="badge" style="font-size:.58rem;padding:1px 7px;background:#7c3aed;color:#fff">⚑ ΕΛΕΓΧΟΣ ΔΙΟΙΚΗΣΗΣ</span>':''}</div>
            <div class="task-meta">${assignee?`<span>Υπεύθυνος: ${esc(assignee.name)}</span>`:''}${taskMembers.length?`<span>Μέλη: ${taskMembers.map(m=>esc(m.name)).join(', ')}</span>`:''}${t.plannedStart?`<span class="date-planned">📅 Προγρ: ${fmt(t.plannedStart)}${t.plannedEnd?' – '+fmt(t.plannedEnd):''}</span>`:''}${t.startDate?`<span>Έναρξη: ${fmt(t.startDate)}</span>`:''}${t.completedDate?`<span>Ολοκλήρωση: ${fmt(t.completedDate)}</span>`:''}${depNames.length?`<span class="dep-badge">⊞ Εξαρτάται από: ${esc(depNames.join(', '))}</span>`:''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end">
            <span class="task-status-badge ${stInfo.cls}">${stInfo.label}</span>
            <div class="mini-prog"><div class="mini-bar"><div class="mini-fill" style="width:${dp.pct}%;background:${t.status==='completed'?'var(--green)':'var(--orange)'}"></div></div><span class="mini-count">${dp.done}/${dp.total}</span></div>
            ${!unlocked?'<span class="badge badge-amber" style="font-size:.58rem">Κλειδωμένη</span>':''}
            ${canMod&&!isComp?`<button class="btn btn-ghost btn-sm" data-action="duplicate-task" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${t.id}" title="Αντιγραφή εργασίας" style="font-size:.7rem;padding:3px 8px">⧉</button>`:''}
            ${phaseMoveButtons}
            <span class="expand-icon${isExp?' ei-open':''}" id="ei-${t.id}">▼</span>
          </div>
        </div>
        <div class="task-row-body${isExp?' body-open':''}" id="body-${t.id}">
          ${depNames.length?`<div class="lock-msg" style="opacity:.7${!unlocked?';color:var(--red)':''}">${!unlocked?'🔒':'ℹ'} Εξαρτάται από: ${esc(depNames.join(', '))}</div>`:''}
          ${canMod&&unlocked&&!isComp?`<div class="flex-center mb-12" style="gap:8px;flex-wrap:wrap"><select class="form-control" style="max-width:230px;font-size:.8rem" data-action="change-status" data-tid="${t.id}" data-phid="${ph.id}" data-pid="${proj.id}">${Object.entries(TASK_STATUSES).sort((a,b)=>a[1].label.localeCompare(b[1].label,'el')).map(([k,v])=>`<option value="${k}"${t.status===k?' selected':''}>${v.label}</option>`).join('')}</select><button class="btn btn-secondary btn-sm" data-action="modal-edit-task" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${t.id}">Επεξεργασία</button></div>`:''}
          ${(t.subtasks||[]).length?`<div class="subtasks-section"><div class="subtask-label">Υποεργασίες</div>${t.subtasks.map(st=>{
            const srs=st.reviewStatus;
            const canActSt=unlocked&&!isComp&&canMod&&['project_manager','team_member'].includes(state.cu?.role);
            const chkDisabled=!canActSt||(srs!=='approved'&&!st.done);
            let revHtml='';
            if(!st.done){
              if(isAdminOrMgmt&&srs==='pending') revHtml=`<span class="st-review-acts"><button class="btn btn-primary btn-sm" onclick="resolveSubtaskReview('${proj.id}','${ph.id}','${t.id}','${st.id}','approved')">✅ Αποδοχή</button><button class="btn btn-danger btn-sm" onclick="resolveSubtaskReview('${proj.id}','${ph.id}','${t.id}','${st.id}','rejected')">❌ Απόρριψη</button></span>`;
              else if(isAdminOrMgmt&&srs==='approved') revHtml=`<span class="badge badge-green" style="font-size:.6rem;margin-left:6px">Εγκρίθηκε</span>`;
              else if(isAdminOrMgmt&&srs==='rejected') revHtml=`<span class="badge badge-red" style="font-size:.6rem;margin-left:6px">Απορρίφθηκε</span>`;
              else if(canActSt){
                if(!srs) revHtml=`<button class="btn btn-ghost btn-sm" style="font-size:.65rem;padding:1px 8px;margin-left:6px" onclick="requestSubtaskReview('${proj.id}','${ph.id}','${t.id}','${st.id}')">📩 Έλεγχος</button>`;
                else if(srs==='pending') revHtml=`<span style="font-size:.65rem;color:var(--amber);margin-left:6px">⏳ Αναμονή Διοίκησης</span>`;
                else if(srs==='approved') revHtml=`<span style="font-size:.65rem;color:var(--green);margin-left:6px">✅ Εγκρίθηκε — τσεκάρετε ως done</span>`;
                else if(srs==='rejected') revHtml=`<span style="font-size:.65rem;color:var(--red);margin-left:6px">❌ Απορρίφθηκε</span><button class="btn btn-ghost btn-sm" style="font-size:.65rem;padding:1px 8px;margin-left:4px" onclick="requestSubtaskReview('${proj.id}','${ph.id}','${t.id}','${st.id}')">↩ Νέο</button>`;
              }
            }
            return `<div class="subtask-item"><input type="checkbox" class="subtask-check"${st.done?' checked':''}${chkDisabled?' disabled':''} data-action="toggle-subtask" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${t.id}" data-stid="${st.id}"><span style="${st.done?'text-decoration:line-through;color:var(--slate-400)':''}">${esc(st.name)}</span>${revHtml}</div>`;
          }).join('')}</div>`:''}
          ${docsHtml}
          ${(()=>{const rs=t.reviewStatus; const canReqRev=canMod&&['project_manager','team_member'].includes(state.cu?.role);
            if(isAdminOrMgmt&&rs==='pending') return `<div class="review-bar review-bar-pending"><div class="review-bar-msg">📩 Αίτημα Ελέγχου από τον Υπεύθυνο Έργου</div><div class="review-bar-acts"><button class="btn btn-primary btn-sm" onclick="resolveTaskReview('${proj.id}','${ph.id}','${t.id}','approved')">✅ Αποδοχή</button><button class="btn btn-danger btn-sm" onclick="resolveTaskReview('${proj.id}','${ph.id}','${t.id}','rejected')">❌ Απόρριψη</button></div></div>`;
            if(isAdminOrMgmt&&rs==='approved') return `<div class="review-bar review-bar-approved">✅ Εγκρίθηκε</div>`;
            if(isAdminOrMgmt&&rs==='rejected') return `<div class="review-bar review-bar-rejected">❌ Απορρίφθηκε</div>`;
            if(canReqRev&&t.status==='completed'){
              if(!rs) return `<div class="review-bar"><button class="btn btn-secondary btn-sm" onclick="requestTaskReview('${proj.id}','${ph.id}','${t.id}')">📩 Αίτημα Ελέγχου</button></div>`;
              if(rs==='pending') return `<div class="review-bar review-bar-pending">⏳ Αναμονή Ελέγχου από Διοίκηση…</div>`;
              if(rs==='approved') return `<div class="review-bar review-bar-approved">✅ Εγκρίθηκε</div>`;
              if(rs==='rejected') return `<div class="review-bar review-bar-rejected">❌ Απορρίφθηκε &nbsp;<button class="btn btn-secondary btn-sm" onclick="requestTaskReview('${proj.id}','${ph.id}','${t.id}')">↩ Νέο Αίτημα</button></div>`;
            }
            return '';
          })()}
          ${state.cu.role!=='client'?renderTaskComments(t,proj,ph):''}
        </div>
      </div>`;
    }).join('');
    const canReorder = state.cu && ['admin','management'].includes(state.cu.role);
    const totalPhases = (proj.phases||[]).length;
    const canDropTasks = !isComp && state.cu && state.cu.role !== 'client';
    return `<div class="phase-section${phDone?' phase-done':''}" data-phase-idx="${phIdx}" data-phase-id="${ph.id}"${canReorder?` draggable="true" ondragstart="phaseDragStart(event,this,${phIdx})" ondragend="phaseDragEnd(this)"`:''} ${canDropTasks||canReorder?`ondragover="unifiedPhaseDragOver(event,this,${phIdx},'${ph.id}')" ondrop="unifiedPhaseDrop(event,this,${phIdx},'${ph.id}','${proj.id}')"`:''}>
      <div class="phase-header"><div class="phase-num${phDone?' pn-done':' pn-active'}">${phDone?'✓':phIdx+1}</div><div class="phase-title">${esc(ph.name)}</div>${phDone?'<span class="badge badge-green">Ολοκληρώθηκε</span>':''}
      <div style="margin-left:auto;display:flex;align-items:center;gap:10px">${canReorder?`<div style="display:flex;flex-direction:column;gap:2px"><button class="btn btn-ghost btn-sm prio-arrow-btn" data-action="move-phase-up" data-pid="${proj.id}" data-phidx="${phIdx}" ${phIdx===0?'disabled':''} style="padding:1px 6px;font-size:.7rem">▲</button><button class="btn btn-ghost btn-sm prio-arrow-btn" data-action="move-phase-down" data-pid="${proj.id}" data-phidx="${phIdx}" ${phIdx===totalPhases-1?'disabled':''} style="padding:1px 6px;font-size:.7rem">▼</button></div>`:''}<div class="mini-prog"><div class="mini-bar" style="width:70px"><div class="mini-fill" style="width:${phPct}%;background:${phDone?'var(--green)':'var(--orange)'}"></div></div><span class="mini-count">${phPct}%</span></div><button class="btn btn-ghost btn-sm" data-action="export-phase" data-pid="${proj.id}" data-phid="${ph.id}" title="Εξαγωγή φάσης σε Excel" style="font-size:.7rem;padding:3px 8px">⬇ Excel</button>${canMod?`<button class="btn btn-ghost btn-sm" data-action="modal-edit-phase" data-pid="${proj.id}" data-phid="${ph.id}" style="font-size:.7rem;padding:3px 8px" title="Επεξεργασία φάσης">✏</button>`:''} ${canMod&&!isComp?`<button class="btn btn-secondary btn-sm" data-action="modal-add-task" data-pid="${proj.id}" data-phid="${ph.id}">+ Εργασία</button>`:''}</div></div>
      ${(()=>{const rs=ph.reviewStatus; const canReqRev=canMod&&['project_manager','team_member'].includes(state.cu?.role);
        if(isAdminOrMgmt&&rs==='pending') return `<div class="review-bar review-bar-pending phase-review-bar"><div class="review-bar-msg">📩 Η φάση <strong>${esc(ph.name)}</strong> χρειάζεται έλεγχο</div><div class="review-bar-acts"><button class="btn btn-primary btn-sm" onclick="resolvePhaseReview('${proj.id}','${ph.id}','approved')">✅ Αποδοχή</button><button class="btn btn-danger btn-sm" onclick="resolvePhaseReview('${proj.id}','${ph.id}','rejected')">❌ Απόρριψη</button></div></div>`;
        if(isAdminOrMgmt&&rs==='approved') return `<div class="review-bar review-bar-approved phase-review-bar">✅ Φάση Εγκρίθηκε</div>`;
        if(isAdminOrMgmt&&rs==='rejected') return `<div class="review-bar review-bar-rejected phase-review-bar">❌ Φάση Απορρίφθηκε</div>`;
        if(canReqRev&&phDone){
          if(!rs) return `<div class="review-bar phase-review-bar"><button class="btn btn-secondary btn-sm" onclick="requestPhaseReview('${proj.id}','${ph.id}')">📩 Αίτημα Ελέγχου Φάσης</button></div>`;
          if(rs==='pending') return `<div class="review-bar review-bar-pending phase-review-bar">⏳ Αναμονή Ελέγχου Φάσης από Διοίκηση…</div>`;
          if(rs==='approved') return `<div class="review-bar review-bar-approved phase-review-bar">✅ Φάση Εγκρίθηκε</div>`;
          if(rs==='rejected') return `<div class="review-bar review-bar-rejected phase-review-bar">❌ Φάση Απορρίφθηκε &nbsp;<button class="btn btn-secondary btn-sm" onclick="requestPhaseReview('${proj.id}','${ph.id}')">↩ Νέο Αίτημα</button></div>`;
        }
        return '';
      })()}
      <div class="phase-tasks">${tasksHtml||(cuEffectiveRole(proj.categoryId)==='team_member'?'<div class="text-sm text-muted" style="padding:12px 20px;font-style:italic">Δεν έχετε εργασίες σε αυτή τη φάση.</div>':'<div class="text-sm text-muted" style="padding:12px 20px">Δεν υπάρχουν εργασίες.</div>')}</div>
    </div>`;
  }).join('');

  return `
  <div class="case-detail-hd">
    <div class="cdh-mono" style="background:${cat?.bgLight||'rgba(255,255,255,.1)'};color:${cat?.color||'#fff'}">${init}</div>
    <div class="cdh-info"><div class="cdh-name">${esc(proj.name)}</div><div class="cdh-sub">${proj.code?esc(proj.code)+' · ':''}Πελάτης: ${esc(proj.clientName||'—')} · Υπεύθυνος: ${esc(mgrNames)}${proj.startDate?` · 📅 Έναρξη: ${fmt(proj.startDate)}`:''}${proj.endDate?` · 🏁 Λήξη: ${fmt(proj.endDate)}`:''}</div>
      <div style="margin-top:12px">${renderProjectProgressChart(proj, prog)}</div>
    </div>
    <div class="cdh-actions">${isComp?'<span class="badge badge-green" style="font-size:.75rem;padding:5px 12px">Ολοκληρωμένο</span>':'<span class="badge badge-orange" style="font-size:.75rem;padding:5px 12px">Σε Εξέλιξη</span>'}<button class="btn btn-secondary btn-sm" data-action="export-project" data-pid="${proj.id}" title="Εξαγωγή έργου σε Excel">⬇ Excel</button>${state.cu.role!=='client'?`<button class="btn btn-secondary btn-sm" data-action="project-to-template" data-pid="${proj.id}" title="Αποθήκευση ως Πρότυπο Έργου">📋 Σε Πρότυπο</button>`:''}<button class="btn ${state.ganttView?'btn-primary':'btn-secondary'} btn-sm" data-action="toggle-gantt" title="Gantt Chart">📊 Gantt</button>${canMod?`<button class="btn btn-secondary btn-sm" data-action="modal-edit-project" data-pid="${proj.id}" title="Επεξεργασία έργου">✏ Επεξεργασία</button><button class="btn btn-secondary btn-sm" data-action="apply-template-to-project" data-pid="${proj.id}" title="Εφαρμογή ή ενημέρωση προτύπου">📋 Πρότυπο</button>`:''}${canMod&&!isComp&&proj.clientId?`<button class="btn btn-secondary btn-sm" data-action="send-client-reminder" data-pid="${proj.id}" title="Αποστολή υπενθύμισης στον πελάτη">🔔 Υπενθύμιση</button>`:''}${canMod&&!isComp?`<button class="btn btn-secondary btn-sm" data-action="modal-add-phase" data-pid="${proj.id}">+ Φάση</button>`:''}${canMod?`<button class="btn btn-danger btn-sm" data-action="delete-project" data-pid="${proj.id}">Διαγραφή</button>`:''}</div>
  </div>
  ${state.ganttView ? renderGantt(proj) : `<div class="phases-list">${phases}</div>`}`;
}

// ── VIEW: USERS ───────────────────────────────────────────────────
function renderUsers() {
  if (!isAdmin()) return '<div class="empty-state"><h3>Δεν έχετε πρόσβαση</h3></div>';
  const onlineCount = state.db.users.filter(u => state.onlineUsers.has(u.id)).length;
  const rows = state.db.users.map(u => {
    const ri = ROLE_INFO[u.role] || {};
    const isOnline = state.onlineUsers.has(u.id);
    const hasProjRole = ['project_manager','team_member'].includes(u.role)
      || Object.values(u.categoryRoles||{}).some(r=>['project_manager','team_member'].includes(r));
    const catOverrides = Object.entries(u.categoryRoles||{})
      .map(([cid,r]) => { const cat=getCategory(cid); const ri2=ROLE_INFO[r]||{}; return cat?`${esc(cat.name)}: ${ri2.label||r}`:''; })
      .filter(Boolean).join(' · ');
    return `
    <div class="user-row">
      <div class="user-row-name">
        <div style="display:flex;align-items:center;gap:7px">
          ${isOnline?'<span class="presence-dot" title="Ενεργός τώρα"></span>':'<span class="presence-dot presence-dot-off" title="Εκτός σύνδεσης"></span>'}
          <span class="case-row-title">${esc(u.name)}</span>
        </div>
        ${catOverrides?`<div class="user-row-cats">${catOverrides}</div>`:''}
      </div>
      <div class="user-row-role"><span class="role-badge ${ri.cls}">${ri.label}</span></div>
      <div class="user-row-username text-sm text-muted">${esc(u.username)}</div>
      <div class="user-row-email text-sm text-muted">${esc(u.email||'—')}</div>
      <div class="user-row-lastlogin text-sm text-muted">${fmtDT(u.lastLogin||null)}</div>
      <div class="user-row-actions">
        ${hasProjRole?`<button class="btn btn-ghost btn-sm" data-action="modal-user-priority" data-uid="${u.id}" title="Σειρά προτεραιότητας">⇅</button>`:''}
        <button class="btn btn-ghost btn-sm" data-action="modal-edit-user" data-uid="${u.id}">Επεξ.</button>
        ${u.id!==state.cu?.id?`<button class="btn btn-danger btn-icon btn-sm" data-action="delete-user" data-uid="${u.id}">✕</button>`:'<div style="width:28px"></div>'}
      </div>
    </div>`;
  }).join('');
  return `
  <div class="page-hd">
    <div>
      <h1>Χρήστες</h1>
      <div class="page-hd-sub">
        ${state.db.users.length} χρήστες
        ${onlineCount ? `&nbsp;·&nbsp;<span style="color:var(--green);font-weight:600">● ${onlineCount} ενεργοί τώρα</span>` : ''}
      </div>
    </div>
    <div class="page-hd-actions"><button class="btn btn-primary" data-action="modal-add-user">+ Νέος Χρήστης</button></div>
  </div>
  <div class="users-table">
    <div class="users-table-head">
      <div>Χρήστης</div>
      <div>Ρόλος</div>
      <div>Username</div>
      <div>Email</div>
      <div>Τελευταία Είσοδος</div>
      <div></div>
    </div>
    ${rows}
  </div>`;
}

// ── VIEW: AUDIT ───────────────────────────────────────────────────
function renderAudit() {
  if (!isAdmin()) return '<div class="empty-state"><h3>Δεν έχετε πρόσβαση</h3></div>';
  const log=state.db.auditLog.slice(0,100);
  return `
  <div class="page-hd"><div><h1>Ιστορικό Αλλαγών</h1><div class="page-hd-sub">${log.length} εγγραφές</div></div><div class="page-hd-actions"><button class="btn btn-danger btn-sm" data-action="clear-audit">Εκκαθάριση</button></div></div>
  ${log.length?`<div class="audit-list">${log.map(e=>{const ri=ROLE_INFO[e.role]||{};return`<div class="audit-entry"><div class="audit-dot" style="background:${e.role==='admin'?'var(--orange)':e.role==='client'?'var(--blue)':'var(--slate-400)'}"></div><div class="audit-info"><div class="audit-action">${esc(e.action)}</div>${e.details?`<div class="audit-detail">${esc(e.details)}</div>`:''}<div class="audit-meta"><span class="role-badge ${ri.cls}" style="font-size:.58rem;padding:1px 7px">${ri.label}</span> ${esc(e.userName)} · ${fmtDT(e.timestamp)}</div></div></div>`;}).join('')}</div>`:'<div class="empty-state"><h3>Δεν υπάρχουν εγγραφές</h3></div>'}`;
}

// ── VIEW: CLIENT PORTAL ───────────────────────────────────────────
function renderClientPortal() {
  const projs=visibleProjects();
  const hdr=`<div class="client-header"><img src="logo.jpg" alt="B&E Solutions" onerror="this.style.display='none'" style="height:46px;object-fit:contain"><div style="margin-left:14px"><div style="font-weight:800;font-size:1rem;color:var(--navy)">Παρακολούθηση Έργου</div><div class="text-sm text-muted">Καλωσήρθατε, ${esc(state.cu.name)}</div></div><div style="margin-left:auto;display:flex;gap:8px;align-items:center"><button class="btn btn-ghost btn-sm" data-action="my-account">⚙ Λογαριασμός</button><button class="btn btn-ghost btn-sm" data-action="logout">Αποσύνδεση</button></div></div>`;
  if (!projs.length) return `<div class="client-wrap">${hdr}<div class="empty-state"><h3>Δεν βρέθηκαν έργα</h3></div></div>`;
  // Multi-project support: track selected project
  if (!state.clientProjectId || !projs.find(p=>p.id===state.clientProjectId)) state.clientProjectId=projs[0].id;
  const proj=projs.find(p=>p.id===state.clientProjectId)||projs[0]; const cat=getCategory(proj.categoryId); const mgrNames=projManagerNames(proj); const prog=projectProgress(proj);
  const projSelector=projs.length>1?`<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--navy-line)"><div style="font-size:.7rem;font-weight:700;color:var(--steel);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Επιλογή Έργου</div><div style="display:flex;flex-wrap:wrap;gap:6px">${projs.map(p=>{const pc=getCategory(p.categoryId);return`<button onclick="state.clientProjectId='${p.id}';render()" style="padding:7px 14px;font-size:.78rem;font-weight:700;border:1px solid ${p.id===proj.id?'var(--orange)':'var(--navy-line)'};background:${p.id===proj.id?'var(--orange)':'var(--white)'};color:${p.id===proj.id?'var(--white)':'var(--ink)'};cursor:pointer;border-radius:2px;transition:all .15s">${esc(p.name)}<span style="font-size:.65rem;opacity:.7;margin-left:5px">${esc(pc?.name||'')}</span></button>`;}).join('')}</div></div>`:'';
  const phases=(proj.phases||[]).map((ph,i)=>{const done=isPhaseComplete(ph);const unlocked=isPhaseUnlocked(proj,i);const phActive=ph.tasks.filter(t=>t.status!=='cancelled'&&t.status!=='not_required');const phPct=phActive.length===0?0:Math.round(phActive.filter(t=>t.status==='completed').length/phActive.length*100);
    return `<div class="client-phase${done?' cph-done':''}"><div class="client-phase-head"><div class="phase-num${done?' pn-done':unlocked?' pn-active':' pn-locked'}" style="width:30px;height:30px;font-size:.72rem">${done?'✓':i+1}</div><div><div style="font-weight:700;font-size:.88rem">${esc(ph.name)}</div><div class="text-sm text-muted">${ph.tasks.filter(t=>t.status!=='cancelled').length} εργασίες</div></div><div class="mini-prog" style="margin-left:auto"><div class="mini-bar" style="width:80px"><div class="mini-fill" style="width:${phPct}%;background:${done?'var(--green)':'var(--orange)'}"></div></div><span class="mini-count">${phPct}%</span></div></div>${ph.tasks.filter(t=>t.status!=='cancelled').map(t=>{const cst=CLIENT_STATUSES[t.status]||CLIENT_STATUSES.not_started;const statusColors={ts_ns:'#64748b','ts-ns':'#64748b','ts-ip':'#1d4ed8','ts-wc':'#b45309','ts-done':'#059669','ts-canc':'#dc2626'};const dotColor=t.status==='completed'?'var(--green)':t.status==='waiting_client'?'var(--amber)':'var(--blue)';const dp=taskDocProgress(t);const clientDocs=(t.docs||[]).filter(d=>d.type==='client');const pendDocs=clientDocs.filter(d=>!d.done&&d.required).length;const isExp=!!(state.clientExpanded||{})[t.id];const docsHtml=isExp?`<div class="client-task-docs">${clientDocs.length===0?'<div style="padding:8px 0;font-size:.75rem;color:var(--muted)">Δεν απαιτούνται έγγραφα από εσάς.</div>':clientDocs.map(d=>{if(d.done)return`<div class="client-doc-row client-doc-done"><span style="color:var(--green)">✓</span><span style="flex:1;font-size:.78rem">${esc(d.name)}</span><span style="font-size:.65rem;color:var(--muted)">${d.file?esc(d.file):''}</span></div>`;return`<div class="client-doc-row"><span style="color:var(--red);flex-shrink:0">✱</span><span style="flex:1;font-size:.78rem">${esc(d.name)}</span><label class="btn btn-primary btn-sm" style="cursor:pointer;flex-shrink:0">⬆ Ανέβασμα<input type="file" style="display:none" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onchange="clientUploadDoc('${d.id}','${t.id}','${proj.id}',this)"></label></div>`;}).join('')}</div>`:'';return`<div class="client-task" style="flex-direction:column;align-items:stretch;padding:10px 16px;gap:0"><div style="display:flex;align-items:center;gap:10px"><div class="task-status-dot" style="background:${dotColor};width:10px;height:10px;flex-shrink:0"></div><div style="flex:1"><div style="font-size:.82rem;font-weight:600">${esc(t.name)}</div><span class="task-status-badge ${cst.cls}" style="font-size:.62rem">${cst.label}</span></div>${pendDocs>0?`<span style="font-size:.72rem;color:var(--red);font-weight:700">${pendDocs} εκκρ.</span>`:''}<span class="text-sm text-muted">${dp.done}/${dp.total} έγγρ.</span>${clientDocs.length?`<button class="btn btn-ghost btn-sm" data-action="client-toggle-task" data-tid="${t.id}" style="padding:2px 6px;font-size:.7rem">${isExp?'▲':'▼'}</button>`:''}</div>${docsHtml}</div>`;}).join('')}</div>`;
  }).join('');
  return `<div class="client-wrap">${hdr}<div class="client-body">${projSelector}<div class="client-proj-title">${esc(proj.name)}</div><div class="client-proj-sub">${esc(cat?.name||'')}${mgrNames?' · Υπεύθυνος Έργου: '+esc(mgrNames):''}</div><div style="margin:16px 0"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span class="text-sm fw-700">Συνολική Πρόοδος</span><span class="text-sm fw-700">${prog.tasks.pct}%</span></div><div style="height:8px;background:var(--slate-200);border-radius:999px;overflow:hidden"><div style="height:100%;width:${prog.tasks.pct}%;background:${proj.status==='completed'?'var(--green)':'var(--orange)'};border-radius:999px;transition:width .4s"></div></div></div><div class="client-phases">${phases}</div></div></div>`;
}

function renderClientPortalFix8() {
  const projs=visibleProjects();
  const hdr=`<div class="client-header"><img src="logo.jpg" alt="B&E Solutions" onerror="this.style.display='none'" style="height:46px;object-fit:contain"><div style="margin-left:14px"><div style="font-weight:800;font-size:1rem;color:var(--navy)">Παρακολούθηση Έργου</div><div class="text-sm text-muted">Καλωσήρθατε, ${esc(state.cu.name)}</div></div><div style="margin-left:auto;display:flex;gap:8px;align-items:center"><button class="btn btn-ghost btn-sm" data-action="my-account">⚙ Λογαριασμός</button><button class="btn btn-ghost btn-sm" data-action="logout">Αποσύνδεση</button></div></div>`;
  if(!projs.length) return `<div class="client-wrap">${hdr}<div class="empty-state"><h3>Δεν βρέθηκαν έργα</h3></div></div>`;
  if(!state.clientProjectId||!projs.some(p=>p.id===state.clientProjectId)) state.clientProjectId=projs[0].id;
  const proj=projs.find(p=>p.id===state.clientProjectId)||projs[0];
  const cat=getCategory(proj.categoryId); const prog=projectProgress(proj);
  const deliveries=(state.db.clientDeliveries||[]).filter(d=>d.projectId===proj.id&&d.active!==false);
  const selector=projs.length>1?`<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--navy-line)"><div class="form-label">Επιλογή Έργου</div><div style="display:flex;flex-wrap:wrap;gap:6px">${projs.map(p=>`<button onclick="state.clientProjectId='${p.id}';render()" class="btn btn-sm ${p.id===proj.id?'btn-primary':'btn-ghost'}">${esc(p.name)}</button>`).join('')}</div></div>`:'';

  const phases=(proj.phases||[]).map((ph,i)=>{
    const done=isPhaseComplete(ph);
    const phActive=(ph.tasks||[]).filter(t=>t.status!=='cancelled'&&t.status!=='not_required');
    const phPct=phActive.length?Math.round(phActive.filter(t=>t.status==='completed').length/phActive.length*100):0;
    const tasks=(ph.tasks||[]).filter(t=>t.status!=='cancelled').map(t=>{
      const cst=CLIENT_STATUSES[t.status]||CLIENT_STATUSES.not_started;
      const requested=(t.docs||[]).filter(d=>d.type==='client');
      const delivered=deliveries.filter(d=>d.taskId===t.id);
      const pending=requested.filter(d=>!d.done&&d.required).length;
      const isExp=!!state.clientExpanded[t.id];
      const requestedHtml=requested.map(d=>d.done
        ? `<div class="client-doc-row client-doc-done"><span style="color:var(--green)">✓</span><span style="flex:1;font-size:.78rem">${esc(d.name)}</span><span class="text-sm text-muted">${esc(d.file||'')}</span></div>`
        : `<div class="client-doc-row"><span style="color:var(--red)">✱</span><span style="flex:1;font-size:.78rem">${esc(d.name)}</span><label class="btn btn-primary btn-sm" style="cursor:pointer">⬆ Ανέβασμα<input type="file" style="display:none" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" onchange="clientUploadDoc('${d.id}','${t.id}','${proj.id}',this)"></label></div>`
      ).join('');
      const deliveredHtml=delivered.map(d=>`<div class="client-doc-row client-doc-done"><span style="color:var(--blue)">📄</span><span style="flex:1"><strong style="font-size:.78rem">${esc(d.fileName||'Έγγραφο')}</strong><span class="text-sm text-muted" style="display:block">Παράδοση v${d.version} · ${fmtDT(d.publishedAt)}</span></span><button class="btn btn-secondary btn-sm" data-action="open-client-delivery" data-delivery-id="${d.id}">Προβολή</button><button class="btn btn-ghost btn-sm" data-action="download-client-delivery" data-delivery-id="${d.id}">Λήψη</button></div>`).join('');
      const docsHtml=isExp?`<div class="client-task-docs">${deliveredHtml?`<div class="form-label" style="margin-top:6px">Έγγραφα που σας παραδόθηκαν</div>${deliveredHtml}`:''}${requestedHtml?`<div class="form-label" style="margin-top:10px">Έγγραφα που ζητούνται από εσάς</div>${requestedHtml}`:''}${!deliveredHtml&&!requestedHtml?'<div class="text-sm text-muted" style="padding:8px 0">Δεν υπάρχουν έγγραφα.</div>':''}</div>`:'';
      const expandable=requested.length+delivered.length>0;
      return `<div class="client-task" style="flex-direction:column;align-items:stretch;padding:10px 16px;gap:0"><div style="display:flex;align-items:center;gap:10px"><div class="task-status-dot" style="background:${t.status==='completed'?'var(--green)':t.status==='waiting_client'?'var(--amber)':'var(--blue)'};width:10px;height:10px"></div><div style="flex:1"><div style="font-size:.82rem;font-weight:600">${esc(t.name)}</div><span class="task-status-badge ${cst.cls}" style="font-size:.62rem">${cst.label}</span></div>${pending?`<span style="font-size:.72rem;color:var(--red);font-weight:700">${pending} εκκρ.</span>`:''}${delivered.length?`<span class="badge badge-green" style="font-size:.58rem">${delivered.length} παραδόσεις</span>`:''}${expandable?`<button class="btn btn-ghost btn-sm" data-action="client-toggle-task" data-tid="${t.id}">${isExp?'▲':'▼'}</button>`:''}</div>${docsHtml}</div>`;
    }).join('');
    return `<div class="client-phase${done?' cph-done':''}"><div class="client-phase-head"><div class="phase-num${done?' pn-done':' pn-active'}" style="width:30px;height:30px;font-size:.72rem">${done?'✓':i+1}</div><div><div style="font-weight:700;font-size:.88rem">${esc(ph.name)}</div><div class="text-sm text-muted">${(ph.tasks||[]).filter(t=>t.status!=='cancelled').length} εργασίες</div></div><div class="mini-prog" style="margin-left:auto"><div class="mini-bar" style="width:80px"><div class="mini-fill" style="width:${phPct}%;background:${done?'var(--green)':'var(--orange)'}"></div></div><span class="mini-count">${phPct}%</span></div></div>${tasks}</div>`;
  }).join('');

  return `<div class="client-wrap">${hdr}<div class="client-body">${selector}<div class="client-proj-title">${esc(proj.name)}</div><div class="client-proj-sub">${esc(cat?.name||'')}${projManagerNames(proj)?' · Υπεύθυνος Έργου: '+esc(projManagerNames(proj)):''}</div><div style="margin:16px 0"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><span class="text-sm fw-700">Συνολική Πρόοδος</span><span class="text-sm fw-700">${prog.tasks.pct}%</span></div><div style="height:8px;background:var(--slate-200);border-radius:999px;overflow:hidden"><div style="height:100%;width:${prog.tasks.pct}%;background:${proj.status==='completed'?'var(--green)':'var(--orange)'}"></div></div></div>${deliveries.length?`<div style="padding:10px 12px;margin-bottom:14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;color:#1e40af;font-size:.78rem">🔐 Τα παραδοτέα ανοίγουν μόνο μέσα από τον συνδεδεμένο λογαριασμό σας.</div>`:''}<div class="client-phases">${phases}</div></div></div>`;
}

// ── VIEW: TIMESHEET ───────────────────────────────────────────────
function timesheetCategoryList() {
  const source = (state.db.timesheetCategories||[]).length
    ? state.db.timesheetCategories
    : (state.db.categories||[]).map(c=>({id:c.id,name:c.name}));
  return [...source]
    .filter(c=>c?.id && c?.name)
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','el',{sensitivity:'base'}));
}

function getTimesheetCategory(categoryId) {
  return timesheetCategoryList().find(c=>c.id===categoryId) || null;
}

function buildTimesheetCategoryOptions(selectedId='', allowBlank=true) {
  const cats=timesheetCategoryList();
  let html=allowBlank ? `<option value="">— Επιλογή —</option>` : '';
  html += cats.map(c=>`<option value="${c.id}" ${c.id===selectedId?'selected':''}>${esc(c.name)}</option>`).join('');
  return html;
}

function timesheetProjectName(entry) {
  const proj=getProject(entry?.projectId);
  return proj?.name || entry?.projectName || '';
}

function timesheetCategoryName(entry) {
  const live=getTimesheetCategory(entry?.projectCategoryId);
  return live?.name || entry?.projectCategoryName || '';
}

window.hydrateTimesheetCategorySelect = function(sel, selectedId='') {
  if(!sel || sel.dataset.hydrated==='1') return;
  sel.innerHTML=buildTimesheetCategoryOptions(selectedId,true);
  sel.value=selectedId||'';
  sel.dataset.hydrated='1';
};

window.setTimesheetCategory = async function(entryId, categoryId) {
  const entry=(state.db.timesheets||[]).find(e=>e.id===entryId);
  if(!entry) return;
  const cu=state.cu;
  const canEdit=['admin','management'].includes(cu?.role) || entry.userId===cu?.id;
  if(!canEdit){
    showToast('Δεν έχετε δικαίωμα αλλαγής αυτής της εγγραφής.','error');
    render();
    return;
  }

  const cat=categoryId ? getTimesheetCategory(categoryId) : null;
  entry.projectCategoryId=cat?.id || null;
  entry.projectCategoryName=cat?.name || null;

  try{
    await dbSaveTimesheet(entry);
    showToast(cat ? `Είδος έργου: ${cat.name}` : 'Το είδος έργου έμεινε κενό.','success');
  }catch(err){
    console.error(err);
    await loadFromDB().catch(()=>{});
    render();
  }
};

window.syncTsCategoryFromProject = function(prefix) {
  const projectId=el(prefix+'-projectId')?.value;
  const select=el(prefix+'-categoryId');
  if(!select) return;
  const proj=getProject(projectId);
  const categoryId=proj?.categoryId || '';
  select.value=getTimesheetCategory(categoryId) ? categoryId : '';
};

window.setTimesheetSort = function(key) {
  if(!['date','project'].includes(key)) return;
  if(state.tsSortKey===key){
    state.tsSortDir=state.tsSortDir==='asc'?'desc':'asc';
  }else{
    state.tsSortKey=key;
    state.tsSortDir=key==='date'?'desc':'asc';
  }
  state.tsPage=1;
  if(isSupabaseAuthMode()) loadTimesheetPage(1); else render();
};

function ensureTimesheetLayoutStyle() {
  if(document.getElementById('be-timesheet-layout-style')) return;
  const style=document.createElement('style');
  style.id='be-timesheet-layout-style';
  style.textContent=`
    .page-content.ts-fullwidth-page{
      max-width:none !important;
      width:100% !important;
      box-sizing:border-box;
      padding-left:16px;
      padding-right:16px;
    }
    .ts-table-wrap.ts-fluid-wrap{
      width:100%;
      overflow-x:auto;
    }
    .ts-table.ts-fluid-table{
      width:100%;
      table-layout:fixed;
      border-collapse:collapse;
    }
    .ts-table.ts-fluid-table th{
      padding:7px 8px;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .ts-table.ts-fluid-table td{
      padding:6px 8px;
      line-height:1.22;
      overflow:hidden;
    }
    .ts-two-line{
      display:-webkit-box;
      -webkit-box-orient:vertical;
      -webkit-line-clamp:2;
      line-clamp:2;
      overflow:hidden;
      line-height:1.22;
      max-height:2.44em;
      word-break:break-word;
    }
    .ts-category-select{
      width:100%;
      min-width:0;
      height:30px;
      padding:4px 22px 4px 6px;
      font-size:.72rem;
      text-overflow:ellipsis;
    }
    .ts-actions-cell{
      display:flex;
      gap:3px;
      justify-content:flex-end;
      align-items:center;
      white-space:nowrap;
    }
    @media(max-width:900px){
      .ts-table.ts-fluid-table{min-width:900px;}
      .page-content.ts-fullwidth-page{padding-left:10px;padding-right:10px;}
    }
  `;
  document.head.appendChild(style);
}

function renderTimesheet() {
  ensureTimesheetLayoutStyle();
  if(!state.cu || state.cu.role==='client') return '<div class="empty-state"><h3>Δεν έχετε πρόσβαση</h3></div>';
  const cu=state.cu;
  const isAdminOrMgmt=['admin','management'].includes(cu.role);

  if(isSupabaseAuthMode() && !state.tsLoaded){
    return `<div class="page-hd"><div><h1>Timesheet</h1><div class="page-hd-sub">Φόρτωση δεδομένων...</div></div></div>
      <div style="padding:48px 20px;text-align:center;color:var(--muted);font-size:.9rem">Φόρτωση των πρώτων 100 εγγραφών…</div>`;
  }

  const filterUser=state.tsFilterUser||'';
  const filterProj=state.tsFilterProj||'';
  const filterFrom=state.tsFilterFrom||'';
  const filterTo=state.tsFilterTo||'';
  const sortKey=state.tsSortKey||'date';
  const sortDir=state.tsSortDir||'desc';
  const pageSize=100;
  let page=state.tsPage||1;
  let entries=[...(state.db.timesheets||[])];
  let totalCount=0,totalHours=0;

  if(isSupabaseAuthMode()){
    totalCount=Number(state.tsTotalCount||0);
    totalHours=Number(state.tsTotalHours||0);
  }else{
    if(!isAdminOrMgmt) entries=entries.filter(e=>e.userId===cu.id);
    if(filterUser) entries=entries.filter(e=>e.userId===filterUser);
    if(filterProj) entries=entries.filter(e=>e.projectId===filterProj);
    if(filterFrom) entries=entries.filter(e=>e.date>=filterFrom);
    if(filterTo) entries=entries.filter(e=>e.date<=filterTo);
    const collator=new Intl.Collator('el',{sensitivity:'base',numeric:true});
    const dir=sortDir==='asc'?1:-1;
    entries.sort((a,b)=>{
      if(sortKey==='project'){
        const p=collator.compare(timesheetProjectName(a),timesheetProjectName(b));
        if(p!==0) return p*dir;
        return String(b.date||'').localeCompare(String(a.date||''));
      }
      const d=String(a.date||'').localeCompare(String(b.date||''));
      if(d!==0) return d*dir;
      return String(a.timeFrom||'').localeCompare(String(b.timeFrom||''))*dir;
    });
    totalCount=entries.length;
    totalHours=entries.reduce((s,e)=>s+(parseFloat(e.hours)||0),0);
    const maxPage=Math.max(1,Math.ceil(totalCount/pageSize));
    page=Math.min(page,maxPage); state.tsPage=page;
    entries=entries.slice((page-1)*pageSize,page*pageSize);
  }

  const totalPages=Math.max(1,Math.ceil(totalCount/pageSize));
  const rangeFrom=totalCount?((page-1)*pageSize)+1:0;
  const rangeTo=totalCount?Math.min(page*pageSize,totalCount):0;
  const hasFilter=filterUser||filterProj||filterFrom||filterTo;

  const userOpts=isAdminOrMgmt?`<select class="form-control" style="max-width:165px;font-size:.79rem" onchange="setTimesheetFilter('user',this.value)">
    <option value="">Όλοι οι χρήστες</option>${sortByName(state.db.users.filter(u=>u.role!=='client')).map(u=>`<option value="${u.id}" ${filterUser===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select>`:'';

  const myProjects=isAdminOrMgmt?state.db.projects:visibleProjects();
  const standingProjs=getStandingProjects();
  const regularProjs=sortByCode(myProjects.filter(p=>!p.standing));
  const filterOpt=p=>`<option value="${p.id}" ${filterProj===p.id?'selected':''}>${p.code?esc(p.code+' – '+p.name):esc(p.name)}</option>`;
  const projOpts=`<select class="form-control" style="max-width:215px;font-size:.79rem" onchange="setTimesheetFilter('project',this.value)">
    <option value="">Όλα τα έργα</option>${standingProjs.length?`<optgroup label="── Μόνιμα Έργα ──">${standingProjs.map(filterOpt).join('')}</optgroup>`:''}<optgroup label="── Τρέχοντα Έργα ──">${regularProjs.map(filterOpt).join('')}</optgroup></select>`;

  const dateOpts=`<div style="display:flex;align-items:center;gap:5px;flex-wrap:nowrap"><span style="font-size:.76rem;color:var(--muted)">Από</span>
    <input type="date" class="form-control" style="max-width:136px;font-size:.78rem" value="${filterFrom}" onchange="setTimesheetFilter('from',this.value)">
    <span style="font-size:.76rem;color:var(--muted)">Έως</span><input type="date" class="form-control" style="max-width:136px;font-size:.78rem" value="${filterTo}" onchange="setTimesheetFilter('to',this.value)"></div>`;

  const sortArrow=key=>sortKey!==key?'<span style="opacity:.35;margin-left:3px">↕</span>':`<span style="margin-left:3px">${sortDir==='asc'?'▲':'▼'}</span>`;

  // Target proportions: 100 / 160 / 300 / 120 / 75 / 300 / 70 / 100 / 90.
  const colgroup=isAdminOrMgmt?`<colgroup>
    <col style="width:7.60%"><col style="width:12.17%"><col style="width:22.81%"><col style="width:9.13%"><col style="width:5.70%"><col style="width:22.81%"><col style="width:5.32%"><col style="width:7.60%"><col style="width:6.84%">
    </colgroup>`:`<colgroup><col style="width:8.66%"><col style="width:25.97%"><col style="width:10.39%"><col style="width:6.49%"><col style="width:25.97%"><col style="width:6.06%"><col style="width:8.66%"><col style="width:7.79%"></colgroup>`;

  const rows=entries.map(e=>{
    const canEdit=isAdminOrMgmt||e.userId===cu.id;
    const timeRange=e.timeFrom&&e.timeTo?`<div style="font-size:.68rem;color:var(--muted);margin-top:2px">${esc(e.timeFrom)}–${esc(e.timeTo)}</div>`:'';
    const projectName=timesheetProjectName(e)||'—';
    const categoryName=timesheetCategoryName(e);
    const categoryCell=canEdit?`<select class="form-control ts-category-select" data-hydrated="0" title="${esc(categoryName||'Επιλογή Είδους Έργου')}" onfocus="hydrateTimesheetCategorySelect(this,'${esc(e.projectCategoryId||'')}')" onchange="setTimesheetCategory('${e.id}',this.value)"><option value="${esc(e.projectCategoryId||'')}" selected>${esc(categoryName||'—')}</option></select>`:`<div class="ts-two-line" title="${esc(categoryName||'')}">${esc(categoryName||'—')}</div>`;
    return `<tr><td style="font-size:.76rem;white-space:nowrap">${esc(e.date)}${timeRange}</td>${isAdminOrMgmt?`<td style="font-size:.76rem"><div class="ts-two-line" title="${esc(e.userName||'')}">${esc(e.userName||'—')}</div></td>`:''}<td style="font-size:.76rem"><div class="ts-two-line" title="${esc(projectName)}">${esc(projectName)}</div></td><td>${categoryCell}</td><td style="font-size:.76rem;font-weight:700;color:var(--navy);text-align:center">${parseFloat(e.hours||0).toFixed(1)}h</td><td style="font-size:.74rem;color:var(--muted)"><div class="ts-two-line" title="${esc(e.desc||'')}">${esc(e.desc||'—')}</div></td><td style="font-size:.75rem;text-align:center;color:var(--navy);white-space:nowrap">${e.km?`${e.km} χλμ.`:'—'}</td><td style="font-size:.72rem;color:var(--muted)"><div class="ts-two-line" title="${esc(e.comments||'')}">${esc(e.comments||'—')}</div></td><td><div class="ts-actions-cell">${canEdit?`<button class="btn btn-ghost btn-sm" data-action="modal-edit-timesheet" data-eid="${e.id}">✏</button>`:''}${canEdit?`<button class="btn btn-danger btn-icon btn-sm" data-action="delete-timesheet" data-eid="${e.id}">✕</button>`:''}</div></td></tr>`;
  }).join('');

  const pagebar=`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;padding:8px 2px 2px;flex-wrap:wrap"><div style="font-size:.78rem;color:var(--muted)">${rangeFrom}–${rangeTo} από ${totalCount.toLocaleString('el-GR')} εγγραφές · σύνολο φίλτρου <strong>${totalHours.toFixed(1)}h</strong></div><div style="display:flex;gap:6px;align-items:center"><button class="btn btn-ghost btn-sm" onclick="goTimesheetPage(${page-1})" ${page<=1?'disabled':''}>‹ Προηγούμενη</button><span style="font-size:.78rem;color:var(--muted);min-width:90px;text-align:center">Σελίδα ${page} / ${totalPages}</span><button class="btn btn-ghost btn-sm" onclick="goTimesheetPage(${page+1})" ${page>=totalPages?'disabled':''}>Επόμενη ›</button></div></div>`;

  return `<div class="page-hd"><div><h1>Timesheet</h1><div class="page-hd-sub">${rangeFrom}–${rangeTo} από <strong>${totalCount.toLocaleString('el-GR')}</strong> εγγραφές</div></div><div class="page-hd-actions">${isAdminOrMgmt?`<button class="btn btn-ghost btn-sm" data-action="modal-manage-standing" style="font-size:.78rem">⚙ Μόνιμα Έργα</button>`:''}${isAdminOrMgmt?`<button class="btn btn-ghost btn-sm" data-action="modal-billing" style="font-size:.78rem">📊 Κοστολόγηση</button>`:''}<button class="btn btn-primary" data-action="modal-add-timesheet">+ Καταχώρηση</button></div></div><div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px;align-items:center">${userOpts}${projOpts}${dateOpts}${hasFilter?`<button class="btn btn-ghost btn-sm" onclick="clearTimesheetFilters()">✕ Καθαρισμός</button>`:''}${state.tsLoading?`<span style="font-size:.76rem;color:var(--muted)">Φόρτωση…</span>`:''}</div><div class="ts-table-wrap ts-fluid-wrap"><table class="ts-table ts-fluid-table">${colgroup}<thead><tr><th onclick="setTimesheetSort('date')" style="cursor:pointer;user-select:none">Ημερομηνία${sortArrow('date')}</th>${isAdminOrMgmt?'<th>Χρήστης</th>':''}<th onclick="setTimesheetSort('project')" style="cursor:pointer;user-select:none">Έργο${sortArrow('project')}</th><th>Είδος Έργου</th><th style="text-align:center">Ώρες</th><th>Περιγραφή</th><th style="text-align:center">Χλμ.</th><th>Σχόλια</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="${isAdminOrMgmt?9:8}" style="text-align:center;padding:24px;color:var(--steel);font-size:.82rem">Δεν υπάρχουν εγγραφές.</td></tr>`}</tbody></table></div>${pagebar}`;
}

// ── VIEW: CALENDAR ────────────────────────────────────────────────
function _calMondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return d.toISOString().slice(0, 10);
}

function _calToggle() {
  const vm = state.calViewMode || 'month';
  return `<div class="cal-view-toggle">
    <button data-action="cal-view-month" class="${vm==='month'?'cvt-active':''}">Μήνας</button>
    <button data-action="cal-view-week"  class="${vm==='week' ?'cvt-active':''}">Εβδομάδα</button>
    <button data-action="cal-view-day"   class="${vm==='day'  ?'cvt-active':''}">Ημέρα</button>
  </div>`;
}

function _calLegend() {
  return '';
}

function renderCalendar() {
  if (!state.cu || state.cu.role === 'client') return '<div class="empty-state"><h3>Δεν έχετε πρόσβαση</h3></div>';
  const vm = state.calViewMode || 'month';
  if (vm === 'week') return _renderCalWeek();
  if (vm === 'day')  return _renderCalDay();
  return _renderCalMonth();
}

// Palette for phase bars (cycles if more phases than colors)
const PHASE_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16'];

function _datesBetween(startStr, endStr) {
  // Returns array of 'YYYY-MM-DD' strings inclusive
  const out = [];
  const s = new Date(startStr), e = new Date(endStr);
  if (isNaN(s)||isNaN(e)||s>e) return out;
  for (let d=new Date(s); d<=e; d.setDate(d.getDate()+1)) out.push(d.toISOString().slice(0,10));
  return out;
}

function _renderCalMonth() {
  const now = new Date();
  const year  = state.calYear  !== null ? state.calYear  : now.getFullYear();
  const month = state.calMonth !== null ? state.calMonth : now.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7;
  const todayStr = today();
  const monthPrefix = `${year}-${String(month+1).padStart(2,'0')}-`;

  // Build phasesByDay: day -> [{ph, proj, color}]
  const phasesByDay = {};
  let phColorIdx = 0;
  const phColorMap = {}; // ph.id -> color
  visibleProjects().forEach(proj => {
    (proj.phases||[]).forEach(ph => {
      const _phPD = phasePlannedDates(ph);
      if (!_phPD.start || !_phPD.end) return;
      if (!phColorMap[ph.id]) { phColorMap[ph.id] = PHASE_COLORS[phColorIdx++ % PHASE_COLORS.length]; }
      const color = phColorMap[ph.id];
      _datesBetween(_phPD.start, _phPD.end).forEach(ds => {
        if (!ds.startsWith(monthPrefix)) return;
        const day = parseInt(ds.slice(8), 10);
        if (!phasesByDay[day]) phasesByDay[day] = [];
        phasesByDay[day].push({ph, proj, color, isFirst: ds===_phPD.start, isLast: ds===_phPD.end});
      });
    });
  });

  // Build tasksByDay: day -> [{task, proj}]  (tasks appear on each day they span)
  const tasksByDay = {};
  visibleProjects().forEach(proj => {
    (proj.phases||[]).forEach(ph => {
      (ph.tasks||[]).forEach(t => {
        if (t.status==='cancelled') return;
        // Determine date range to show task
        const ts = t.plannedStart || t.startDate;
        const te = t.plannedEnd || t.startDate;
        if (!te) return;
        const dates = ts && ts < te ? _datesBetween(ts, te) : [te];
        dates.forEach(ds => {
          if (!ds.startsWith(monthPrefix)) return;
          const day = parseInt(ds.slice(8), 10);
          if (!tasksByDay[day]) tasksByDay[day] = [];
          // Avoid duplicate entries for the same task
          if (!tasksByDay[day].some(x=>x.task.id===t.id)) tasksByDay[day].push({task:t, proj});
        });
      });
    });
  });

  const monthName = firstDay.toLocaleDateString('el-GR',{month:'long',year:'numeric'});
  const dayNames  = ['Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ','Κυρ'];

  let cells = dayNames.map(d=>`<div class="cal-day-name">${d}</div>`).join('');
  for (let i=0;i<startDow;i++) cells+=`<div class="cal-cell cal-empty"></div>`;
  for (let day=1;day<=lastDay.getDate();day++) {
    const dateStr=`${monthPrefix}${String(day).padStart(2,'0')}`;
    const isToday=dateStr===todayStr;
    const isWeekend=((startDow+day-1)%7)>=5;
    const dayPhases=phasesByDay[day]||[];
    const dayTasks=tasksByDay[day]||[];
    const totalItems=dayPhases.length+dayTasks.length;

    // Phase bars (show up to 2)
    const phaseBars = dayPhases.slice(0,2).map(({ph, proj, color, isFirst, isLast}) => {
      const nm = isFirst ? (ph.name.length>14?ph.name.slice(0,13)+'…':ph.name) : '';
      return `<div class="cal-phase-bar" data-action="open-project" data-pid="${proj.id}" style="background:${color}20;border-left:3px solid ${color}" title="${esc(ph.name)} · ${esc(proj.name)}">${nm?`<span style="color:${color};font-weight:700">${esc(nm)}</span>`:''}</div>`;
    }).join('');

    // Task pills (show up to 2, after phases)
    const maxTasks = dayPhases.length >= 2 ? 0 : 2 - dayPhases.length;
    const pills=dayTasks.slice(0,maxTasks).map(({task,proj})=>{
      const st=TASK_STATUSES[task.status]||TASK_STATUSES.not_started;
      const nm=task.name.length>16?task.name.slice(0,15)+'…':task.name;
      const pn=proj.name.length>13?proj.name.slice(0,12)+'…':proj.name;
      const timeLabel=task.startTime?`<span style="font-size:.55rem;opacity:.7"> ${task.startTime}</span>`:'';
      return `<div class="cal-task ${st.cls}" data-action="open-project" data-pid="${proj.id}" title="${esc(task.name)} · ${esc(proj.name)}">${esc(nm)}${timeLabel}<span class="cal-task-proj">${esc(pn)}</span></div>`;
    }).join('');
    const more=totalItems>2?`<div class="cal-more">+${totalItems-2} ακόμα</div>`:'';
    cells+=`<div class="cal-cell${isToday?' cal-today':''}${isWeekend?' cal-weekend':''}"><div class="cal-day-num">${day}${totalItems>0?`<span class="cal-day-badge">${totalItems}</span>`:''}</div>${phaseBars}${pills}${more}</div>`;
  }

  return `
  <div class="page-hd">
    <div><h1>Ημερολόγιο</h1><div class="page-hd-sub">Μηνιαία προβολή</div></div>
    <div class="page-hd-actions" style="gap:8px;align-items:center;flex-wrap:wrap">
      ${_calToggle()}
      <div class="cal-nav">
        <button class="btn btn-ghost btn-sm" data-action="cal-prev">‹</button>
        <span class="cal-nav-label">${monthName}</span>
        <button class="btn btn-ghost btn-sm" data-action="cal-next">›</button>
      </div>
      <button class="btn btn-secondary btn-sm" data-action="cal-today">Σήμερα</button>
    </div>
  </div>
  <div class="cal-grid">${cells}</div>
  ${_calLegend()}`;
}

function ensureCalWeekWorkdaysStyle() {
  if (document.getElementById('be-cal-week-workdays-style')) return;
  const style = document.createElement('style');
  style.id = 'be-cal-week-workdays-style';
  style.textContent = `
    .cal-week-grid.cal-week-workdays {
      grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
      gap: 8px;
    }
    .cal-week-grid.cal-week-workdays .cal-week-col {
      min-width: 0;
    }
    @media (max-width: 1000px) {
      .cal-week-grid.cal-week-workdays {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
    }
    @media (max-width: 640px) {
      .cal-week-grid.cal-week-workdays {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function _renderCalWeek() {
  ensureCalWeekWorkdaysStyle();

  const monStr = _calMondayOf(state.calWeekStart);
  const mon = new Date(monStr);

  // Weekly view intentionally contains WORKDAYS ONLY: Monday–Friday.
  const days = Array.from({length:5}, (_,i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate()+i);
    return d;
  });

  const weekDateStrs = days.map(d=>d.toISOString().slice(0,10));
  const weekDatesSet = new Set(weekDateStrs);
  const todayStr = today();

  // Tasks by workday. Multi-day tasks are shown only on Monday–Friday,
  // because Saturday/Sunday do not exist in this weekly view.
  const tasksByDate = {};
  visibleProjects().forEach(proj => {
    (proj.phases||[]).forEach(ph => {
      (ph.tasks||[]).forEach(t => {
        if (t.status==='cancelled') return;

        const ts = t.plannedStart || t.startDate;
        const te = t.plannedEnd || t.startDate;
        if (!te) return;

        const dates = ts && ts < te ? _datesBetween(ts, te) : [te];
        dates.forEach(ds => {
          if (!weekDatesSet.has(ds)) return;
          if (!tasksByDate[ds]) tasksByDate[ds] = [];
          if (!tasksByDate[ds].some(x=>x.task.id===t.id)) {
            tasksByDate[ds].push({task:t, proj});
          }
        });
      });
    });
  });

  const dayNamesLong = ['Δευτέρα','Τρίτη','Τετάρτη','Πέμπτη','Παρασκευή'];
  const fromStr = days[0].toLocaleDateString('el-GR',{day:'numeric',month:'short'});
  const toStr   = days[4].toLocaleDateString('el-GR',{day:'numeric',month:'short',year:'numeric'});

  const cols = days.map((d,i) => {
    const dateStr = weekDateStrs[i];
    const isToday = dateStr===todayStr;

    const dayTasks = (tasksByDate[dateStr]||[])
      .slice()
      .sort((a,b)=>(a.task.startTime||'').localeCompare(b.task.startTime||''));

    const cards = dayTasks.map(({task,proj}) => {
      const st = TASK_STATUSES[task.status] || TASK_STATUSES.not_started;

      // startTime/endTime represent the planned working time for this day.
      const timeRange = task.startTime
        ? `<div class="cwc-time">⏰ ${task.startTime}${task.endTime?' – '+task.endTime:''}</div>`
        : '';

      return `<div class="cwc"
          data-action="open-project"
          data-pid="${proj.id}"
          style="border-left-color:${st.color}"
          title="${esc(task.name)}">
        <div class="cwc-name">${esc(task.name)}</div>
        ${timeRange}
        <div class="cwc-proj">📁 ${esc(proj.name)}</div>
        <span class="task-status-badge ${st.cls}"
          style="font-size:.58rem;margin-top:5px;display:inline-block">${st.label}</span>
      </div>`;
    }).join('');

    return `<div class="cal-week-col">
      <div class="cal-week-head${isToday?' cwh-today':''}">
        <div class="cwh-name">${dayNamesLong[i]}</div>
        <div class="cwh-date${isToday?' cwh-date-today':''}">${d.getDate()}</div>
      </div>
      <div class="cal-week-tasks">
        ${cards || '<div class="cwc-empty">—</div>'}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="page-hd">
    <div>
      <h1>Ημερολόγιο</h1>
      <div class="page-hd-sub">Εβδομαδιαία προβολή · Δευτέρα–Παρασκευή</div>
    </div>
    <div class="page-hd-actions" style="gap:8px;align-items:center;flex-wrap:wrap">
      ${_calToggle()}
      <div class="cal-nav">
        <button class="btn btn-ghost btn-sm" data-action="cal-prev">‹</button>
        <span class="cal-nav-label">${fromStr} – ${toStr}</span>
        <button class="btn btn-ghost btn-sm" data-action="cal-next">›</button>
      </div>
      <button class="btn btn-secondary btn-sm" data-action="cal-today">Σήμερα</button>
    </div>
  </div>
  <div class="cal-week-grid cal-week-workdays">${cols}</div>
  ${_calLegend(false)}`;
}

function ensureCompactDayCalendarStyle() {
  if(document.getElementById('be-cal-day-compact-style')) return;
  const style=document.createElement('style');
  style.id='be-cal-day-compact-style';
  style.textContent=`
    .cal-day-card.cal-day-card-compact{
      padding:8px 10px;
    }
    .cal-day-mainline{
      display:flex;
      align-items:center;
      gap:8px;
      min-width:0;
      flex-wrap:nowrap;
      font-size:.78rem;
    }
    .cal-day-mainline .cal-day-path{
      min-width:0;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      font-weight:650;
      flex:1 1 auto;
    }
    .cal-day-inline-meta{
      white-space:nowrap;
      color:var(--muted);
      font-size:.74rem;
      flex:0 0 auto;
    }
    .cal-day-subtask-lines{
      margin-top:5px;
      padding-top:5px;
      border-top:1px solid var(--slate-100);
      display:flex;
      flex-wrap:wrap;
      gap:3px 10px;
      font-size:.72rem;
      color:var(--slate-600);
    }
    .cal-day-subtask-item{
      white-space:normal;
    }
    @media(max-width:900px){
      .cal-day-mainline{flex-wrap:wrap;}
      .cal-day-mainline .cal-day-path{flex-basis:100%;}
    }
  `;
  document.head.appendChild(style);
}

function _renderCalDay() {
  ensureCompactDayCalendarStyle();

  const dateStr=state.calDayDate||today();
  const d=new Date(dateStr);
  const todayStr=today();
  const isToday=dateStr===todayStr;

  const dayTasks=[];
  visibleProjects().forEach(proj=>{
    (proj.phases||[]).forEach(ph=>{
      (ph.tasks||[]).forEach(t=>{
        if(t.status==='cancelled') return;
        const ts=t.plannedStart||t.startDate;
        const te=t.plannedEnd||t.startDate;
        if(!te) return;
        const inRange=ts&&ts<te ? (dateStr>=ts&&dateStr<=te) : te===dateStr;
        if(inRange) dayTasks.push({task:t,proj,ph});
      });
    });
  });

  const timedTasks=dayTasks.filter(x=>x.task.startTime)
    .sort((a,b)=>a.task.startTime.localeCompare(b.task.startTime));
  const untimedTasks=dayTasks.filter(x=>!x.task.startTime);

  const dayNameLong=d.toLocaleDateString('el-GR',{
    weekday:'long',day:'numeric',month:'long',year:'numeric'
  });

  const taskCard=({task,proj,ph})=>{
    const st=TASK_STATUSES[task.status]||TASK_STATUSES.not_started;
    const assignee=task.assigneeId ? (state.db.users||[]).find(u=>u.id===task.assigneeId) : null;

    const timeText=task.startTime
      ? `⏰ ${task.startTime}${task.endTime?'–'+task.endTime:''}`
      : (task.plannedStart&&task.plannedEnd&&task.plannedStart!==task.plannedEnd
          ? `📅 ${task.plannedStart}→${task.plannedEnd}` : '');

    const subtaskItems=(task.subtasks||[]).map((s,i)=>
      `<span class="cal-day-subtask-item">${i+1}. ${s.done?'✓ ':''}${esc(s.name)}</span>`
    ).join('');

    return `<div class="cal-day-card cal-day-card-compact"
        data-action="open-project"
        data-pid="${proj.id}"
        style="border-left:4px solid ${st.color}"
        title="${esc(task.name)}">
      <div class="cal-day-mainline">
        <span class="cal-day-path">📁 ${esc(proj.name)} › ${esc(ph.name)}</span>
        ${timeText?`<span class="cal-day-inline-meta">${timeText}</span>`:''}
        ${assignee?`<span class="cal-day-inline-meta">👤 ${esc(assignee.name)}</span>`:''}
        <span class="task-status-badge ${st.cls}" style="font-size:.6rem;flex:0 0 auto">${st.label}</span>
      </div>
      ${subtaskItems?`<div class="cal-day-subtask-lines">${subtaskItems}</div>`:''}
    </div>`;
  };

  const timeGrid=timedTasks.length ? `<div class="cdd-timegrid">
    <div class="cdd-tg-label">Προγραμματισμένες εργασίες</div>
    ${timedTasks.map(x=>taskCard(x)).join('')}
  </div>`:'';

  const untimedGrid=untimedTasks.length ? `<div class="cdd-untimed">
    ${timedTasks.length?'<div class="cdd-tg-label" style="margin-top:12px">Χωρίς συγκεκριμένη ώρα</div>':''}
    ${untimedTasks.map(x=>taskCard(x)).join('')}
  </div>`:'';

  const empty=!dayTasks.length
    ? `<div class="cal-day-empty"><div class="es-icon">📅</div><p>Δεν υπάρχουν εργασίες για αυτή την ημέρα.</p></div>`
    :'';

  return `
  <div class="page-hd">
    <div><h1>Ημερολόγιο</h1><div class="page-hd-sub${isToday?' cal-day-today-label':''}">Ημερήσια προβολή${isToday?' · Σήμερα':''}</div></div>
    <div class="page-hd-actions" style="gap:8px;align-items:center;flex-wrap:wrap">
      ${_calToggle()}
      <div class="cal-nav">
        <button class="btn btn-ghost btn-sm" data-action="cal-prev">‹</button>
        <span class="cal-nav-label">${dayNameLong}</span>
        <button class="btn btn-ghost btn-sm" data-action="cal-next">›</button>
      </div>
      <button class="btn btn-secondary btn-sm" data-action="cal-today">Σήμερα</button>
    </div>
  </div>
  ${timeGrid}${untimedGrid}${empty}`;
}

// ── VIEW: TEMPLATES ───────────────────────────────────────────────
function renderTemplates() {
  if (!canViewTemplates()) return '<div class="empty-state"><h3>Δεν έχετε πρόσβαση</h3></div>';
  const mgmt = canManageTemplates();
  const tpls = state.db.templates || [];
  const cards = tpls.map(tpl => {
    const phCount = (tpl.phases||[]).length;
    const taskCount = (tpl.phases||[]).reduce((s,ph)=>s+(ph.tasks||[]).length, 0);
    return `<div class="project-card" style="cursor:pointer" data-action="open-template" data-tid="${tpl.id}">
      <div class="project-card-accent" style="background:var(--orange)"></div>
      <div class="project-card-body">
        <div class="project-monogram" style="background:#fff3e6;color:var(--orange)">📋</div>
        <div class="project-card-name">${esc(tpl.name)}</div>
        <div class="project-card-desc">${esc(tpl.desc||'—')}</div>
      </div>
      <div class="project-card-stats">
        <div class="pstat"><div class="pstat-num">${phCount}</div><div class="pstat-label">Φάσεις</div></div>
        <div class="pstat"><div class="pstat-num" style="color:var(--orange)">${taskCount}</div><div class="pstat-label">Εργασίες</div></div>
      </div>
      ${mgmt ? `<div class="project-card-footer" style="justify-content:flex-end;gap:8px">
        <button class="btn btn-ghost btn-sm" data-action="duplicate-template" data-tid="${tpl.id}" title="Αντιγραφή προτύπου">⧉ Αντιγραφή</button>
        <button class="btn btn-ghost btn-sm" data-action="modal-edit-template" data-tid="${tpl.id}">✏</button>
        <button class="btn btn-danger btn-sm" data-action="delete-template" data-tid="${tpl.id}">Διαγραφή</button>
      </div>` : ''}
    </div>`;
  }).join('');
  return `
  <div class="page-hd">
    <div><h1>Πρότυπα Έργων</h1><div class="page-hd-sub">${tpls.length} πρότυπα</div></div>
    ${mgmt ? `<div class="page-hd-actions"><button class="btn btn-primary" data-action="modal-add-template">+ Νέο Πρότυπο</button></div>` : ''}
  </div>
  <div class="projects-grid">
    ${cards || '<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">📋</div><h3>Δεν υπάρχουν πρότυπα</h3><p>Δεν έχουν δημιουργηθεί πρότυπα ακόμα.</p></div>'}
    ${mgmt ? `<div class="card-add" data-action="modal-add-template"><div class="card-add-icon">+</div><p>Νέο Πρότυπο</p></div>` : ''}
  </div>`;
}

function renderTemplateDetail() {
  if (!canViewTemplates()) return '<div class="empty-state"><h3>Δεν έχετε πρόσβαση</h3></div>';
  const tpl = getTemplate(state.templateId); if (!tpl) { navigate('templates'); return ''; }
  const mgmt = canManageTemplates();
  const totalPhases = (tpl.phases||[]).length;

  const phases = (tpl.phases||[]).map((ph, phIdx) => {
    const totalTasks = (ph.tasks||[]).length;

    const tasks = (ph.tasks||[]).map((tk, tkIdx) => {
      const docs = (tk.docs||[]).map(d => `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--navy-line);font-size:.78rem">
          <span style="flex:1">${esc(d.name)} <span class="text-muted">(${esc(d.cat||'')})</span></span>
          <span class="doc-type-badge doc-type-${d.type||'client'}">${DOC_TYPES[d.type]||'Πελάτης'}</span>
          ${d.required?'<span class="badge badge-orange" style="font-size:.58rem">Απαιτ.</span>':''}
          ${mgmt?`<button class="btn btn-ghost btn-sm" data-action="delete-tpl-doc" data-tid="${tpl.id}" data-phid="${ph.id}" data-tkid="${tk.id}" data-did="${d.id}" style="padding:2px 6px;font-size:.7rem">✕</button>`:''}
        </div>`).join('');

      const taskArrows = mgmt ? `<div class="tpl-arrows">
        <button class="tpl-arr${tkIdx===0?' tpl-arr-disabled':''}" data-action="tpl-task-up" data-tid="${tpl.id}" data-phid="${ph.id}" data-tkid="${tk.id}" ${tkIdx===0?'disabled':''} title="Πάνω">↑</button>
        <button class="tpl-arr${tkIdx===totalTasks-1?' tpl-arr-disabled':''}" data-action="tpl-task-down" data-tid="${tpl.id}" data-phid="${ph.id}" data-tkid="${tk.id}" ${tkIdx===totalTasks-1?'disabled':''} title="Κάτω">↓</button>
      </div>` : '';

      return `<div class="task-row tpl-task-row" data-tpl-task-idx="${tkIdx}"
        ${mgmt?`draggable="true" ondragstart="tplTaskDragStart(event,this,${tkIdx},'${ph.id}','${tpl.id}')" ondragend="tplTaskDragEnd(this)" ondragover="tplTaskDragOver(event,${tkIdx},'${ph.id}')" ondrop="tplTaskDrop(event,${tkIdx},'${ph.id}','${tpl.id}')"`:''}
        style="margin:0;border-radius:0;border-left:none;border-right:none;border-top:none">
        <div class="task-row-head" style="cursor:default">
          ${mgmt?'<div class="tpl-drag-handle" title="Σύρσιμο">⠿</div>':''}
          ${taskArrows}
          <div class="task-status-dot" style="background:var(--slate-400)"></div>
          <div class="task-info"><div class="task-name">${esc(tk.name)}</div><div class="task-meta">${(tk.subtasks||[]).length} υποεργ. · ${(tk.docs||[]).length} έγγρ.</div>
          ${(tk.subtasks||[]).length?`<div class="tpl-subtasks">${(tk.subtasks||[]).map(st=>`<div class="tpl-subtask-item">◦ ${esc(st.name||st)}</div>`).join('')}</div>`:''}
          ${tk.notes?`<div class="tpl-task-notes">💬 ${esc(tk.notes)}</div>`:''}</div>
          ${mgmt?`<div style="display:flex;gap:6px;margin-left:auto">
            <button class="btn btn-ghost btn-sm" data-action="modal-add-tpl-doc" data-tid="${tpl.id}" data-phid="${ph.id}" data-tkid="${tk.id}" style="font-size:.7rem">+ Έγγραφο</button>
            <button class="btn btn-ghost btn-sm" data-action="modal-edit-tpl-task" data-tid="${tpl.id}" data-phid="${ph.id}" data-tkid="${tk.id}" style="font-size:.7rem">✏</button>
            <button class="btn btn-danger btn-sm" data-action="delete-tpl-task" data-tid="${tpl.id}" data-phid="${ph.id}" data-tkid="${tk.id}" style="font-size:.7rem">✕</button>
          </div>`:''}
        </div>
        ${docs?`<div style="padding:4px 20px 8px 44px">${docs}</div>`:''}
      </div>`;
    }).join('');

    const phaseArrows = mgmt ? `<div class="tpl-arrows">
      <button class="tpl-arr${phIdx===0?' tpl-arr-disabled':''}" data-action="tpl-phase-up" data-tid="${tpl.id}" data-phid="${ph.id}" ${phIdx===0?'disabled':''} title="Φάση πάνω">↑</button>
      <button class="tpl-arr${phIdx===totalPhases-1?' tpl-arr-disabled':''}" data-action="tpl-phase-down" data-tid="${tpl.id}" data-phid="${ph.id}" ${phIdx===totalPhases-1?'disabled':''} title="Φάση κάτω">↓</button>
    </div>` : '';

    return `<div class="phase-section tpl-phase-row" data-tpl-phase-idx="${phIdx}"
      ${mgmt?`draggable="true" ondragstart="tplPhaseDragStart(event,this,${phIdx},'${tpl.id}')" ondragend="tplPhaseDragEnd(this)" ondragover="tplPhaseDragOver(event,${phIdx})" ondrop="tplPhaseDrop(event,${phIdx},'${tpl.id}')"`:''}
      >
      <div class="phase-header">
        ${mgmt?'<div class="tpl-drag-handle" title="Σύρσιμο">⠿</div>':''}
        ${phaseArrows}
        <div class="phase-num pn-active">${phIdx+1}</div>
        <div class="phase-title">${esc(ph.name)}</div>
        ${mgmt?`<div style="margin-left:auto;display:flex;gap:8px;align-items:center">
          <button class="btn btn-secondary btn-sm" data-action="modal-add-tpl-task" data-tid="${tpl.id}" data-phid="${ph.id}">+ Εργασία</button>
          <button class="btn btn-ghost btn-sm" data-action="modal-edit-tpl-phase" data-tid="${tpl.id}" data-phid="${ph.id}" style="font-size:.8rem">✏</button>
          <button class="btn btn-danger btn-sm" data-action="delete-tpl-phase" data-tid="${tpl.id}" data-phid="${ph.id}">Διαγραφή</button>
        </div>`:''}
      </div>
      <div class="phase-tasks">${tasks||'<div class="text-sm text-muted" style="padding:12px 20px">Δεν υπάρχουν εργασίες.</div>'}</div>
    </div>`;
  }).join('');

  return `
  <div class="page-hd">
    <div><h1>${esc(tpl.name)}</h1><div class="page-hd-sub">${esc(tpl.desc||'')} ${mgmt?'<span class="text-muted" style="font-size:.72rem">· Σύρετε φάσεις/εργασίες ή χρησιμοποιήστε τα βελάκια για αλλαγή σειράς</span>':''}</div></div>
    ${mgmt?`<div class="page-hd-actions"><button class="btn btn-ghost btn-sm" data-action="duplicate-template" data-tid="${tpl.id}" title="Αντιγραφή προτύπου">⧉ Αντιγραφή</button><button class="btn btn-ghost btn-sm" data-action="modal-edit-template" data-tid="${tpl.id}">✏ Επεξεργασία</button><button class="btn btn-primary" data-action="modal-add-tpl-phase" data-tid="${tpl.id}">+ Φάση</button></div>`:''}
  </div>
  <div class="phases-list">${phases||'<div class="empty-state"><div class="es-icon">📋</div><h3>Δεν υπάρχουν φάσεις</h3><p>Πατήστε "+ Φάση" για να ξεκινήσετε.</p></div>'}</div>`;
}

// ── BIND EVENTS ───────────────────────────────────────────────────
function _mainClickHandler(e) { handleClick(e); }
function _mainChangeHandler(e) {
  const sel=e.target.closest('[data-action="change-status"]');
  if (sel) { handleStatusChange(sel); return; }
  const chk=e.target.closest('[data-action="toggle-subtask"]');
  if (chk) { toggleSubtask(chk.dataset.pid,chk.dataset.phid,chk.dataset.tid,chk.dataset.stid,chk.checked); return; }
}
function bindEvents() {
  const main=el('main-content'); if(!main) return;
  main.removeEventListener('click', _mainClickHandler);
  main.removeEventListener('change', _mainChangeHandler);
  main.addEventListener('click', _mainClickHandler);
  main.addEventListener('change', _mainChangeHandler);
  const si=el('search-input'); if(si) si.addEventListener('input',e=>{ state.search=e.target.value; render(); });
  const lp=el('login-pass'); if(lp) lp.addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
}

// Global nav (sidebar + breadcrumb + header actions)
document.addEventListener('click',e=>{
  const nl=e.target.closest('.nav-link[data-nav]');
  if (nl) { e.preventDefault(); navigate(nl.dataset.nav); return; }
  const bc=e.target.closest('.bc-item[data-action]');
  if (bc) {
    const a=bc.dataset.action;
    if (a==='nav-dashboard') navigate('dashboard');
    else if (a==='nav-categories') navigate('categories');
    else if (a==='nav-projects') navigate('projects',{categoryId:bc.dataset.cid});
    else if (a==='nav-templates')     navigate('templates');
    else if (a==='nav-crm-companies') navigate('crm-companies');
    else if (a==='nav-crm-contacts')  navigate('crm-contacts');
    return;
  }
  // Header bell opens the single, full Notification Center page.
  const bell=e.target.closest('[data-action="nav-notifications"]');
  if (bell) { e.stopPropagation(); navigate('notifications'); return; }
  // Sidebar / header logout (outside main-content)
  const logoutBtn=e.target.closest('[data-action="logout"]');
  if (logoutBtn) { doLogout(); return; }
  // My account (sidebar)
  const accBtn=e.target.closest('[data-action="my-account"]');
  if (accBtn) { showModalMyAccount(); return; }
});

// ── AUTH ACTIONS ──────────────────────────────────────────────────
async function doLogin() {
  try {
    const identifier=(el('login-user')?.value||'').trim().toLowerCase();
    const password=(el('login-pass')?.value||'');
    const errEl=el('login-err');
    if(errEl) errEl.style.display='none';

    if (!identifier || !password) {
      if(errEl){errEl.textContent='Συμπληρώστε email/username και κωδικό.';errEl.style.display='block';}
      return;
    }

    // Final cutover: resolve the login email via a safe RPC (no anon table
    // read of be_users needed) and authenticate exclusively via Supabase Auth.
    const {data:resolvedEmail, error:resolveError}=await sb.rpc('app_resolve_login_email',{p_identifier:identifier});
    if (resolveError) {
      if(errEl){errEl.textContent='Σφάλμα σύνδεσης: '+(resolveError.message||resolveError);errEl.style.display='block';}
      return;
    }

    const email=resolvedEmail||(identifier.includes('@')?identifier:null);
    if (!email) {
      if(errEl){errEl.textContent='Λάθος στοιχεία σύνδεσης.';errEl.style.display='block';}
      return;
    }

    const {error:authError}=await sb.auth.signInWithPassword({email,password});
    if (authError) {
      if(errEl){
        errEl.textContent='Λάθος στοιχεία σύνδεσης ή ο λογαριασμός Auth δεν έχει ενεργοποιηθεί.';
        errEl.style.display='block';
      }
      return;
    }

    AUTH_MODE='supabase';
    sessionStorage.removeItem('be_pm_user');

    let profile=await loadCurrentAppUser().catch(()=>null);
    if (!profile) {
      const {data:claimed,error:claimError}=await sb.rpc('app_claim_my_profile');
      if (claimError) {
        await sb.auth.signOut({scope:'local'}).catch(()=>{});
        AUTH_MODE='legacy';
        throw claimError;
      }
      profile=claimed||await loadCurrentAppUser();
    }

    if (!profile) {
      await sb.auth.signOut({scope:'local'}).catch(()=>{});
      AUTH_MODE='legacy';
      throw new Error('Δεν βρέθηκε ενεργό προφίλ για αυτόν τον λογαριασμό.');
    }

    await loadFromDB();
    state.cu=profile;
    const idx=state.db.users.findIndex(u=>u.id===profile.id);
    if(idx>=0) state.db.users[idx]=profile; else state.db.users.push(profile);
    state.view=profile.role==='client'?'client':'dashboard';

    sb.rpc('app_touch_last_login').then(({error})=>{
      if(error) console.warn('touch last login:',error);
    });

    initPresence();
    initProjectsRealtime();
    startNotificationPolling();
    auditLog('Σύνδεση',`Ο χρήστης ${profile.name} συνδέθηκε μέσω Supabase Auth`);
    render();
  } catch(err) {
    console.error('doLogin error:',err);
    const errEl=el('login-err');
    if(errEl){
      errEl.textContent='Σφάλμα σύνδεσης: '+(err.message||err);
      errEl.style.display='block';
    } else showToast('Σφάλμα σύνδεσης: '+(err.message||err),'error');
  }
}

async function doLogout() {
  cleanupNotificationCenter();
  try { auditLog('Αποσύνδεση',`Ο χρήστης ${state.cu?.name} αποσυνδέθηκε`); } catch(e){}
  cleanupPresence();

  if (isSupabaseAuthMode()) {
    try { await sb.auth.signOut({scope:'local'}); } catch(e) { console.warn('signOut',e); }
  }

  clearCurrentUser();
  state.cu=null;
  state.view='login';
  AUTH_MODE='legacy';

  try { await loadFromDB(); }
  catch(e) { state.db=emptyDbState(); }

  render();
}

// ── TASK ACTIONS ──────────────────────────────────────────────────
function toggleTask(tid) {
  state.expandedTasks[tid]=!state.expandedTasks[tid];
  const b=el('body-'+tid); const i=el('ei-'+tid);
  if (b) b.classList.toggle('body-open',!!state.expandedTasks[tid]);
  if (i) i.classList.toggle('ei-open',!!state.expandedTasks[tid]);
}
function restoreExpanded() {
  Object.entries(state.expandedTasks).forEach(([tid,open])=>{
    if (!open) return;
    const b=el('body-'+tid); const i=el('ei-'+tid);
    if (b) b.classList.add('body-open'); if (i) i.classList.add('ei-open');
  });
}

async function handleStatusChange(sel) {
  const {pid,phid,tid}=sel.dataset;
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid);
  if (!task) return;
  const old=task.status;
  const next=sel.value;
  const phaseBefore=currentActionPhase(proj);
  const phaseBeforeId=phaseBefore?.id || null;

  if (isSupabaseAuthMode()) {
    sel.disabled=true;
    try {
      await secureProjectRpc('app_task_set_status',{
        p_project_id:pid,
        p_phase_id:phid,
        p_task_id:tid,
        p_status:next
      },pid);
      auditLog('Αλλαγή κατάστασης',`"${task.name}": ${TASK_STATUSES[old]?.label} → ${TASK_STATUSES[next]?.label}`);
      const freshProj=getProject(pid);
      if(freshProj) await notifyPhaseActivation(freshProj,phaseBeforeId);
    } catch(err) {
      console.error('app_task_set_status:',err);
      showToast('Η αλλαγή κατάστασης απορρίφθηκε: '+(err.message||err),'error');
    } finally {
      render(); requestAnimationFrame(()=>restoreExpanded());
    }
    return;
  }

  task.status=next;
  if (next==='completed'&&!task.completedDate) task.completedDate=today();
  if (next!=='completed') task.completedDate=null;
  auditLog('Αλλαγή κατάστασης',`"${task.name}": ${TASK_STATUSES[old]?.label} → ${TASK_STATUSES[next]?.label}`);
  dbSaveProject(proj).catch(()=>{});
  notifyPhaseActivation(proj,phaseBeforeId).catch(()=>{});
  render(); requestAnimationFrame(()=>restoreExpanded());
}

async function toggleSubtask(pid,phid,tid,stid,checked) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); const st=task?.subtasks.find(s=>s.id===stid);
  if (!st) return;

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_subtask_set_done',{
        p_project_id:pid,
        p_phase_id:phid,
        p_task_id:tid,
        p_subtask_id:stid,
        p_done:!!checked
      },pid);
      auditLog('Υποεργασία',`"${st.name}" → ${checked?'Ολοκλήρωση':'Αναίρεση'}`);
    } catch(err) {
      console.error('app_subtask_set_done:',err);
      showToast('Η ενημέρωση υποεργασίας απορρίφθηκε: '+(err.message||err),'error');
    } finally {
      render(); requestAnimationFrame(()=>restoreExpanded());
    }
    return;
  }

  st.done=checked;
  if (!checked) st.reviewStatus=undefined;
  auditLog('Υποεργασία',`"${st.name}" → ${checked?'Ολοκλήρωση':'Αναίρεση'}`);
  dbSaveProject(proj).catch(()=>{});
  render(); requestAnimationFrame(()=>restoreExpanded());
}

function handleClick(e) {
  const btn=e.target.closest('[data-action]'); if(!btn||btn.tagName==='LABEL') return;
  e.stopPropagation();
  const a=btn.dataset.action; const {pid,cid,phid,tid,did,uid:uidVal}=btn.dataset;
  switch(a){
    case 'do-login':           doLogin();                                   break;
    case 'logout':             doLogout();                                  break;
    case 'my-account':         showModalMyAccount();                        break;
    case 'nav-dashboard':      navigate('dashboard'); state.dashFilter=null; break;
    case 'dash-filter': { const v=btn.dataset.val; state.dashFilter=(state.dashFilter===v?null:v); render(); break; }
    case 'nav-categories':     navigate('categories');                      break;
    case 'nav-projects':       navigate('projects',{categoryId:btn.dataset.cid}); break;
    case 'nav-templates':      navigate('templates');                       break;
    case 'nav-timesheet':      navigate('timesheet');                       break;
    case 'nav-notifications':  navigate('notifications');                   break;
    case 'open-template':      navigate('template',{templateId:btn.dataset.tid}); break;
    case 'open-category':      navigate('projects',{categoryId:cid});       break;
    case 'delete-category':    confirmDeleteCategory(cid);                  break;
    case 'open-project':       navigate('project',{projectId:pid});        break;
    case 'open-notification':
      window.openNotificationTarget(btn.dataset.nid,btn.dataset.source,pid,phid,tid)
        .catch(error=>{
          console.error('notification click:',error);
          showToast('Δεν ήταν δυνατό το άνοιγμα της ειδοποίησης.','error');
        });
      break;
    case 'mark-notification-read':
      markOneNotificationRead(btn.dataset.nid,btn.dataset.source).then(()=>render());
      break;
    case 'mark-all-notifications-read':
      markAllProjectNotificationsRead();
      break;
    case 'filter-notifications':
      state.notificationFilter=btn.dataset.val||'all'; render();
      break;
    case 'toggle-task':        toggleTask(tid);                             break;
    case 'add-doc-url':        showModalAddDocUrl(did,tid);                break;
    case 'doc-manual-check':   docManualCheck(did,tid);                    break;
    case 'remove-doc-url':     removeDocUrl(did,tid);                      break;
    case 'open-task-document': openTaskDocument(did,tid);                  break;
    case 'open-task-document-online': openTaskDocumentOnline(did,tid);     break;
    case 'client-delivery': showModalClientDelivery(did,tid);              break;
    case 'open-client-delivery': openClientDelivery(btn.dataset.deliveryId,false); break;
    case 'download-client-delivery': openClientDelivery(btn.dataset.deliveryId,true); break;
    case 'edit-doc-source':    showModalAddDocUrl(did,tid);                break;
    case 'doc-rename':         docRename(did,tid);                         break;
    case 'delete-doc':         deleteDoc(did,tid);                         break;
    case 'export-category':    exportCategoryToExcel(cid);            break;
    case 'export-project':     exportProjectToExcel(pid);             break;
    case 'project-to-template':       showModalCreateTemplateFromProject(pid); break;
    case 'apply-template-to-project': showModalApplyTemplate(pid);            break;
    case 'export-phase':       exportPhaseToExcel(pid,phid);          break;
    case 'filter-status':      state.filter.status=btn.dataset.val; render(); break;
    case 'toggle-priority-sort': state.sortByPriority=!state.sortByPriority; render(); break;
    case 'toggle-gantt':       state.ganttView=!state.ganttView; render(); break;
    case 'add-comment':        addComment(pid,phid,tid); break;
    case 'delete-comment':     deleteComment(pid,phid,tid,btn.dataset.cid); break;
    case 'toggle-comments':    if(!state.commentsOpen)state.commentsOpen={}; state.commentsOpen[tid]=!state.commentsOpen[tid]; state.expandedTasks[tid]=true; render(); requestAnimationFrame(()=>restoreExpanded()); break;
    case 'client-toggle-task': if(!state.clientExpanded)state.clientExpanded={}; state.clientExpanded[tid]=!state.clientExpanded[tid]; render(); break;
    case 'cal-view-month': state.calViewMode='month'; render(); break;
    case 'cal-view-week':  state.calViewMode='week';  if(!state.calWeekStart)state.calWeekStart=_calMondayOf(null); render(); break;
    case 'cal-view-day':   state.calViewMode='day';   if(!state.calDayDate)state.calDayDate=today(); render(); break;
    case 'cal-prev': {
      const vm=state.calViewMode||'month';
      if (vm==='week') {
        const m=new Date(state.calWeekStart||_calMondayOf(null)); m.setDate(m.getDate()-7); state.calWeekStart=m.toISOString().slice(0,10);
      } else if (vm==='day') {
        const m=new Date(state.calDayDate||today()); m.setDate(m.getDate()-1); state.calDayDate=m.toISOString().slice(0,10);
      } else {
        const d=new Date(state.calYear||new Date().getFullYear(),state.calMonth!==null?state.calMonth:new Date().getMonth(),1); d.setMonth(d.getMonth()-1); state.calYear=d.getFullYear();state.calMonth=d.getMonth();
      }
      render(); break; }
    case 'cal-next': {
      const vm=state.calViewMode||'month';
      if (vm==='week') {
        const m=new Date(state.calWeekStart||_calMondayOf(null)); m.setDate(m.getDate()+7); state.calWeekStart=m.toISOString().slice(0,10);
      } else if (vm==='day') {
        const m=new Date(state.calDayDate||today()); m.setDate(m.getDate()+1); state.calDayDate=m.toISOString().slice(0,10);
      } else {
        const d=new Date(state.calYear||new Date().getFullYear(),state.calMonth!==null?state.calMonth:new Date().getMonth(),1); d.setMonth(d.getMonth()+1); state.calYear=d.getFullYear();state.calMonth=d.getMonth();
      }
      render(); break; }
    case 'cal-today': state.calYear=new Date().getFullYear();state.calMonth=new Date().getMonth();state.calWeekStart=_calMondayOf(null);state.calDayDate=today(); render(); break;
    case 'show-search':        showGlobalSearch(); break;
    case 'move-phase-up':      movePhase(pid,btn.dataset.phidx,-1); break;
    case 'move-phase-down':    movePhase(pid,btn.dataset.phidx, 1); break;
    case 'task-phase-prev':
    case 'task-phase-next': {
      const proj2=getProject(pid); if(!proj2) break;
      const phIdx2=(proj2.phases||[]).findIndex(p=>p.id===phid); if(phIdx2<0) break;
      const targetIdx2 = a==='task-phase-prev' ? phIdx2-1 : phIdx2+1;
      if(targetIdx2<0||targetIdx2>=(proj2.phases||[]).length) break;
      moveTaskToPhase(pid, phid, tid, proj2.phases[targetIdx2].id);
      break;
    }
    case 'send-client-reminder':    showModalClientReminder(pid); break;
    case 'toggle-notif':       navigate('notifications'); break;
    case 'delete-project':     confirmDeleteProject(pid);                   break;
    case 'delete-user':        confirmDeleteUser(uidVal);                   break;
    case 'clear-audit':        clearAudit();                                break;
    case 'modal-add-timesheet':      showModalAddTimesheet();                       break;
    case 'modal-edit-timesheet':     showModalEditTimesheet(btn.dataset.eid);       break;
    case 'delete-timesheet':         deleteTimesheetEntry(btn.dataset.eid);         break;
    case 'modal-manage-standing':    showModalManageStanding();                     break;
    case 'modal-billing':            showModalBilling();                            break;
    case 'modal-add-template':       showModalAddTemplate();                        break;
    case 'modal-edit-template':      showModalEditTemplate(btn.dataset.tid);        break;
    case 'delete-template':          confirmDeleteTemplate(btn.dataset.tid);        break;
    case 'duplicate-template':       duplicateTemplate(btn.dataset.tid);            break;
    case 'modal-add-tpl-phase':      showModalAddTplPhase(btn.dataset.tid);         break;
    case 'modal-edit-tpl-phase':     showModalEditTplPhase(btn.dataset.tid,btn.dataset.phid); break;
    case 'delete-tpl-phase':         deleteTplPhase(btn.dataset.tid,btn.dataset.phid);       break;
    case 'tpl-phase-up':
    case 'tpl-phase-down': {
      const tpl = getTemplate(btn.dataset.tid); if (!tpl) break;
      const phases = tpl.phases || [];
      const pi = phases.findIndex(p => p.id === btn.dataset.phid); if (pi < 0) break;
      const ni = a === 'tpl-phase-up' ? pi - 1 : pi + 1;
      if (ni < 0 || ni >= phases.length) break;
      [phases[pi], phases[ni]] = [phases[ni], phases[pi]];
      dbSaveTemplate(tpl).then(() => render());
      break;
    }
    case 'modal-add-tpl-task':       showModalAddTplTask(btn.dataset.tid,btn.dataset.phid);  break;
    case 'modal-edit-tpl-task':      showModalEditTplTask(btn.dataset.tid,btn.dataset.phid,btn.dataset.tkid); break;
    case 'delete-tpl-task':          deleteTplTask(btn.dataset.tid,btn.dataset.phid,btn.dataset.tkid);       break;
    case 'tpl-task-up':
    case 'tpl-task-down': {
      const tpl = getTemplate(btn.dataset.tid); if (!tpl) break;
      const ph = (tpl.phases||[]).find(p => p.id === btn.dataset.phid); if (!ph) break;
      const tasks = ph.tasks || [];
      const ti = tasks.findIndex(t => t.id === btn.dataset.tkid); if (ti < 0) break;
      const ni = a === 'tpl-task-up' ? ti - 1 : ti + 1;
      if (ni < 0 || ni >= tasks.length) break;
      [tasks[ti], tasks[ni]] = [tasks[ni], tasks[ti]];
      dbSaveTemplate(tpl).then(() => render());
      break;
    }
    case 'modal-add-tpl-doc':        showModalAddTplDoc(btn.dataset.tid,btn.dataset.phid,btn.dataset.tkid);  break;
    case 'delete-tpl-doc':           deleteTplDoc(btn.dataset.tid,btn.dataset.phid,btn.dataset.tkid,btn.dataset.did); break;
    case 'modal-add-category':  showModalAddCategory();                      break;
    case 'modal-edit-category': showModalEditCategory(cid);                 break;
    case 'modal-add-project':   showModalAddProject(cid);                   break;
    case 'modal-edit-project':  showModalEditProject(pid);                  break;
    case 'modal-add-phase':     showModalAddPhase(pid);                     break;
    case 'modal-edit-phase':    showModalEditPhase(pid,phid);               break;
    case 'modal-add-task':      showModalAddTask(pid,phid);                 break;
    case 'modal-edit-task':     showModalEditTask(pid,phid,tid);            break;
    case 'duplicate-task':      duplicateTask(pid,phid,tid);                break;
    case 'modal-add-doc':      showModalAddDoc(pid,phid,tid);               break;
    case 'modal-add-user':          showModalAddUser();                     break;
    case 'modal-edit-user':         showModalEditUser(uidVal);              break;
    case 'modal-user-priority':     showModalUserPriority(uidVal);          break;
    case 'ccal-add':    showModalAddCcal();                         break;
    case 'ccal-edit':   showModalEditCcal(btn.dataset.ccid);        break;
    case 'ccal-delete': ccalDelete(btn.dataset.ccid);               break;
    // CRM
    case 'crm-co-open':   navigate('crm-company',{crmCompanyId:btn.dataset.coid}); break;
    case 'crm-co-add':    showModalCrmCompany();                    break;
    case 'crm-co-edit':   showModalCrmCompany(btn.dataset.coid);    break;
    case 'crm-co-delete': crmDeleteCompany(btn.dataset.coid);       break;
    case 'crm-ct-open':   navigate('crm-contact',{crmContactId:btn.dataset.ctid}); break;
    case 'crm-ct-add':    showModalCrmContact();                    break;
    case 'crm-ct-edit':   showModalCrmContact(btn.dataset.ctid);    break;
    case 'crm-ct-delete': crmDeleteContact(btn.dataset.ctid);       break;
    // Offers
    case 'offer-add':    showModalOffer();                           break;
    case 'offer-edit':   showModalOffer(btn.dataset.oid);           break;
    case 'offer-delete': dbDeleteOffer(btn.dataset.oid);            break;
    case 'offer-file':   showModalOfferFile(btn.dataset.oid);       break;
    default: break;
  }
}

// ── DOCUMENT LINK / FILE ACTIONS ──────────────────────────────────
function showModalAddDocUrlLegacy(did, tid) {
  const found=findDoc(did,tid); if(!found) return;
  const {doc}=found;
  const basePath=(localStorage.getItem('dropbox_base_path')||'').replace(/\/+$/,'');
  const localRoot=(localStorage.getItem('dropbox_local_root')||'T:\\B&E SOLUTIONS Dropbox').replace(/[/\\]+$/,'');
  showModal(`
    <div class="modal-header"><div class="modal-title">Προσθήκη – ${esc(doc.name)}</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="doc-add-tabs">
        <button class="doc-tab active" onclick="docTabSwitch(this,'tab-local')">🖥️ Τοπική Διαδρομή</button>
        <button class="doc-tab" onclick="docTabSwitch(this,'tab-dbx-browse')">📁 Dropbox (περιήγηση)</button>
        <button class="doc-tab" onclick="docTabSwitch(this,'tab-url')">🔗 Σύνδεσμος</button>
        <button class="doc-tab" onclick="docTabSwitch(this,'tab-file')">📎 Ανέβασμα</button>
      </div>
      <div id="tab-local" class="doc-tab-body">
        <div style="margin-top:12px">
          <!-- Instruction -->
          <div style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:.78rem;color:#92400e;line-height:1.5">
            <strong>Πώς να βρείτε τη διαδρομή:</strong><br>
            Στον Explorer, <strong>Shift + δεξί κλικ</strong> πάνω στο αρχείο → <strong>"Αντιγραφή ως διαδρομή"</strong> → επικολλήστε παρακάτω.
          </div>
          <!-- Single path field -->
          <div class="form-group">
            <label class="form-label">Διαδρομή αρχείου</label>
            <input class="form-control" id="local-path-${did}"
              placeholder="T:\\B&E SOLUTIONS Dropbox\\03. SOLUTIONS-PROJECTS\\ΙΟΡΔΑΝΗΣ\\αρχείο.pdf"
              oninput="localPathPreview('${did}')" style="font-size:.82rem">
          </div>
          <!-- Preview -->
          <div id="local-url-preview-${did}" style="display:none;margin-top:6px;padding:7px 10px;background:rgba(29,78,216,.06);border:1px solid rgba(29,78,216,.15);border-radius:6px;font-size:.68rem;color:var(--blue);word-break:break-all">
            <div style="font-weight:600;margin-bottom:2px">✅ Θα αποθηκευτεί ως:</div>
            <span id="local-url-text-${did}"></span>
          </div>
        </div>
        <div class="modal-footer-inline"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveLocalPath('${did}','${tid}')">Αποθήκευση</button></div>
      </div>
      <div id="tab-dbx-browse" class="doc-tab-body" style="display:none">
        <div class="dbx-browse-zone" id="dbx-browse-zone-${did}" onclick="document.getElementById('dbx-file-inp-${did}').click()">
          <div class="file-drop-icon">☁</div>
          <div class="file-drop-text">Κλικ για επιλογή αρχείων από Dropbox<br><span style="font-size:.72rem;color:var(--muted)">Ctrl+κλικ για πολλαπλά αρχεία</span></div>
          <div class="file-drop-name" id="dbx-file-name-${did}"></div>
        </div>
        <input type="file" id="dbx-file-inp-${did}" style="display:none" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.ppt,.pptx">
        <div id="dbx-file-list-${did}" style="display:none;margin-top:8px"></div>
        <div class="form-group" style="margin-top:12px" id="dbx-single-path-group-${did}">
          <label class="form-label" style="display:flex;align-items:center;gap:8px">
            Διαδρομή μέσα στο Dropbox
            <span style="font-size:.72rem;color:var(--muted);font-weight:400">(επεξεργάσιμο)</span>
          </label>
          <input class="form-control" id="dbx-path-${did}" placeholder="π.χ. 04. SOLUTIONS-SERVICES/ProjectX/αρχείο.pdf" value="" oninput="dbxPathPreview('${did}')">
          <div class="dbx-base-row">
            <span class="dbx-base-label">📂 Βασικός φάκελος:</span>
            <span class="dbx-base-val" id="dbx-base-display-${did}">${esc(basePath||'(δεν έχει οριστεί)')}</span>
            <button class="btn-link" onclick="dbxEditBasePath('${did}')">Αλλαγή</button>
          </div>
        </div>
        <div id="dbx-url-preview-${did}" style="display:none;margin-bottom:10px;padding:7px 10px;background:rgba(29,78,216,.06);border:1px solid rgba(29,78,216,.15);border-radius:6px;font-size:.68rem;color:var(--blue);word-break:break-all"></div>
        <div class="dbx-base-row" style="margin-top:6px">
          <span class="dbx-base-label">🖥️ Τοπική διαδρομή Dropbox:</span>
          <span class="dbx-base-val" style="color:var(--muted)">${esc(localStorage.getItem('dropbox_local_root')||'(δεν έχει οριστεί)')}</span>
          <button class="btn-link" onclick="dbxEditLocalRoot()">Αλλαγή</button>
        </div>
        <div class="form-hint">Τα αρχεία <strong>δεν ανεβαίνουν</strong> — αποθηκεύεται μόνο η διαδρομή. Όταν τρέχει τοπικά, ανοίγει απευθείας στον υπολογιστή.</div>
        <div class="modal-footer-inline"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveDropboxBrowse('${did}','${tid}')">Αποθήκευση</button></div>
      </div>
      <div id="tab-url" class="doc-tab-body" style="display:none">
        <div class="form-group" style="margin-top:14px"><label class="form-label">Σύνδεσμος Dropbox <sup>*</sup></label><input class="form-control" id="durl-input" type="url" placeholder="https://www.dropbox.com/…" value="${esc(doc.url||'')}"></div>
        <div class="form-hint">Επικολλήστε τον σύνδεσμο κοινής χρήσης.</div>
        <div class="modal-footer-inline"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveDocUrl('${did}','${tid}')">Αποθήκευση</button></div>
      </div>
      <div id="tab-file" class="doc-tab-body" style="display:none">
        <div class="file-drop-zone" id="file-drop-${did}" onclick="document.getElementById('file-inp-${did}').click()">
          <div class="file-drop-icon">📁</div>
          <div class="file-drop-text">Κλικ για επιλογή αρχείων<br><span style="font-size:.72rem;color:var(--muted)">Ctrl+κλικ για πολλαπλά · ή σύρτε εδώ</span></div>
          <div class="file-drop-name" id="file-drop-name-${did}"></div>
        </div>
        <div id="file-list-preview-${did}" style="display:none;margin-top:8px"></div>
        <input type="file" id="file-inp-${did}" style="display:none" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.ppt,.pptx">
        <div class="modal-footer-inline"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" id="file-upload-btn-${did}" onclick="modalUploadDocFile('${did}','${tid}')">Ανέβασμα</button></div>
      </div>
    </div>`);
  setTimeout(()=>{
    const inp=el('durl-input');
    // Local path tab file input
    const localFi=el(`local-file-inp-${did}`);
    if (localFi) localFi.addEventListener('change',()=>{
      const f=localFi.files?.[0]; if(!f) return;
      // Fill filename field only — user must fill subfolder separately
      const fnEl=el(`local-filename-${did}`);
      if(fnEl) { fnEl.value=f.name; }
      localPathPreview(did);
    });
    // Dropbox browse tab file input
    const dbxFi=el(`dbx-file-inp-${did}`);
    if (dbxFi) dbxFi.addEventListener('change',()=>{
      const files=Array.from(dbxFi.files||[]);
      const zone=el(`dbx-browse-zone-${did}`);
      const nd=el(`dbx-file-name-${did}`);
      const listEl=el(`dbx-file-list-${did}`);
      const pathGroup=el(`dbx-single-path-group-${did}`);
      if (!files.length) {
        if(nd){nd.textContent='';nd.style.display='none';}
        if(zone) zone.classList.remove('file-drop-selected');
        if(listEl) listEl.style.display='none';
        if(pathGroup) pathGroup.style.display='';
        _dbxUpdatePath(did,''); return;
      }
      if(zone) zone.classList.add('file-drop-selected');
      if (files.length===1) {
        // single file: show path field as before
        if(nd){nd.textContent=files[0].name;nd.style.display='block';}
        if(listEl) listEl.style.display='none';
        if(pathGroup) pathGroup.style.display='';
        _dbxUpdatePath(did, files[0].name);
      } else {
        // multiple files: show list, hide single path field
        const base=(localStorage.getItem('dropbox_base_path')||'').replace(/\/+$/,'').replace(/\\/g,'/');
        if(nd){nd.textContent=`${files.length} αρχεία επιλεγμένα`;nd.style.display='block';}
        if(pathGroup) pathGroup.style.display='none';
        const previewUrl=el(`dbx-url-preview-${did}`); if(previewUrl) previewUrl.style.display='none';
        if(listEl){
          listEl.style.display='';
          listEl.innerHTML=`<div style="font-size:.72rem;color:var(--muted);margin-bottom:4px">📂 Βασικός φάκελος: <strong>${esc(base||'(δεν έχει οριστεί)')}</strong></div>`+
            files.map(f=>{
              const url=_dbxBuildUrl((base?base+'/':'')+f.name);
              return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.75rem;color:var(--text-secondary)"><span style="color:var(--orange)">☁</span>${esc(f.name)} <a href="${esc(url)}" target="_blank" style="margin-left:auto;font-size:.65rem;color:var(--blue)">🔗</a></div>`;
            }).join('');
        }
      }
    });
    // Init path field with existing URL or base path
    _dbxUpdatePath(did, '');
    if (doc.url && doc.url.includes('dropbox.com/home/')) {
      const rel=decodeURIComponent(doc.url.replace(/.*dropbox\.com\/home\//,''));
      const pf=el(`dbx-path-${did}`); if(pf) { pf.value=rel; dbxPathPreview(did); }
    }
    // Upload tab — multi-file support
    function _updateFilePreview(files) {
      const dz=el(`file-drop-${did}`);
      const nd=el(`file-drop-name-${did}`);
      const lp=el(`file-list-preview-${did}`);
      if (!files||!files.length) {
        if(nd) nd.textContent=''; if(dz) dz.classList.remove('file-drop-selected');
        if(lp) lp.style.display='none'; return;
      }
      if(nd) nd.textContent=files.length===1?files[0].name:`${files.length} αρχεία επιλεγμένα`;
      if(dz) dz.classList.add('file-drop-selected');
      if(lp) {
        lp.style.display='';
        lp.innerHTML=Array.from(files).map(f=>`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.75rem;color:var(--text-secondary)"><span style="color:var(--orange)">📄</span>${esc(f.name)} <span style="color:var(--muted);font-size:.68rem">(${(f.size/1024).toFixed(0)} KB)</span></div>`).join('');
      }
    }
    const fi=el(`file-inp-${did}`);
    if (fi) fi.addEventListener('change',()=>{ _updateFilePreview(fi.files); });
    const dz=el(`file-drop-${did}`);
    if (dz) {
      dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('file-drop-hover');});
      dz.addEventListener('dragleave',()=>dz.classList.remove('file-drop-hover'));
      dz.addEventListener('drop',e=>{
        e.preventDefault(); dz.classList.remove('file-drop-hover');
        const dropped=e.dataTransfer.files; if(!dropped.length) return;
        const fi2=el(`file-inp-${did}`); if(!fi2) return;
        const dt=new DataTransfer();
        Array.from(dropped).forEach(f=>dt.items.add(f));
        fi2.files=dt.files;
        _updateFilePreview(fi2.files);
      });
    }
  }, 80);
}

// Fix 7: one Dropbox form replaces the four legacy source tabs.
function showModalAddDocUrl(did, tid) {
  const found=findDoc(did,tid); if(!found) return;
  const {doc}=found;
  const sources=_dropboxDocumentSources(doc.url);
  const localPath=sources.localPath||'';
  const onlineUrl=sources.onlineUrl||'';
  const isEditing=!!doc.done;
  showModal(`
    <div class="modal-header"><div class="modal-title">${isEditing?'Αλλαγή πηγής':'Προσθήκη'} – ${esc(doc.name)}</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div style="margin-bottom:14px;padding:11px 13px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:.77rem;color:#1e3a5f;line-height:1.55">
        Το επίσημο αρχείο παραμένει στο <strong>Dropbox</strong>. Δεν δημιουργείται δεύτερο αντίγραφο στο PROJECT TRACKING.
      </div>
      <div style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:.78rem;color:#92400e;line-height:1.5">
        <strong>Διαδρομή αρχείου:</strong> Στον Explorer, <strong>Shift + δεξί κλικ</strong> στο αρχείο → <strong>«Αντιγραφή ως διαδρομή»</strong> → επικόλληση παρακάτω.
      </div>
      <div class="form-group">
        <label class="form-label">Τοπική διαδρομή Dropbox <sup>*</sup></label>
        <input class="form-control" id="dropbox-local-path-${did}" value="${esc(localPath)}" placeholder="T:\\B&amp;E SOLUTIONS Dropbox\\03. SOLUTIONS-PROJECTS\\Έργο\\αρχείο.pdf" style="font-size:.82rem">
        <div class="form-hint">Η διαδρομή πρέπει να βρίσκεται μέσα στο <strong>${esc(_dropboxLocalRoot())}</strong>.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Dropbox shared link <span style="font-weight:400;color:var(--muted)">(προαιρετικό)</span></label>
        <input class="form-control" id="dropbox-online-url-${did}" type="url" value="${esc(onlineUrl)}" placeholder="https://www.dropbox.com/…" style="font-size:.82rem">
        <div class="form-hint">Στο Dropbox: <strong>Κοινή χρήση → Αντιγραφή συνδέσμου</strong>. Όταν συμπληρωθεί, εμφανίζεται και το κουμπί «☁ Dropbox».</div>
      </div>
      <div class="modal-footer-inline"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" id="dropbox-save-btn-${did}" onclick="modalSaveDropboxDocument('${did}','${tid}')">Αποθήκευση</button></div>
    </div>`);
}

window.modalSaveDropboxDocument=async function(did,tid){
  const localRaw=(el(`dropbox-local-path-${did}`)?.value||'').trim();
  const onlineRaw=(el(`dropbox-online-url-${did}`)?.value||'').trim();
  const localPath=_normalizeDropboxLocalPath(localRaw);
  if(!localPath){
    alert(`Η διαδρομή πρέπει να είναι αρχείο μέσα στο ${_dropboxLocalRoot()}.`);
    return;
  }
  let onlineUrl=null;
  if(onlineRaw){
    onlineUrl=_safeWebDocumentUrl(onlineRaw);
    if(!onlineUrl || !_isDropboxDocumentUrl(onlineUrl)){
      alert('Ο online σύνδεσμος πρέπει να είναι έγκυρο Dropbox shared link που ξεκινά με https://.');
      return;
    }
  }
  const found=findDoc(did,tid); if(!found) return;
  const {proj,ph,task,doc}=found;
  const storedUrl=_buildDropboxDocumentRef(localPath,onlineUrl);
  const btn=el(`dropbox-save-btn-${did}`);
  if(btn){btn.disabled=true;btn.textContent='Αποθήκευση…';}

  if(isSupabaseAuthMode()){
    try{
      await secureProjectRpc('app_document_complete',{
        p_project_id:proj.id,p_phase_id:ph.id,p_task_id:task.id,
        p_document_id:did,p_file_name:null,p_url:storedUrl,p_client_uploaded:false
      },proj.id);
      auditLog('Σύνδεση εγγράφου Dropbox',`"${doc.name}" – ${task.name}`);
      closeModal(); render(); requestAnimationFrame(()=>restoreExpanded());
      showToast('Το έγγραφο συνδέθηκε με το Dropbox.','success');
    }catch(err){
      if(btn){btn.disabled=false;btn.textContent='Αποθήκευση';}
      showToast('Η σύνδεση Dropbox δεν αποθηκεύτηκε: '+(err.message||err),'error');
    }
    return;
  }

  doc.url=storedUrl; doc.file=null; doc.done=true; doc.at=today();
  auditLog('Σύνδεση εγγράφου Dropbox',`"${doc.name}" – ${task.name}`);
  await dbSaveProject(proj); closeModal();
  render(); requestAnimationFrame(()=>restoreExpanded());
  showToast('Το έγγραφο συνδέθηκε με το Dropbox.','success');
};

function _dbxUpdatePath(did, fname) {
  const base=(localStorage.getItem('dropbox_base_path')||'').replace(/\/+$/,'').replace(/\\/g,'/');
  const pf=el(`dbx-path-${did}`); if(!pf) return;
  if (!pf.value || (!fname && pf.value===base) || (fname && pf.value===base+(base?'/':'')+pf.value.split('/').pop())) {
    pf.value = base + (base&&fname?'/':'') + (fname||'');
  } else if (fname) {
    // replace just the filename part
    const parts=pf.value.replace(/\\/g,'/').split('/');
    parts[parts.length-1]=fname;
    pf.value=parts.join('/');
  }
  dbxPathPreview(did);
}
window.dbxEditBasePath=function(did){
  const cur=localStorage.getItem('dropbox_base_path')||'';
  const val=prompt('Εισάγετε τον βασικό φάκελο Dropbox\n(η διαδρομή μέσα στο Dropbox, χωρίς το όνομα του φακέλου Dropbox)\n\nΠαράδειγμα: 04. SOLUTIONS-SERVICES/00. EHS BNE SOLUTIONS', cur);
  if (val===null) return;
  const clean=val.trim().replace(/\\/g,'/').replace(/\/+$/,'');
  localStorage.setItem('dropbox_base_path', clean);
  const disp=el(`dbx-base-display-${did}`); if(disp) disp.textContent=clean||'(δεν έχει οριστεί)';
  _dbxUpdatePath(did, el(`dbx-file-inp-${did}`)?.files[0]?.name||'');
};
// Set local Dropbox root path (for localhost file:// opening)
window.dbxEditLocalRoot = function() {
  const cur = localStorage.getItem('dropbox_local_root') || '';
  const val = prompt(
    'Εισάγετε τη διαδρομή του φακέλου Dropbox στον υπολογιστή σας\n\nΠαράδειγμα: T:\\B&E SOLUTIONS Dropbox\n\nΌταν το site τρέχει τοπικά, τα αρχεία θα ανοίγουν απευθείας με αυτή τη διαδρομή.',
    cur
  );
  if (val === null) return;
  localStorage.setItem('dropbox_local_root', val.trim().replace(/[/\\]+$/, ''));
  showToast('Τοπική διαδρομή Dropbox αποθηκεύτηκε.', 'success');
};
// Local path tab helpers
window.localSetRoot = function(did) {
  dbxEditLocalRoot();
  const root = localStorage.getItem('dropbox_local_root')||'';
  const d = el(`local-root-disp-${did}`);
  if (d) { d.textContent = root||'(δεν έχει οριστεί)'; d.style.color = root?'':'var(--muted)'; }
};
window.localBrowse = function(did) {
  el(`local-file-inp-${did}`)?.click();
};
window.localPathPreview = function(did) {
  const pathEl=el(`local-path-${did}`);
  const prev=el(`local-url-preview-${did}`);
  const textEl=el(`local-url-text-${did}`);
  // Strip surrounding quotes (Windows "Copy as path" adds them)
  let raw=(pathEl?.value||'').trim().replace(/^"|"$/g,'').trim();
  if (!raw) { if(prev) prev.style.display='none'; return; }
  if(textEl) textEl.textContent=raw;
  if(prev) prev.style.display='block';
};
function _localToRel(fullPath, root) {
  // Strip root prefix (case-insensitive, handle both / and \)
  const n=fullPath.replace(/\\/g,'/');
  const r=(root||'').replace(/\\/g,'/').replace(/\/+$/,'');
  if (r && n.toLowerCase().startsWith(r.toLowerCase()+'/')) return n.slice(r.length+1);
  if (r && n.toLowerCase().startsWith(r.toLowerCase()+'\\')) return n.slice(r.length+1);
  return n; // no root prefix found — return as-is
}
window.modalSaveLocalPath = async function(did,tid) {
  const pathEl=el(`local-path-${did}`);
  // Strip surrounding quotes (Windows "Copy as path" adds them)
  let raw=(pathEl?.value||'').trim().replace(/^"|"$/g,'').trim();
  if (!raw) { alert('Εισάγετε τη διαδρομή του αρχείου.'); return; }
  const fileUrl='file:///'+raw.replace(/\\/g,'/');
  const found=findDoc(did,tid); if(!found) return;
  const {proj,task,doc}=found;
  doc.url=fileUrl; doc.file=null; doc.done=true; doc.at=today();
  auditLog('Τοπική διαδρομή εγγράφου',`"${doc.name}" – ${task.name}`);
  await dbSaveProject(proj); closeModal();
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
  showToast('Αρχείο συνδέθηκε.','success');
};
// ── FOLDER PATH MODAL ─────────────────────────────────────────────
window.showFolderPathModal = function(did, tid) {
  const found = findDoc(did, tid); if (!found) return;
  const {doc} = found;
  showModal(`<div class="modal-header"><div class="modal-title">📂 Φάκελος Εγγράφου</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:.78rem;color:#92400e;line-height:1.5"><strong>Πώς να βρείτε τη διαδρομή:</strong><br>Στον Explorer, <strong>Shift + δεξί κλικ</strong> πάνω στον φάκελο → <strong>"Αντιγραφή ως διαδρομή"</strong> → επικολλήστε παρακάτω.</div><div class="form-group"><label class="form-label">Τοπική διαδρομή φακέλου</label><input class="form-control" id="folder-path-inp" placeholder="T:\\B&E SOLUTIONS Dropbox\\03. SOLUTIONS-PROJECTS\\..." value="${esc(doc.folderPath||'')}" style="font-size:.82rem"></div><div style="margin-top:10px;padding:8px 12px;background:rgba(29,78,216,.06);border:1px solid rgba(29,78,216,.15);border-radius:6px;font-size:.72rem;color:var(--steel);line-height:1.6">💡 Το κουμπί <strong>📄 Άνοιγμα</strong> ανοίγει τον φάκελο στον Explorer μόνο όταν η εφαρμογή ανοίγεται τοπικά από το <strong>index.html</strong>, όχι από το Netlify.</div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>${doc.folderPath?`<button class="btn btn-danger btn-sm" onclick="modalClearFolderPath('${did}','${tid}')" style="margin-right:auto">Εκκαθάριση</button>`:''}<button class="btn btn-primary" onclick="modalSaveFolderPath('${did}','${tid}')">Αποθήκευση</button></div>`);
};
window.modalSaveFolderPath = async function(did, tid) {
  const raw = (el('folder-path-inp')?.value||'').trim().replace(/^"|"$/g,'').trim();
  const found = findDoc(did, tid); if (!found) return;
  const {proj, doc} = found;
  doc.folderPath = raw || null;
  await dbSaveProject(proj); closeModal();
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
  showToast(raw ? 'Φάκελος αποθηκεύτηκε.' : 'Φάκελος εκκαθαρίστηκε.', 'success');
};
window.modalClearFolderPath = async function(did, tid) {
  const found = findDoc(did, tid); if (!found) return;
  const {proj, doc} = found;
  doc.folderPath = null;
  await dbSaveProject(proj); closeModal();
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
  showToast('Φάκελος εκκαθαρίστηκε.', 'success');
};
const DROPBOX_LOCAL_ROOT = 'T:\\B&E SOLUTIONS Dropbox';
const DROPBOX_LOCAL_HASH_PREFIX = '#pt-local=';

function _dropboxLocalRoot(){
  return DROPBOX_LOCAL_ROOT;
}
function _pathFromLocalDocumentUrl(rawValue){
  const raw=String(rawValue||'').trim().replace(/^"|"$/g,'');
  if(!raw) return '';
  if(/^[A-Za-z]:[\\/]/.test(raw)) return raw.replace(/\//g,'\\');
  if(!/^file:\/\//i.test(raw)) return '';
  try{
    let pathname=decodeURIComponent(new URL(raw).pathname||'');
    if(/^\/[A-Za-z]:\//.test(pathname)) pathname=pathname.slice(1);
    return pathname.replace(/\//g,'\\');
  }catch{return '';}
}
function _normalizeDropboxLocalPath(rawValue){
  const root=_dropboxLocalRoot().replace(/[\\/]+$/,'');
  const raw=_pathFromLocalDocumentUrl(rawValue)||String(rawValue||'').trim().replace(/^"|"$/g,'').replace(/\//g,'\\');
  const normalized=raw.replace(/\\+/g,'\\').replace(/\\+$/,'');
  if(!normalized || normalized.toLowerCase()===root.toLowerCase()) return null;
  if(!normalized.toLowerCase().startsWith(root.toLowerCase()+'\\')) return null;
  return root+normalized.slice(root.length);
}
function _dropboxRelativePath(localPath){
  const normalized=_normalizeDropboxLocalPath(localPath);
  if(!normalized) return null;
  return normalized.slice(_dropboxLocalRoot().length).replace(/^[\\/]+/,'');
}
function _buildDropboxDocumentRef(localPath,onlineUrl=null){
  const normalized=_normalizeDropboxLocalPath(localPath);
  if(!normalized) return null;
  if(!onlineUrl) return _localFileHref(normalized);
  const parsed=new URL(onlineUrl);
  parsed.hash=DROPBOX_LOCAL_HASH_PREFIX.slice(1)+encodeURIComponent(_dropboxRelativePath(normalized));
  return parsed.href;
}
function _dropboxDocumentSources(storedValue){
  const raw=String(storedValue||'').trim();
  if(!raw) return {localPath:null,onlineUrl:null};
  if(_isLocalDocumentUrl(raw)){
    return {localPath:_normalizeDropboxLocalPath(_pathFromLocalDocumentUrl(raw)),onlineUrl:null};
  }
  const safe=_safeWebDocumentUrl(raw);
  if(!safe) return {localPath:null,onlineUrl:null};
  try{
    const parsed=new URL(safe);
    let localPath=null;
    if(parsed.hash.startsWith(DROPBOX_LOCAL_HASH_PREFIX)){
      const relative=decodeURIComponent(parsed.hash.slice(DROPBOX_LOCAL_HASH_PREFIX.length));
      localPath=_normalizeDropboxLocalPath(_dropboxLocalRoot()+'\\'+relative.replace(/\//g,'\\'));
      parsed.hash='';
    }
    return {localPath,onlineUrl:parsed.href};
  }catch{return {localPath:null,onlineUrl:safe};}
}
function _isDropboxDocumentUrl(url) {
  try {
    const host=new URL(String(url||'')).hostname.toLowerCase();
    return host==='dropbox.com'||host.endsWith('.dropbox.com')||host.endsWith('.dropboxusercontent.com');
  } catch { return false; }
}
function _isLocalDocumentUrl(url) {
  return /^file:\/\//i.test(String(url||'')) || /^[A-Za-z]:[\\/]/.test(String(url||''));
}
function _safeWebDocumentUrl(url) {
  try {
    const parsed=new URL(String(url||''));
    return ['http:','https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch { return null; }
}
function _localFileHref(rawPath) {
  const raw=String(rawPath||'').trim().replace(/^"|"$/g,'');
  if (!raw) return null;
  if (/^file:\/\//i.test(raw)) return raw;
  const normalized=raw.replace(/\\/g,'/');
  return normalized.startsWith('/') ? 'file://'+normalized : 'file:///'+normalized;
}
function _canOpenLocalDocuments() {
  return window.location?.protocol==='file:';
}
// Build clean Dropbox URL from a raw path string
function _dbxBuildUrl(rawPath) {
  // Strip any Windows drive prefix (e.g. "T:\", "C:/Users/...") up to and including the Dropbox root folder
  let p = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  // If path starts with a Windows drive letter (C:/, T:/ etc.) strip everything up to the Dropbox root folder
  // Dropbox root folders typically end with "Dropbox" or "Dropbox (Personal)" etc.
  p = p.replace(/^[A-Za-z]:\//, ''); // strip drive
  // Strip any leading path segment that looks like a Dropbox local root (contains "Dropbox")
  const parts = p.split('/');
  const dbxRootIdx = parts.findIndex(s => /dropbox/i.test(s));
  if (dbxRootIdx !== -1) p = parts.slice(dbxRootIdx + 1).join('/');
  // Build the URL — use encodeURI (not encodeURIComponent) so slashes are preserved and chars like () . work fine
  return 'https://www.dropbox.com/home/' + p.split('/').map(s => encodeURIComponent(s).replace(/%20/g, '%20')).join('/');
}
window.dbxPathPreview=function(did){
  const pf=el(`dbx-path-${did}`); if(!pf) return;
  const raw=(pf.value||'').trim();
  const preview=el(`dbx-url-preview-${did}`); if(!preview) return;
  if (!raw) { preview.style.display='none'; return; }
  const url=_dbxBuildUrl(raw);
  preview.style.display='';
  preview.innerHTML=`🔗 URL που θα αποθηκευτεί: <a href="${esc(url)}" target="_blank" style="color:var(--blue)">${esc(url)}</a>`;
};
window.modalSaveDropboxBrowse=async function(did,tid){
  const found=findDoc(did,tid); if(!found) return;
  const {proj,task,doc}=found;
  const dbxFi=el(`dbx-file-inp-${did}`);
  const files=Array.from(dbxFi?.files||[]);

  if (files.length > 1) {
    // Multiple files: first fills existing doc, rest create new entries
    const base=(localStorage.getItem('dropbox_base_path')||'').replace(/\/+$/,'').replace(/\\/g,'/');
    const buildPath=fname=>(base?base+'/':'')+fname;
    const firstUrl=_dbxBuildUrl(buildPath(files[0].name));
    doc.url=firstUrl; doc.file=null; doc.done=true; doc.at=today();
    auditLog('Σύνδεσμος Dropbox',`"${files[0].name}" – ${task.name}`);
    for (let i=1; i<files.length; i++) {
      const url=_dbxBuildUrl(buildPath(files[i].name));
      task.docs.push({id:'d_'+uid(), name:files[i].name, cat:doc.cat||'', type:doc.type||'team', required:false, done:true, file:null, url, at:today()});
      auditLog('Σύνδεσμος Dropbox',`"${files[i].name}" – ${task.name}`);
    }
    await dbSaveProject(proj); closeModal();
    render(); requestAnimationFrame(()=>{ restoreExpanded(); });
    showToast(`${files.length} διαδρομές Dropbox αποθηκεύτηκαν.`,'success');
  } else {
    // Single file or manual path
    const pf=el(`dbx-path-${did}`); const raw=(pf?.value||'').trim();
    if (!raw) { alert('Επιλέξτε αρχείο ή εισάγετε διαδρομή.'); return; }
    const url=_dbxBuildUrl(raw);
    doc.url=url; doc.file=null; doc.done=true; doc.at=today();
    auditLog('Σύνδεσμος Dropbox (περιήγηση)',`"${doc.name}" – ${task.name}`);
    await dbSaveProject(proj); closeModal();
    render(); requestAnimationFrame(()=>{ restoreExpanded(); });
    showToast('Διαδρομή Dropbox αποθηκεύτηκε.','success');
  }
};
window.docTabSwitch=function(btn,tabId){
  document.querySelectorAll('.doc-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.doc-tab-body').forEach(b=>b.style.display='none');
  const t=el(tabId); if(t) t.style.display='';
};
window.modalSaveDocUrl=async function(did,tid){
  const rawUrl=(el('durl-input')?.value||'').trim();
  if (!rawUrl) { alert('Εισάγετε σύνδεσμο Dropbox.'); return; }
  const url=_safeWebDocumentUrl(rawUrl);
  if (!url) { alert('Ο σύνδεσμος πρέπει να ξεκινά με https:// ή http://.'); return; }
  const found=findDoc(did,tid); if(!found) return;
  const {proj,ph,task,doc}=found;

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_document_complete',{
        p_project_id:proj.id,p_phase_id:ph.id,p_task_id:task.id,
        p_document_id:did,p_file_name:null,p_url:url,p_client_uploaded:false
      },proj.id);
      auditLog('Σύνδεσμος εγγράφου',`"${doc.name}" – ${task.name}`);
      closeModal(); render(); requestAnimationFrame(()=>restoreExpanded());
      showToast('Σύνδεσμος αποθηκεύτηκε.','success');
    } catch(err) { showToast('Ο σύνδεσμος δεν αποθηκεύτηκε: '+(err.message||err),'error'); }
    return;
  }

  doc.url=url; doc.file=null; doc.done=true; doc.at=today();
  auditLog('Σύνδεσμος εγγράφου',`"${doc.name}" – ${task.name}`);
  await dbSaveProject(proj); closeModal();
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
  showToast('Σύνδεσμος αποθηκεύτηκε.','success');
};
window.modalUploadDocFile=async function(did,tid){
  const fi=el(`file-inp-${did}`); const files=Array.from(fi?.files||[]);
  if (!files.length) { alert('Επιλέξτε αρχείο.'); return; }
  const oversize=files.find(f=>f.size>50*1024*1024);
  if (oversize) { alert(`Το αρχείο «${oversize.name}» υπερβαίνει τα 50MB.`); return; }
  const found=findDoc(did,tid); if(!found) return;
  const {proj,task,doc}=found;
  const btn=el(`file-upload-btn-${did}`);
  if(btn){btn.disabled=true;btn.textContent=`Ανέβασμα (0/${files.length})…`;}
  try {
    // First file → fills the existing doc slot
    await fileSave(did, files[0]);

    if (isSupabaseAuthMode() && files.length===1) {
      await secureProjectRpc('app_document_complete',{
        p_project_id:proj.id,p_phase_id:found.ph.id,p_task_id:task.id,
        p_document_id:did,p_file_name:files[0].name,p_url:null,p_client_uploaded:false
      },proj.id);
      auditLog('Ανέβασμα αρχείου',`"${files[0].name}" – ${task.name}`);
      closeModal(); render(); requestAnimationFrame(()=>restoreExpanded());
      showToast(`Αρχείο «${files[0].name}» αποθηκεύτηκε.`,'success');
      return;
    }

    doc.file=files[0].name; doc.url=null; doc.done=true; doc.at=today();
    auditLog('Ανέβασμα αρχείου',`"${files[0].name}" – ${task.name}`);
    // Extra files → create new doc entries automatically
    for (let i=1; i<files.length; i++) {
      if(btn) btn.textContent=`Ανέβασμα (${i}/${files.length})…`;
      const newId='d_'+uid();
      await fileSave(newId, files[i]);
      task.docs.push({
        id:newId, name:files[i].name,
        cat:doc.cat||'', type:doc.type||'team',
        required:false, done:true, file:files[i].name,
        url:null, at:today(), clientUploaded:false
      });
      auditLog('Ανέβασμα αρχείου',`"${files[i].name}" – ${task.name}`);
    }
    await dbSaveProject(proj); closeModal();
    render(); requestAnimationFrame(()=>{ restoreExpanded(); });
    showToast(files.length===1?`Αρχείο «${files[0].name}» αποθηκεύτηκε.`:`${files.length} αρχεία αποθηκεύτηκαν επιτυχώς.`,'success');
  } catch(err) { showToast('Σφάλμα ανεβάσματος: '+(err.message||err),'error'); if(btn){btn.disabled=false;btn.textContent='Ανέβασμα';} }
};
const DOCUMENT_SIGNED_URL_TTL_SECONDS = 300;
const DOCUMENT_OFFICE_EXTS = ['doc','docx','xls','xlsx','ppt','pptx'];

function _documentExtension(name) {
  const clean=String(name||'').split(/[?#]/)[0];
  const dot=clean.lastIndexOf('.');
  return dot>=0 ? clean.slice(dot+1).toLowerCase() : '';
}
function _documentMime(name, fallback='') {
  const mimeMap={
    pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',
    gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',txt:'text/plain',
    doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  return mimeMap[_documentExtension(name)]||fallback||'application/octet-stream';
}
function _prepareDocumentTab() {
  try {
    const tab=window.open('about:blank','_blank');
    if (!tab) return null;
    try {
      tab.opener=null;
      if (tab.document?.body) {
        tab.document.title='Άνοιγμα εγγράφου…';
        tab.document.body.textContent='Το έγγραφο ανοίγει…';
        tab.document.body.style.cssText='font:16px system-ui;padding:24px;color:#334155';
      }
    } catch {}
    return tab;
  } catch { return null; }
}
function _showDocumentLinkFallback(url) {
  showModal(`<div class="modal-header"><div class="modal-title">📄 Άνοιγμα εγγράφου</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><p style="line-height:1.6">Ο browser απέκλεισε τη νέα καρτέλα. Πατήστε το παρακάτω κουμπί για να ανοίξετε το έγγραφο.</p></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Κλείσιμο</button><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">📄 Άνοιγμα</a></div>`);
}
function _navigateDocumentTab(tab,url) {
  if (tab && !tab.closed) {
    try { tab.location.replace(url); return; } catch {}
  }
  _showDocumentLinkFallback(url);
}
function _closePreparedDocumentTab(tab) {
  try { if(tab&&!tab.closed) tab.close(); } catch {}
}
function _showLegacyLocalDocumentNotice(did,tid,path) {
  showModal(`<div class="modal-header"><div class="modal-title">🖥️ Τοπική διαδρομή εγγράφου</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div style="padding:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;color:#92400e;line-height:1.55"><strong>Το αρχείο δεν μπορεί να ανοίξει από το online PROJECT TRACKING.</strong><br>Η εγγραφή περιέχει μόνο παλιά τοπική διαδρομή. Για σταθερό άνοιγμα, συνδέστε Dropbox link ή ανεβάστε το αρχείο.</div><div style="margin-top:12px;font-size:.75rem;color:var(--muted);word-break:break-all">${esc(path||'')}</div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Κλείσιμο</button><button class="btn btn-primary" onclick="closeModal();showModalAddDocUrl('${did}','${tid}')">Αλλαγή πηγής</button></div>`);
}
async function _storageDocumentUrl(storagePath) {
  const bucket=sb.storage.from(BUCKET);
  let signedError=null;
  if (typeof bucket.createSignedUrl==='function') {
    try {
      const {data,error}=await bucket.createSignedUrl(storagePath,DOCUMENT_SIGNED_URL_TTL_SECONDS);
      const signedUrl=data?.signedUrl||data?.signedURL;
      if (!error&&signedUrl) return {url:signedUrl,kind:'signed'};
      signedError=error||new Error('Δεν δημιουργήθηκε προσωρινός σύνδεσμος.');
    } catch(error) { signedError=error; }
  }
  // Μεταβατική συμβατότητα όσο ο υφιστάμενος live bucket παραμένει public.
  if (typeof bucket.getPublicUrl==='function') {
    const {data}=bucket.getPublicUrl(storagePath);
    if (data?.publicUrl) return {url:data.publicUrl,kind:'public-fallback'};
  }
  throw signedError||new Error('Δεν ήταν δυνατό να δημιουργηθεί σύνδεσμος αρχείου.');
}
async function _openStorageDocument(doc,tab) {
  const storagePath=doc.storagePath||doc.fileId||doc.id;
  const filename=doc.file||doc.name||'document';
  const ext=_documentExtension(filename);
  try {
    const target=await _storageDocumentUrl(storagePath);
    const openUrl=DOCUMENT_OFFICE_EXTS.includes(ext)
      ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(target.url)}`
      : target.url;
    _navigateDocumentTab(tab,openUrl);
    return;
  } catch(signedError) {
    // Ασφαλές fallback: λήψη με τα δικαιώματα του συνδεδεμένου χρήστη.
    try {
      const rawBlob=await fileGet(storagePath);
      const blob=new Blob([rawBlob],{type:_documentMime(filename,rawBlob.type)});
      const objectUrl=URL.createObjectURL(blob);
      _navigateDocumentTab(tab,objectUrl);
      setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
      return;
    } catch(downloadError) {
      _closePreparedDocumentTab(tab);
      console.error('document open:',signedError,downloadError);
      showToast('Το αρχείο δεν βρέθηκε ή δεν έχετε δικαίωμα πρόσβασης.','error');
    }
  }
}
async function openTaskDocument(did,tid) {
  const found=findDoc(did,tid);
  if (!found) { showToast('Το έγγραφο δεν βρέθηκε.','error'); return; }
  const {doc,task}=found;

  // Το πραγματικό Storage αρχείο έχει πάντα προτεραιότητα από folder/link metadata.
  if (doc.file) {
    const tab=_prepareDocumentTab();
    showToast('Άνοιγμα εγγράφου…','info');
    await _openStorageDocument(doc,tab);
    auditLog('Άνοιγμα εγγράφου',`"${doc.name}" – ${task.name}`);
    return;
  }

  if (doc.url) {
    const sources=_dropboxDocumentSources(doc.url);
    if (sources.localPath) {
      if (_canOpenLocalDocuments()) {
        const localHref=_localFileHref(sources.localPath);
        if(localHref) window.open(localHref,'_blank');
      } else if (sources.onlineUrl) {
        _openSafeOnlineDocument(sources.onlineUrl);
      } else {
        _showLegacyLocalDocumentNotice(did,tid,sources.localPath);
      }
      auditLog('Άνοιγμα εγγράφου',`"${doc.name}" – ${task.name}`);
      return;
    }
    if (sources.onlineUrl) {
      _openSafeOnlineDocument(sources.onlineUrl);
      auditLog('Άνοιγμα εγγράφου',`"${doc.name}" – ${task.name}`);
      return;
    }
    // Backward compatibility for old local paths outside the standardized Dropbox root.
    if (_isLocalDocumentUrl(doc.url)) {
      if (_canOpenLocalDocuments()) {
        const localHref=_localFileHref(doc.url);
        if(localHref) window.open(localHref,'_blank');
      } else {
        _showLegacyLocalDocumentNotice(did,tid,doc.url);
      }
      return;
    }
    showToast('Ο σύνδεσμος του εγγράφου δεν είναι έγκυρος.','error');
    return;
  }

  if (doc.folderPath) {
    if (_canOpenLocalDocuments()) {
      const folderHref=_localFileHref(doc.folderPath);
      if(folderHref) window.open(folderHref,'_blank');
    } else {
      _showLegacyLocalDocumentNotice(did,tid,doc.folderPath);
    }
    return;
  }

  showToast('Δεν υπάρχει συνδεδεμένο αρχείο.','error');
}
function _openSafeOnlineDocument(url){
  const webUrl=_safeWebDocumentUrl(url);
  if(!webUrl){showToast('Ο σύνδεσμος του εγγράφου δεν είναι έγκυρος.','error');return false;}
  const opened=window.open(webUrl,'_blank');
  if(opened){try{opened.opener=null;}catch{}}
  else _showDocumentLinkFallback(webUrl);
  return true;
}
async function openTaskDocumentOnline(did,tid){
  const found=findDoc(did,tid);
  if(!found){showToast('Το έγγραφο δεν βρέθηκε.','error');return;}
  const {doc,task}=found;
  const sources=_dropboxDocumentSources(doc.url);
  if(!sources.onlineUrl){showToast('Δεν έχει καταχωριστεί Dropbox shared link.','error');return;}
  if(_openSafeOnlineDocument(sources.onlineUrl)){
    auditLog('Άνοιγμα εγγράφου στο Dropbox',`"${doc.name}" – ${task.name}`);
  }
}
async function removeDocUrl(did,tid) {
  if (!confirm('Αφαίρεση εγγράφου/συνδέσμου;')) return;
  const found=findDoc(did,tid); if(!found) return;
  const {proj,ph,doc,task}=found;
  if (doc.file) await fileDelete(did).catch(()=>{});

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_document_clear',{
        p_project_id:proj.id,p_phase_id:ph.id,p_task_id:task.id,p_document_id:did
      },proj.id);
      auditLog('Αφαίρεση εγγράφου',`"${doc.name}" από "${task.name}"`);
      render(); requestAnimationFrame(()=>restoreExpanded());
      showToast('Έγγραφο αφαιρέθηκε.','');
    } catch(err) { showToast('Το έγγραφο δεν αφαιρέθηκε: '+(err.message||err),'error'); }
    return;
  }

  doc.done=false; doc.url=null; doc.file=null; doc.at=null; doc.manualCheck=false; doc.checkedBy=null;
  auditLog('Αφαίρεση εγγράφου',`"${doc.name}" από "${task.name}"`);
  await dbSaveProject(proj);
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
  showToast('Έγγραφο αφαιρέθηκε.','');
}

async function docManualCheck(did,tid) {
  const found=findDoc(did,tid); if(!found) return;
  const {proj,doc,task}=found;
  doc.done=true; doc.manualCheck=true; doc.at=today();
  doc.checkedBy=state.cu?.name||state.cu?.email||'';
  doc.url=null; doc.file=null;
  auditLog('Χειροκίνητο τικ εγγράφου',`"${doc.name}" από "${task.name}"`);
  await dbSaveProject(proj);
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
  showToast('Έγγραφο σημάνθηκε ως ολοκληρωμένο.','success');
}

async function deleteDoc(did,tid) {
  if (!confirm('Διαγραφή εγγράφου;')) return;
  const found=findDoc(did,tid); if(!found) return;
  const {proj,task,doc}=found;
  task.docs=task.docs.filter(d=>d.id!==did);
  auditLog('Διαγραφή εγγράφου',`"${doc.name}" από "${task.name}"`);
  await dbSaveProject(proj);
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
}

async function docRename(did,tid) {
  const found=findDoc(did,tid); if(!found) return;
  const {proj,doc}=found;
  const newName=prompt('Νέο όνομα εγγράφου:',doc.name);
  if(!newName||newName.trim()===''||newName.trim()===doc.name) return;
  const oldName=doc.name;
  doc.name=newName.trim();
  auditLog('Μετονομασία εγγράφου',`"${oldName}" → "${doc.name}"`);
  await dbSaveProject(proj);
  render(); requestAnimationFrame(()=>{ restoreExpanded(); });
  showToast('Όνομα εγγράφου ενημερώθηκε.','success');
}

// ── DELETE ACTIONS ────────────────────────────────────────────────
async function confirmDeleteCategory(cid) {
  const cat = getCategory(cid); if (!cat) return;
  const projs = state.db.projects.filter(p => p.categoryId === cid);
  const msg = `⚠ ΠΡΟΣΟΧΗ: Θα διαγραφούν οριστικά:\n\n• Η κατηγορία "${cat.name}"\n• ${projs.length} έργο(α) που ανήκουν σε αυτή\n• Όλες οι εργασίες, έγγραφα και αρχεία τους\n\nΑυτή η ενέργεια ΔΕΝ αναιρείται.\n\nΣυνέχεια;`;
  if (!confirm(msg)) return;
  showToast('Διαγραφή κατηγορίας…', '');
  for (const proj of projs) {
    await dbDeleteProject(proj.id);
  }
  state.db.projects = state.db.projects.filter(p => p.categoryId !== cid);
  state.db.categories = state.db.categories.filter(c => c.id !== cid);
  auditLog('Διαγραφή κατηγορίας', `"${cat.name}" — ${projs.length} έργα διαγράφηκαν`);
  await dbDeleteCategory(cid);
  navigate('categories');
  showToast(`Κατηγορία "${cat.name}" διαγράφηκε.`, 'success');
}

async function confirmDeleteProject(pid) {
  if (!confirm('Οριστική διαγραφή έργου; Όλα τα δεδομένα θα χαθούν.')) return;
  const proj=getProject(pid); const catId=proj?.categoryId;
  // Links only — no storage files to delete
  state.db.projects=state.db.projects.filter(p=>p.id!==pid);
  auditLog('Διαγραφή έργου',proj?.name||pid);
  await dbDeleteProject(pid);
  navigate('projects',{categoryId:catId});
}

async function confirmDeleteUser(uid) {
  if (!confirm('Διαγραφή χρήστη;')) return;
  const user=getUser(uid);
  state.db.users=state.db.users.filter(u=>u.id!==uid);
  auditLog('Διαγραφή χρήστη',user?.name||uid);
  await dbDeleteUser(uid);
  render();
}

async function clearAudit() {
  if (!confirm('Εκκαθάριση ολόκληρου του ιστορικού;')) return;
  state.db.auditLog=[];
  await dbClearAudit();
  render();
}

// ── MODALS ────────────────────────────────────────────────────────
function showModal(html) {
  closeModal();
  const ov=document.createElement('div'); ov.className='modal-overlay'; ov.id='modal-overlay';
  ov.innerHTML=`<div class="modal">${html}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{ if(e.target===ov) closeModal(); });
}
function closeModal() { const ov=el('modal-overlay'); if(ov) ov.remove(); }

// MY ACCOUNT
function showModalMyAccount() {
  const cu=state.cu; if(!cu) return;

  if (isSupabaseAuthMode()) {
    showModal(`<div class="modal-header"><div class="modal-title">Ο Λογαριασμός μου</div><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Ονοματεπώνυμο</label><input class="form-control" id="ma-name" value="${esc(cu.name)}"></div>
      <div class="form-group"><label class="form-label">Email σύνδεσης</label><input class="form-control" type="email" value="${esc(cu.email||'')}" readonly><div class="form-hint">Το email είναι συνδεδεμένο με Supabase Auth.</div></div>
      <hr class="divider">
      <div class="form-group"><label class="form-label">Νέος κωδικός <span class="text-muted" style="font-weight:400">(κενό = χωρίς αλλαγή)</span></label><input class="form-control" type="password" id="ma-pass" placeholder="••••••••" autocomplete="new-password"></div>
      <div class="form-group"><label class="form-label">Επιβεβαίωση κωδικού</label><input class="form-control" type="password" id="ma-pass2" placeholder="••••••••" autocomplete="new-password"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveMyAccount()">Αποθήκευση</button></div>`);
    return;
  }

  showModal(`<div class="modal-header"><div class="modal-title">Ο Λογαριασμός μου</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Ονοματεπώνυμο</label><input class="form-control" id="ma-name" value="${esc(cu.name)}"></div>
    <div class="form-group"><label class="form-label">Username <sup>*</sup></label><input class="form-control" id="ma-user" value="${esc(cu.username)}" autocomplete="off"></div>
    <div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" id="ma-email" value="${esc(cu.email||'')}"></div>
    <hr class="divider">
    <div class="form-group"><label class="form-label">Νέος Κωδικός <span class="text-muted" style="font-weight:400">(κενό = χωρίς αλλαγή)</span></label><input class="form-control" type="password" id="ma-pass" placeholder="••••••••" autocomplete="new-password"></div>
    <div class="form-group"><label class="form-label">Επιβεβαίωση Κωδικού</label><input class="form-control" type="password" id="ma-pass2" placeholder="••••••••" autocomplete="new-password"></div>
  </div>
  <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveMyAccount()">Αποθήκευση</button></div>`);
}

window.modalSaveMyAccount=async function(){
  const cu=state.cu; if(!cu) return;
  const name=(el('ma-name')?.value||'').trim();
  const pass=el('ma-pass')?.value||'';
  const pass2=el('ma-pass2')?.value||'';

  if (!name) { alert('Το ονοματεπώνυμο είναι υποχρεωτικό.'); return; }
  if (pass && pass!==pass2) { alert('Οι κωδικοί δεν ταιριάζουν.'); return; }

  if (isSupabaseAuthMode()) {
    if (pass && pass.length<6) { alert('Ο νέος κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες, σύμφωνα με το τεχνικό ελάχιστο του Supabase Auth.'); return; }

    const {data:newProfile,error:profileError}=await sb.rpc('app_update_my_name',{p_name:name});
    if(profileError) throw profileError;

    if(pass){
      const {error}=await sb.auth.updateUser({password:pass});
      if(error) throw error;
    }

    state.cu=newProfile||{...cu,name};
    const idx=state.db.users.findIndex(u=>u.id===state.cu.id);
    if(idx>=0) state.db.users[idx]=state.cu;

    auditLog('Ενημέρωση λογαριασμού',state.cu.name);
    closeModal(); render();
    showToast('Ο λογαριασμός σας αποθηκεύτηκε.','success');
    return;
  }

  const username=(el('ma-user')?.value||'').trim().toLowerCase();
  const email=(el('ma-email')?.value||'').trim();
  if (!username) { alert('Το username είναι υποχρεωτικό.'); return; }
  if (username!==cu.username && state.db.users.find(u=>u.id!==cu.id&&u.username===username)) {
    alert('Το username χρησιμοποιείται ήδη από άλλο χρήστη.'); return;
  }
  if (pass && pass.length<4) { alert('Ο κωδικός πρέπει να έχει τουλάχιστον 4 χαρακτήρες.'); return; }

  const user=state.db.users.find(u=>u.id===cu.id); if(!user) return;
  user.name=name;
  user.username=username;
  user.email=email;
  if (pass) user.password=dcodeIO.bcrypt.hashSync(pass, 10);
  state.cu={...user}; setCurrentUser(state.cu);
  auditLog('Ενημέρωση λογαριασμού',`${user.name} (@${user.username})`);
  await dbSaveUser(user);
  closeModal(); render();
  showToast('Ο λογαριασμός σας αποθηκεύτηκε.','success');
};

// CLIENT REMINDER
function showModalClientReminder(pid) {
  const proj=getProject(pid); if(!proj) return;
  const pendingDocs=[]; (proj.phases||[]).forEach(ph=>(ph.tasks||[]).forEach(t=>(t.docs||[]).filter(d=>!d.done&&d.required).forEach(d=>pendingDocs.push(`${t.name}: ${d.name}`))));
  const defaultMsg=pendingDocs.length>0
    ? `Παρακαλούμε αποστείλετε τα ακόλουθα έγγραφα:\n• ${pendingDocs.slice(0,5).join('\n• ')}`
    : `Υπενθύμιση για το έργο "${proj.name}".`;
  showModal(`<div class="modal-header"><div class="modal-title">Υπενθύμιση Πελάτη – ${esc(proj.clientName||'')}</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-hint" style="margin-bottom:12px">Η υπενθύμιση θα σταλεί για έγκριση στον Υπεύθυνο Έργου πριν παραδοθεί στον πελάτη.</div><div class="form-group"><label class="form-label">Μήνυμα</label><textarea class="form-control" id="rem-msg" rows="5" style="resize:vertical">${esc(defaultMsg)}</textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalQueueReminder('${pid}')">Αποστολή για Έγκριση</button></div>`);
}
window.modalQueueReminder=function(pid){
  const msg=(el('rem-msg')?.value||'').trim(); if(!msg){alert('Γράψτε μήνυμα.');return;}
  const proj=getProject(pid); queueClientReminder(proj,msg); closeModal();
};

// ADD CATEGORY
function showModalAddCategory() {
  showModal(`<div class="modal-header"><div class="modal-title">Νέα Κατηγορία</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="mc-name" placeholder="π.χ. Φορολογικές Δηλώσεις"></div><div class="form-group"><label class="form-label">Περιγραφή</label><textarea class="form-control" id="mc-desc" placeholder="Σύντομη περιγραφή…"></textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveCategory()">Δημιουργία</button></div>`);
}
window.modalSaveCategory=async function(){
  const name=el('mc-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  const cols=['#e87010','#059669','#1d4ed8','#7c3aed','#dc2626','#0891b2'];
  const bgs=['#fff3e6','#ecfdf5','#eff6ff','#f5f3ff','#fef2f2','#e0f2fe'];
  const i=state.db.categories.length%cols.length;
  const cat={id:'cat_'+uid(),name,icon:'📋',color:cols[i],bgLight:bgs[i],desc:el('mc-desc').value.trim()||'Κατηγορία έργων',managerIds:[],template:{phases:[]}};
  state.db.categories.push(cat);
  auditLog('Δημιουργία κατηγορίας',name);
  await dbSaveCategory(cat);
  // Non-admin/management users who create a category get auto-assigned to it
  if (!['admin','management'].includes(state.cu.role)) {
    const creator = state.db.users.find(u=>u.id===state.cu.id);
    if (creator) {
      if (!creator.categoryIds) creator.categoryIds = [];
      if (!creator.categoryIds.includes(cat.id)) {
        creator.categoryIds.push(cat.id);
        state.cu.categoryIds = creator.categoryIds; // keep state in sync
        await dbSaveUser(creator);
      }
    }
  }
  closeModal(); render(); showToast(`Κατηγορία «${name}» δημιουργήθηκε.`,'success');
};

// ── BILLING REPORT ───────────────────────────────────────────────
const BILLING_KM_KEY = 'beKmRate';
function getKmRate() { return parseFloat(localStorage.getItem(BILLING_KM_KEY) || '0.25'); }
function setKmRate(v) { localStorage.setItem(BILLING_KM_KEY, String(v)); }

function showModalBilling() {
  const allProjects = sortByCode((state.db.projects||[]).filter(p=>!p.standing));
  const projOpts = allProjects.map(p=>`<option value="${p.id}">${p.code ? esc(p.code+' – '+p.name) : esc(p.name)}</option>`).join('');
  const todayVal = today();

  showModal(`
    <div class="modal-header">
      <div class="modal-title">📊 Κοστολόγηση Έργου</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Έργο</label>
        <select class="form-control" id="bill-proj">
          <option value="">— Επιλέξτε έργο —</option>
          ${projOpts}
        </select>
      </div>
      <div style="display:flex;gap:10px">
        <div class="form-group" style="flex:1">
          <label class="form-label">Από</label>
          <input class="form-control" type="date" id="bill-from">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Έως</label>
          <input class="form-control" type="date" id="bill-to" value="${todayVal}">
        </div>
      </div>
      <div id="bill-results"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Κλείσιμο</button>
      <button class="btn btn-primary btn-sm" onclick="billingLoad()">Φόρτωση Δεδομένων</button>
    </div>`);
}

window.billingLoad = async function() {
  const projId = el('bill-proj')?.value;
  const from   = el('bill-from')?.value;
  const to     = el('bill-to')?.value;
  if (!projId) { showToast('Επιλέξτε έργο.','error'); return; }
  if (!from)   { showToast('Επιλέξτε ημερομηνία έναρξης.','error'); return; }
  if (!to)     { showToast('Επιλέξτε ημερομηνία λήξης.','error'); return; }

  const proj = getProject(projId);
  let entries=[];
  try {
    const resultEl=el('bill-results');
    if(resultEl) resultEl.innerHTML='<p class="text-muted" style="margin-top:12px;font-size:.85rem">Φόρτωση δεδομένων…</p>';
    entries=await fetchTimesheetRowsForBilling(projId,from,to);
  } catch(err) {
    console.error('Billing load:',err);
    const resultEl=el('bill-results');
    if(resultEl) resultEl.innerHTML='<p style="margin-top:12px;font-size:.85rem;color:var(--red)">Σφάλμα φόρτωσης δεδομένων κοστολόγησης.</p>';
    return;
  }

  // Group by user
  const byUser = {};
  entries.forEach(e => {
    if (!byUser[e.userId]) byUser[e.userId] = { name: e.userName, hours: 0, km: 0, rows: [] };
    byUser[e.userId].hours += parseFloat(e.hours||0);
    byUser[e.userId].km    += parseInt(e.km||0, 10);
    byUser[e.userId].rows.push(e);
  });

  const totalKm = entries.reduce((s,e)=>s+parseInt(e.km||0,10), 0);
  const kmRate  = getKmRate();

  if (!Object.keys(byUser).length) {
    el('bill-results').innerHTML = `<p class="text-muted" style="margin-top:12px;font-size:.85rem">Δεν βρέθηκαν εγγραφές για αυτό το έργο και χρονική περίοδο.</p>`;
    return;
  }

  const userRows = Object.entries(byUser).map(([uid, u], i) => `
    <tr>
      <td style="font-size:.83rem;font-weight:500">${esc(u.name)}</td>
      <td style="text-align:center;font-size:.83rem">${u.hours.toFixed(2)}h</td>
      <td style="text-align:center;font-size:.83rem">${u.km} χλμ.</td>
      <td><input class="form-control" type="number" min="0" step="0.5"
            id="bill-rate-${uid}" value=""
            placeholder="€/h"
            style="width:90px;font-size:.82rem;text-align:right"
            oninput="billingCalc()"></td>
      <td style="text-align:right;font-size:.83rem;font-weight:600;color:var(--navy)" id="bill-sub-${uid}">—</td>
    </tr>`).join('');

  el('bill-results').innerHTML = `
    <hr style="margin:16px 0">
    <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px">Εργαζόμενοι</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <thead>
        <tr style="font-size:.72rem;color:var(--muted);border-bottom:1px solid var(--slate-200)">
          <th style="text-align:left;padding:4px 6px">Εργαζόμενος</th>
          <th style="text-align:center;padding:4px 6px">Ώρες</th>
          <th style="text-align:center;padding:4px 6px">Χλμ.</th>
          <th style="text-align:center;padding:4px 6px">€/h</th>
          <th style="text-align:right;padding:4px 6px">Υποσύνολο</th>
        </tr>
      </thead>
      <tbody>${userRows}</tbody>
    </table>
    <div style="display:flex;gap:16px;margin-bottom:10px;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:140px">
        <label class="form-label">Σύνολο χλμ.</label>
        <input class="form-control" type="number" id="bill-km" value="${totalKm}" oninput="billingCalc()" style="font-size:.85rem">
      </div>
      <div class="form-group" style="flex:1;min-width:140px">
        <label class="form-label">€/km (global)</label>
        <input class="form-control" type="number" id="bill-kmrate" value="${kmRate}" step="0.01" oninput="billingCalc()" style="font-size:.85rem">
      </div>
      <div class="form-group" style="flex:1;min-width:140px">
        <label class="form-label">Άλλα κόστη (€)</label>
        <input class="form-control" type="number" id="bill-other" value="0" step="0.01" oninput="billingCalc()" style="font-size:.85rem">
      </div>
    </div>
    <div id="bill-total-box" style="background:var(--paper);border:1px solid var(--slate-200);border-radius:6px;padding:10px 14px;font-size:.9rem;margin-bottom:4px">
      <div style="display:flex;justify-content:space-between"><span>Κόστος μετακίνησης:</span><span id="bill-km-cost">—</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px"><span>Αμοιβή εργασίας:</span><span id="bill-labor-total">—</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px"><span>Άλλα κόστη:</span><span id="bill-other-display">—</span></div>
      <hr style="margin:8px 0">
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:1rem;color:var(--navy)"><span>ΓΕΝΙΚΟ ΣΥΝΟΛΟ:</span><span id="bill-grand">—</span></div>
    </div>`;

  // Store context for export
  window._billingCtx = { projId, proj, from, to, byUser, entries };
  billingCalc();

  // Update footer
  const footer = document.querySelector('.modal-footer');
  if (footer) footer.innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Κλείσιμο</button>
    <button class="btn btn-ghost btn-sm" onclick="billingLoad()">↺ Ανανέωση</button>
    <button class="btn btn-primary btn-sm" onclick="billingExportXlsx()">⬇ Εξαγωγή Excel</button>`;
};

window.billingCalc = function() {
  const ctx = window._billingCtx; if (!ctx) return;
  const kmTotal  = parseFloat(el('bill-km')?.value||0);
  const kmRate   = parseFloat(el('bill-kmrate')?.value||0);
  const other    = parseFloat(el('bill-other')?.value||0);
  setKmRate(kmRate);

  let laborTotal = 0;
  Object.entries(ctx.byUser).forEach(([uid, u]) => {
    const rate = parseFloat(el(`bill-rate-${uid}`)?.value||0);
    const sub  = u.hours * rate;
    laborTotal += sub;
    const subEl = el(`bill-sub-${uid}`);
    if (subEl) subEl.textContent = rate > 0 ? sub.toFixed(2)+' €' : '—';
  });

  const kmCost = kmTotal * kmRate;
  const grand  = laborTotal + kmCost + other;

  const fmt2 = n => n.toFixed(2) + ' €';
  const setT = (id, val) => { const e2=el(id); if(e2) e2.textContent=val; };
  setT('bill-km-cost',      fmt2(kmCost));
  setT('bill-labor-total',  fmt2(laborTotal));
  setT('bill-other-display',fmt2(other));
  setT('bill-grand',        fmt2(grand));
};

window.billingExportXlsx = async function() {
  if (!window._billingCtx) return;
  if (!window.ExcelJS) { showToast('Η βιβλιοθήκη ExcelJS δεν φορτώθηκε ακόμα. Δοκιμάστε ξανά σε λίγο.','error'); return; }

  const { proj, from, to, byUser, entries } = window._billingCtx;
  const kmTotal    = parseFloat(el('bill-km')?.value||0);
  const kmRate     = parseFloat(el('bill-kmrate')?.value||0);
  const other      = parseFloat(el('bill-other')?.value||0);
  const kmCost     = kmTotal * kmRate;
  const userRates  = {};
  Object.keys(byUser).forEach(uid => { userRates[uid] = parseFloat(el(`bill-rate-${uid}`)?.value||0); });
  const laborTotal = Object.entries(byUser).reduce((s,[uid,u])=>s + u.hours * userRates[uid], 0);
  const grand      = laborTotal + kmCost + other;
  const r2         = n => parseFloat(n.toFixed(2));

  // ── Palette (ARGB) ─────────────────────────────────────────────
  const CLR = {
    darkBlue:  'FF1F497D',
    medBlue:   'FF4472C4',
    lightBlue: 'FFD6E4F7',
    zebra:     'FFEBF3FB',
    white:     'FFFFFFFF',
    textWhite: 'FFFFFFFF',
    textDark:  'FF1F497D',
    hairline:  'FFB8CCE4',
  };

  const fill  = argb => ({ type:'pattern', pattern:'solid', fgColor:{argb} });
  const font  = (argb, bold=false, size=10) => ({ name:'Calibri', color:{argb}, bold, size });
  const hair  = argb => ({ style:'hair', color:{argb} });
  const thin  = argb => ({ style:'thin', color:{argb} });
  const bord  = (bottom) => ({ bottom });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'B&E Solutions';
  wb.created = new Date();
  const ws = wb.addWorksheet('Κοστολόγηση', {
    pageSetup: { paperSize:9, orientation:'portrait', fitToPage:true, fitToWidth:1 }
  });

  ws.columns = [
    { width:42 }, { width:22 }, { width:16 },
    { width:10 }, { width:10 }, { width:30 },
  ];

  let ri = 1; // row index tracker for mergeCells

  // ── helpers ────────────────────────────────────────────────────
  const styleRow = (row, opts) => {
    const cols = opts.cols || ['A','B','C'];
    cols.forEach(c => {
      const cell = row.getCell(c);
      if (opts.fill)  cell.fill      = fill(opts.fill);
      if (opts.font)  cell.font      = opts.font;
      if (opts.align) cell.alignment = opts.align;
      if (opts.bord)  cell.border    = opts.bord;
    });
  };

  const addMainHeader = () => {
    const row = ws.addRow(['B&E SOLUTIONS — ΑΝΑΦΟΡΑ ΚΟΣΤΟΛΟΓΗΣΗΣ','','','','','']);
    row.height = 26;
    ws.mergeCells(`A${ri}:F${ri}`);
    styleRow(row, {
      fill: CLR.darkBlue,
      font: font(CLR.textWhite, true, 13),
      align: { vertical:'middle', horizontal:'center' },
      cols: ['A'],
    });
    ri++;
  };

  const addProjHeader = () => {
    const label = (proj.code ? proj.code + ' — ' : '') + proj.name + (proj.clientName ? '  |  ' + proj.clientName : '');
    const row = ws.addRow([label,'','','','','']);
    row.height = 20;
    ws.mergeCells(`A${ri}:F${ri}`);
    styleRow(row, {
      fill: CLR.medBlue,
      font: font(CLR.textWhite, false, 11),
      align: { vertical:'middle', horizontal:'center' },
      cols: ['A'],
    });
    ri++;
  };

  const addDateRow = (label, value) => {
    const row = ws.addRow([label,'',value,'','','']);
    row.height = 15;
    styleRow(row, { fill:CLR.zebra, font:font('FF000000',false,10), cols:['A','B','C','D','E','F'] });
    row.getCell('C').alignment = { horizontal:'right' };
    row.getCell('C').border    = bord(hair(CLR.hairline));
    ri++;
  };

  const addEmpty = (h=8) => { const r=ws.addRow([]); r.height=h; ri++; };

  const addSectionHd = (label) => {
    const row = ws.addRow([label,'','','','','']);
    row.height = 17;
    ws.mergeCells(`A${ri}:F${ri}`);
    styleRow(row, {
      fill: CLR.lightBlue,
      font: font(CLR.textDark, true, 10),
      align: { vertical:'middle' },
      cols: ['A'],
    });
    ri++;
  };

  const addDataRow = (label, value, shaded=false) => {
    const isNum = typeof value === 'number';
    const row   = ws.addRow([label,'', isNum ? value : (value||'—'),'','','']);
    row.height  = 15;
    const bg    = shaded ? CLR.zebra : CLR.white;
    styleRow(row, { fill:bg, font:font('FF212121',false,10), bord:bord(hair(CLR.hairline)), cols:['A','B','C','D','E','F'] });
    row.getCell('C').alignment = { horizontal:'right' };
    if (isNum) row.getCell('C').numFmt = '#,##0.00 "€"';
    ri++;
  };

  const addTotalRow = (value) => {
    const row = ws.addRow(['ΓΕΝΙΚΟ ΣΥΝΟΛΟ ΑΜΟΙΒΗΣ:','', r2(value),'','','']);
    row.height = 22;
    ws.mergeCells(`A${ri}:B${ri}`);
    styleRow(row, {
      fill: CLR.darkBlue,
      font: font(CLR.textWhite, true, 12),
      align: { vertical:'middle' },
      cols: ['A','B','C','D','E','F'],
    });
    row.getCell('C').alignment = { horizontal:'right', vertical:'middle' };
    row.getCell('C').numFmt   = '#,##0.00 "€"';
    ri++;
  };

  // ── Build sheet ────────────────────────────────────────────────
  addMainHeader();
  addProjHeader();
  addDateRow('ΑΠΟ (ΗΜΕΡΟΜΗΝΙΑ):', fmt(from));
  addDateRow('ΕΩΣ (ΗΜΕΡΟΜΗΝΙΑ):', fmt(to));
  addEmpty();

  // Per-employee
  addSectionHd('ΑΜΟΙΒΗ ΕΡΓΑΣΙΑΣ');
  let sh = false;
  Object.entries(byUser).forEach(([uid, u]) => {
    const rate = userRates[uid];
    const sub  = r2(u.hours * rate);
    addDataRow(`${u.name}  —  ${u.hours.toFixed(2)}h  ×  ${rate.toFixed(2)} €/h`, sub, sh);
    sh = !sh;
  });
  addEmpty();

  // Movement
  addSectionHd('ΕΞΟΔΑ ΜΕΤΑΚΙΝΗΣΗΣ');
  addDataRow('Συνολικά χιλιόμετρα:', kmTotal, false);
  addDataRow('Κόστος ανά χλμ. (€/km):', kmRate, true);
  addDataRow('Κόστος μετακίνησης:', r2(kmCost), false);
  addEmpty();

  // Other
  addSectionHd('ΑΛΛΑ ΚΟΣΤΗ');
  addDataRow('Λοιπά έξοδα:', other > 0 ? r2(other) : 0, false);
  addEmpty();

  // Grand total
  addTotalRow(grand);
  addEmpty(14);
  addEmpty(14);

  // Detail table header
  {
    const row = ws.addRow(['ΗΜΕΡΟΜΗΝΙΑ','ΠΕΡΙΓΡΑΦΗ ΕΡΓΑΣΙΑΣ','ΠΟΙΟΣ','ΩΡΕΣ','ΧΛΜ.','ΣΧΟΛΙΑ']);
    row.height = 17;
    row.eachCell({ includeEmpty:true }, cell => {
      cell.fill      = fill(CLR.medBlue);
      cell.font      = font(CLR.textWhite, true, 10);
      cell.alignment = { vertical:'middle', horizontal:'center' };
      cell.border    = { bottom: thin(CLR.darkBlue) };
    });
    ri++;
  }

  // Detail rows
  const sorted = [...entries].sort((a,b) => a.date.localeCompare(b.date));
  sorted.forEach((e, i) => {
    const row = ws.addRow([
      fmt(e.date), e.desc||'', e.userName||'',
      parseFloat(e.hours||0), e.km||0, e.comments||'',
    ]);
    row.height = 15;
    const bg = i % 2 === 0 ? CLR.white : CLR.zebra;
    row.eachCell({ includeEmpty:true }, cell => {
      cell.fill   = fill(bg);
      cell.font   = font('FF212121', false, 10);
      cell.border = bord(hair(CLR.hairline));
    });
    row.getCell(4).numFmt    = '0.00';
    row.getCell(4).alignment = { horizontal:'center' };
    row.getCell(5).alignment = { horizontal:'center' };
    ri++;
  });

  // ── Download ───────────────────────────────────────────────────
  showToast('Δημιουργία αρχείου…','');
  const buffer   = await wb.xlsx.writeBuffer();
  const blob     = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const filename = `Κοστολόγηση_${(proj.name||'Έργο').replace(/[^α-ωΑ-Ωa-zA-Z0-9]/g,'_')}_${from}_${to}.xlsx`;
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Αρχείο "${filename}" λήφθηκε.`, 'success');
};

// ── STANDING PROJECTS ─────────────────────────────────────────────
function showModalManageStanding() {
  const renderList = () => {
    const list = getStandingProjects();
    if (!list.length) return `<p class="text-muted" style="font-size:.82rem;padding:8px 0">Δεν υπάρχουν μόνιμα έργα ακόμα.</p>`;
    return list.map(p=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--slate-100)">
        <span style="font-size:.85rem;font-weight:500">${esc(p.name)}</span>
        <button class="btn btn-danger btn-sm" onclick="deleteStandingProject('${p.id}')">✕</button>
      </div>`).join('');
  };

  showModal(`
    <div class="modal-header">
      <div class="modal-title">⚙ Μόνιμα Έργα Timesheet</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px">
        Τα μόνιμα έργα εμφανίζονται πάντα στο dropdown του Timesheet, ανεξάρτητα από τα ενεργά έργα.
      </p>
      <div id="standing-list">${renderList()}</div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <input class="form-control" id="standing-new-name" placeholder="Όνομα νέου μόνιμου έργου (π.χ. ΓΡΑΦΕΙΟ)" style="flex:1">
        <button class="btn btn-primary btn-sm" onclick="addStandingProject()">+ Προσθήκη</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Κλείσιμο</button>
    </div>`);
}

window.addStandingProject = async function() {
  const nameEl = el('standing-new-name');
  const name = nameEl?.value?.trim();
  if (!name) { showToast('Εισάγετε όνομα.','error'); return; }
  const exists = getStandingProjects().find(p=>p.name.toLowerCase()===name.toLowerCase());
  if (exists) { showToast('Υπάρχει ήδη αυτό το μόνιμο έργο.','error'); return; }
  const proj = { id:'sp_'+Date.now(), name, standing:true, createdAt:new Date().toISOString() };
  state.db.projects = [proj, ...(state.db.projects||[])];
  await dbSaveProject(proj);
  showToast(`«${name}» προστέθηκε.`,'success');
  // Re-render the list inside the modal
  const listEl = el('standing-list');
  if (listEl) listEl.innerHTML = getStandingProjects().map(p=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--slate-100)">
      <span style="font-size:.85rem;font-weight:500">${esc(p.name)}</span>
      <button class="btn btn-danger btn-sm" onclick="deleteStandingProject('${p.id}')">✕</button>
    </div>`).join('') || `<p class="text-muted" style="font-size:.82rem;padding:8px 0">Δεν υπάρχουν μόνιμα έργα ακόμα.</p>`;
  if (nameEl) nameEl.value = '';
};

window.deleteStandingProject = async function(pid) {
  const proj = getProject(pid); if (!proj) return;
  if (!confirm(`Διαγραφή μόνιμου έργου «${proj.name}»;\nΟι ήδη καταχωρημένες ώρες δεν επηρεάζονται.`)) return;
  state.db.projects = state.db.projects.filter(p=>p.id!==pid);
  await sb.from('be_projects').delete().eq('id', pid);
  showToast(`«${proj.name}» διαγράφηκε.`,'success');
  const listEl = el('standing-list');
  if (listEl) {
    const remaining = getStandingProjects();
    listEl.innerHTML = remaining.length
      ? remaining.map(p=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--slate-100)"><span style="font-size:.85rem;font-weight:500">${esc(p.name)}</span><button class="btn btn-danger btn-sm" onclick="deleteStandingProject('${p.id}')">✕</button></div>`).join('')
      : `<p class="text-muted" style="font-size:.82rem;padding:8px 0">Δεν υπάρχουν μόνιμα έργα ακόμα.</p>`;
  }
};

// ── TIMESHEET CRUD ────────────────────────────────────────────────
// ── TIME RANGE HELPERS ────────────────────────────────────────────
function buildTimeOptions(selected) {
  let opts = `<option value="">—</option>`;
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      opts += `<option value="${val}" ${val===selected?'selected':''}>${val}</option>`;
    }
  }
  return opts;
}
function calcTsMins(from, to) {
  if (!from || !to) return null;
  const [fh,fm] = from.split(':').map(Number);
  const [th,tm] = to.split(':').map(Number);
  return (th*60+tm) - (fh*60+fm);
}
window.updateTsPreview = function(prefix) {
  const from = el(prefix+'-timeFrom')?.value;
  const to   = el(prefix+'-timeTo')?.value;
  const prev = el(prefix+'-preview');
  if (!prev) return;
  if (!from || !to) { prev.innerHTML=''; return; }
  const mins = calcTsMins(from, to);
  if (mins <= 0) {
    prev.innerHTML=`<span style="color:var(--red);font-size:.8rem">⚠ Η ώρα λήξης πρέπει να είναι μετά την έναρξη</span>`;
  } else {
    const h = Math.floor(mins/60), m = mins%60;
    prev.innerHTML=`<span style="color:var(--navy);font-size:.82rem;font-weight:600">= ${h > 0 ? h+'ω ' : ''}${m > 0 ? m+'λ' : ''} (${(mins/60).toFixed(2)}h)</span>`;
  }
};

function showModalAddTimesheet() {
  const cu=state.cu;
  const isAdminOrMgmt=['admin','management'].includes(cu.role);
  const accessibleProjects=isAdminOrMgmt ? state.db.projects : visibleProjects();
  const myProjects=accessibleProjects.filter(p=>p.standing || p.status==='in_progress');
  const today=new Date().toISOString().slice(0,10);

  const userSel=isAdminOrMgmt
    ? `<div class="form-group">
        <label class="form-label">Χρήστης</label>
        <select class="form-control" id="ts-userId">
          ${sortByName(state.db.users.filter(u=>u.role!=='client')).map(u=>`<option value="${u.id}" data-name="${esc(u.name)}" ${u.id===cu.id?'selected':''}>${esc(u.name)}</option>`).join('')}
        </select>
      </div>`:'';

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Νέα Καταχώρηση Ωρών</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      ${userSel}
      <div class="form-group">
        <label class="form-label">Ημερομηνία</label>
        <input class="form-control" type="date" id="ts-date" value="${today}">
      </div>
      <div class="form-group">
        <label class="form-label">Έργο</label>
        <select class="form-control" id="ts-projectId" onchange="syncTsCategoryFromProject('ts')">
          ${buildTsProjectOptions(myProjects)}
        </select>
        <div class="form-hint">Εμφανίζονται μόνο ενεργά έργα και Μόνιμα Έργα Timesheet.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Είδος Έργου <sup>*</sup></label>
        <select class="form-control" id="ts-categoryId">
          ${buildTimesheetCategoryOptions('',true)}
        </select>
        <div class="form-hint">Συμπληρώνεται από την κατηγορία του έργου και μπορεί να αλλάξει χειροκίνητα.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Ώρα</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="form-control" id="ts-timeFrom" onchange="updateTsPreview('ts')" style="flex:1">${buildTimeOptions('09:00')}</select>
          <span style="color:var(--muted);font-size:.85rem">έως</span>
          <select class="form-control" id="ts-timeTo" onchange="updateTsPreview('ts')" style="flex:1">${buildTimeOptions('10:00')}</select>
        </div>
        <div id="ts-preview" style="margin-top:6px;min-height:20px"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Περιγραφή <span class="text-muted">(προαιρετικό)</span></label>
        <textarea class="form-control" id="ts-desc" rows="2" placeholder="Τι έγινε..."></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Χιλιόμετρα <span class="text-muted">(προαιρετικό)</span></label>
        <input class="form-control" type="number" id="ts-km" min="0" step="1" placeholder="π.χ. 45">
      </div>
      <div class="form-group">
        <label class="form-label">Σχόλια <span class="text-muted">(προαιρετικό)</span></label>
        <textarea class="form-control" id="ts-comments" rows="2" placeholder="Πρόσθετες σημειώσεις..."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Ακύρωση</button>
      <button class="btn btn-primary btn-sm" onclick="saveTimesheetEntry()">Αποθήκευση</button>
    </div>`);
  setTimeout(()=>{
    updateTsPreview('ts');
    syncTsCategoryFromProject('ts');
  },50);
}

function showModalEditTimesheet(eid) {
  const entry=(state.db.timesheets||[]).find(e=>e.id===eid); if(!entry) return;
  const cu=state.cu;
  const isAdminOrMgmt=['admin','management'].includes(cu.role);
  const accessibleProjects=isAdminOrMgmt ? state.db.projects : visibleProjects();
  const myProjects=accessibleProjects.filter(p=>p.standing || p.status==='in_progress' || p.id===entry.projectId);

  const existFrom=entry.timeFrom||'09:00';
  const existMins=Math.round((parseFloat(entry.hours||1))*60);
  const [fh,fm]=existFrom.split(':').map(Number);
  const toMins=fh*60+fm+existMins;
  const existTo=entry.timeTo||`${String(Math.floor(toMins/60)%24).padStart(2,'0')}:${String(toMins%60).padStart(2,'0')}`;

  showModal(`
    <div class="modal-header">
      <div class="modal-title">Επεξεργασία Καταχώρησης</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Ημερομηνία</label>
        <input class="form-control" type="date" id="tse-date" value="${entry.date}">
      </div>
      <div class="form-group">
        <label class="form-label">Έργο</label>
        <select class="form-control" id="tse-projectId" onchange="syncTsCategoryFromProject('tse')">
          ${buildTsProjectOptions(myProjects,entry.projectId,entry.projectName||'')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Είδος Έργου <sup>*</sup></label>
        <select class="form-control" id="tse-categoryId">
          ${buildTimesheetCategoryOptions(entry.projectCategoryId||'',true)}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Ώρα</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="form-control" id="tse-timeFrom" onchange="updateTsPreview('tse')" style="flex:1">${buildTimeOptions(existFrom)}</select>
          <span style="color:var(--muted);font-size:.85rem">έως</span>
          <select class="form-control" id="tse-timeTo" onchange="updateTsPreview('tse')" style="flex:1">${buildTimeOptions(existTo)}</select>
        </div>
        <div id="tse-preview" style="margin-top:6px;min-height:20px"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Περιγραφή</label>
        <textarea class="form-control" id="tse-desc" rows="2">${esc(entry.desc||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Χιλιόμετρα <span class="text-muted">(προαιρετικό)</span></label>
        <input class="form-control" type="number" id="tse-km" min="0" step="1" value="${entry.km||''}">
      </div>
      <div class="form-group">
        <label class="form-label">Σχόλια <span class="text-muted">(προαιρετικό)</span></label>
        <textarea class="form-control" id="tse-comments" rows="2">${esc(entry.comments||'')}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost btn-sm" onclick="closeModal()">Ακύρωση</button>
      <button class="btn btn-primary btn-sm" onclick="updateTimesheetEntry('${eid}')">Αποθήκευση</button>
    </div>`);
  setTimeout(()=>updateTsPreview('tse'),50);
}

window.updateTimesheetEntry = async function(eid) {
  const entry=(state.db.timesheets||[]).find(e=>e.id===eid); if(!entry) return;
  const date=el('tse-date')?.value?.trim();
  const projectId=el('tse-projectId')?.value;
  const categoryId=el('tse-categoryId')?.value;
  const timeFrom=el('tse-timeFrom')?.value;
  const timeTo=el('tse-timeTo')?.value;
  const desc=el('tse-desc')?.value?.trim();
  const kmRaw=el('tse-km')?.value?.trim();
  const comments=el('tse-comments')?.value?.trim();

  if(!date){showToast('Επιλέξτε ημερομηνία.','error');return;}
  if(!projectId){showToast('Επιλέξτε έργο.','error');return;}
  if(!categoryId){showToast('Επιλέξτε είδος έργου.','error');return;}
  if(!timeFrom){showToast('Επιλέξτε ώρα έναρξης.','error');return;}
  if(!timeTo){showToast('Επιλέξτε ώρα λήξης.','error');return;}

  const mins=calcTsMins(timeFrom,timeTo);
  if(!mins||mins<=0){showToast('Η ώρα λήξης πρέπει να είναι μετά την έναρξη.','error');return;}

  const proj=getProject(projectId);
  const cat=getTimesheetCategory(categoryId);
  entry.date=date;
  entry.projectId=projectId;
  entry.projectName=proj?.name || entry.projectName;
  entry.projectCategoryId=cat?.id || null;
  entry.projectCategoryName=cat?.name || null;
  entry.timeFrom=timeFrom;
  entry.timeTo=timeTo;
  entry.hours=parseFloat((mins/60).toFixed(2));
  entry.desc=desc;
  entry.km=kmRaw ? parseInt(kmRaw,10) : null;
  entry.comments=comments||null;

  closeModal();
  await dbSaveTimesheet(entry);
  await refreshTimesheetAfterMutation(state.tsPage||1);
  showToast('Η καταχώρηση ενημερώθηκε.','success');
};

window.saveTimesheetEntry = async function() {
  const cu=state.cu;
  const isAdminOrMgmt=['admin','management'].includes(cu.role);
  const date=el('ts-date')?.value?.trim();
  const projectId=el('ts-projectId')?.value;
  const categoryId=el('ts-categoryId')?.value;
  const timeFrom=el('ts-timeFrom')?.value;
  const timeTo=el('ts-timeTo')?.value;
  const desc=el('ts-desc')?.value?.trim();
  const kmRaw=el('ts-km')?.value?.trim();
  const comments=el('ts-comments')?.value?.trim();

  let userId=cu.id,userName=cu.name;
  if(isAdminOrMgmt){
    const sel=el('ts-userId');
    if(sel){
      userId=sel.value;
      userName=sel.options[sel.selectedIndex]?.dataset?.name || sel.options[sel.selectedIndex]?.text || cu.name;
    }
  }

  if(!date){showToast('Επιλέξτε ημερομηνία.','error');return;}
  if(!projectId){showToast('Επιλέξτε έργο.','error');return;}
  if(!categoryId){showToast('Επιλέξτε είδος έργου.','error');return;}
  if(!timeFrom){showToast('Επιλέξτε ώρα έναρξης.','error');return;}
  if(!timeTo){showToast('Επιλέξτε ώρα λήξης.','error');return;}

  const mins=calcTsMins(timeFrom,timeTo);
  if(!mins||mins<=0){showToast('Η ώρα λήξης πρέπει να είναι μετά την έναρξη.','error');return;}

  const proj=getProject(projectId);
  const cat=getTimesheetCategory(categoryId);
  const entry={
    id:'ts_'+Date.now(),
    userId,userName,
    projectId,projectName:proj?.name||'',
    projectCategoryId:cat?.id||null,
    projectCategoryName:cat?.name||null,
    date,timeFrom,timeTo,
    hours:parseFloat((mins/60).toFixed(2)),
    desc,
    km:kmRaw ? parseInt(kmRaw,10) : null,
    comments:comments||null,
    createdAt:nowTS()
  };

  closeModal();
  await dbSaveTimesheet(entry);
  if(isSupabaseAuthMode()) await loadTimesheetPage(1);
  else { state.db.timesheets.push(entry); state.tsPage=1; render(); }
  showToast('Η καταχώρηση αποθηκεύτηκε.','success');
};

async function deleteTimesheetEntry(eid) {
  if(!confirm('Διαγραφή εγγραφής;')) return;
  await dbDeleteTimesheet(eid);
  if(isSupabaseAuthMode()) await loadTimesheetPage(state.tsPage||1);
  else { state.db.timesheets=(state.db.timesheets||[]).filter(e=>e.id!==eid); render(); }
  showToast('Η εγγραφή διαγράφηκε.','success');
}

// ── CONVERT PROJECT → TEMPLATE ────────────────────────────────────
function showModalCreateTemplateFromProject(pid) {
  const proj = getProject(pid); if (!proj) return;
  const phCount  = (proj.phases||[]).length;
  const taskCount = (proj.phases||[]).reduce((s,ph)=>s+(ph.tasks||[]).length, 0);
  const tpls = sortByName(state.db.templates || []);
  const tplOpts = tpls.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const mergeTab = tpls.length ? `
    <div id="p2t-tab-merge" class="doc-tab-body" style="display:none">
      <div class="form-group" style="margin-top:12px">
        <label class="form-label">Επιλογή Προτύπου <sup>*</sup></label>
        <select class="form-control" id="p2t-tplid" onchange="p2tShowDiff('${pid}')">
          <option value="">— Επιλέξτε πρότυπο —</option>${tplOpts}
        </select>
      </div>
      <div id="p2t-diff-area"></div>
      <div class="form-hint">Εμφανίζονται μόνο φάσεις/εργασίες που ΔΕΝ υπάρχουν ήδη στο πρότυπο.</div>
    </div>` : `<div id="p2t-tab-merge" class="doc-tab-body" style="display:none"><div class="form-hint" style="margin-top:12px">Δεν υπάρχουν αποθηκευμένα πρότυπα.</div></div>`;

  showModal(`
  <div class="modal-header">
    <div class="modal-title">📋 Φάσεις/Εργασίες σε Πρότυπο</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div class="doc-add-tabs">
      <button class="doc-tab active" onclick="docTabSwitch(this,'p2t-tab-new')">✨ Νέο Πρότυπο</button>
      <button class="doc-tab" onclick="docTabSwitch(this,'p2t-tab-merge')">📋 Ενημέρωση Υπάρχοντος</button>
    </div>
    <div id="p2t-tab-new" class="doc-tab-body">
      <div style="background:var(--bg-alt,#f8fafc);border:1px solid var(--navy-line);border-radius:8px;padding:12px 16px;margin:12px 0;font-size:.82rem">
        Θα δημιουργηθεί πρότυπο από το έργο <strong>${esc(proj.name)}</strong>:<br>
        <span style="margin-top:4px;display:block">📂 ${phCount} φάσεις &nbsp;·&nbsp; ✅ ${taskCount} εργασίες</span>
        <span style="font-size:.75rem;color:var(--muted);margin-top:4px;display:block">Αναθέσεις, ημερομηνίες και καταστάσεις ΔΕΝ αντιγράφονται.</span>
      </div>
      <div class="form-group">
        <label class="form-label">Τίτλος Προτύπου <sup>*</sup></label>
        <input class="form-control" id="p2t-name" value="${esc(proj.name)}" placeholder="π.χ. Πρότυπο Μεταβίβασης">
      </div>
      <div class="form-group">
        <label class="form-label">Περιγραφή</label>
        <input class="form-control" id="p2t-desc" placeholder="Σύντομη περιγραφή του προτύπου">
      </div>
      <div class="modal-footer-inline">
        <button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>
        <button class="btn btn-primary" onclick="modalSaveProjectAsTemplate('${pid}')">📋 Δημιουργία</button>
      </div>
    </div>
    ${mergeTab}
  </div>`);
}
window.p2tShowDiff = function(pid) {
  const tplId = el('p2t-tplid')?.value; const area = el('p2t-diff-area'); if (!area) return;
  if (!tplId) { area.innerHTML = ''; return; }
  const proj = getProject(pid); const tpl = getTemplate(tplId);
  if (!proj || !tpl) return;
  const tplPhaseNames = new Set((tpl.phases||[]).map(p=>p.name.trim().toLowerCase()));

  const rows = (proj.phases||[]).map((ph, pi) => {
    const phNew = !tplPhaseNames.has(ph.name.trim().toLowerCase());
    // For existing phases, find new tasks
    const tplPh = (tpl.phases||[]).find(p=>p.name.trim().toLowerCase()===ph.name.trim().toLowerCase());
    const tplTaskNames = new Set((tplPh?.tasks||[]).map(t=>t.name.trim().toLowerCase()));
    const newTasks = (ph.tasks||[]).filter(t=>t.status!=='cancelled'&&!tplTaskNames.has(t.name.trim().toLowerCase()));

    if (!phNew && !newTasks.length) return ''; // nothing new

    const tasksHtml = (phNew ? (ph.tasks||[]).filter(t=>t.status!=='cancelled') : newTasks).map(t=>`
      <label class="cat-proj-item" style="padding-left:8px">
        <input type="checkbox" class="p2t-task" data-phidx="${pi}" data-phname="${esc(ph.name)}" data-tname="${esc(t.name)}" checked>
        ${esc(t.name)}
      </label>`).join('');

    return `<div class="cat-access-item">
      <label class="cat-access-head" style="background:${phNew?'var(--orange-light)':'var(--paper-2)'}">
        <input type="checkbox" class="p2t-phase" data-phidx="${pi}" ${phNew?'checked':''} onchange="p2tTogglePhase(this,'${pi}')">
        <span class="cat-access-name">${esc(ph.name)}</span>
        ${phNew?'<span class="cat-access-badge">Νέα Φάση</span>':'<span style="font-size:.68rem;color:var(--muted)">+νέες εργασίες</span>'}
      </label>
      <div class="cat-proj-list" id="p2t-tasks-${pi}">${tasksHtml}</div>
    </div>`;
  }).join('');

  area.innerHTML = rows || `<div class="form-hint" style="margin-top:8px;color:var(--green)">✓ Το πρότυπο είναι ήδη ενημερωμένο — δεν υπάρχουν νέες φάσεις ή εργασίες.</div>`;
  // Add save button
  if (rows) {
    area.insertAdjacentHTML('beforeend', `<div class="modal-footer-inline" style="margin-top:12px">
      <button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>
      <button class="btn btn-primary" onclick="modalMergeToTemplate('${pid}')">💾 Ενημέρωση Προτύπου</button>
    </div>`);
  }
};
window.p2tTogglePhase = function(cb, phIdx) {
  const list = el('p2t-tasks-'+phIdx); if (!list) return;
  list.querySelectorAll('.p2t-task').forEach(c => c.checked = cb.checked);
};
window.modalMergeToTemplate = async function(pid) {
  const tplId = el('p2t-tplid')?.value; if (!tplId) { alert('Επιλέξτε πρότυπο.'); return; }
  const proj = getProject(pid); const tpl = getTemplate(tplId); if (!proj||!tpl) return;

  const checkedTasks = Array.from(document.querySelectorAll('.p2t-task:checked'));
  if (!checkedTasks.length) { alert('Επιλέξτε τουλάχιστον μία εργασία.'); return; }

  // Group by phase name
  const byPhase = {};
  checkedTasks.forEach(cb => {
    const phName = cb.dataset.phname; const tName = cb.dataset.tname;
    if (!byPhase[phName]) byPhase[phName] = [];
    byPhase[phName].push(tName);
  });

  const tplPhaseNames = new Set((tpl.phases||[]).map(p=>p.name.trim().toLowerCase()));
  let added = 0;

  Object.entries(byPhase).forEach(([phName, taskNames]) => {
    let tplPh = tpl.phases.find(p=>p.name.trim().toLowerCase()===phName.trim().toLowerCase());
    if (!tplPh) {
      // Add entire new phase
      const srcPh = proj.phases.find(p=>p.name===phName);
      tplPh = { id:'ph_'+uid(), name:phName, order:(tpl.phases.length+1), tasks:[] };
      tpl.phases.push(tplPh);
    }
    const tplTaskNames = new Set((tplPh.tasks||[]).map(t=>t.name.trim().toLowerCase()));
    taskNames.forEach(tName => {
      if (tplTaskNames.has(tName.trim().toLowerCase())) return;
      const srcPh = proj.phases.find(p=>p.name===phName);
      const srcTask = (srcPh?.tasks||[]).find(t=>t.name===tName);
      tplPh.tasks.push({
        id:'task_'+uid(), name:tName,
        subtasks:(srcTask?.subtasks||[]).map(st=>({id:'st_'+uid(),name:st.name||st,done:false})),
        docs:(srcTask?.docs||[]).map(d=>({id:'d_'+uid(),name:d.name,cat:d.cat,type:d.type||'client',required:d.required!==false,done:false}))
      });
      added++;
    });
  });

  await dbSaveTemplate(tpl);
  auditLog('Ενημέρωση προτύπου',`"${tpl.name}" +${added} εργασίες από "${proj.name}"`);
  closeModal();
  showToast(`Πρότυπο «${tpl.name}» ενημερώθηκε (+${added} εργασίες).`, 'success');
};
window.modalSaveProjectAsTemplate = async function(pid) {
  const proj = getProject(pid); if (!proj) return;
  const name = el('p2t-name').value.trim();
  if (!name) { alert('Συμπληρώστε τίτλο προτύπου.'); return; }
  const desc = el('p2t-desc').value.trim();

  // Convert project phases → template phases (strip runtime data)
  const phases = (proj.phases||[]).map((ph, pi) => ({
    id: 'ph_' + uid(),
    name: ph.name,
    order: pi + 1,
    tasks: (ph.tasks||[]).filter(t => t.status !== 'cancelled').map(t => ({
      id: 'task_' + uid(),
      name: t.name,
      subtasks: (t.subtasks||[]).map(st => ({ id: 'st_' + uid(), name: st.name, done: false })),
      docs: (t.docs||[]).map(d => ({
        id: 'd_' + uid(),
        name: d.name,
        cat: d.cat,
        type: d.type || 'client',
        required: d.required !== false,
        done: false
      }))
    }))
  }));

  const tpl = { id: 'tpl_' + uid(), name, desc, phases, createdAt: nowTS(), createdFrom: proj.id };
  if (!state.db.templates) state.db.templates = [];
  state.db.templates.push(tpl);
  await dbSaveTemplate(tpl);
  auditLog('Πρότυπο από έργο', `"${proj.name}" → "${name}"`);
  closeModal();
  showToast(`Πρότυπο «${name}» δημιουργήθηκε επιτυχώς! 🎉`, 'success');
};

// ── APPLY TEMPLATE TO EXISTING PROJECT ────────────────────────────
function showModalApplyTemplate(pid) {
  const proj = getProject(pid); if (!proj) return;
  const tpls = state.db.templates || [];
  if (!tpls.length) { showToast('Δεν υπάρχουν πρότυπα.', 'error'); return; }
  const tplOpts = tpls.map(t => `<option value="${t.id}"${proj.templateId===t.id?' selected':''}>${esc(t.name)} (${(t.phases||[]).length} φάσεις)</option>`).join('');
  showModal(`
  <div class="modal-header">
    <div class="modal-title">📋 Εφαρμογή Προτύπου στο «${esc(proj.name)}»</div>
    <button class="modal-close" onclick="closeModal()">✕</button>
  </div>
  <div class="modal-body">
    <div class="form-group">
      <label class="form-label">Επιλογή Προτύπου <sup>*</sup></label>
      <select class="form-control" id="atp-tplid">${tplOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Τρόπος εφαρμογής</label>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="radio" name="atp-mode" value="append" checked style="margin-top:3px">
          <div><div style="font-weight:600;font-size:.85rem">Προσθήκη νέων φάσεων</div><div style="font-size:.75rem;color:var(--muted)">Προσθέτει μόνο φάσεις/εργασίες του προτύπου που ΔΕΝ υπάρχουν ήδη. Οι υπάρχουσες παραμένουν ανέπαφες.</div></div>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="radio" name="atp-mode" value="replace" style="margin-top:3px">
          <div><div style="font-weight:600;font-size:.85rem;color:var(--red)">Αντικατάσταση</div><div style="font-size:.75rem;color:var(--muted)">Διαγράφει όλες τις υπάρχουσες φάσεις και εφαρμόζει το πρότυπο από την αρχή.</div></div>
        </label>
      </div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>
    <button class="btn btn-primary" onclick="modalDoApplyTemplate('${pid}')">Εφαρμογή</button>
  </div>`);
}
window.modalDoApplyTemplate = async function(pid) {
  const proj = getProject(pid); if (!proj) return;
  const tplId = el('atp-tplid').value; if (!tplId) { alert('Επιλέξτε πρότυπο.'); return; }
  const tpl = getTemplate(tplId); if (!tpl) return;
  const mode = document.querySelector('input[name="atp-mode"]:checked')?.value || 'append';
  const managerId = projManagerIds(proj)[0] || state.cu?.id;

  const buildPhases = (tplPhases) => tplPhases.map((tph, pi) => ({
    id: 'ph_'+uid(), name: tph.name, order: pi+1,
    tasks: (tph.tasks||[]).map(tt => ({
      id: 'task_'+uid(), name: tt.name, assigneeId: managerId,
      status: 'not_started', parallel: false, dependsOn: [],
      startDate: null, completedDate: null, plannedStart: null, plannedEnd: null,
      notes: tt.notes||'',
      subtasks: (tt.subtasks||[]).map(sn => ({id:'st_'+uid(), name: sn.name||sn, done: false})),
      docs: (tt.docs||[]).map(d => ({id:'d_'+uid(), cat:d.cat, name:d.name, required:d.required!==false, done:false, type:d.type||'client', url:null, at:null}))
    }))
  }));

  if (mode === 'replace') {
    if (!confirm('Θα διαγραφούν ΟΛΕΣ οι υπάρχουσες φάσεις και δεδομένα. Συνέχεια;')) return;
    proj.phases = buildPhases(tpl.phases||[]);
  } else {
    // Append: only add phases whose name doesn't already exist
    const existingNames = new Set((proj.phases||[]).map(p => p.name.trim().toLowerCase()));
    const newPhases = (tpl.phases||[]).filter(tph => !existingNames.has(tph.name.trim().toLowerCase()));
    if (!newPhases.length) { showToast('Όλες οι φάσεις του προτύπου υπάρχουν ήδη.', 'info'); closeModal(); return; }
    proj.phases = [...(proj.phases||[]), ...buildPhases(newPhases)];
  }
  proj.templateId = tplId;
  await dbSaveProject(proj);
  auditLog('Εφαρμογή προτύπου', `"${tpl.name}" στο "${proj.name}" (${mode})`);
  closeModal(); render();
  showToast(`Πρότυπο «${tpl.name}» εφαρμόστηκε επιτυχώς!`, 'success');
};

// ── TEMPLATE CRUD ─────────────────────────────────────────────────
function showModalAddTemplate() {
  const existing = sortByName(state.db.templates||[]);
  const tplOptions = existing.length
    ? `<option value="">— Ξεκινήστε από το μηδέν —</option>` + existing.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')
    : `<option value="">— Δεν υπάρχουν πρότυπα ακόμα —</option>`;
  showModal(`<div class="modal-header"><div class="modal-title">Νέο Πρότυπο</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="nt-tname" placeholder="π.χ. Μεταβίβαση Ακινήτου"></div>
    <div class="form-group"><label class="form-label">Περιγραφή</label><textarea class="form-control" id="nt-tdesc" placeholder="Σύντομη περιγραφή…"></textarea></div>
    ${existing.length ? `<div class="form-group"><label class="form-label">Αντιγραφή φάσεων από υπάρχον πρότυπο <span class="text-muted" style="font-size:.72rem">(προαιρετικό)</span></label><select class="form-control" id="nt-from-tpl"><option value="">— Ξεκινήστε από το μηδέν —</option>${existing.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>` : ''}
  </div>
  <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveTemplate()">Δημιουργία</button></div>`);
}
window.modalSaveTemplate=async function(){
  const name=el('nt-tname').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  const fromId = el('nt-from-tpl')?.value||'';
  const src = fromId ? getTemplate(fromId) : null;
  const clonedPhases = src ? (src.phases||[]).map(ph=>({
    ...ph,
    id:'ph_'+uid(),
    tasks:(ph.tasks||[]).map(tk=>({
      ...tk,
      id:'tk_'+uid(),
      docs:(tk.docs||[]).map(d=>({...d,id:'d_'+uid()})),
      subtasks:(tk.subtasks||[]).map(st=>typeof st==='string'?st:{...st,id:'st_'+uid()})
    }))
  })) : [];
  const tpl={id:'tpl_'+uid(),name,desc:el('nt-tdesc').value.trim(),phases:clonedPhases};
  if (!state.db.templates) state.db.templates=[];
  state.db.templates.push(tpl);
  auditLog('Δημιουργία προτύπου', src ? `${name} (από «${src.name}»)` : name);
  await dbSaveTemplate(tpl);
  closeModal(); navigate('template',{templateId:tpl.id});
  showToast(`Πρότυπο «${name}» δημιουργήθηκε${src?` με ${clonedPhases.length} φάσεις από «${src.name}»`:'.'}`,'success');
};
function showModalEditTemplate(tid) {
  const tpl=getTemplate(tid); if(!tpl) return;
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Προτύπου</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="et-tname" value="${esc(tpl.name)}"></div><div class="form-group"><label class="form-label">Περιγραφή</label><textarea class="form-control" id="et-tdesc">${esc(tpl.desc||'')}</textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateTemplate('${tid}')">Αποθήκευση</button></div>`);
}
window.modalUpdateTemplate=async function(tid){
  const tpl=getTemplate(tid); if(!tpl) return;
  const name=el('et-tname').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  tpl.name=name; tpl.desc=el('et-tdesc').value.trim();
  auditLog('Επεξεργασία προτύπου',name);
  await dbSaveTemplate(tpl); closeModal(); render(); showToast('Πρότυπο ενημερώθηκε.','success');
};
async function duplicateTemplate(tid) {
  const src = getTemplate(tid); if (!src) return;
  // Deep-clone phases/tasks/docs with fresh IDs
  const clonePhases = (src.phases||[]).map(ph => ({
    ...ph,
    id: 'ph_'+uid(),
    tasks: (ph.tasks||[]).map(tk => ({
      ...tk,
      id: 'tk_'+uid(),
      docs: (tk.docs||[]).map(d => ({...d, id: 'd_'+uid()})),
      subtasks: (tk.subtasks||[]).map(st => typeof st==='string' ? st : {...st, id: 'st_'+uid()})
    }))
  }));
  const newTpl = {
    ...src,
    id: 'tpl_'+uid(),
    name: src.name + ' (Αντίγραφο)',
    phases: clonePhases,
  };
  if (!state.db.templates) state.db.templates = [];
  state.db.templates.push(newTpl);
  auditLog('Αντιγραφή προτύπου', `${src.name} → ${newTpl.name}`);
  await dbSaveTemplate(newTpl);
  render();
  showToast(`Δημιουργήθηκε αντίγραφο: «${newTpl.name}»`, 'success');
}

async function confirmDeleteTemplate(tid) {
  const tpl=getTemplate(tid); if(!tpl) return;
  if (!confirm(`Διαγραφή προτύπου «${tpl.name}»;`)) return;
  state.db.templates=state.db.templates.filter(t=>t.id!==tid);
  auditLog('Διαγραφή προτύπου',tpl.name);
  await dbDeleteTemplate(tid); render(); showToast('Πρότυπο διαγράφηκε.','');
}

// Template phases
function showModalAddTplPhase(tid) {
  showModal(`<div class="modal-header"><div class="modal-title">Προσθήκη Φάσης στο Πρότυπο</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος Φάσης <sup>*</sup></label><input class="form-control" id="tph-name" placeholder="π.χ. Κατάθεση Δικαιολογητικών"></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveTplPhase('${tid}')">Προσθήκη</button></div>`);
}
window.modalSaveTplPhase=async function(tid){
  const tpl=getTemplate(tid); if(!tpl) return;
  const name=el('tph-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  if (!tpl.phases) tpl.phases=[];
  tpl.phases.push({id:'tph_'+uid(),name,tasks:[]});
  await dbSaveTemplate(tpl); closeModal(); render(); showToast('Φάση προστέθηκε.','success');
};
function showModalEditTplPhase(tid,phid) {
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); if(!ph) return;
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Φάσης</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="etph-name" value="${esc(ph.name)}"></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateTplPhase('${tid}','${phid}')">Αποθήκευση</button></div>`);
}
window.modalUpdateTplPhase=async function(tid,phid){
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); if(!ph) return;
  const name=el('etph-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  ph.name=name; await dbSaveTemplate(tpl); closeModal(); render(); showToast('Φάση ενημερώθηκε.','success');
};
async function deleteTplPhase(tid,phid) {
  const tpl=getTemplate(tid); if(!tpl) return;
  if (!confirm('Διαγραφή φάσης και όλων των εργασιών της;')) return;
  tpl.phases=tpl.phases.filter(p=>p.id!==phid);
  await dbSaveTemplate(tpl); render(); showToast('Φάση διαγράφηκε.','');
}

// Template tasks
function showModalAddTplTask(tid,phid) {
  showModal(`<div class="modal-header"><div class="modal-title">Νέα Εργασία Προτύπου</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="ttk-name" placeholder="π.χ. Αίτηση βεβαίωσης"></div>
    <div class="form-group"><label class="form-label">Υποεργασίες <span class="text-muted" style="font-size:.72rem">(μία ανά γραμμή)</span></label><textarea class="form-control" id="ttk-subs" rows="3" placeholder="Υποεργασία 1&#10;Υποεργασία 2"></textarea></div>
    <div class="form-group"><label class="form-label">Σχόλια / Οδηγίες</label><textarea class="form-control" id="ttk-notes" rows="3" placeholder="Προαιρετικές οδηγίες ή σημειώσεις για αυτήν την εργασία…"></textarea></div>
  </div>
  <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveTplTask('${tid}','${phid}')">Προσθήκη</button></div>`);
}
window.modalSaveTplTask=async function(tid,phid){
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); if(!ph) return;
  const name=el('ttk-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  const subs=el('ttk-subs').value.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>({id:'st_'+uid(),name:s,done:false}));
  const notes=el('ttk-notes').value.trim();
  ph.tasks.push({id:'ttk_'+uid(),name,subtasks:subs,notes,docs:[]});
  await dbSaveTemplate(tpl); closeModal(); render(); showToast('Εργασία προστέθηκε.','success');
};
function showModalEditTplTask(tid,phid,tkid) {
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); const tk=ph?.tasks.find(t=>t.id===tkid); if(!tk) return;
  const subsVal=(tk.subtasks||[]).map(s=>s.name).join('\n');
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Εργασίας</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="etk-name" value="${esc(tk.name)}"></div>
    <div class="form-group"><label class="form-label">Υποεργασίες <span class="text-muted" style="font-size:.72rem">(μία ανά γραμμή)</span></label><textarea class="form-control" id="etk-subs" rows="3">${esc(subsVal)}</textarea></div>
    <div class="form-group"><label class="form-label">Σχόλια / Οδηγίες</label><textarea class="form-control" id="etk-notes" rows="3" placeholder="Προαιρετικές οδηγίες ή σημειώσεις…">${esc(tk.notes||'')}</textarea></div>
  </div>
  <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateTplTask('${tid}','${phid}','${tkid}')">Αποθήκευση</button></div>`);
}
window.modalUpdateTplTask=async function(tid,phid,tkid){
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); const tk=ph?.tasks.find(t=>t.id===tkid); if(!tk) return;
  const name=el('etk-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  tk.name=name;
  tk.subtasks=el('etk-subs').value.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>({id:'st_'+uid(),name:s,done:false}));
  tk.notes=el('etk-notes').value.trim();
  await dbSaveTemplate(tpl); closeModal(); render(); showToast('Εργασία ενημερώθηκε.','success');
};
async function deleteTplTask(tid,phid,tkid) {
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); if(!ph) return;
  if (!confirm('Διαγραφή εργασίας;')) return;
  ph.tasks=ph.tasks.filter(t=>t.id!==tkid);
  await dbSaveTemplate(tpl); render(); showToast('Εργασία διαγράφηκε.','');
}

// Template docs
function showModalAddTplDoc(tid,phid,tkid) {
  showModal(`<div class="modal-header"><div class="modal-title">Προσθήκη Εγγράφου</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="tdoc-name" placeholder="π.χ. Αστυνομική Ταυτότητα"></div><div class="form-group"><label class="form-label">Κατηγορία</label><input class="form-control" id="tdoc-cat" placeholder="π.χ. Ταυτότητα"></div><div class="form-group"><label class="form-label">Τύπος</label><select class="form-control" id="tdoc-type"><option value="client">Πελάτης</option><option value="team">Εσωτερικό</option><option value="third_party">Τρίτος</option></select></div><div class="form-group"><label class="form-label" style="cursor:pointer"><input type="checkbox" id="tdoc-req" checked style="margin-right:6px">Απαιτούμενο</label></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveTplDoc('${tid}','${phid}','${tkid}')">Προσθήκη</button></div>`);
}
window.modalSaveTplDoc=async function(tid,phid,tkid){
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); const tk=ph?.tasks.find(t=>t.id===tkid); if(!tk) return;
  const name=el('tdoc-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  if (!tk.docs) tk.docs=[];
  tk.docs.push({id:'d_'+uid(),name,cat:el('tdoc-cat').value.trim(),type:el('tdoc-type').value,required:el('tdoc-req').checked});
  await dbSaveTemplate(tpl); closeModal(); render(); showToast('Έγγραφο προστέθηκε.','success');
};
async function deleteTplDoc(tid,phid,tkid,did) {
  const tpl=getTemplate(tid); const ph=tpl?.phases.find(p=>p.id===phid); const tk=ph?.tasks.find(t=>t.id===tkid); if(!tk) return;
  tk.docs=(tk.docs||[]).filter(d=>d.id!==did);
  await dbSaveTemplate(tpl); render(); showToast('Έγγραφο διαγράφηκε.','');
}

// EDIT CATEGORY
function showModalEditCategory(catId) {
  const cat=getCategory(catId); if(!cat) return;
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Κατηγορίας</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="ec-name" value="${esc(cat.name)}"></div><div class="form-group"><label class="form-label">Περιγραφή</label><textarea class="form-control" id="ec-desc">${esc(cat.desc||'')}</textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateCategory('${catId}')">Αποθήκευση</button></div>`);
}
window.modalUpdateCategory=async function(catId){
  const cat=getCategory(catId); if(!cat) return;
  const name=el('ec-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  cat.name=name; cat.desc=el('ec-desc').value.trim();
  auditLog('Επεξεργασία κατηγορίας',name);
  await dbSaveCategory(cat); closeModal(); render(); showToast('Κατηγορία ενημερώθηκε.','success');
};

// ADD PROJECT
function showModalAddProject(catId) {
  const cat=getCategory(catId);
  const pms=sortByName(state.db.users.filter(u=>['admin','management','project_manager'].includes(u.role)));
  const clients=sortByName(state.db.users.filter(u=>u.role==='client'));
  const tpls=sortByName(state.db.templates||[]);
  const tplOpts=tpls.length
    ? `<div class="form-group"><label class="form-label">Πρότυπο</label><select class="form-control" id="np-tplid"><option value="">— Χωρίς πρότυπο —</option>${tpls.map(t=>`<option value="${t.id}">${esc(t.name)} (${(t.phases||[]).length} φάσεις)</option>`).join('')}</select></div>`
    : '';
  showModal(`<div class="modal-header"><div class="modal-title">Νέο Έργο – ${esc(cat?.name||'')}</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος Έργου <sup>*</sup></label><input class="form-control" id="np-name" placeholder="π.χ. Μεταβίβαση – Παπαδόπουλος Γ."></div><div class="form-group"><label class="form-label">Κωδικός</label><input class="form-control" id="np-code" placeholder="π.χ. OX-2024-005"></div><div class="form-group"><label class="form-label">Ονοματεπώνυμο Πελάτη</label><input class="form-control" id="np-client" placeholder="π.χ. Παπαδόπουλος Γεώργιος"></div><div class="form-group"><label class="form-label">Λογαριασμός Πελάτη</label><select class="form-control" id="np-clientid"><option value="">— Χωρίς λογαριασμό —</option>${clients.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Υπεύθυνοι Έργου <sup>*</sup></label><div class="member-check-list">${pms.map(u=>`<label class="member-check-item"><input type="checkbox" class="np-mgr-cb" value="${u.id}"${u.id===state.cu.id?' checked':''}> ${esc(u.name)}</label>`).join('')}</div></div><div class="modal-date-grid"><div class="form-group"><label class="form-label">📅 Ημ. Έναρξης</label><input type="date" class="form-control" id="np-start" value="${today()}"></div><div class="form-group"><label class="form-label">🏁 Ημ. Λήξης</label><input type="date" class="form-control" id="np-end"></div></div>${tplOpts}</div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveProject('${catId}')">Δημιουργία</button></div>`);
}
window.modalSaveProject=async function(catId){
  const name=el('np-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  const managerIds=Array.from(document.querySelectorAll('.np-mgr-cb:checked')).map(c=>c.value);
  if(!managerIds.length){alert('Επιλέξτε τουλάχιστον έναν υπεύθυνο.');return;}
  const tplId=el('np-tplid')?.value;
  const tpl=tplId?getTemplate(tplId):null;
  let phases=[];
  if (tpl?.phases?.length) {
    phases=tpl.phases.map((tph,pi)=>({id:'ph_'+uid(),name:tph.name,order:pi+1,tasks:(tph.tasks||[]).map(tt=>({id:'task_'+uid(),name:tt.name,assigneeId:managerIds[0]||null,status:'not_started',parallel:false,dependsOn:[],startDate:null,completedDate:null,plannedStart:null,plannedEnd:null,subtasks:(tt.subtasks||[]).map(sn=>({id:'st_'+uid(),name:sn.name||sn,done:false})),docs:(tt.docs||[]).map(d=>({id:'d_'+uid(),cat:d.cat,name:d.name,required:d.required!==false,done:false,type:d.type||'client',url:null,at:null}))}))}));
  }
  const clientId=el('np-clientid').value; const clientName=el('np-client').value.trim()||(clientId?getUser(clientId)?.name:'')||'';
  const proj={id:'proj_'+uid(),categoryId:catId,code:el('np-code').value.trim(),name,clientId:clientId||null,clientName,managerIds,memberIds:[],status:'in_progress',startDate:el('np-start').value||today(),endDate:el('np-end')?.value||null,completedDate:null,phases};
  if (clientId && !isSupabaseAuthMode()) {
    const cu2=getUser(clientId);
    if(cu2){
      cu2.projectIds=cu2.projectIds||[];
      if(!cu2.projectIds.includes(proj.id)){
        cu2.projectIds.push(proj.id);
        await dbSaveUser(cu2);
      }
    }
  }
  state.db.projects.push(proj);
  auditLog('Δημιουργία έργου',name+(tpl?` (πρότυπο: ${tpl.name})`:''));
  await dbSaveProject(proj);
  closeModal(); navigate('project',{projectId:proj.id}); showToast(`Έργο «${name}» δημιουργήθηκε.`,'success');
};

// EDIT PROJECT
function showModalEditProject(pid) {
  const proj=getProject(pid); if(!proj) return;
  const pms=sortByName(state.db.users.filter(u=>['admin','management','project_manager'].includes(u.role)));
  const clients=sortByName(state.db.users.filter(u=>u.role==='client'));
  const curMgrIds = projManagerIds(proj);
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Έργου</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="ep-name" value="${esc(proj.name)}"></div><div class="form-group"><label class="form-label">Κωδικός</label><input class="form-control" id="ep-code" value="${esc(proj.code||'')}"></div><div class="form-group"><label class="form-label">Ονοματεπώνυμο Πελάτη</label><input class="form-control" id="ep-client" value="${esc(proj.clientName||'')}"></div><div class="form-group"><label class="form-label">Λογαριασμός Πελάτη</label><select class="form-control" id="ep-clientid"><option value="">— Χωρίς —</option>${clients.map(c=>`<option value="${c.id}"${c.id===proj.clientId?' selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Υπεύθυνοι Έργου <sup>*</sup></label><div class="member-check-list">${pms.map(u=>`<label class="member-check-item"><input type="checkbox" class="ep-mgr-cb" value="${u.id}"${curMgrIds.includes(u.id)?' checked':''}> ${esc(u.name)}</label>`).join('')}</div></div><div class="modal-date-grid"><div class="form-group"><label class="form-label">📅 Ημ. Έναρξης</label><input type="date" class="form-control" id="ep-start" value="${proj.startDate||''}"></div><div class="form-group"><label class="form-label">🏁 Ημ. Λήξης</label><input type="date" class="form-control" id="ep-end" value="${proj.endDate||''}"></div></div><div class="form-group"><label class="form-label">Κατάσταση</label><select class="form-control" id="ep-status"><option value="in_progress"${proj.status==='in_progress'?' selected':''}>Σε Εξέλιξη</option><option value="completed"${proj.status==='completed'?' selected':''}>Ολοκληρωμένο</option><option value="on_hold"${proj.status==='on_hold'?' selected':''}>Σε Αναστολή</option></select></div><div class="form-group"><label class="form-label" style="cursor:pointer;display:flex;align-items:center;gap:8px"><input type="checkbox" id="ep-enforce-deps"${proj.enforceDeps?' checked':''}> Επιβολή εξαρτήσεων εργασιών</label><div class="form-hint">Όταν ενεργό, εργασία με εξάρτηση δεν μπορεί να αλλάξει κατάσταση μέχρι να ολοκληρωθεί η προηγούμενη.</div></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateProject('${pid}')">Αποθήκευση</button></div>`);
}
window.modalUpdateProject=async function(pid){
  const proj=getProject(pid); if(!proj) return;
  const name=el('ep-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  const managerIds=Array.from(document.querySelectorAll('.ep-mgr-cb:checked')).map(c=>c.value);
  if(!managerIds.length){alert('Επιλέξτε τουλάχιστον έναν υπεύθυνο.');return;}
  proj.name=name; proj.code=el('ep-code').value.trim(); proj.clientName=el('ep-client').value.trim();
  proj.clientId=el('ep-clientid').value||null; proj.managerIds=managerIds; delete proj.managerId; proj.status=el('ep-status').value;
  proj.startDate=el('ep-start')?.value||proj.startDate||null; proj.endDate=el('ep-end')?.value||null;
  proj.enforceDeps=el('ep-enforce-deps')?.checked||false;
  auditLog('Επεξεργασία έργου',name);
  await dbSaveProject(proj); closeModal(); render(); showToast('Έργο ενημερώθηκε.','success');
};

// ADD PHASE
function showModalAddPhase(pid) {
  showModal(`<div class="modal-header"><div class="modal-title">Προσθήκη Φάσης</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος Φάσης <sup>*</sup></label><input class="form-control" id="nph-name" placeholder="π.χ. Κατάθεση Δικαιολογητικών"></div><div class="modal-date-grid"><div class="form-group"><label class="form-label">📅 Ημ. Έναρξης</label><input type="date" class="form-control" id="nph-start"></div><div class="form-group"><label class="form-label">📅 Ημ. Λήξης</label><input type="date" class="form-control" id="nph-end"></div></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSavePhase('${pid}')">Προσθήκη</button></div>`);
}
window.modalSavePhase=async function(pid){
  const name=el('nph-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  const proj=getProject(pid);
  proj.phases.push({id:'ph_'+uid(),name,order:proj.phases.length+1,tasks:[],startDate:el('nph-start')?.value||null,endDate:el('nph-end')?.value||null});
  auditLog('Προσθήκη φάσης',`"${name}" στο "${proj.name}"`);
  await dbSaveProject(proj); closeModal(); render(); showToast('Φάση προστέθηκε.','success');
};

// EDIT PHASE
function showModalEditPhase(pid,phid) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); if(!ph) return;
  const _phPd = phasePlannedDates(ph);
  const _phAd = phaseActualDates(ph);
  const _fmtOrDash = d => d ? fmt(d) : '—';
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Φάσης</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος Φάσης <sup>*</sup></label><input class="form-control" id="eph-name" value="${esc(ph.name)}"></div><div class="form-hint" style="margin-top:8px;padding:8px 12px;background:var(--slate-50,#f8fafc);border-radius:6px;font-size:.78rem;color:var(--steel)">📅 Προγραμματισμένο: ${_fmtOrDash(_phPd.start)} → ${_fmtOrDash(_phPd.end)}<br>✅ Πραγματικό: ${_fmtOrDash(_phAd.start)} → ${_fmtOrDash(_phAd.end)}<br><span style="opacity:.7">Οι ημερομηνίες υπολογίζονται αυτόματα από τις εργασίες.</span></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdatePhase('${pid}','${phid}')">Αποθήκευση</button></div>`);
}
window.modalUpdatePhase=async function(pid,phid){
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); if(!ph) return;
  const name=el('eph-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  ph.name=name;
  auditLog('Επεξεργασία φάσης',`"${name}" στο "${proj.name}"`);
  await dbSaveProject(proj); closeModal(); render(); showToast('Φάση ενημερώθηκε.','success');
};

// ADD TASK
function showModalAddTask(pid,phid) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid);
  const members=sortByName(state.db.users.filter(u=>!['client'].includes(u.role)));
  const otherTasks=ph?.tasks||[];
  const canAssignMembers = state.cu && ['admin','management'].includes(state.cu.role);
  const membersHtml = canAssignMembers ? `<div class="form-group"><label class="form-label">Μέλη Ομάδας</label><div style="border:1px solid var(--navy-line);border-radius:6px;padding:8px 12px;max-height:160px;overflow-y:auto">${members.map(u=>`<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer"><input type="checkbox" class="nt-member" value="${u.id}"> ${esc(u.name)} <span class="text-muted" style="font-size:.75rem">(${ROLE_INFO[u.role]?.label||u.role})</span></label>`).join('')}</div><div class="form-hint">Επιλέξτε όσους συμμετέχουν στην εργασία</div></div>` : '';
  showModal(`<div class="modal-header"><div class="modal-title">Νέα Εργασία – ${esc(ph?.name||'')}</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="nt-name" placeholder="π.χ. Σύνταξη Σύμβασης"></div><div class="form-group"><label class="form-label">Υπεύθυνος</label><select class="form-control" id="nt-assignee"><option value="">— Χωρίς ανάθεση —</option>${members.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>${membersHtml}<div class="form-group"><label class="form-label" style="cursor:pointer"><input type="checkbox" id="nt-parallel" style="margin-right:6px">Παράλληλη εκτέλεση</label></div>${otherTasks.length?`<div class="form-group"><label class="form-label">Εξαρτάται από</label><div style="border:1px solid var(--navy-line);border-radius:6px;padding:8px 12px;max-height:160px;overflow-y:auto">${otherTasks.map(t=>`<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer"><input type="checkbox" class="nt-dep-ck" value="${t.id}"> ${esc(t.name)}</label>`).join('')}</div></div><div class="form-group"><label class="form-label" style="cursor:pointer;display:flex;align-items:center;gap:8px"><input type="checkbox" id="nt-enforce-deps"> Επιβολή εξαρτήσεων</label><div class="form-hint">Κλειδώνει την εργασία μέχρι να ολοκληρωθούν οι εξαρτήσεις.</div></div>`:''}<div class="form-group"><label class="form-label">Ημερομηνία Έναρξης</label><input type="date" class="form-control" id="nt-start" value="${today()}"></div><div class="form-group" style="border:1px solid #dc262633;border-radius:6px;padding:10px 14px;background:#fef2f2"><label class="form-label" style="cursor:pointer;color:#b91c1c;font-weight:700;display:flex;align-items:center;gap:8px"><input type="checkbox" id="nt-urgent">⚡ Επείγουσα εργασία</label><div class="form-hint">Η ένδειξη δεν αλλάζει τη σειρά. Ειδοποιεί μόνο τους συμμετέχοντες.</div></div><div class="form-group" style="border:1px solid #7c3aed33;border-radius:6px;padding:10px 14px;background:#f5f3ff"><label class="form-label" style="cursor:pointer;color:#7c3aed;font-weight:700;display:flex;align-items:center;gap:8px"><input type="checkbox" id="nt-mgmt-check" style="margin-right:2px">⚑ Απαιτείται Έλεγχος από Διοίκηση</label></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveTask('${pid}','${phid}')">Προσθήκη</button></div>`);
}
window.modalSaveTask=async function(pid,phid){
  const name=el('nt-name').value.trim(); if(!name){alert('Συμπληρώστε τίτλο.');return;}
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); if(!ph) return;
  const memberIds=Array.from(document.querySelectorAll('.nt-member:checked')).map(c=>c.value);
  const task={id:'task_'+uid(),name,assigneeId:el('nt-assignee').value||null,memberIds,status:'not_started',parallel:el('nt-parallel')?.checked||false,dependsOn:Array.from(document.querySelectorAll('.nt-dep-ck:checked')).map(c=>c.value),enforceDeps:el('nt-enforce-deps')?.checked||false,startDate:el('nt-start')?.value||null,completedDate:null,subtasks:[],docs:[],urgent:false,mgmtCheck:el('nt-mgmt-check')?.checked||false};
  task.urgent=!!el('nt-urgent')?.checked&&canSetTaskUrgent(proj,task);
  ph.tasks.push(task);
  auditLog('Προσθήκη εργασίας',`"${name}" – ${ph.name}`);
  await dbSaveProject(proj);
  if(task.urgent) {
    if(isSupabaseAuthMode()) await secureProjectRpc('app_task_set_urgent',{
      p_project_id:pid,p_phase_id:phid,p_task_id:task.id,p_urgent:true
    },pid);
    else await emitProjectNotification('urgent_changed',proj,ph,task,null,'true');
  }
  closeModal(); render(); showToast('Εργασία προστέθηκε.','success');
};

// DUPLICATE TASK — full copy (incl. documents), status reset to "not_started"
// so the repeated task starts fresh and can be corrected independently.
async function duplicateTask(pid,phid,tid) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const src=ph?.tasks.find(t=>t.id===tid);
  if(!src) return;
  const idx=ph.tasks.indexOf(src);
  const newTask={
    ...src,
    id:'task_'+uid(),
    name:src.name+' (Αντίγραφο)',
    status:'not_started',
    startDate:null,
    completedDate:null,
    actualStartTime:null,
    actualEndTime:null,
    reviewStatus:null,
    urgent:false,
    memberIds:[...(src.memberIds||[])],
    dependsOn:[...(src.dependsOn||[])],
    subtasks:(src.subtasks||[]).map(st=>({...st,id:'st_'+uid(),done:false,reviewStatus:null})),
    docs:(src.docs||[]).map(d=>({...d,id:'d_'+uid()})), // πλήρης αντιγραφή εγγράφων, με τα ίδια αρχεία
  };
  ph.tasks.splice(idx+1,0,newTask);
  auditLog('Αντιγραφή εργασίας',`"${src.name}" → "${newTask.name}" – ${ph.name}`);
  await dbSaveProject(proj);
  render();
  showToast(`Δημιουργήθηκε αντίγραφο: «${newTask.name}»`,'success');
}

// EDIT TASK
function showModalEditTask(pid,phid,tid) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;
  const members=sortByName(state.db.users.filter(u=>!['client'].includes(u.role)));
  const canAssignMembers = state.cu && ['admin','management'].includes(state.cu.role);
  const currentMembers = task.memberIds||[];
  const membersHtml = canAssignMembers ? `<div class="form-group"><label class="form-label">Μέλη Ομάδας</label><div style="border:1px solid var(--navy-line);border-radius:6px;padding:8px 12px;max-height:160px;overflow-y:auto">${members.map(u=>`<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer"><input type="checkbox" class="et-member" value="${u.id}"${currentMembers.includes(u.id)?' checked':''}> ${esc(u.name)} <span class="text-muted" style="font-size:.75rem">(${ROLE_INFO[u.role]?.label||u.role})</span></label>`).join('')}</div><div class="form-hint">Επιλέξτε όσους συμμετέχουν στην εργασία</div></div>` : '';
  const otherTasks=(ph.tasks||[]).filter(t=>t.id!==tid);
  const curDeps=task.dependsOn||[];
  window._editTaskCtx={pid,phid,tid};
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Εργασίας</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Τίτλος</label><input class="form-control" id="et-name" value="${esc(task.name)}"></div><div class="form-group"><label class="form-label">Υπεύθυνος</label><select class="form-control" id="et-assignee"><option value="">— Χωρίς ανάθεση —</option>${members.map(u=>`<option value="${u.id}"${u.id===task.assigneeId?' selected':''}>${esc(u.name)}</option>`).join('')}</select></div>${membersHtml}<div class="form-group"><label class="form-label" style="cursor:pointer"><input type="checkbox" id="et-parallel" style="margin-right:6px"${task.parallel?' checked':''}>Παράλληλη εκτέλεση</label></div>${otherTasks.length?`<div class="form-group"><label class="form-label">Εξαρτάται από</label><div style="border:1px solid var(--navy-line);border-radius:6px;padding:8px 12px;max-height:160px;overflow-y:auto">${otherTasks.map(t=>`<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer"><input type="checkbox" class="et-dep-ck" value="${t.id}"${curDeps.includes(t.id)?' checked':''}> ${esc(t.name)}</label>`).join('')}</div></div><div class="form-group"><label class="form-label" style="cursor:pointer;display:flex;align-items:center;gap:8px"><input type="checkbox" id="et-enforce-deps"${task.enforceDeps?' checked':''}> Επιβολή εξαρτήσεων</label><div class="form-hint">Κλειδώνει την εργασία μέχρι να ολοκληρωθούν οι εξαρτήσεις.</div></div>`:''}<div class="modal-date-grid"><div class="form-group"><label class="form-label">📅 Προγρ. Έναρξη</label><input type="date" class="form-control" id="et-pstart" value="${task.plannedStart||''}"></div><div class="form-group"><label class="form-label">⏰ Ώρα Έναρξης</label><input type="time" class="form-control" id="et-stime" lang="en-GB" value="${task.startTime||'08:00'}"></div><div class="form-group"><label class="form-label">📅 Προγρ. Λήξη</label><input type="date" class="form-control" id="et-pend" value="${task.plannedEnd||''}"></div><div class="form-group"><label class="form-label">⏰ Ώρα Λήξης</label><input type="time" class="form-control" id="et-etime" lang="en-GB" value="${task.endTime||'16:00'}"></div><div class="form-group"><label class="form-label">Πραγμ. Έναρξη</label><input type="date" class="form-control" id="et-start" value="${task.startDate||''}"></div><div class="form-group"><label class="form-label">⏰ Ώρα Πραγμ. Έναρξης</label><input type="time" class="form-control" id="et-atime" lang="en-GB" value="${task.actualStartTime||'08:00'}"></div><div class="form-group"><label class="form-label">Πραγμ. Ολοκλήρωση</label><input type="date" class="form-control" id="et-comp" value="${task.completedDate||''}"></div><div class="form-group"><label class="form-label">⏰ Ώρα Πραγμ. Ολοκλήρωσης</label><input type="time" class="form-control" id="et-ctime" lang="en-GB" value="${task.actualEndTime||'16:00'}"></div></div><div class="form-group"><label class="form-label">Υποεργασίες</label><div id="et-sub-list">${(task.subtasks||[]).map(st=>`<div class="proc-tpl-item" id="str-${st.id}"><span>${esc(st.name)}</span><button class="btn btn-danger btn-icon btn-sm" onclick="modalRemoveSubtask('${st.id}')">✕</button></div>`).join('')}</div><div style="display:flex;gap:8px;margin-top:8px"><input class="form-control" id="et-sub" placeholder="Νέα υποεργασία"><button class="btn btn-secondary btn-sm" onclick="modalAddSubtask()">+ Προσθήκη</button></div></div><div class="form-group" style="border:1px solid #7c3aed33;border-radius:6px;padding:10px 14px;background:#f5f3ff"><label class="form-label" style="cursor:pointer;color:#7c3aed;font-weight:700;display:flex;align-items:center;gap:8px"><input type="checkbox" id="et-mgmt-check" style="margin-right:2px"${task.mgmtCheck?' checked':''}>⚑ Απαιτείται Έλεγχος από Διοίκηση</label></div><hr class="divider"><button class="btn btn-danger btn-sm" onclick="modalRemoveTask()">Αφαίρεση Εργασίας</button></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateTask()">Αποθήκευση</button></div>`);
  const mgmtField=el('et-mgmt-check')?.closest('.form-group');
  if(mgmtField){
    mgmtField.insertAdjacentHTML('beforebegin',`<div class="form-group" style="border:1px solid #dc262633;border-radius:6px;padding:10px 14px;background:#fef2f2"><label class="form-label" style="cursor:${canSetTaskUrgent(proj,task)?'pointer':'not-allowed'};color:#b91c1c;font-weight:700;display:flex;align-items:center;gap:8px"><input type="checkbox" id="et-urgent"${task.urgent?' checked':''}${canSetTaskUrgent(proj,task)?'':' disabled'}>⚡ Επείγουσα εργασία</label><div class="form-hint">Μπορεί να αλλάξει μόνο ο Υπεύθυνος Έργου ή ο Υπεύθυνος Εργασίας. Δεν επηρεάζει τη σειρά.</div></div>`);
  }
}
window.modalAddSubtask=async function(){
  const name=el('et-sub')?.value.trim(); if(!name) return;
  const {pid,phid,tid}=window._editTaskCtx||{}; const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;
  const st={id:'st_'+uid(),name,done:false}; task.subtasks.push(st); await dbSaveProject(proj);
  const list=el('et-sub-list'); if(list) list.insertAdjacentHTML('beforeend',`<div class="proc-tpl-item" id="str-${st.id}"><span>${esc(st.name)}</span><button class="btn btn-danger btn-icon btn-sm" onclick="modalRemoveSubtask('${st.id}')">✕</button></div>`);
  el('et-sub').value='';
};
window.modalRemoveSubtask=async function(stid){
  const {pid,phid,tid}=window._editTaskCtx||{}; const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;
  task.subtasks=task.subtasks.filter(s=>s.id!==stid); await dbSaveProject(proj);
  const row=el('str-'+stid); if(row) row.remove();
};
window.modalUpdateTask=async function(){
  const {pid,phid,tid}=window._editTaskCtx||{}; const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;
  const wasUrgent=!!task.urgent;
  task.name=el('et-name').value.trim()||task.name; task.assigneeId=el('et-assignee').value||null;
  const etMembers=document.querySelectorAll('.et-member:checked');
  if(etMembers.length||document.querySelector('.et-member')) task.memberIds=Array.from(etMembers).map(c=>c.value);
  task.parallel=el('et-parallel')?.checked||false;
  task.dependsOn=Array.from(document.querySelectorAll('.et-dep-ck:checked')).map(c=>c.value);
  task.enforceDeps=el('et-enforce-deps')?.checked||false;
  task.plannedStart=el('et-pstart')?.value||null; task.plannedEnd=el('et-pend')?.value||null;
  task.startTime=el('et-stime')?.value||null; task.endTime=el('et-etime')?.value||null;
  task.startDate=el('et-start').value||null; task.actualStartTime=el('et-atime')?.value||null; task.completedDate=el('et-comp').value||null; task.actualEndTime=el('et-ctime')?.value||null;
  task.mgmtCheck=el('et-mgmt-check')?.checked||false;
  if(el('et-urgent')&&canSetTaskUrgent(proj,task)) task.urgent=!!el('et-urgent').checked;
  if(task.completedDate) task.status='completed';
  auditLog('Επεξεργασία εργασίας',`"${task.name}"`);
  await dbSaveProject(proj);
  if(wasUrgent!==!!task.urgent) {
    if(isSupabaseAuthMode()) await secureProjectRpc('app_task_set_urgent',{
      p_project_id:pid,p_phase_id:phid,p_task_id:tid,p_urgent:!!task.urgent
    },pid);
    else await emitProjectNotification('urgent_changed',proj,ph,task,null,String(!!task.urgent));
  }
  closeModal(); render(); showToast('Εργασία αποθηκεύτηκε.','success');
};
// ── REVIEW REQUEST SYSTEM ─────────────────────────────────────────
window.requestTaskReview = async function(pid, phid, tid) {
  const proj=getProject(pid); if(!proj) return;
  const ph=proj.phases.find(p=>p.id===phid); if(!ph) return;
  const task=ph.tasks.find(t=>t.id===tid); if(!task) return;

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_review_request',{
        p_project_id:pid,p_phase_id:phid,p_task_id:tid,
        p_subtask_id:null,p_entity_type:'task'
      },pid);
      auditLog('Αίτημα Ελέγχου Εργασίας', `"${task.name}" – ${ph.name}`);
      await emitProjectNotification('review_requested',getProject(pid)||proj,ph,task,null,'');
      render(); showToast('Το αίτημα ελέγχου στάλθηκε στον Υπεύθυνο Έργου και στη Διοίκηση.','success');
    } catch(err) { showToast('Αποτυχία αιτήματος ελέγχου: '+(err.message||err),'error'); }
    return;
  }

  task.reviewStatus='pending';
  task.reviewRequestedBy=state.cu?.id||null;
  task.reviewRequestedByName=state.cu?.name||null;
  task.reviewRequestedAt=nowTS();
  auditLog('Αίτημα Ελέγχου Εργασίας', `"${task.name}" – ${ph.name}`);
  await dbSaveProject(proj);
  await emitProjectNotification('review_requested',proj,ph,task,null,'');
  render(); showToast('Το αίτημα ελέγχου στάλθηκε στον Υπεύθυνο Έργου και στη Διοίκηση.', 'success');
};

window.requestPhaseReview = async function(pid, phid) {
  const proj=getProject(pid); if(!proj) return;
  const ph=proj.phases.find(p=>p.id===phid); if(!ph) return;

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_review_request',{
        p_project_id:pid,p_phase_id:phid,p_task_id:null,
        p_subtask_id:null,p_entity_type:'phase'
      },pid);
      auditLog('Αίτημα Ελέγχου Φάσης', `"${ph.name}" – ${proj.name}`);
      await emitProjectNotification('review_requested',getProject(pid)||proj,ph,null,null,'');
      render(); showToast('Το αίτημα ελέγχου φάσης στάλθηκε στον Υπεύθυνο Έργου και στη Διοίκηση.','success');
    } catch(err) { showToast('Αποτυχία αιτήματος ελέγχου: '+(err.message||err),'error'); }
    return;
  }

  ph.reviewStatus='pending';
  ph.reviewRequestedBy=state.cu?.id||null;
  ph.reviewRequestedByName=state.cu?.name||null;
  ph.reviewRequestedAt=nowTS();
  auditLog('Αίτημα Ελέγχου Φάσης', `"${ph.name}" – ${proj.name}`);
  await dbSaveProject(proj);
  await emitProjectNotification('review_requested',proj,ph,null,null,'');
  render(); showToast('Το αίτημα ελέγχου φάσης στάλθηκε στον Υπεύθυνο Έργου και στη Διοίκηση.', 'success');
};

window.resolveTaskReview = async function(pid, phid, tid, decision) {
  const proj=getProject(pid); if(!proj) return;
  const ph=proj.phases.find(p=>p.id===phid); if(!ph) return;
  const task=ph.tasks.find(t=>t.id===tid); if(!task) return;
  const label=decision==='approved'?'Εγκρίθηκε':'Απορρίφθηκε';

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_review_resolve',{
        p_project_id:pid,p_phase_id:phid,p_task_id:tid,
        p_subtask_id:null,p_entity_type:'task',p_decision:decision
      },pid);
      auditLog(`Έλεγχος Εργασίας: ${label}`, `"${task.name}" – ${ph.name}`);
      await emitProjectNotification('review_resolved',getProject(pid)||proj,ph,task,null,decision);
      render(); updateHeaderUser();
      showToast(`Εργασία "${task.name}": ${label}.`, decision==='approved'?'success':'');
    } catch(err) { showToast('Αποτυχία ελέγχου: '+(err.message||err),'error'); }
    return;
  }

  task.reviewStatus=decision;
  auditLog(`Έλεγχος Εργασίας: ${label}`, `"${task.name}" – ${ph.name}`);
  await dbSaveProject(proj);
  await emitProjectNotification('review_resolved',proj,ph,task,null,decision);
  render(); updateHeaderUser();
  showToast(`Εργασία "${task.name}": ${label}.`, decision==='approved'?'success':'');
};

window.resolvePhaseReview = async function(pid, phid, decision) {
  const proj=getProject(pid); if(!proj) return;
  const ph=proj.phases.find(p=>p.id===phid); if(!ph) return;
  const label=decision==='approved'?'Εγκρίθηκε':'Απορρίφθηκε';

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_review_resolve',{
        p_project_id:pid,p_phase_id:phid,p_task_id:null,
        p_subtask_id:null,p_entity_type:'phase',p_decision:decision
      },pid);
      auditLog(`Έλεγχος Φάσης: ${label}`, `"${ph.name}" – ${proj.name}`);
      await emitProjectNotification('review_resolved',getProject(pid)||proj,ph,null,null,decision);
      render(); updateHeaderUser();
      showToast(`Φάση "${ph.name}": ${label}.`, decision==='approved'?'success':'');
    } catch(err) { showToast('Αποτυχία ελέγχου: '+(err.message||err),'error'); }
    return;
  }

  ph.reviewStatus=decision;
  auditLog(`Έλεγχος Φάσης: ${label}`, `"${ph.name}" – ${proj.name}`);
  await dbSaveProject(proj);
  await emitProjectNotification('review_resolved',proj,ph,null,null,decision);
  render(); updateHeaderUser();
  showToast(`Φάση "${ph.name}": ${label}.`, decision==='approved'?'success':'');
};

window.requestSubtaskReview = async function(pid, phid, tid, stid) {
  const proj=getProject(pid); if(!proj) return;
  const ph=proj.phases.find(p=>p.id===phid); if(!ph) return;
  const task=ph.tasks.find(t=>t.id===tid); if(!task) return;
  const st=(task.subtasks||[]).find(s=>s.id===stid); if(!st) return;

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_review_request',{
        p_project_id:pid,p_phase_id:phid,p_task_id:tid,
        p_subtask_id:stid,p_entity_type:'subtask'
      },pid);
      auditLog('Αίτημα Ελέγχου Υποεργασίας',`"${st.name}" – "${task.name}"`);
      await emitProjectNotification('review_requested',getProject(pid)||proj,ph,task,st,'');
      render(); requestAnimationFrame(()=>restoreExpanded());
      showToast('Αίτημα ελέγχου στάλθηκε στον Υπεύθυνο Έργου και στη Διοίκηση.','success');
    } catch(err) { showToast('Αποτυχία αιτήματος ελέγχου: '+(err.message||err),'error'); }
    return;
  }

  st.reviewStatus='pending';
  st.reviewRequestedBy=state.cu?.id||null;
  st.reviewRequestedByName=state.cu?.name||null;
  st.reviewRequestedAt=nowTS();
  auditLog('Αίτημα Ελέγχου Υποεργασίας',`"${st.name}" – "${task.name}"`);
  await dbSaveProject(proj);
  await emitProjectNotification('review_requested',proj,ph,task,st,'');
  render(); requestAnimationFrame(()=>restoreExpanded());
  showToast('Αίτημα ελέγχου στάλθηκε στον Υπεύθυνο Έργου και στη Διοίκηση.','success');
};

window.resolveSubtaskReview = async function(pid, phid, tid, stid, decision) {
  const proj=getProject(pid); if(!proj) return;
  const ph=proj.phases.find(p=>p.id===phid); if(!ph) return;
  const task=ph.tasks.find(t=>t.id===tid); if(!task) return;
  const st=(task.subtasks||[]).find(s=>s.id===stid); if(!st) return;
  const label=decision==='approved'?'Εγκρίθηκε':'Απορρίφθηκε';

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_review_resolve',{
        p_project_id:pid,p_phase_id:phid,p_task_id:tid,
        p_subtask_id:stid,p_entity_type:'subtask',p_decision:decision
      },pid);
      auditLog(`Έλεγχος Υποεργασίας: ${label}`,`"${st.name}" – "${task.name}"`);
      await emitProjectNotification('review_resolved',getProject(pid)||proj,ph,task,st,decision);
      render(); requestAnimationFrame(()=>restoreExpanded()); updateHeaderUser();
      showToast(`Υποεργασία "${st.name}": ${label}.`, decision==='approved'?'success':'');
    } catch(err) { showToast('Αποτυχία ελέγχου: '+(err.message||err),'error'); }
    return;
  }

  st.reviewStatus=decision;
  auditLog(`Έλεγχος Υποεργασίας: ${label}`,`"${st.name}" – "${task.name}"`);
  await dbSaveProject(proj);
  await emitProjectNotification('review_resolved',proj,ph,task,st,decision);
  render(); requestAnimationFrame(()=>restoreExpanded()); updateHeaderUser();
  showToast(`Υποεργασία "${st.name}": ${label}.`, decision==='approved'?'success':'');
};

window.modalRemoveTask=async function(){
  if (!confirm('Αφαίρεση εργασίας;')) return;
  const {pid,phid,tid}=window._editTaskCtx||{}; const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); if(!ph) return;
  const task=ph.tasks.find(t=>t.id===tid);
  // Links only — no storage files to delete
  ph.tasks=ph.tasks.filter(t=>t.id!==tid);
  auditLog('Αφαίρεση εργασίας',task?.name||tid);
  await dbSaveProject(proj); closeModal(); render();
};

// ADD DOC
function showModalAddDoc(pid,phid,tid) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid);
  showModal(`<div class="modal-header"><div class="modal-title">Προσθήκη Εγγράφου${task?' – '+esc(task.name):''}</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body">
    <div style="margin-bottom:14px;padding:11px 13px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;font-size:.77rem;color:#1e3a5f;line-height:1.55">Το επίσημο αρχείο παραμένει στο <strong>Dropbox</strong>. Μπορείτε να δημιουργήσετε εκκρεμή απαίτηση εγγράφου ή να τη συνδέσετε αμέσως.</div>
    <div class="form-group"><label class="form-label">Κατηγορία <sup>*</sup></label><input class="form-control" id="nd-cat" placeholder="π.χ. Τεχνικά έγγραφα"></div>
    <div class="form-group"><label class="form-label">Όνομα Εγγράφου <sup>*</sup></label><input class="form-control" id="nd-name" placeholder="π.χ. Τεχνική έκθεση.pdf"></div>
    <div class="form-group"><label class="form-label">Τύπος</label><select class="form-control" id="nd-type"><option value="client">Πελάτης παρέχει</option><option value="team">Εσωτερικό (ομάδα)</option><option value="third_party">Τρίτος</option></select></div>
    <div class="form-group"><label class="form-label" style="cursor:pointer"><input type="checkbox" id="nd-req" checked style="margin-right:6px">Υποχρεωτικό</label></div>
    <div style="height:1px;background:var(--slate-200);margin:14px 0"></div>
    <div class="form-group"><label class="form-label">Τοπική διαδρομή Dropbox <span style="font-weight:400;color:var(--muted)">(αν υπάρχει ήδη αρχείο)</span></label><input class="form-control" id="nd-local-path" placeholder="T:\\B&amp;E SOLUTIONS Dropbox\\03. SOLUTIONS-PROJECTS\\Έργο\\αρχείο.pdf"><div class="form-hint">Explorer: <strong>Shift + δεξί κλικ → Αντιγραφή ως διαδρομή</strong>.</div></div>
    <div class="form-group"><label class="form-label">Dropbox shared link <span style="font-weight:400;color:var(--muted)">(προαιρετικό)</span></label><input class="form-control" id="nd-url" type="url" placeholder="https://www.dropbox.com/…"></div>
    </div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveDoc('${pid}','${phid}','${tid}')">Προσθήκη</button></div>`);
}
window.modalSaveDoc=async function(pid,phid,tid){
  const cat=el('nd-cat').value.trim(); const name=el('nd-name').value.trim(); if(!cat||!name){alert('Συμπληρώστε κατηγορία και όνομα.');return;}
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;
  const localRaw=(el('nd-local-path')?.value||'').trim();
  const onlineRaw=(el('nd-url')?.value||'').trim();
  let localPath=null,onlineUrl=null;
  if(localRaw){
    localPath=_normalizeDropboxLocalPath(localRaw);
    if(!localPath){alert(`Η διαδρομή πρέπει να είναι αρχείο μέσα στο ${_dropboxLocalRoot()}.`);return;}
  }
  if(onlineRaw){
    onlineUrl=_safeWebDocumentUrl(onlineRaw);
    if(!onlineUrl||!_isDropboxDocumentUrl(onlineUrl)){alert('Ο σύνδεσμος πρέπει να είναι έγκυρο Dropbox shared link που ξεκινά με https://.');return;}
  }
  const storedUrl=localPath?_buildDropboxDocumentRef(localPath,onlineUrl):onlineUrl;
  const ndDone=!!storedUrl;
  task.docs.push({id:'d_'+uid(),cat,name,required:el('nd-req')?.checked!==false,type:el('nd-type')?.value||'client',done:ndDone,url:storedUrl||null,at:ndDone?today():null});
  auditLog('Προσθήκη εγγράφου',`"${name}" – ${task.name}`);
  await dbSaveProject(proj); closeModal(); state.expandedTasks[tid]=true; render(); requestAnimationFrame(()=>{ restoreExpanded(); }); showToast('Έγγραφο προστέθηκε.','success');
};

// ADD USER
function showModalAddUser() {
  if (isSupabaseAuthMode()) {
    showModal(`<div class="modal-header"><div class="modal-title">Νέος Χρήστης</div><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="login-err" style="display:block">
          Η δημιουργία νέου χρήστη είναι προσωρινά απενεργοποιημένη στη μεταβατική Auth έκδοση.
        </div>
        <div class="form-hint">Οι υπάρχοντες χρήστες συνεχίζουν κανονικά. Η νέα ροή provisioning θα ενεργοποιηθεί στο τελικό cutover, ώστε να μη δημιουργούνται ασύνδετα application/Auth accounts.</div>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" onclick="closeModal()">OK</button></div>`);
    return;
  }
  showModal(`<div class="modal-header"><div class="modal-title">Νέος Χρήστης</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Ονοματεπώνυμο <sup>*</sup></label><input class="form-control" id="nu-name" placeholder="Γεώργιος Παπαδόπουλος"></div><div class="form-group"><label class="form-label">Username <sup>*</sup></label><input class="form-control" id="nu-user" placeholder="gpapadopoulos"></div><div class="form-group"><label class="form-label">Κωδικός <sup>*</sup></label><input class="form-control" type="password" id="nu-pass"></div><div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" id="nu-email"></div><div class="form-group"><label class="form-label">Ρόλος</label><select class="form-control" id="nu-role">${Object.entries(ROLE_INFO).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Κατηγορίες (για Υπ. Έργου)</label>${state.db.categories.map(c=>`<label style="display:flex;align-items:center;gap:8px;margin-top:6px"><input type="checkbox" class="nu-catck" value="${c.id}"> ${esc(c.name)}</label>`).join('')}</div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveUser()">Δημιουργία</button></div>`);
}
window.modalSaveUser=async function(){
  const name=el('nu-name').value.trim(); const username=el('nu-user').value.trim(); const password=el('nu-pass').value;
  if(!name||!username||!password){alert('Συμπληρώστε υποχρεωτικά πεδία.');return;}
  if(state.db.users.find(u=>u.username===username)){alert('Το username υπάρχει ήδη.');return;}
  const catIds=Array.from(document.querySelectorAll('.nu-catck:checked')).map(c=>c.value);
  const hashedPass = dcodeIO.bcrypt.hashSync(password, 10);
  const user={id:'u_'+uid(),name,username,password:hashedPass,role:el('nu-role').value,email:el('nu-email').value.trim(),categoryIds:catIds,projectIds:[]};
  state.db.users.push(user);
  auditLog('Δημιουργία χρήστη',`${user.name} (${ROLE_INFO[user.role]?.label})`);
  await dbSaveUser(user); closeModal(); render(); showToast(`Χρήστης «${name}» δημιουργήθηκε.`,'success');
};

// USER PRIORITY
function _getUserProjects(userId) {
  // All active projects where user is manager OR assignee of any task
  const byManager = state.db.projects.filter(p => projManagerIds(p).includes(userId) && p.status!=='completed');
  const byTask = state.db.projects.filter(p =>
    p.status!=='completed' && !byManager.includes(p) &&
    (p.phases||[]).some(ph=>(ph.tasks||[]).some(t=>t.assigneeId===userId||(t.memberIds||[]).includes(userId)))
  );
  return [...byManager, ...byTask];
}

// Drag-and-drop + editable position for priority modal
window._dragIdx = null;
window.priorityDragStart = function(el, idx) {
  window._dragIdx = idx;
  setTimeout(()=>{ el.style.opacity='.4'; el.style.boxShadow='0 4px 16px rgba(7,24,39,.18)'; }, 0);
};
window.priorityDragEnd = function(el) {
  el.style.opacity='1'; el.style.boxShadow='';
  document.querySelectorAll('.prio-row').forEach(r=>r.classList.remove('prio-drag-over'));
};
window.priorityDragOver = function(e, el) {
  e.preventDefault();
  document.querySelectorAll('.prio-row').forEach(r=>r.classList.remove('prio-drag-over'));
  if (el.dataset.idx != window._dragIdx) el.classList.add('prio-drag-over');
};
window.priorityDrop = function(e, targetIdx) {
  e.preventDefault();
  document.querySelectorAll('.prio-row').forEach(r=>r.classList.remove('prio-drag-over'));
  const fromIdx = window._dragIdx;
  if (fromIdx===null||fromIdx===targetIdx) return;
  const { ordered } = window._priorityCtx;
  const [item] = ordered.splice(fromIdx, 1);
  ordered.splice(targetIdx, 0, item);
  window._dragIdx = null;
  _renderPriorityList();
};
window.movePriorityItem = function(idx, dir) {
  const { ordered } = window._priorityCtx;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= ordered.length) return;
  [ordered[idx], ordered[newIdx]] = [ordered[newIdx], ordered[idx]];
  _renderPriorityList();
};
// ── PHASE REORDER ────────────────────────────────────────────────
async function movePhase(projId, idxStr, dir) {
  const proj = getProject(projId); if (!proj) return;
  const idx = parseInt(idxStr);
  const newIdx = idx + dir;
  const phases = proj.phases || [];
  if (newIdx < 0 || newIdx >= phases.length) return;
  [phases[idx], phases[newIdx]] = [phases[newIdx], phases[idx]];
  proj.phases = phases;
  await dbSaveProject(proj);
  auditLog('Αλλαγή σειράς φάσεων', `Στο έργο "${proj.name}"`);
  render();
}

window._phaseDragIdx = null;
window.phaseDragStart = function(e, el, idx) {
  // Don't start drag if clicking on a button/input
  if (e.target.closest('button,input,select,a')) { e.preventDefault(); return; }
  window._phaseDragIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { el.style.opacity = '.5'; }, 0);
};
window.phaseDragEnd = function(el) {
  el.style.opacity = '1';
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-drag-over'));
};
window.phaseDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const ph = e.currentTarget;
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-drag-over'));
  if (parseInt(ph.dataset.phaseIdx) !== window._phaseDragIdx) ph.classList.add('phase-drag-over');
};
window.phaseDrop = async function(e, targetIdx, projId) {
  e.preventDefault();
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-drag-over'));
  const fromIdx = parseInt(window._phaseDragIdx);
  window._phaseDragIdx = null;
  if (isNaN(fromIdx) || fromIdx === targetIdx) return;
  const proj = getProject(projId); if (!proj) return;
  const phases = [...(proj.phases || [])];
  const [item] = phases.splice(fromIdx, 1);
  phases.splice(targetIdx, 0, item);
  proj.phases = phases;
  await dbSaveProject(proj);
  auditLog('Αλλαγή σειράς φάσεων', `Στο έργο "${proj.name}"`);
  render();
};

// ── Unified phase dragover/drop (handles both phase-reorder AND task-move) ──
window.unifiedPhaseDragOver = function(e, el, phIdx, phId) {
  if (window._projTaskDrag) {
    // Task drag: highlight target phase if different
    if (window._projTaskDrag.phaseId === phId) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-drag-over','phase-task-drop-over'));
    el.classList.add('phase-task-drop-over');
  } else if (window._phaseDragIdx !== null) {
    // Phase reorder drag
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-drag-over','phase-task-drop-over'));
    if (phIdx !== window._phaseDragIdx) el.classList.add('phase-drag-over');
  }
};
window.unifiedPhaseDrop = async function(e, el, phIdx, phId, projId) {
  e.preventDefault();
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-drag-over','phase-task-drop-over'));

  if (window._projTaskDrag) {
    // Task move
    const { taskId, phaseId: fromPhaseId } = window._projTaskDrag;
    window._projTaskDrag = null;
    if (fromPhaseId !== phId) await moveTaskToPhase(projId, fromPhaseId, taskId, phId);
  } else if (window._phaseDragIdx !== null) {
    // Phase reorder
    const fromIdx = parseInt(window._phaseDragIdx);
    window._phaseDragIdx = null;
    if (isNaN(fromIdx) || fromIdx === phIdx) return;
    const proj = getProject(projId); if (!proj) return;
    const phases = [...(proj.phases||[])];
    const [item] = phases.splice(fromIdx, 1);
    phases.splice(phIdx, 0, item);
    proj.phases = phases;
    await dbSaveProject(proj);
    auditLog('Αλλαγή σειράς φάσεων', `Στο έργο "${proj.name}"`);
    render();
  }
};

// ── Move task between phases ──────────────────────────────────────────────
async function moveTaskToPhase(projId, fromPhaseId, taskId, targetPhaseId) {
  const proj = getProject(projId); if (!proj) return;
  const fromPh   = proj.phases.find(p => p.id === fromPhaseId);
  const targetPh = proj.phases.find(p => p.id === targetPhaseId);
  if (!fromPh || !targetPh) return;
  const taskIdx = (fromPh.tasks||[]).findIndex(t => t.id === taskId);
  if (taskIdx < 0) return;
  const [task] = fromPh.tasks.splice(taskIdx, 1);
  if (!targetPh.tasks) targetPh.tasks = [];
  targetPh.tasks.push(task);
  await dbSaveProject(proj);
  auditLog('Μετακίνηση εργασίας', `"${task.name}" → "${targetPh.name}"`);
  render();
  showToast(`Εργασία μεταφέρθηκε στη "${esc(targetPh.name)}"`, 'success');
}

window._projTaskDrag = null;
window.projTaskDragStart = function(e, el, taskId, phaseId, projId) {
  if (e.target.closest('button,input,select,a,label')) { e.preventDefault(); return; }
  window._projTaskDrag = { taskId, phaseId, projId };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
  setTimeout(() => { el.style.opacity = '.4'; }, 0);
};
window.projTaskDragEnd = function(el) {
  el.style.opacity = '1';
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-task-drop-over'));
  document.querySelectorAll('.task-row').forEach(r => r.classList.remove('task-drag-over'));
  window._projTaskDrag = null;
};
window.projTaskRowDragOver = function(e, el) {
  if (!window._projTaskDrag) return;
  e.preventDefault(); e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.task-row').forEach(r => r.classList.remove('task-drag-over'));
  el.classList.add('task-drag-over');
};
window.projTaskRowDragLeave = function(el) {
  el.classList.remove('task-drag-over');
};
window.projTaskRowDrop = async function(e, el, targetTaskId, phaseId, projId) {
  e.preventDefault(); e.stopPropagation();
  document.querySelectorAll('.task-row').forEach(r => r.classList.remove('task-drag-over'));
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-task-drop-over'));
  if (!window._projTaskDrag) return;
  const { taskId: dragTaskId, phaseId: dragPhaseId } = window._projTaskDrag;
  window._projTaskDrag = null;
  if (dragTaskId === targetTaskId) return;
  const proj = getProject(projId); if (!proj) return;
  if (dragPhaseId === phaseId) {
    // Ίδια φάση → αναδιάταξη
    const phase = proj.phases.find(p => p.id === phaseId); if (!phase) return;
    const tasks = [...(phase.tasks||[])];
    const fi = tasks.findIndex(t => t.id === dragTaskId);
    const ti = tasks.findIndex(t => t.id === targetTaskId);
    if (fi === -1 || ti === -1) return;
    const [item] = tasks.splice(fi, 1);
    tasks.splice(ti, 0, item);
    phase.tasks = tasks;
    await dbSaveProject(proj);
    auditLog('Αλλαγή σειράς εργασιών', `"${item.name}" στη φάση "${phase.name}"`);
    render(); requestAnimationFrame(() => restoreExpanded());
  } else {
    // Άλλη φάση → μετακίνηση πριν την target εργασία
    const fromPh = proj.phases.find(p => p.id === dragPhaseId);
    const targetPh = proj.phases.find(p => p.id === phaseId);
    if (!fromPh || !targetPh) return;
    const fi = (fromPh.tasks||[]).findIndex(t => t.id === dragTaskId); if (fi < 0) return;
    const [task] = fromPh.tasks.splice(fi, 1);
    if (!targetPh.tasks) targetPh.tasks = [];
    const ti = targetPh.tasks.findIndex(t => t.id === targetTaskId);
    if (ti >= 0) targetPh.tasks.splice(ti, 0, task); else targetPh.tasks.push(task);
    await dbSaveProject(proj);
    auditLog('Μετακίνηση εργασίας', `"${task.name}" → "${targetPh.name}"`);
    render(); requestAnimationFrame(() => restoreExpanded());
    showToast(`Εργασία μεταφέρθηκε στη "${esc(targetPh.name)}"`, 'success');
  }
};
window.projPhaseDragOver = function(e, el, phaseId) {
  if (!window._projTaskDrag) return; // not a task drag — let phaseDragOver handle it
  if (window._projTaskDrag.phaseId === phaseId) return;
  e.preventDefault(); e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-task-drop-over'));
  el.classList.add('phase-task-drop-over');
};
window.projPhaseDrop = async function(e, targetPhaseId, projId) {
  if (!window._projTaskDrag) return;
  e.preventDefault(); e.stopPropagation();
  document.querySelectorAll('.phase-section').forEach(r => r.classList.remove('phase-task-drop-over'));
  const { taskId, phaseId: fromPhaseId } = window._projTaskDrag;
  window._projTaskDrag = null;
  if (fromPhaseId === targetPhaseId) return;
  await moveTaskToPhase(projId, fromPhaseId, taskId, targetPhaseId);
};

// ── Template phase drag & drop ──────────────────────────────────────────────
window._tplPhaseDragIdx = null;
window._tplPhaseDragTplId = null;
window.tplPhaseDragStart = function(e, el, phIdx, tplId) {
  if (e.target.closest('button,input,select,a')) { e.preventDefault(); return; }
  window._tplPhaseDragIdx = phIdx;
  window._tplPhaseDragTplId = tplId;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { el.style.opacity = '.5'; }, 0);
};
window.tplPhaseDragEnd = function(el) {
  el.style.opacity = '1';
  document.querySelectorAll('.tpl-phase-row').forEach(r => r.classList.remove('phase-drag-over'));
};
window.tplPhaseDragOver = function(e, phIdx) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.tpl-phase-row').forEach(r => r.classList.remove('phase-drag-over'));
  if (phIdx !== window._tplPhaseDragIdx) e.currentTarget.classList.add('phase-drag-over');
};
window.tplPhaseDrop = async function(e, targetIdx, tplId) {
  e.preventDefault();
  document.querySelectorAll('.tpl-phase-row').forEach(r => r.classList.remove('phase-drag-over'));
  const fromIdx = parseInt(window._tplPhaseDragIdx);
  window._tplPhaseDragIdx = null;
  if (isNaN(fromIdx) || fromIdx === targetIdx) return;
  const tpl = getTemplate(tplId); if (!tpl) return;
  const phases = [...(tpl.phases || [])];
  const [item] = phases.splice(fromIdx, 1);
  phases.splice(targetIdx, 0, item);
  tpl.phases = phases;
  await dbSaveTemplate(tpl); render();
};

// ── Template task drag & drop ────────────────────────────────────────────────
window._tplTaskDragIdx = null;
window._tplTaskDragPhId = null;
window._tplTaskDragTplId = null;
window.tplTaskDragStart = function(e, el, tkIdx, phId, tplId) {
  if (e.target.closest('button,input,select,a')) { e.preventDefault(); return; }
  window._tplTaskDragIdx = tkIdx;
  window._tplTaskDragPhId = phId;
  window._tplTaskDragTplId = tplId;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { el.style.opacity = '.5'; }, 0);
};
window.tplTaskDragEnd = function(el) {
  el.style.opacity = '1';
  document.querySelectorAll('.tpl-task-row').forEach(r => r.classList.remove('phase-drag-over'));
};
window.tplTaskDragOver = function(e, tkIdx, phId) {
  e.preventDefault();
  if (phId !== window._tplTaskDragPhId) return;
  document.querySelectorAll('.tpl-task-row').forEach(r => r.classList.remove('phase-drag-over'));
  if (tkIdx !== window._tplTaskDragIdx) e.currentTarget.classList.add('phase-drag-over');
};
window.tplTaskDrop = async function(e, targetIdx, phId, tplId) {
  e.preventDefault();
  document.querySelectorAll('.tpl-task-row').forEach(r => r.classList.remove('phase-drag-over'));
  if (phId !== window._tplTaskDragPhId) return;
  const fromIdx = parseInt(window._tplTaskDragIdx);
  window._tplTaskDragIdx = null;
  if (isNaN(fromIdx) || fromIdx === targetIdx) return;
  const tpl = getTemplate(tplId); if (!tpl) return;
  const ph = (tpl.phases || []).find(p => p.id === phId); if (!ph) return;
  const tasks = [...(ph.tasks || [])];
  const [item] = tasks.splice(fromIdx, 1);
  tasks.splice(targetIdx, 0, item);
  ph.tasks = tasks;
  await dbSaveTemplate(tpl); render();
};

// ── Project order (shared per category) ─────────────────────────
async function _saveProjOrder(catId) {
  const cat = getCategory(catId); if (!cat) return;
  await dbSaveCategory(cat);
}

window.moveProjOrder = async function(catId, projId, dir) {
  const cat = getCategory(catId); if (!cat) return;
  const vis = state.db.projects.filter(p=>p.categoryId===catId);
  // Build current ordered list
  const order = cat.projectOrder || [];
  const ordered = [...vis].sort((a,b)=>{
    const ia=order.indexOf(a.id), ib=order.indexOf(b.id);
    if(ia===-1&&ib===-1) return 0; if(ia===-1) return 1; if(ib===-1) return -1;
    return ia-ib;
  });
  const idx = ordered.findIndex(p=>p.id===projId);
  const newIdx = idx + dir;
  if (idx===-1 || newIdx<0 || newIdx>=ordered.length) return;
  [ordered[idx], ordered[newIdx]] = [ordered[newIdx], ordered[idx]];
  cat.projectOrder = ordered.map(p=>p.id);
  await _saveProjOrder(catId);
  render();
};

window._projDragId = null;
window.projDragStart = function(e, el) {
  if (e.target.closest('button')) { e.preventDefault(); return; }
  window._projDragId = el.dataset.projId;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(()=>{ el.style.opacity='.45'; el.style.boxShadow='0 4px 18px rgba(7,24,39,.18)'; }, 0);
};
window.projDragEnd = function(el) {
  el.style.opacity='1'; el.style.boxShadow='';
  document.querySelectorAll('.proj-sort-row').forEach(r=>r.classList.remove('proj-drag-over'));
};
window.projDragOver = function(e, el) {
  e.preventDefault(); e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.proj-sort-row').forEach(r=>r.classList.remove('proj-drag-over'));
  if (el.dataset.projId !== window._projDragId) el.classList.add('proj-drag-over');
};
window.projDrop = async function(e, el, catId) {
  e.preventDefault();
  document.querySelectorAll('.proj-sort-row').forEach(r=>r.classList.remove('proj-drag-over'));
  const fromId = window._projDragId;
  const toId   = el.dataset.projId;
  window._projDragId = null;
  if (!fromId || fromId===toId) return;
  const cat = getCategory(catId); if (!cat) return;
  const vis = state.db.projects.filter(p=>p.categoryId===catId);
  const order = cat.projectOrder || [];
  const ordered = [...vis].sort((a,b)=>{
    const ia=order.indexOf(a.id), ib=order.indexOf(b.id);
    if(ia===-1&&ib===-1) return 0; if(ia===-1) return 1; if(ib===-1) return -1;
    return ia-ib;
  });
  const fromIdx = ordered.findIndex(p=>p.id===fromId);
  const toIdx   = ordered.findIndex(p=>p.id===toId);
  if (fromIdx===-1||toIdx===-1) return;
  const [item] = ordered.splice(fromIdx, 1);
  ordered.splice(toIdx, 0, item);
  cat.projectOrder = ordered.map(p=>p.id);
  await _saveProjOrder(catId);
  render();
};

window.prioritySetPos = function(fromIdx, input) {
  const newPos = parseInt(input.value) - 1;
  const { ordered } = window._priorityCtx;
  if (isNaN(newPos)||newPos<0||newPos>=ordered.length||newPos===fromIdx) { _renderPriorityList(); return; }
  const [item] = ordered.splice(fromIdx, 1);
  ordered.splice(newPos, 0, item);
  _renderPriorityList();
};

function _renderPriorityList() {
  const { ordered } = window._priorityCtx;
  const rows = ordered.map((p,i) => {
    const cat = getCategory(p.categoryId);
    const prog = projectProgress(p);
    const isFirst = i===0;
    return `<div class="prio-row" draggable="true" data-idx="${i}"
      ondragstart="priorityDragStart(this,${i})"
      ondragend="priorityDragEnd(this)"
      ondragover="priorityDragOver(event,this)"
      ondrop="priorityDrop(event,${i})">
      <input type="number" class="prio-pos-input${isFirst?' prio-pos-first':''}"
        value="${i+1}" min="1" max="${ordered.length}"
        title="Κλικ για αλλαγή θέσης"
        onchange="prioritySetPos(${i},this)"
        onkeydown="if(event.key==='Enter')this.blur()"
        onclick="this.select()">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--navy)">${esc(p.name)}</div>
        <div style="font-size:.72rem;color:var(--steel);margin-top:2px">${esc(cat?.name||'—')} · ${prog.tasks.pct}% πρόοδος</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">
        <button onclick="movePriorityItem(${i},-1)" class="prio-arrow-btn" ${i===0?'disabled':''} title="Μετακίνηση πάνω">▲</button>
        <button onclick="movePriorityItem(${i},1)"  class="prio-arrow-btn" ${i===ordered.length-1?'disabled':''} title="Μετακίνηση κάτω">▼</button>
      </div>
      <div class="prio-handle" title="Σύρετε για αλλαγή σειράς">⠿</div>
    </div>`;
  }).join('');
  const container = document.getElementById('prio-list-container') || document.querySelector('#modal-overlay .modal-body');
  if (container) container.innerHTML = rows || '<div style="padding:20px;text-align:center;color:var(--steel);font-size:.85rem">Δεν υπάρχουν ενεργά έργα.</div>';
}

function _loadPriorityCat(catId) {
  const { userId } = window._priorityCtx;
  const user = getUser(userId); if (!user) return;
  const catPrio = ((user.categoryPriority || {})[catId]) || [];
  const projs = _getUserProjects(userId).filter(p => p.categoryId === catId);
  window._priorityCtx.ordered = [...projs].sort((a,b) => {
    const ia=catPrio.indexOf(a.id), ib=catPrio.indexOf(b.id);
    if(ia===-1&&ib===-1) return 0; if(ia===-1) return 1; if(ib===-1) return -1;
    return ia-ib;
  });
}

window.switchPriorityCategory = function(catId) {
  const ctx = window._priorityCtx;
  // Persist current order before switching
  ctx.pendingOrders[ctx.catId] = ctx.ordered.map(p => p.id);
  ctx.catId = catId;
  _loadPriorityCat(catId);
  document.querySelectorAll('#prio-cat-tabs .doc-tab').forEach(t => t.classList.toggle('active', t.dataset.catid === catId));
  _renderPriorityList();
};

function showModalUserPriority(userId) {
  const user = getUser(userId); if(!user) return;
  const allProjs = _getUserProjects(userId);
  const catIds = [...new Set(allProjs.map(p => p.categoryId))];
  const cats = catIds.map(id => getCategory(id)).filter(Boolean);
  if (!cats.length) { showToast('Δεν υπάρχουν ενεργά έργα.', 'error'); return; }
  const defaultCatId = cats[0].id;
  window._priorityCtx = { userId, catId: defaultCatId, ordered: [], pendingOrders: {} };
  _loadPriorityCat(defaultCatId);
  const catTabs = cats.length > 1
    ? `<div class="doc-add-tabs" id="prio-cat-tabs" style="margin:-4px -4px 12px">${cats.map(c=>`<button class="doc-tab${c.id===defaultCatId?' active':''}" data-catid="${c.id}" onclick="switchPriorityCategory('${c.id}')">${esc(c.name)}</button>`).join('')}</div>`
    : `<div style="padding:6px 0 10px;font-size:.75rem;font-weight:800;color:var(--steel);text-transform:uppercase;letter-spacing:.08em">${esc(cats[0].name)}</div>`;
  showModal(`<div class="modal-header"><div class="modal-title">Σειρά Προτεραιότητας – ${esc(user.name)}</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body">${catTabs}<div id="prio-list-container"></div></div><div class="modal-footer"><div class="text-sm text-muted" style="flex:1">Σύρετε ▲▼ για αλλαγή σειράς</div><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="savePriority()">Αποθήκευση</button></div>`);
  _renderPriorityList();
}

window.savePriority = async function() {
  const { userId, catId, ordered, pendingOrders } = window._priorityCtx || {};
  const user = getUser(userId); if(!user) return;
  // Include current category's order
  const allOrders = { ...(user.categoryPriority || {}), ...pendingOrders, [catId]: ordered.map(p => p.id) };
  user.categoryPriority = allOrders;
  auditLog('Ενημέρωση προτεραιοτήτων', user.name);
  await dbSaveUser(user);
  closeModal(); showToast('Προτεραιότητες αποθηκεύτηκαν.', 'success');
};

// EDIT USER
function showModalEditUser(userId) {
  const user=getUser(userId); if(!user) return;
  const isGlobalFixed=['admin','management','client'].includes(user.role);
  const catRoleOpts=(current)=>`<option value=""${!current?' selected':''}>— Προεπιλογή (${ROLE_INFO[user.role]?.label||user.role}) —</option><option value="project_manager"${current==='project_manager'?' selected':''}>Υπεύθυνος Έργου</option><option value="team_member"${current==='team_member'?' selected':''}>Μέλος Ομάδας</option>`;
  const catRolesHtml=isGlobalFixed?'':`<div class="form-group"><label class="form-label" style="margin-bottom:8px">Ρόλος ανά Κατηγορία</label><div style="border:1px solid var(--navy-line);border-radius:6px;overflow:hidden">${state.db.categories.map((c,i)=>`<div style="display:flex;align-items:center;gap:12px;padding:8px 12px;${i>0?'border-top:1px solid var(--navy-line)':''}"><span style="flex:1;font-size:.82rem">${esc(c.name)}</span><select class="eu-catrole" data-cid="${c.id}" style="font-size:.78rem;padding:3px 6px;border:1px solid var(--navy-line);border-radius:4px;background:var(--white)">${catRoleOpts((user.categoryRoles||{})[c.id])}</select></div>`).join('')}</div><div class="form-hint">«Προεπιλογή» σημαίνει χρήση του global ρόλου.</div></div>`;

  // Access section: per category full OR specific projects
  // Clients also get access control (admin/management pick what they see)
  const isRoleFixed = ['admin','management'].includes(user.role);
  const accessHtml = isRoleFixed ? '' : `<div class="form-group">
    <label class="form-label" style="margin-bottom:8px">Πρόσβαση σε Κατηγορίες / Έργα</label>
    <div class="cat-access-list">${state.db.categories.filter(c=>(state.db.projects||[]).some(p=>p.categoryId===c.id&&p.status!=='completed')).map(c=>{
      const catChecked=(user.categoryIds||[]).includes(c.id);
      const catProjs=state.db.projects.filter(p=>p.categoryId===c.id&&p.status!=='completed');
      const projsHtml=catProjs.length
        ? catProjs.map(p=>`<label class="cat-proj-item"><input type="checkbox" class="eu-proj" value="${p.id}" data-cid="${c.id}"${(user.projectIds||[]).includes(p.id)?' checked':''}> ${esc(p.name)}</label>`).join('')
        : `<div style="font-size:.75rem;color:var(--muted);padding:4px 8px">Δεν υπάρχουν έργα</div>`;
      return `<div class="cat-access-item">
        <label class="cat-access-head">
          <input type="checkbox" class="eu-catfull" data-cid="${c.id}"${catChecked?' checked':''} onchange="euToggleCat(this,'${c.id}')">
          <span class="cat-access-name">${esc(c.name)}</span>
          <span class="cat-access-badge">Ολόκληρη</span>
        </label>
        <div class="cat-proj-list" id="cap-${c.id}"${catChecked?' style="display:none"':''}>
          ${projsHtml}
        </div>
      </div>`;
    }).join('')}</div>
    <div class="form-hint">✓ Ολόκληρη = πρόσβαση σε όλα τα έργα της κατηγορίας. Αποεπιλέξτε για να επιλέξετε συγκεκριμένα έργα.</div>
  </div>`;

  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία – ${esc(user.name)}</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div class="form-group"><label class="form-label">Ονοματεπώνυμο</label><input class="form-control" id="eu-name" value="${esc(user.name)}"></div><div class="form-group"><label class="form-label">Username</label><input class="form-control" id="eu-user" value="${esc(user.username)}" autocomplete="off"></div>${isSupabaseAuthMode()
    ? `<div class="form-hint" style="margin-bottom:12px">Ο κωδικός διαχειρίζεται από Supabase Auth και δεν αλλάζει από αυτή τη φόρμα.</div>
       <div class="form-group"><label class="form-label">Email Auth</label><input class="form-control" type="email" id="eu-email" value="${esc(user.email||'')}" readonly></div>`
    : `<div class="form-group"><label class="form-label">Νέος Κωδικός (κενό = χωρίς αλλαγή)</label><input class="form-control" type="password" id="eu-pass" placeholder="••••••••" autocomplete="new-password"></div>
       <div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" id="eu-email" value="${esc(user.email||'')}"></div>`}<div class="form-group"><label class="form-label">Global Ρόλος</label><select class="form-control" id="eu-role">${Object.entries(ROLE_INFO).map(([k,v])=>`<option value="${k}"${k===user.role?' selected':''}>${v.label}</option>`).join('')}</select><div class="form-hint">Ισχύει όπου δεν υπάρχει ειδικός ρόλος κατηγορίας.</div></div>${catRolesHtml}${accessHtml}</div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateUser('${userId}')">Αποθήκευση</button></div>`);
}
window.euToggleCat=function(cb, cid){
  const list=document.getElementById('cap-'+cid); if(!list) return;
  list.style.display=cb.checked?'none':'';
  if(cb.checked) list.querySelectorAll('.eu-proj').forEach(c=>c.checked=false);
};
window.modalUpdateUser=async function(userId){
  const user=getUser(userId); if(!user) return;
  user.name=el('eu-name').value.trim()||user.name;
  if (!isSupabaseAuthMode()) user.email=el('eu-email').value.trim();
  user.role=el('eu-role').value;
  const newUser=(el('eu-user')?.value||'').trim().toLowerCase();
  if (newUser && newUser!==user.username) {
    if (state.db.users.find(u=>u.id!==userId&&u.username===newUser)) { alert('Το username χρησιμοποιείται ήδη από άλλο χρήστη.'); return; }
    user.username=newUser;
  }
  const np=el('eu-pass')?.value||'';
  if(!isSupabaseAuthMode() && np) user.password=dcodeIO.bcrypt.hashSync(np, 10);
  user.categoryIds=Array.from(document.querySelectorAll('.eu-catfull:checked')).map(c=>c.dataset.cid);
  const fullCatSet=new Set(user.categoryIds);
  user.projectIds=Array.from(document.querySelectorAll('.eu-proj:checked')).filter(c=>!fullCatSet.has(c.dataset.cid)).map(c=>c.value);
  // Save per-category role overrides
  const catRoleSelects=document.querySelectorAll('.eu-catrole');
  if (catRoleSelects.length) {
    const roles={};
    catRoleSelects.forEach(sel=>{ if(sel.value) roles[sel.dataset.cid]=sel.value; });
    user.categoryRoles=roles;
  }
  if(state.cu?.id===userId){state.cu={...user};setCurrentUser(state.cu);}
  auditLog('Επεξεργασία χρήστη',user.name);
  await dbSaveUser(user); closeModal(); render(); showToast('Χρήστης αποθηκεύτηκε.','success');
};

// ── TASK COMMENTS ────────────────────────────────────────────────
function renderTaskComments(task, proj, ph) {
  const comments = task.comments || [];
  const listHtml = comments.map(c => {
    const u = getUser(c.userId);
    const isOwn = c.userId === state.cu?.id;
    return `<div class="comment-item">
      <div class="comment-meta">${esc(u?.name||'Άγνωστος')} · ${fmtDT(c.at)}${isOwn?`<button class="btn btn-danger btn-icon btn-sm" style="margin-left:auto;padding:1px 5px;font-size:.6rem" data-action="delete-comment" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${task.id}" data-cid="${c.id}">✕</button>`:''}</div>
      <div class="comment-text">${esc(c.text)}</div>
    </div>`;
  }).join('');
  return `<div class="comments-section">
    <div class="comments-label">💬 Σχόλια${comments.length?` (${comments.length})`:''}${comments.length?`<button class="btn btn-ghost btn-sm" style="font-size:.68rem;padding:2px 6px;margin-left:auto" data-action="toggle-comments" data-tid="${task.id}">${state.commentsOpen?.[task.id]?'Απόκρυψη':'Εμφάνιση'}</button>`:''}</div>
    ${(state.commentsOpen?.[task.id]||comments.length===0)?`<div class="comments-list">${listHtml}</div>`:''}
    <div class="comment-add">
      <textarea class="form-control comment-input" id="ci-${task.id}" placeholder="Σχόλιο…" rows="2"></textarea>
      <button class="btn btn-secondary btn-sm" data-action="add-comment" data-pid="${proj.id}" data-phid="${ph.id}" data-tid="${task.id}">+ Αποστολή</button>
    </div>
  </div>`;
}

// Returns all users who can see a given project (mirrors visibleProjects logic but for all users)
function getUsersWhoCanSeeProject(proj) {
  return (state.db.users||[]).filter(u => {
    const r = effectiveRole(u, proj.categoryId);
    if (['admin','management'].includes(u.role)) return true;
    if (u.role === 'client') return (u.projectIds||[]).includes(proj.id) || proj.clientId===u.id || (u.categoryIds||[]).includes(proj.categoryId);
    if (r === 'project_manager') {
      const isCatPM = (u.categoryIds||[]).includes(proj.categoryId) || (u.categoryRoles||{})[proj.categoryId]==='project_manager';
      if (isCatPM) return true;
      if ((u.projectIds||[]).includes(proj.id) || projManagerIds(proj).includes(u.id)) return true;
    }
    if (r === 'team_member') {
      if ((u.categoryIds||[]).includes(proj.categoryId) || (u.projectIds||[]).includes(proj.id) || (proj.memberIds||[]).includes(u.id)) return true;
    }
    if (r === 'project_manager' || r === 'team_member') {
      return (proj.phases||[]).some(ph =>
        (ph.tasks||[]).some(t => t.assigneeId===u.id || (t.memberIds||[]).includes(u.id))
      );
    }
    return false;
  });
}

async function sendCommentNotifications(proj, ph, task, commentText) {
  // In-app notification only. No application email is sent.
  await emitProjectNotification('comment',proj,ph,task,null,commentText);
}

async function addComment(pid, phid, tid) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;
  const input=el('ci-'+tid); const text=(input?.value||'').trim(); if(!text) return;

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_comment_add',{
        p_project_id:pid,p_phase_id:phid,p_task_id:tid,p_text:text
      },pid);
      state.expandedTasks[tid]=true;
      if(!state.commentsOpen) state.commentsOpen={};
      state.commentsOpen[tid]=true;
      render();
      showToast('Σχόλιο προστέθηκε.','success');

      const freshProj=getProject(pid);
      const freshPh=freshProj?.phases?.find(p=>p.id===phid);
      const freshTask=freshPh?.tasks?.find(t=>t.id===tid);
      if (freshProj && freshPh && freshTask) {
        sendCommentNotifications(freshProj,freshPh,freshTask,text);
      }
    } catch(err) {
      showToast('Το σχόλιο δεν αποθηκεύτηκε: '+(err.message||err),'error');
    }
    return;
  }

  if(!task.comments) task.comments=[];
  task.comments.push({id:'c_'+uid(),userId:state.cu.id,text,at:nowTS()});
  await dbSaveProject(proj);
  state.expandedTasks[tid]=true;
  if(!state.commentsOpen) state.commentsOpen={};
  state.commentsOpen[tid]=true;
  render();
  showToast('Σχόλιο προστέθηκε.','success');
  sendCommentNotifications(proj, ph, task, text);
}

async function deleteComment(pid, phid, tid, cid) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid); const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;

  if (isSupabaseAuthMode()) {
    try {
      await secureProjectRpc('app_comment_delete',{
        p_project_id:pid,p_phase_id:phid,p_task_id:tid,p_comment_id:cid
      },pid);
      state.expandedTasks[tid]=true;
      render();
    } catch(err) {
      showToast('Το σχόλιο δεν διαγράφηκε: '+(err.message||err),'error');
    }
    return;
  }

  task.comments=(task.comments||[]).filter(c=>c.id!==cid);
  await dbSaveProject(proj);
  state.expandedTasks[tid]=true;
  render();
}

// ── GANTT CHART ───────────────────────────────────────────────────
function renderGantt(proj) {
  const phases=proj.phases||[];
  if (!phases.length) return '<div class="empty-state"><div class="es-icon">📊</div><h3>Δεν υπάρχουν φάσεις</h3></div>';

  // Collect dates from task plannedStart/plannedEnd (auto-computed per phase)
  const allDates=[];
  phases.forEach(ph=>{
    const _pd=phasePlannedDates(ph);
    if(_pd.start) allDates.push(new Date(_pd.start));
    if(_pd.end)   allDates.push(new Date(_pd.end));
    const _ad=phaseActualDates(ph);
    if(_ad.start) allDates.push(new Date(_ad.start));
    if(_ad.end)   allDates.push(new Date(_ad.end));
  });
  let minDate,maxDate;
  if(allDates.length>=1){
    minDate=new Date(Math.min(...allDates.map(d=>d.getTime())));
    maxDate=new Date(Math.max(...allDates.map(d=>d.getTime())));
  } else {
    minDate=new Date(); maxDate=new Date();
    maxDate.setDate(maxDate.getDate()+90);
  }
  // Pad min/max
  minDate.setDate(minDate.getDate()-2);
  maxDate.setDate(maxDate.getDate()+7); // right padding so last bar doesn't get clipped
  if((maxDate-minDate)<7*86400000) maxDate=new Date(minDate.getTime()+90*86400000);
  const rangeMs=maxDate.getTime()-minDate.getTime();
  const ganttScale = state.ganttScale || 'month'; // 'day' | 'week' | 'month'

  // Month labels
  let monthLabels='';
  const cur=new Date(minDate); cur.setDate(1);
  while(cur<=maxDate){
    const mStart=new Date(cur);
    const mEnd  =new Date(cur.getFullYear(),cur.getMonth()+1,0);
    const lPct  =Math.max(0,(mStart-minDate)/rangeMs*100);
    const rPct  =Math.min(100,(mEnd  -minDate)/rangeMs*100);
    const wPct  =rPct-lPct;
    monthLabels+=`<div style="position:absolute;left:${lPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;border-right:1px solid var(--navy-line);font-size:.65rem;font-weight:700;color:var(--steel);padding:3px 5px;white-space:nowrap;overflow:hidden">${cur.toLocaleDateString('el-GR',{month:'short',year:'2-digit'})}</div>`;
    cur.setMonth(cur.getMonth()+1);
  }

  // Week labels
  let weekLabels='';
  const wCur=new Date(minDate);
  const dow=wCur.getDay(); wCur.setDate(wCur.getDate()-(dow===0?6:dow-1));
  while(wCur<=maxDate){
    const lPct=Math.max(0,(wCur-minDate)/rangeMs*100);
    const nextMon=new Date(wCur); nextMon.setDate(nextMon.getDate()+7);
    const rPct=Math.min(100,(nextMon-minDate)/rangeMs*100);
    const wPct=rPct-lPct;
    if(lPct<100&&wPct>0) weekLabels+=`<div style="position:absolute;left:${lPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;border-right:1px solid var(--navy-line);font-size:.62rem;font-weight:700;color:var(--steel);padding:3px 4px;white-space:nowrap;overflow:hidden">${wCur.getDate()}/${wCur.getMonth()+1}</div>`;
    wCur.setDate(wCur.getDate()+7);
  }

  // Day labels
  const GR_MONTHS_G=['Ιαν','Φεβ','Μάρ','Απρ','Μάι','Ιούν','Ιούλ','Αύγ','Σεπ','Οκτ','Νοε','Δεκ'];
  let dayLabels='';
  const rangeDays=Math.round(rangeMs/86400000);
  const dayStep = rangeDays<=60?1:rangeDays<=120?2:5;
  const dCur=new Date(minDate);
  for(let d=0;d<=rangeDays;d+=dayStep){
    const dt=new Date(minDate); dt.setDate(dt.getDate()+d);
    const lPct=(d/rangeDays*100);
    const wPct=(dayStep/rangeDays*100);
    if(lPct<100) dayLabels+=`<div style="position:absolute;left:${lPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;border-right:1px solid var(--navy-line);font-size:.58rem;font-weight:700;color:var(--steel);padding:3px 2px;white-space:nowrap;overflow:hidden">${dt.getDate()} ${GR_MONTHS_G[dt.getMonth()]}</div>`;
  }

  const headerLabels = ganttScale==='week' ? weekLabels : ganttScale==='day' ? dayLabels : monthLabels;

  // Today line
  const todayPct=((new Date()-minDate)/rangeMs*100).toFixed(2);
  const todayLine=(todayPct>=0&&todayPct<=100)?`<div style="position:absolute;left:${todayPct}%;top:0;bottom:0;width:2px;background:var(--red);z-index:3;opacity:.65" title="Σήμερα"></div>`:'';

  // Phase rows — δύο γραμμές ανά φάση: Προγραμματισμένο + Πραγματικό
  const _mkBar=(s,e,clr,label,opacity=1)=>{
    if(!s&&!e) return '';
    const effS=s||e, effE=e||s;
    const sd=new Date(effS),ed=new Date(effE);
    if(ed<sd) return '';
    const lPct=Math.max(0,(sd-minDate)/rangeMs*100);
    const wPct=Math.min(100-lPct,(ed-sd)/rangeMs*100);
    return `<div style="position:absolute;left:${lPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;min-width:6px;top:50%;transform:translateY(-50%);height:20px;background:${clr};border-radius:4px;padding:0 6px;display:flex;align-items:center;overflow:visible;box-shadow:0 1px 3px rgba(0,0,0,.15);opacity:${opacity}"><span style="font-size:.58rem;color:#fff;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${label}</span></div>`;
  };
  const rows=phases.map((ph,idx)=>{
    const done=isPhaseComplete(ph);
    const pd=phasePlannedDates(ph);
    const ad=phaseActualDates(ph);
    const plannedClr='var(--orange)';
    const actualClr ='var(--blue)';
    const plannedBar=(pd.start||pd.end)
      ? _mkBar(pd.start,pd.end,plannedClr,pd.start&&pd.end?fmt(pd.start)+' → '+fmt(pd.end):fmt(pd.start||pd.end))
      : `<div style="padding:0 10px;font-size:.68rem;color:var(--muted);line-height:28px;white-space:nowrap">Δεν υπάρχουν planned dates στις εργασίες</div>`;
    const actualBar=(ad.start||ad.end)
      ? _mkBar(ad.start,ad.end,actualClr,ad.start&&ad.end?fmt(ad.start)+' → '+fmt(ad.end):fmt(ad.start||ad.end),0.75)
      : '';
    const labelCol=`<div style="width:200px;flex-shrink:0;font-size:.75rem;font-weight:600;color:var(--navy);padding:0 14px;border-right:1px solid var(--navy-line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center" title="${esc(ph.name)}">${idx+1}. ${esc(ph.name)}</div>`;
    return `<div style="border-bottom:1px solid var(--slate-100)">
      <div style="display:flex;align-items:stretch;min-height:30px">
        ${labelCol}
        <div style="flex:1;position:relative;min-height:30px;padding:3px 0">${todayLine}${plannedBar}</div>
      </div>
      ${actualBar?`<div style="display:flex;align-items:stretch;min-height:24px;background:rgba(0,0,0,.02)">
        <div style="width:200px;flex-shrink:0;padding:0 14px;border-right:1px solid var(--navy-line);font-size:.6rem;color:var(--muted);display:flex;align-items:center">↳ Πραγματικό</div>
        <div style="flex:1;position:relative;min-height:24px;padding:2px 0">${todayLine}${actualBar}</div>
      </div>`:''}
    </div>`;
  }).join('');

  return `<div style="display:flex;justify-content:flex-end;gap:4px;margin-bottom:6px">
    <button class="btn btn-sm" onclick="state.ganttScale='day';render()" style="font-size:.62rem;padding:3px 7px;${ganttScale==='day'?'background:var(--navy);color:#fff':''}">Ημέρα</button>
    <button class="btn btn-sm" onclick="state.ganttScale='week';render()" style="font-size:.62rem;padding:3px 7px;${ganttScale==='week'?'background:var(--navy);color:#fff':''}">Εβδομάδα</button>
    <button class="btn btn-sm" onclick="state.ganttScale='month';render()" style="font-size:.62rem;padding:3px 7px;${ganttScale==='month'?'background:var(--navy);color:#fff':''}">Μήνας</button>
  </div>
  <div style="background:var(--white);border:1px solid var(--navy-line);border-radius:10px;overflow:hidden;margin-top:0">
    <div style="display:flex;align-items:center;border-bottom:2px solid var(--navy-line)">
      <div style="width:200px;flex-shrink:0;padding:8px 14px;font-size:.68rem;font-weight:800;color:var(--steel);text-transform:uppercase;letter-spacing:.06em;border-right:1px solid var(--navy-line)">Φάση</div>
      <div style="flex:1;position:relative;height:28px">${headerLabels}</div>
    </div>
    ${rows}
    <div style="padding:8px 14px;font-size:.7rem;color:var(--muted);border-top:1px solid var(--slate-100)">
      <span style="color:var(--red);font-weight:700">│</span> Σήμερα &nbsp;
      <span style="display:inline-block;width:12px;height:10px;background:var(--orange);border-radius:2px;vertical-align:middle"></span> Προγραμματισμένο &nbsp;
      <span style="display:inline-block;width:12px;height:10px;background:var(--blue);border-radius:2px;vertical-align:middle;opacity:.75"></span> Πραγματικό
    </div>
  </div>`;
}

// ── GLOBAL SEARCH ─────────────────────────────────────────────────
function showGlobalSearch() {
  if (!state.cu || state.cu.role==='client') return;
  const existing=document.getElementById('gsearch-overlay'); if(existing){existing.remove();return;}
  const ov=document.createElement('div');
  ov.id='gsearch-overlay';
  ov.innerHTML=`
    <div id="gsearch-box">
      <div id="gsearch-top">
        <span style="font-size:1.1rem;color:var(--steel);flex-shrink:0">🔍</span>
        <input id="gsearch-input" type="text" placeholder="Αναζήτηση σε έργα, φάσεις, εργασίες…" autocomplete="off">
        <kbd onclick="closeGsearch()" style="cursor:pointer">Esc</kbd>
      </div>
      <div id="gsearch-results"><div class="gsearch-empty">Πληκτρολογήστε για αναζήτηση…</div></div>
    </div>`;
  document.body.appendChild(ov);
  const input=document.getElementById('gsearch-input');
  input.focus();

  window._gsearchHits=[];
  window.gsearchGo=function(idx){
    const h=window._gsearchHits[idx]; if(!h) return;
    closeGsearch();
    navigate('project',{projectId:h.proj.id});
    if(h.task){ state.expandedTasks[h.task.id]=true; render(); }
  };

  const doSearch=q=>{
    const res=document.getElementById('gsearch-results'); if(!res) return;
    const ql=q.trim().toLowerCase();
    if(!ql){res.innerHTML='<div class="gsearch-empty">Πληκτρολογήστε για αναζήτηση…</div>';return;}
    const hits=[];
    visibleProjects().forEach(proj=>{
      if(proj.name.toLowerCase().includes(ql)||(proj.code||'').toLowerCase().includes(ql)||(proj.clientName||'').toLowerCase().includes(ql))
        hits.push({type:'project',proj,label:proj.name,sub:(proj.code?proj.code+' · ':'')+esc(proj.clientName||'')});
      (proj.phases||[]).forEach(ph=>{
        if(ph.name.toLowerCase().includes(ql))
          hits.push({type:'phase',proj,ph,label:ph.name,sub:esc(proj.name)});
        (ph.tasks||[]).forEach(t=>{
          if(t.name.toLowerCase().includes(ql))
            hits.push({type:'task',proj,ph,task:t,label:t.name,sub:esc(proj.name)+' › '+esc(ph.name)});
          (t.comments||[]).forEach(c=>{
            if(c.text.toLowerCase().includes(ql))
              hits.push({type:'comment',proj,ph,task:t,label:c.text.slice(0,60),sub:'Σχόλιο: '+esc(t.name)});
          });
        });
      });
    });
    if(!hits.length){res.innerHTML='<div class="gsearch-empty">Δεν βρέθηκαν αποτελέσματα</div>';return;}
    const ICONS={project:'📁',phase:'📂',task:'✅',comment:'💬'};
    window._gsearchHits=hits;
    res.innerHTML=hits.slice(0,15).map((h,i)=>`
      <div class="gsearch-item" onclick="gsearchGo(${i})">
        <span class="gsearch-icon">${ICONS[h.type]||'•'}</span>
        <div><div class="gsearch-label">${esc(h.label)}</div><div class="gsearch-sub">${h.sub}</div></div>
      </div>`).join('');
  };

  input.addEventListener('input',e=>doSearch(e.target.value));
  ov.addEventListener('click',e=>{if(e.target===ov)closeGsearch();});
  document.addEventListener('keydown',function gsEsc(e){if(e.key==='Escape'){closeGsearch();document.removeEventListener('keydown',gsEsc);}});
}
window.closeGsearch=function(){const o=document.getElementById('gsearch-overlay');if(o)o.remove();};

// ── CLIENT DOCUMENT UPLOAD ────────────────────────────────────────
window.clientUploadDoc=async function(docId,taskId,projId,inputEl){
  const file=inputEl.files?.[0];
  if(!file) return;
  if(file.size>50*1024*1024){showToast('Το αρχείο υπερβαίνει τα 50MB.','error');return;}
  const proj=getProject(projId);
  if(!proj) return;

  let targetDoc=null, targetPhase=null;
  outer:for(const ph of proj.phases||[]){
    for(const t of ph.tasks||[]){
      const d=(t.docs||[]).find(x=>x.id===docId);
      if(d){targetDoc=d;targetPhase=ph;break outer;}
    }
  }
  if(!targetDoc||!targetPhase){showToast('Δεν βρέθηκε έγγραφο.','error');return;}

  showToast('Ανέβασμα αρχείου…','info');
  try{
    await fileSave(docId,file);

    if (isSupabaseAuthMode()) {
      await secureProjectRpc('app_document_complete',{
        p_project_id:projId,p_phase_id:targetPhase.id,p_task_id:taskId,
        p_document_id:docId,p_file_name:file.name,p_url:null,p_client_uploaded:true
      },projId);
    } else {
      targetDoc.done=true;
      targetDoc.file=file.name;
      targetDoc.doneAt=nowTS();
      targetDoc.clientUploaded=true;
      await dbSaveProject(proj);
    }

    const freshProj=getProject(projId)||proj;
    const freshPhase=(freshProj.phases||[]).find(x=>x.id===targetPhase.id)||targetPhase;
    const freshTask=(freshPhase.tasks||[]).find(x=>x.id===taskId);
    if(freshTask){
      await emitProjectNotification('client_document_uploaded',freshProj,freshPhase,freshTask,null,targetDoc?.name||file.name);
    }

    if(!state.clientExpanded)state.clientExpanded={};
    state.clientExpanded[taskId]=true;
    render();
    showToast('Το αρχείο ανέβηκε επιτυχώς! ✓','success');
  }catch(e){
    showToast('Σφάλμα: '+(e.message||e),'error');
  }
};

async function reloadClientDeliveries() {
  if(!isSupabaseAuthMode()) { state.db.clientDeliveries=[]; return; }
  const {data,error}=await sb.rpc('app_client_deliveries_list',{p_project_id:null});
  if(error) throw error;
  state.db.clientDeliveries=(data||[]).map(r=>({
    id:String(r.id),projectId:r.project_id,phaseId:r.phase_id,taskId:r.task_id,
    documentId:r.document_id,storagePath:r.storage_path,fileName:r.file_name,
    mimeType:r.mime_type,sizeBytes:Number(r.size_bytes||0),version:Number(r.version||1),
    publishedAt:r.published_at,publishedBy:r.published_by,active:r.active!==false
  }));
}

window.showModalClientDelivery=function(did,tid){
  const found=findDoc(did,tid); if(!found) return;
  const {proj,ph,task,doc}=found;
  if(!isSupabaseAuthMode()) {
    showToast('Η ασφαλής παράδοση στον πελάτη απαιτεί σύνδεση μέσω Supabase Auth.','error');
    return;
  }
  if(!canPublishClientDelivery(proj,task)) {
    showToast('Δεν έχετε δικαίωμα παράδοσης αυτού του εγγράφου.','error');
    return;
  }
  const current=deliveryForDocument(proj.id,task.id,doc.id);
  const source=_dropboxDocumentSources(doc.url);
  showModal(`<div class="modal-header"><div class="modal-title">📤 ${current?'Ενημέρωση':'Παράδοση'} εγγράφου στον πελάτη</div><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body"><div style="padding:12px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;color:#92400e;line-height:1.55"><strong>Χειροκίνητη παράδοση αντιγράφου.</strong><br>Το επίσημο αρχείο παραμένει μόνο στο Dropbox. Επιλέξτε την τρέχουσα έκδοση του ίδιου αρχείου για να δημιουργηθεί ιδιωτικό αντίγραφο που θα βλέπει ο συνδεδεμένος πελάτης.</div><div class="form-group" style="margin-top:14px"><label class="form-label">Έγγραφο</label><div>${esc(doc.name)}</div>${source.localPath?`<div class="form-hint" style="word-break:break-all">${esc(source.localPath)}</div>`:''}</div>${current?`<div class="form-group"><label class="form-label">Τρέχουσα παράδοση</label><div class="badge badge-green">Έκδοση ${current.version} · ${fmtDT(current.publishedAt)}</div><div class="form-hint">${esc(current.fileName||'')}</div></div>`:''}<div class="form-group"><label class="form-label">Επιλογή αρχείου <sup>*</sup></label><input type="file" class="form-control" id="client-delivery-file"><div class="form-hint">Μέγιστο μέγεθος 50MB. Η δημοσίευση δεν γίνεται αυτόματα όταν αλλάζει το Dropbox.</div></div></div><div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" id="client-delivery-publish-btn" onclick="publishClientDelivery('${proj.id}','${ph.id}','${task.id}','${doc.id}')">${current?'🔄 Ενημέρωση παράδοσης':'📤 Παράδοση'}</button></div>`);
};

window.publishClientDelivery=async function(pid,phid,tid,did){
  const file=el('client-delivery-file')?.files?.[0];
  if(!file){showToast('Επιλέξτε αρχείο.','error');return;}
  if(file.size>50*1024*1024){showToast('Το αρχείο υπερβαίνει τα 50MB.','error');return;}
  const found=findDoc(did,tid); if(!found||found.proj.id!==pid) return;
  if(!canPublishClientDelivery(found.proj,found.task)) return;
  const btn=el('client-delivery-publish-btn');
  if(btn){btn.disabled=true;btn.textContent='Προετοιμασία…';}
  try {
    const {data:prepared,error:prepareError}=await sb.rpc('app_client_delivery_prepare',{
      p_project_id:pid,p_phase_id:phid,p_task_id:tid,p_document_id:did,
      p_file_name:file.name,p_mime_type:file.type||_documentMime(file.name),p_size_bytes:file.size
    });
    if(prepareError) throw prepareError;
    const uploadPath=prepared?.upload_path||prepared?.uploadPath;
    if(!uploadPath) throw new Error('Δεν επιστράφηκε ασφαλής διαδρομή ανεβάσματος.');
    if(btn) btn.textContent='Ανέβασμα…';
    const {error:uploadError}=await sb.storage.from(BUCKET).upload(uploadPath,file,{upsert:false,contentType:file.type||_documentMime(file.name)});
    if(uploadError) throw uploadError;
    if(btn) btn.textContent='Δημοσίευση…';
    const {error:publishError}=await sb.rpc('app_client_delivery_publish',{
      p_project_id:pid,p_task_id:tid,p_document_id:did
    });
    if(publishError) throw publishError;
    await reloadClientDeliveries();
    await emitProjectNotification('client_delivery_published',found.proj,found.ph,found.task,null,found.doc.name);
    auditLog('Παράδοση εγγράφου στον πελάτη',`"${found.doc.name}" – ${found.proj.name}`);
    closeModal(); render(); requestAnimationFrame(()=>restoreExpanded());
    showToast('Το ιδιωτικό αντίγραφο παραδόθηκε στον πελάτη.','success');
  } catch(error) {
    if(btn){btn.disabled=false;btn.textContent='Επανάληψη';}
    showToast('Η παράδοση απέτυχε: '+(error.message||error),'error');
  }
};

window.openClientDelivery=async function(deliveryId,download=false){
  const delivery=(state.db.clientDeliveries||[]).find(d=>d.id===String(deliveryId)&&d.active!==false);
  if(!delivery){showToast('Η παράδοση δεν βρέθηκε ή έχει ανακληθεί.','error');return;}
  if(!isSupabaseAuthMode()){showToast('Απαιτείται ασφαλής σύνδεση.','error');return;}
  try {
    if(download){
      const blob=await fileGet(delivery.storagePath);
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a'); a.href=url; a.download=delivery.fileName||'document';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
    } else {
      const tab=_prepareDocumentTab();
      await _openStorageDocument({storagePath:delivery.storagePath,file:delivery.fileName,name:delivery.fileName},tab);
    }
  } catch(error){showToast('Το έγγραφο δεν άνοιξε: '+(error.message||error),'error');}
};

// ── EXCEL EXPORT ─────────────────────────────────────────────────
function _xlsxCheck() {
  if (typeof XLSX === 'undefined') { showToast('Η βιβλιοθήκη Excel δεν φορτώθηκε. Ελέγξτε τη σύνδεση.','error'); return false; }
  return true;
}
function _taskRow(proj, ph, t) {
  const assignee=getUser(t.assigneeId);
  const st=TASK_STATUSES[t.status]||TASK_STATUSES.not_started;
  const subs=t.subtasks||[];
  const dp=taskDocProgress(t);
  return {
    'Έργο':          proj.name,
    'Κωδικός':       proj.code||'',
    'Πελάτης':       proj.clientName||'',
    'Φάση':          ph.name,
    'Εργασία':       t.name,
    'Υπεύθυνος':     assignee?.name||'',
    'Κατάσταση':     st.label,
    'Πρόοδος %':     taskProgress(t),
    'Πρ. Έναρξη':    t.plannedStart||'',
    'Πρ. Λήξη':      t.plannedEnd||'',
    'Πραγμ. Έναρξη': t.startDate||'',
    'Ολοκλήρωση':    t.completedDate||'',
    'Υποεργασίες':   `${subs.filter(s=>s.done).length}/${subs.length}`,
    'Έγγραφα':       `${dp.done}/${dp.total}`,
  };
}
function _docPath(d) {
  if (d.url)  return d.url;
  if (d.file) return `Supabase Storage: ${d.id} (${d.file})`;
  return '';
}
function _docRows(proj, ph, t) {
  return (t.docs||[]).map(d=>({
    'Έργο':               proj.name,
    'Κωδικός':            proj.code||'',
    'Φάση':               ph.name,
    'Εργασία':            t.name,
    'Έγγραφο':            d.name,
    'Κατηγορία':          d.cat||'',
    'Τύπος':              DOC_TYPES[d.type]||d.type||'',
    'Υποχρεωτικό':        d.required?'Ναι':'Όχι',
    'Κατάσταση':          d.done?'Παραλήφθηκε':'Εκκρεμεί',
    'Διαδρομή / Σύνδεσμος': _docPath(d),
    'Ημ/νία Παράδοσης':   d.at||'',
  }));
}
function _writeXlsx(taskRows, docRows, filename) {
  const wb=XLSX.utils.book_new();
  const wsTasks=XLSX.utils.json_to_sheet(taskRows.length?taskRows:[{'':'Δεν υπάρχουν εργασίες'}]);
  const wsDocs =XLSX.utils.json_to_sheet(docRows.length ?docRows :[{'':'Δεν υπάρχουν έγγραφα'}]);
  // Column widths
  wsTasks['!cols']=[{wch:30},{wch:14},{wch:22},{wch:28},{wch:32},{wch:22},{wch:22},{wch:10},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:12}];
  wsDocs ['!cols']=[{wch:30},{wch:14},{wch:28},{wch:32},{wch:30},{wch:16},{wch:14},{wch:12},{wch:14},{wch:50},{wch:30},{wch:12}];
  XLSX.utils.book_append_sheet(wb, wsTasks, 'Εργασίες');
  XLSX.utils.book_append_sheet(wb, wsDocs,  'Έγγραφα');
  XLSX.writeFile(wb, filename);
  showToast(`Αρχείο "${filename}" λήφθηκε.`,'success');
}

function exportCategoryToExcel(catId) {
  if (!_xlsxCheck()) return;
  const cat=getCategory(catId); if(!cat) return;
  const projs=state.db.projects.filter(p=>p.categoryId===catId);
  const tRows=[], dRows=[];
  projs.forEach(proj=>(proj.phases||[]).forEach(ph=>(ph.tasks||[]).forEach(t=>{ tRows.push(_taskRow(proj,ph,t)); dRows.push(..._docRows(proj,ph,t)); })));
  _writeXlsx(tRows, dRows, `${cat.name}.xlsx`);
}
function exportProjectToExcel(projId) {
  if (!_xlsxCheck()) return;
  const proj=getProject(projId); if(!proj) return;
  const tRows=[], dRows=[];
  (proj.phases||[]).forEach(ph=>(ph.tasks||[]).forEach(t=>{ tRows.push(_taskRow(proj,ph,t)); dRows.push(..._docRows(proj,ph,t)); }));
  _writeXlsx(tRows, dRows, `${proj.code||proj.name}.xlsx`);
}
function exportPhaseToExcel(projId, phId) {
  if (!_xlsxCheck()) return;
  const proj=getProject(projId); if(!proj) return;
  const ph=proj.phases.find(p=>p.id===phId); if(!ph) return;
  const tRows=[], dRows=[];
  (ph.tasks||[]).forEach(t=>{ tRows.push(_taskRow(proj,ph,t)); dRows.push(..._docRows(proj,ph,t)); });
  _writeXlsx(tRows, dRows, `${proj.code||proj.name} – ${ph.name}.xlsx`);
}

// ── CLIENT CALENDAR ───────────────────────────────────────────────
// Helper: get display title (new field or legacy clientName)
function _ccalTitle(e)    { return e.title    || e.clientName    || ''; }
// Helper: get display category (new field or legacy projectName)
function _ccalCategory(e) { return e.category || e.projectName  || ''; }
// Helper: extract filename from a local path (last segment)
function _ccalFileBasename(p) {
  if (!p) return 'Αρχείο';
  return p.replace(/\\/g,'/').split('/').filter(Boolean).pop() || 'Αρχείο';
}
// Helper: build a file:// URL from a local Windows/POSIX path
function _ccalFileUrl(p) {
  if (!p) return null;
  const norm = p.replace(/\\/g, '/');
  return norm.startsWith('/') ? 'file://' + norm : 'file:///' + norm;
}

function renderClientCalendar() {
  if (!state.cu || state.cu.role === 'client') return '<div class="empty-state"><h3>Δεν έχετε πρόσβαση</h3></div>';
  const sort = state.ccalSort || 'date-asc';
  let entries = [...(state.db.clientCalendar||[])];
  if (sort === 'date-asc')       entries.sort((a,b)=>a.expiryDate<b.expiryDate?-1:1);
  if (sort === 'date-desc')      entries.sort((a,b)=>a.expiryDate>b.expiryDate?-1:1);
  if (sort === 'title-asc')      entries.sort((a,b)=>_ccalTitle(a).localeCompare(_ccalTitle(b),'el'));
  if (sort === 'title-desc')     entries.sort((a,b)=>_ccalTitle(b).localeCompare(_ccalTitle(a),'el'));
  if (sort === 'category-asc')   entries.sort((a,b)=>_ccalCategory(a).localeCompare(_ccalCategory(b),'el'));
  if (sort === 'category-desc')  entries.sort((a,b)=>_ccalCategory(b).localeCompare(_ccalCategory(a),'el'));
  // legacy aliases
  if (sort === 'client')         entries.sort((a,b)=>_ccalTitle(a).localeCompare(_ccalTitle(b),'el'));
  if (sort === 'project-asc')    entries.sort((a,b)=>_ccalCategory(a).localeCompare(_ccalCategory(b),'el'));
  const todayStr = today();

  const _days = (dateStr) => {
    const diff = Math.round((new Date(dateStr) - new Date(todayStr)) / 86400000);
    return diff;
  };
  const _badge = (dateStr) => {
    const d = _days(dateStr);
    if (d < 0)  return `<span class="ccal-badge ccal-exp">Έληξε ${Math.abs(d)} μέρες πριν</span>`;
    if (d === 0) return `<span class="ccal-badge ccal-today">Λήγει σήμερα!</span>`;
    if (d <= 30) return `<span class="ccal-badge ccal-soon">Λήγει σε ${d} μέρες</span>`;
    return `<span class="ccal-badge ccal-ok">Λήγει σε ${d} μέρες</span>`;
  };
  const _rowCls = (dateStr) => {
    const d = _days(dateStr);
    if (d < 0)  return ' ccal-row-exp';
    if (d <= 30) return ' ccal-row-soon';
    return '';
  };

  const rows = entries.map(e => {
    const filePath = e.fileId ? null : (e.filePath || e.fileUrl || null);
    const fileLabel = e.fileName || (filePath ? _ccalFileBasename(filePath) : null);
    const fileBtn = fileLabel
      ? `<button class="btn btn-ghost btn-sm ccal-file-btn" onclick="ccalOpen('${e.id}')" title="${esc(fileLabel)}" style="font-size:.72rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📄 ${esc(fileLabel)}</button>`
      : `<span class="text-muted" style="font-size:.75rem">—</span>`;
    const title    = _ccalTitle(e);
    const category = _ccalCategory(e);
    return `<div class="ccal-row${_rowCls(e.expiryDate)}">
      <div class="ccal-client"><div class="ccal-name">${esc(title)}</div></div>
      <div class="ccal-company">${category?`<span class="ccal-cat-tag">${esc(category)}</span>`:'<span class="text-muted">—</span>'}</div>
      <div class="ccal-date">
        <div style="font-weight:700;font-size:.85rem">${fmt(e.expiryDate)}</div>
        ${_badge(e.expiryDate)}
      </div>
      <div class="ccal-file">${fileBtn}</div>
      ${e.notes?`<div class="ccal-notes">📝 ${esc(e.notes)}</div>`:'<div></div>'}
      <div class="ccal-actions">
        <button class="btn btn-ghost btn-sm" data-action="ccal-edit" data-ccid="${e.id}" style="font-size:.72rem">✏</button>
        <button class="btn btn-danger btn-sm" data-action="ccal-delete" data-ccid="${e.id}" style="font-size:.72rem">✕</button>
      </div>
    </div>`;
  }).join('');

  // Summary counts
  const allEntries = state.db.clientCalendar || [];
  const expired = allEntries.filter(e=>_days(e.expiryDate)<0).length;
  const soon    = allEntries.filter(e=>{ const d=_days(e.expiryDate); return d>=0&&d<=30; }).length;

  const sortBtns = [
    {k:'date-asc',      label:'Ημερομηνία ↑',  title:'Λήγει πρώτο'},
    {k:'date-desc',     label:'Ημερομηνία ↓',  title:'Λήγει τελευταίο'},
    {k:'title-asc',     label:'Τίτλος A-Z',    title:'Αλφαβητικά τίτλου'},
    {k:'category-asc',  label:'Κατηγορία A-Z', title:'Αλφαβητικά κατηγορίας'},
  ].map(s=>`<button class="crm-filter-btn${sort===s.k?' active':''}" title="${s.title}" onclick="state.ccalSort='${s.k}';render()">${s.label}</button>`).join('');

  // Helper: clickable sort header
  const _sortHd = (label, keyAsc, keyDesc) => {
    const isAsc  = sort === keyAsc;
    const isDesc = sort === keyDesc;
    const arrow  = isAsc ? ' ↑' : isDesc ? ' ↓' : '';
    const next   = isAsc ? keyDesc : keyAsc;
    return `<div class="ccal-hd-sortable${isAsc||isDesc?' ccal-hd-active':''}" onclick="state.ccalSort='${next}';render()" title="Ταξινόμηση">${label}${arrow}</div>`;
  };

  return `
  <div class="page-hd">
    <div><h1>Compliance Calendar</h1><div class="page-hd-sub">Παρακολούθηση ημερομηνιών λήξης εγγράφων</div></div>
    <div class="page-hd-actions">
      <button class="btn btn-primary" data-action="ccal-add">+ Νέα Εγγραφή</button>
    </div>
  </div>
  <div class="crm-toolbar" style="margin-bottom:12px">
    <div style="font-size:.78rem;font-weight:600;color:var(--muted);align-self:center">Ταξινόμηση:</div>
    <div class="crm-filters">${sortBtns}</div>
  </div>
  ${expired||soon?`<div class="ccal-summary">
    ${expired?`<div class="ccal-sum-item ccal-sum-exp">🔴 <strong>${expired}</strong> ληγμένα</div>`:''}
    ${soon?`<div class="ccal-sum-item ccal-sum-soon">🟠 <strong>${soon}</strong> λήγουν εντός 30 ημερών</div>`:''}
  </div>`:''}
  ${entries.length ? `
  <div class="ccal-table">
    <div class="ccal-head">
      ${_sortHd('Τίτλος','title-asc','title-desc')}
      ${_sortHd('Κατηγορία','category-asc','category-desc')}
      ${_sortHd('Ημ. Λήξης','date-asc','date-desc')}
      <div>Αρχείο</div><div>Σημειώσεις</div><div></div>
    </div>
    ${rows}
  </div>` : `<div class="empty-state"><div class="es-icon">📅</div><h3>Δεν υπάρχουν εγγραφές</h3><p>Προσθέστε την πρώτη εγγραφή.</p><button class="btn btn-primary" data-action="ccal-add">+ Νέα Εγγραφή</button></div>`}`;
}

function showModalAddCcal() {
  showModal(`<div class="modal-header"><div class="modal-title">Νέα Εγγραφή – Compliance Calendar</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="cc-title" placeholder="π.χ. Άδεια Λειτουργίας Παπαδόπουλος"></div>
      <div class="form-group"><label class="form-label">Κατηγορία</label><input class="form-control" id="cc-category" placeholder="π.χ. ΜΠΕ, Άδεια, Σύμβαση…"></div>
    </div>
    <div class="form-group"><label class="form-label">📅 Ημερομηνία Λήξης <sup>*</sup></label><input type="date" class="form-control" id="cc-expiry"></div>
    <div class="form-group">
      <label class="form-label">📁 Αρχείο <span class="text-muted" style="font-weight:400">(προαιρετικό)</span></label>
      <div class="ccal-path-row">
        <input class="form-control" id="cc-filepath" placeholder="Επιλέξτε αρχείο…" readonly style="flex:1;background:var(--paper)">
        <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('cc-filepick').click()" style="white-space:nowrap">📂 Αναζήτηση</button>
        <input type="file" id="cc-filepick" style="display:none" onchange="window._ccalPickPath('cc-filepath',this)">
      </div>
      <div class="form-hint">Το αρχείο αποθηκεύεται στο cloud και ανοίγει από οποιοδήποτε πρόγραμμα περιήγησης.</div>
    </div>
    <div class="form-group"><label class="form-label">Σημειώσεις</label><textarea class="form-control" id="cc-notes" rows="2" placeholder="Προαιρετικές σημειώσεις…"></textarea></div>
  </div>
  <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalSaveCcal()">Αποθήκευση</button></div>`);
}

window.modalSaveCcal = async function() {
  const title      = (el('cc-title')?.value||'').trim();
  const expiryDate = el('cc-expiry').value;
  if (!title||!expiryDate) { alert('Συμπληρώστε τον Τίτλο και την Ημερομηνία Λήξης.'); return; }

  let fileId = null, fileName = null;
  if (window._ccalPendingFile) {
    fileId = 'ccal_' + uid();
    showToast('Ανέβασμα αρχείου…', 'info');
    try { await _ccalFileSave(fileId, window._ccalPendingFile); fileName = window._ccalPendingFile.name; }
    catch(e) { showToast('Σφάλμα ανεβάσματος αρχείου.', 'error'); return; }
    window._ccalPendingFile = null;
  }

  const entry = {
    id:         'cc_'+uid(),
    title,
    category:   (el('cc-category')?.value||'').trim(),
    expiryDate,
    fileId,
    fileName,
    filePath:   null,
    notes:      (el('cc-notes')?.value||'').trim(),
    createdBy:  state.cu.id,
    createdAt:  nowTS(),
  };
  if (!state.db.clientCalendar) state.db.clientCalendar = [];
  state.db.clientCalendar.unshift(entry);
  await dbSaveClientCalEntry(entry);
  auditLog('Νέα εγγραφή Compliance Calendar', `${title}`);
  closeModal(); render(); showToast('Εγγραφή αποθηκεύτηκε.','success');
};

function showModalEditCcal(ccId) {
  const e = (state.db.clientCalendar||[]).find(x=>x.id===ccId); if (!e) return;
  const curName = e.fileName || (e.filePath ? _ccalFileBasename(e.filePath) : '') || (e.fileUrl ? _ccalFileBasename(e.fileUrl) : '') || '';
  window._ccalPendingFile = null; // clear any pending file from previous modal
  showModal(`<div class="modal-header"><div class="modal-title">Επεξεργασία Εγγραφής</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">Τίτλος <sup>*</sup></label><input class="form-control" id="cc-title" value="${esc(_ccalTitle(e))}"></div>
      <div class="form-group"><label class="form-label">Κατηγορία</label><input class="form-control" id="cc-category" value="${esc(_ccalCategory(e))}"></div>
    </div>
    <div class="form-group"><label class="form-label">📅 Ημερομηνία Λήξης <sup>*</sup></label><input type="date" class="form-control" id="cc-expiry" value="${e.expiryDate}"></div>
    <div class="form-group">
      <label class="form-label">📁 Αρχείο <span class="text-muted" style="font-weight:400">(προαιρετικό)</span></label>
      <div class="ccal-path-row">
        <input class="form-control" id="cc-filepath" value="${esc(curName)}" placeholder="Επιλέξτε αρχείο…" readonly style="flex:1;background:var(--paper)">
        <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('cc-filepick').click()" style="white-space:nowrap">📂 Αναζήτηση</button>
        <input type="file" id="cc-filepick" style="display:none" onchange="window._ccalPickPath('cc-filepath',this)">
      </div>
      <div class="form-hint">Το αρχείο αποθηκεύεται στο cloud και ανοίγει από οποιοδήποτε πρόγραμμα περιήγησης.</div>
    </div>
    <div class="form-group"><label class="form-label">Σημειώσεις</label><textarea class="form-control" id="cc-notes" rows="2">${esc(e.notes||'')}</textarea></div>
  </div>
  <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button><button class="btn btn-primary" onclick="modalUpdateCcal('${ccId}')">Αποθήκευση</button></div>`);
}

window.modalUpdateCcal = async function(ccId) {
  const entry = (state.db.clientCalendar||[]).find(x=>x.id===ccId); if (!entry) return;
  const title      = (el('cc-title')?.value||'').trim();
  const expiryDate = el('cc-expiry').value;
  if (!title||!expiryDate) { alert('Συμπληρώστε τον Τίτλο και την Ημερομηνία Λήξης.'); return; }
  entry.title      = title;
  entry.category   = (el('cc-category')?.value||'').trim();
  entry.expiryDate = expiryDate;
  entry.notes      = (el('cc-notes')?.value||'').trim();
  if (window._ccalPendingFile) {
    const newId = 'ccal_' + uid();
    showToast('Ανέβασμα αρχείου…', 'info');
    try {
      await _ccalFileSave(newId, window._ccalPendingFile);
      entry.fileId   = newId;
      entry.fileName = window._ccalPendingFile.name;
      entry.filePath = null;
    } catch(e) { showToast('Σφάλμα ανεβάσματος αρχείου.', 'error'); return; }
    window._ccalPendingFile = null;
  }
  entry.updatedAt = nowTS();
  await dbSaveClientCalEntry(entry);
  auditLog('Ενημέρωση Compliance Calendar', `${title}`);
  closeModal(); render(); showToast('Εγγραφή ενημερώθηκε.','success');
};

// Upload helper for Compliance Calendar — sets explicit contentType
async function _ccalFileSave(fileId, file) {
  const ext = (file.name||'').split('.').pop().toLowerCase();
  const mimeMap = {
    pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
    gif:'image/gif', webp:'image/webp', svg:'image/svg+xml',
    doc:'application/msword',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:'application/vnd.ms-excel',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  const contentType = file.type || mimeMap[ext] || 'application/octet-stream';
  const {error} = await sb.storage.from(BUCKET).upload(fileId, file, {upsert:true, contentType});
  if (error) throw error;
}

// Browse helper: store File object for upload on save, show filename in field
window._ccalPickPath = function(fieldId, input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const field = el(fieldId);
  if (!field) return;
  window._ccalPendingFile = f; // upload to Supabase on save
  field.value = f.name;
};

window.ccalOpen = async function(ccId) {
  const entry = (state.db.clientCalendar||[]).find(x=>x.id===ccId);
  if (!entry) return;
  if (entry.fileId) {
    const ext = (entry.fileName||'').split('.').pop().toLowerCase();
    // Office αρχεία → Microsoft Office Online viewer (ανοίγει στον browser)
    const officeExts = ['doc','docx','xls','xlsx','ppt','pptx'];
    if (officeExts.includes(ext)) {
      const { data: pubData } = sb.storage.from(BUCKET).getPublicUrl(entry.fileId);
      const viewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(pubData.publicUrl)}`;
      window.open(viewerUrl, '_blank');
      return;
    }
    // PDF & εικόνες → άνοιγμα inline στον browser
    showToast('Φόρτωση αρχείου…', 'info');
    try {
      const rawBlob = await fileGet(entry.fileId);
      const mimeMap = {
        pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
        gif:'image/gif', webp:'image/webp', svg:'image/svg+xml',
      };
      const mime = mimeMap[ext] || rawBlob.type || 'application/octet-stream';
      const blob = new Blob([rawBlob], {type: mime});
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch(e) { showToast('Σφάλμα φόρτωσης αρχείου.', 'error'); }
    return;
  }
  // Legacy: local file path (Electron only)
  if (entry.filePath) {
    window.open(_ccalFileUrl(entry.filePath), '_blank');
    return;
  }
  if (entry.fileUrl) { window.open(entry.fileUrl, '_blank'); return; }
  showToast('Δεν έχει οριστεί αρχείο για αυτή την εγγραφή.','');
};;

async function ccalDelete(ccId) {
  const entry = (state.db.clientCalendar||[]).find(x=>x.id===ccId); if (!entry) return;
  if (!confirm(`Διαγραφή εγγραφής «${entry.clientName} · ${entry.projectName}»;`)) return;
  state.db.clientCalendar = state.db.clientCalendar.filter(x=>x.id!==ccId);
  if (entry.fileId) fileDelete(entry.fileId).catch(()=>{});
  await dbDeleteClientCalEntry(ccId);
  auditLog('Διαγραφή Client Calendar', `${entry.clientName} · ${entry.projectName}`);
  render(); showToast('Εγγραφή διαγράφηκε.','');
}

// ── CRM HELPERS ───────────────────────────────────────────────
const CRM_CATEGORIES  = ['Πελάτης','Προμηθευτής','Συνεργάτης','Prospect','Άλλο'];
const CRM_LEGAL_FORMS = ['ΑΕ','ΕΠΕ','ΙΚΕ','ΟΕ','ΕΕ','ΑΤΟΜΙΚΗ','Άλλο'];
const CRM_CRED_CATS   = ['ΕΡΓΑΝΗ','e-ΕΦΚΑ','ΗΠΜ','ΗΜΑ','Τράπεζα','MyDATA','ΓΕΜΗ Portal','Άλλο'];
const CRM_CAT_COLORS  = {'Πελάτης':'#1d4ed8','Προμηθευτής':'#7c3aed','Συνεργάτης':'#059669','Prospect':'#b45309','Άλλο':'#64748b'};

function crmContactName(c) {
  return [c.first_name,c.last_name].filter(Boolean).join(' ') || c.nickname || c.organization_name || '(Χωρίς όνομα)';
}
function _crmPhones(c) {
  const ph=[]; for(let i=1;i<=5;i++){if(c[`phone_${i}_value`])ph.push(c[`phone_${i}_value`]);} return ph;
}
function _crmEmails(c) {
  const em=[]; for(let i=1;i<=3;i++){if(c[`email_${i}_value`])em.push(c[`email_${i}_value`]);} return em;
}
function _crmPhonesList(co) {
  try { const a=JSON.parse(co.phones_json||'null'); if(Array.isArray(a)&&a.length) return a; } catch{}
  return co.phone?[co.phone]:[];
}
function _crmEmailsList(co) {
  try { const a=JSON.parse(co.emails_json||'null'); if(Array.isArray(a)&&a.length) return a; } catch{}
  return co.email?[co.email]:[];
}
function _crmAddrsList(co) {
  try { const a=JSON.parse(co.addresses_json||'null'); if(Array.isArray(a)&&a.length) return a; } catch{}
  const addr={street:co.address,city:co.city,postal_code:co.postal_code};
  return (addr.street||addr.city)?[addr]:[];
}
function _crmExtrasCo(co) {
  const res=[];
  if(co.taxisnet_username||co.taxisnet_password) res.push({cat:'Taxisnet',u:co.taxisnet_username||'',p:co.taxisnet_password||''});
  if(co.ergani_username||co.ergani_password)     res.push({cat:'ΕΡΓΑΝΗ',u:co.ergani_username||'',p:co.ergani_password||''});
  if(co.efka_username||co.efka_password)         res.push({cat:'e-ΕΦΚΑ',u:co.efka_username||'',p:co.efka_password||''});
  if(co.bank_username||co.bank_password)         res.push({cat:co.bank_name?`Τράπεζα — ${co.bank_name}`:'Τράπεζα',u:co.bank_username||'',p:co.bank_password||''});
  try { const e=JSON.parse(co.extra_creds_json||'null'); if(Array.isArray(e)) e.forEach(x=>res.push({cat:x.category,u:x.username||'',p:x.password||''})); } catch{}
  return res;
}

// ── CRM — COMPANIES LIST ───────────────────────────────────────
function renderCrmCompanies() {
  const canEdit = state.cu && ['admin','management'].includes(state.cu.role);
  const q = (state.crmSearch||'').toLowerCase();
  let companies = (state.db.crmCompanies||[]).filter(co=>{
    if (!q) return true;
    return (co.company_name||'').toLowerCase().includes(q)
        || (co.afm||'').includes(q)
        || (co.city||'').toLowerCase().includes(q)
        || (co.category||'').toLowerCase().includes(q)
        || (co.activity||'').toLowerCase().includes(q);
  });
  const catFilter = state.crmCatFilter||'';
  if (catFilter) companies = companies.filter(co=>co.category===catFilter);

  const catCounts = {};
  (state.db.crmCompanies||[]).forEach(co=>{
    const k=co.category||'(Χωρίς)'; catCounts[k]=(catCounts[k]||0)+1;
  });

  const rows = companies.map(co=>{
    const phones = _crmPhonesList(co);
    const emails = _crmEmailsList(co);
    const catColor = CRM_CAT_COLORS[co.category]||'#64748b';
    return `<tr class="crm-tr" data-action="crm-co-open" data-coid="${co.id}" style="cursor:pointer">
      <td class="crm-td"><div class="crm-co-name">${esc(co.company_name)}</div>${co.activity?`<div class="crm-sub">${esc(co.activity)}</div>`:''}</td>
      <td class="crm-td">${co.category?`<span class="crm-badge" style="background:${catColor}20;color:${catColor}">${esc(co.category)}</span>`:''}</td>
      <td class="crm-td crm-mono">${co.afm?esc(co.afm):'—'}</td>
      <td class="crm-td">${phones.length?esc(phones[0]):'—'}</td>
      <td class="crm-td">${emails.length?`<a href="mailto:${esc(emails[0])}" onclick="event.stopPropagation()" style="color:var(--blue)">${esc(emails[0])}</a>`:'—'}</td>
      <td class="crm-td">${co.city?esc(co.city):'—'}</td>
      <td class="crm-td" style="text-align:right">
        ${canEdit?`<button class="btn btn-ghost btn-sm" data-action="crm-co-edit" data-coid="${co.id}" style="font-size:.72rem">✏</button>
        <button class="btn btn-danger btn-sm" data-action="crm-co-delete" data-coid="${co.id}" style="font-size:.72rem">✕</button>`:''}
      </td>
    </tr>`;
  }).join('');

  const filterBtns = ['', ...CRM_CATEGORIES].map(cat=>{
    const active = catFilter===cat;
    const label = cat||'Όλες';
    return `<button class="crm-filter-btn${active?' active':''}" onclick="state.crmCatFilter='${cat}';render()">${label}</button>`;
  }).join('');

  return `<div class="page-hd">
    <div><h1>Εταιρείες</h1><div class="page-hd-sub">${(state.db.crmCompanies||[]).length} εταιρείες συνολικά</div></div>
    <div class="page-hd-actions">
      ${canEdit?`<button class="btn btn-primary" data-action="crm-co-add">+ Νέα Εταιρεία</button>`:''}
    </div>
  </div>
  <div class="crm-toolbar">
    <input class="form-control crm-search" placeholder="🔍 Αναζήτηση εταιρείας…" value="${esc(state.crmSearch||'')}" oninput="state.crmSearch=this.value;render()" style="max-width:320px">
    <div class="crm-filters">${filterBtns}</div>
  </div>
  ${companies.length?`<div class="crm-table-wrap"><table class="crm-table">
    <thead><tr>
      <th class="crm-th">Επωνυμία</th><th class="crm-th">Κατηγορία</th><th class="crm-th">ΑΦΜ</th>
      <th class="crm-th">Τηλέφωνο</th><th class="crm-th">Email</th><th class="crm-th">Πόλη</th><th class="crm-th"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`:`<div class="empty-state"><div class="es-icon">🏢</div><h3>Δεν βρέθηκαν εταιρείες</h3>${canEdit?`<button class="btn btn-primary" data-action="crm-co-add">+ Νέα Εταιρεία</button>`:''}</div>`}`;
}

// ── CRM — COMPANY DETAIL ──────────────────────────────────────
function renderCrmCompany() {
  const co = (state.db.crmCompanies||[]).find(x=>x.id===state.crmCompanyId);
  if (!co) return `<div class="empty-state"><h3>Εταιρεία δεν βρέθηκε</h3></div>`;
  const canEdit = state.cu && ['admin','management'].includes(state.cu.role);
  const phones = _crmPhonesList(co);
  const emails = _crmEmailsList(co);
  const addrs  = _crmAddrsList(co);
  const extras = _crmExtrasCo(co);
  const catColor = CRM_CAT_COLORS[co.category]||'#64748b';
  const contacts = (state.db.crmContacts||[]).filter(ct=>ct.company_id===co.id);

  const infoRows = [
    co.afm?       `<div class="crm-info-row"><span class="crm-info-lbl">ΑΦΜ</span><span class="crm-mono">${esc(co.afm)}</span></div>`:'',
    co.doy?       `<div class="crm-info-row"><span class="crm-info-lbl">ΔΟΥ</span><span>${esc(co.doy)}</span></div>`:'',
    co.gemi?      `<div class="crm-info-row"><span class="crm-info-lbl">ΓΕΜΗ</span><span class="crm-mono">${esc(co.gemi)}</span></div>`:'',
    co.legal_form?`<div class="crm-info-row"><span class="crm-info-lbl">Νομ. Μορφή</span><span>${esc(co.legal_form)}</span></div>`:'',
    co.activity?  `<div class="crm-info-row"><span class="crm-info-lbl">Δραστηριότητα</span><span>${esc(co.activity)}</span></div>`:'',
    co.website?   `<div class="crm-info-row"><span class="crm-info-lbl">Ιστοσελίδα</span><a href="${esc(co.website.startsWith('http')?co.website:'https://'+co.website)}" target="_blank" style="color:var(--blue)">${esc(co.website)}</a></div>`:'',
  ].filter(Boolean).join('');

  const phonesHtml = phones.length?phones.map(p=>`<a href="tel:${esc(p)}" class="crm-contact-link">📞 ${esc(p)}</a>`).join(''):'—';
  const emailsHtml = emails.length?emails.map(e=>`<a href="mailto:${esc(e)}" class="crm-contact-link">✉ ${esc(e)}</a>`).join(''):'—';
  const addrsHtml  = addrs.length?addrs.map(a=>`<div>${[a.street,a.city,a.postal_code].filter(Boolean).join(', ')}</div>`).join(''):'—';

  const extrasHtml = extras.length?extras.map(ex=>`
    <div class="crm-cred-box">
      <div class="crm-cred-cat">${esc(ex.cat)}</div>
      ${ex.u?`<div class="crm-cred-row"><span class="crm-cred-lbl">Username</span><span class="crm-mono crm-cred-val">${esc(ex.u)}</span></div>`:''}
      ${ex.p?`<div class="crm-cred-row"><span class="crm-cred-lbl">Password</span><span class="crm-mono crm-cred-val crm-pass" onclick="this.classList.toggle('revealed')">••••••••<span class="crm-pass-text">${esc(ex.p)}</span></span></div>`:''}
    </div>`).join(''):'<span class="text-muted" style="font-size:.82rem">Δεν υπάρχουν κωδικοί.</span>';

  const contactsHtml = contacts.length?contacts.map(ct=>`
    <div class="crm-ct-card" data-action="crm-ct-open" data-ctid="${ct.id}" style="cursor:pointer">
      <div class="crm-ct-name">${esc(crmContactName(ct))}</div>
      ${ct.organization_title?`<div class="crm-sub">${esc(ct.organization_title)}</div>`:''}
      ${_crmPhones(ct).length?`<div class="crm-sub">📞 ${esc(_crmPhones(ct)[0])}</div>`:''}
    </div>`).join(''):'<span class="text-muted" style="font-size:.82rem">Δεν υπάρχουν επαφές.</span>';

  return `<div class="page-hd">
    <div>
      <button class="btn btn-ghost btn-sm" onclick="navigate('crm-companies')" style="margin-bottom:8px">← Εταιρείες</button>
      <h1 style="margin:0">${esc(co.company_name)}</h1>
      ${co.category?`<span class="crm-badge" style="background:${catColor}20;color:${catColor};margin-top:6px;display:inline-block">${esc(co.category)}</span>`:''}
    </div>
    <div class="page-hd-actions">
      ${canEdit?`<button class="btn btn-secondary" data-action="crm-co-edit" data-coid="${co.id}">✏ Επεξεργασία</button>
      <button class="btn btn-danger" data-action="crm-co-delete" data-coid="${co.id}">Διαγραφή</button>`:''}
    </div>
  </div>
  <div class="crm-detail-grid">
    <div class="crm-detail-col">
      <div class="crm-section-hd">Στοιχεία</div>
      <div class="crm-info-block">
        ${infoRows}
      </div>
      <div class="crm-section-hd" style="margin-top:20px">Επικοινωνία</div>
      <div class="crm-info-block">
        <div class="crm-info-row"><span class="crm-info-lbl">Τηλέφωνα</span><div>${phonesHtml}</div></div>
        <div class="crm-info-row"><span class="crm-info-lbl">Email</span><div>${emailsHtml}</div></div>
        <div class="crm-info-row"><span class="crm-info-lbl">Διεύθυνση</span><div>${addrsHtml}</div></div>
      </div>
      ${co.notes?`<div class="crm-section-hd" style="margin-top:20px">Σημειώσεις</div><div class="crm-notes-box">${esc(co.notes)}</div>`:''}
    </div>
    <div class="crm-detail-col">
      <div class="crm-section-hd">Κωδικοί Πρόσβασης</div>
      <div>${extrasHtml}</div>
      <div class="crm-section-hd" style="margin-top:20px">Επαφές (${contacts.length})</div>
      <div>${contactsHtml}</div>
    </div>
  </div>`;
}

// ── CRM — CONTACTS LIST ───────────────────────────────────────
function renderCrmContacts() {
  const canEdit = state.cu && ['admin','management'].includes(state.cu.role);
  const q = (state.crmContactSearch||'').toLowerCase();
  let contacts = (state.db.crmContacts||[]).filter(ct=>{
    if (!q) return true;
    return crmContactName(ct).toLowerCase().includes(q)
        || (ct.organization_name||'').toLowerCase().includes(q)
        || _crmEmails(ct).some(e=>e.toLowerCase().includes(q))
        || _crmPhones(ct).some(p=>p.includes(q))
        || (ct.afm||'').includes(q);
  });

  const rows = contacts.map(ct=>{
    const phones = _crmPhones(ct);
    const emails = _crmEmails(ct);
    const company = (state.db.crmCompanies||[]).find(co=>co.id===ct.company_id);
    return `<tr class="crm-tr" data-action="crm-ct-open" data-ctid="${ct.id}" style="cursor:pointer">
      <td class="crm-td">
        <div class="crm-co-name">${esc(crmContactName(ct))}</div>
        ${ct.organization_title?`<div class="crm-sub">${esc(ct.organization_title)}</div>`:''}
      </td>
      <td class="crm-td">${company?`<span class="crm-co-link">${esc(company.company_name)}</span>`:ct.organization_name?esc(ct.organization_name):'—'}</td>
      <td class="crm-td">${phones.length?esc(phones[0]):'—'}</td>
      <td class="crm-td">${emails.length?`<a href="mailto:${esc(emails[0])}" onclick="event.stopPropagation()" style="color:var(--blue)">${esc(emails[0])}</a>`:'—'}</td>
      <td class="crm-td crm-mono">${ct.afm?esc(ct.afm):'—'}</td>
      <td class="crm-td" style="text-align:right">
        ${canEdit?`<button class="btn btn-ghost btn-sm" data-action="crm-ct-edit" data-ctid="${ct.id}" style="font-size:.72rem">✏</button>
        <button class="btn btn-danger btn-sm" data-action="crm-ct-delete" data-ctid="${ct.id}" style="font-size:.72rem">✕</button>`:''}
      </td>
    </tr>`;
  }).join('');

  const gConnected = googleConnected();
  return `<div class="page-hd">
    <div><h1>Επαφές</h1><div class="page-hd-sub">${(state.db.crmContacts||[]).length} επαφές συνολικά</div></div>
    <div class="page-hd-actions">
      ${gConnected
        ? `<button class="btn btn-ghost btn-sm" onclick="disconnectGoogle()" title="Google Contacts συνδεδεμένο — κάντε κλικ για αποσύνδεση" style="color:#059669;font-size:.78rem">✓ Google Contacts</button>`
        : `<button class="btn btn-ghost btn-sm" onclick="connectGoogle()" style="font-size:.78rem">🔗 Σύνδεση Google Contacts</button>`}
      ${canEdit?`<button class="btn btn-primary" data-action="crm-ct-add">+ Νέα Επαφή</button>`:''}
    </div>
  </div>
  <div class="crm-toolbar">
    <input class="form-control crm-search" placeholder="🔍 Αναζήτηση επαφής…" value="${esc(state.crmContactSearch||'')}" oninput="state.crmContactSearch=this.value;render()" style="max-width:320px">
  </div>
  ${contacts.length?`<div class="crm-table-wrap"><table class="crm-table">
    <thead><tr>
      <th class="crm-th">Όνομα</th><th class="crm-th">Εταιρεία</th><th class="crm-th">Τηλέφωνο</th>
      <th class="crm-th">Email</th><th class="crm-th">ΑΦΜ</th><th class="crm-th"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`:`<div class="empty-state"><div class="es-icon">👤</div><h3>Δεν βρέθηκαν επαφές</h3>${canEdit?`<button class="btn btn-primary" data-action="crm-ct-add">+ Νέα Επαφή</button>`:''}</div>`}`;
}

// ── CRM — CONTACT DETAIL ──────────────────────────────────────
function renderCrmContact() {
  const ct = (state.db.crmContacts||[]).find(x=>x.id===state.crmContactId);
  if (!ct) return `<div class="empty-state"><h3>Επαφή δεν βρέθηκε</h3></div>`;
  const canEdit = state.cu && ['admin','management'].includes(state.cu.role);
  const phones = _crmPhones(ct);
  const emails = _crmEmails(ct);
  const company = (state.db.crmCompanies||[]).find(co=>co.id===ct.company_id);

  const extras = [];
  if(ct.afm)  extras.push({lbl:'ΑΦΜ',val:ct.afm,cred:false});
  if(ct.amka) extras.push({lbl:'ΑΜΚΑ',val:ct.amka,cred:false});
  if(ct.id_number) extras.push({lbl:'Α.Δ.Τ.',val:ct.id_number,cred:false});
  if(ct.taxisnet_username||ct.taxisnet_password) extras.push({lbl:'Taxisnet',u:ct.taxisnet_username||'',p:ct.taxisnet_password||'',cred:true});
  if(ct.hpm_username||ct.hpm_password) extras.push({lbl:'ΗΠΜ',u:ct.hpm_username||'',p:ct.hpm_password||'',cred:true});
  if(ct.hma_username||ct.hma_password) extras.push({lbl:'ΗΜΑ',u:ct.hma_username||'',p:ct.hma_password||'',cred:true});
  if(ct.custom_field_1_label&&ct.custom_field_1_value) extras.push({lbl:ct.custom_field_1_label,val:ct.custom_field_1_value,cred:false});
  if(ct.custom_field_2_label&&ct.custom_field_2_value) extras.push({lbl:ct.custom_field_2_label,val:ct.custom_field_2_value,cred:false});

  const extrasHtml = extras.length?extras.map(ex=>ex.cred?`
    <div class="crm-cred-box">
      <div class="crm-cred-cat">${esc(ex.lbl)}</div>
      ${ex.u?`<div class="crm-cred-row"><span class="crm-cred-lbl">Username</span><span class="crm-mono crm-cred-val">${esc(ex.u)}</span></div>`:''}
      ${ex.p?`<div class="crm-cred-row"><span class="crm-cred-lbl">Password</span><span class="crm-mono crm-cred-val crm-pass" onclick="this.classList.toggle('revealed')">••••••••<span class="crm-pass-text">${esc(ex.p)}</span></span></div>`:''}
    </div>`:
    `<div class="crm-info-row"><span class="crm-info-lbl">${esc(ex.lbl)}</span><span class="crm-mono">${esc(ex.val)}</span></div>`
  ).join(''):'<span class="text-muted" style="font-size:.82rem">—</span>';

  const addrHtml = (ct.address_1_street||ct.address_1_city)?
    `<div class="crm-info-row"><span class="crm-info-lbl">Διεύθυνση</span><div>${[ct.address_1_street,ct.address_1_city,ct.address_1_postal_code,ct.address_1_country].filter(Boolean).join(', ')}</div></div>`:'';

  return `<div class="page-hd">
    <div>
      <button class="btn btn-ghost btn-sm" onclick="navigate('crm-contacts')" style="margin-bottom:8px">← Επαφές</button>
      <h1 style="margin:0">${esc(crmContactName(ct))}</h1>
      ${company?`<span class="crm-sub" style="display:block;margin-top:4px">🏢 <span data-action="crm-co-open" data-coid="${company.id}" style="cursor:pointer;color:var(--blue)">${esc(company.company_name)}</span></span>`:
        ct.organization_name?`<span class="crm-sub" style="display:block;margin-top:4px">🏢 ${esc(ct.organization_name)}</span>`:''}
    </div>
    <div class="page-hd-actions">
      ${canEdit?`<button class="btn btn-secondary" data-action="crm-ct-edit" data-ctid="${ct.id}">✏ Επεξεργασία</button>
      <button class="btn btn-danger" data-action="crm-ct-delete" data-ctid="${ct.id}">Διαγραφή</button>`:''}
    </div>
  </div>
  <div class="crm-detail-grid">
    <div class="crm-detail-col">
      <div class="crm-section-hd">Επικοινωνία</div>
      <div class="crm-info-block">
        ${phones.length?`<div class="crm-info-row"><span class="crm-info-lbl">Τηλέφωνα</span><div>${phones.map(p=>`<a href="tel:${esc(p)}" class="crm-contact-link">📞 ${esc(p)}</a>`).join('')}</div></div>`:''}
        ${emails.length?`<div class="crm-info-row"><span class="crm-info-lbl">Email</span><div>${emails.map(e=>`<a href="mailto:${esc(e)}" class="crm-contact-link">✉ ${esc(e)}</a>`).join('')}</div></div>`:''}
        ${addrHtml}
        ${ct.birthday?`<div class="crm-info-row"><span class="crm-info-lbl">Γενέθλια</span><span>${fmt(ct.birthday)}</span></div>`:''}
      </div>
      ${ct.notes?`<div class="crm-section-hd" style="margin-top:20px">Σημειώσεις</div><div class="crm-notes-box">${esc(ct.notes)}</div>`:''}
    </div>
    <div class="crm-detail-col">
      <div class="crm-section-hd">Στοιχεία &amp; Κωδικοί</div>
      ${extrasHtml}
    </div>
  </div>`;
}

// ── OFFERS ────────────────────────────────────────────────────────

const OFFER_STATUSES = {
  draft:    { label:'Προσχέδιο',  color:'#64748b' },
  sent:     { label:'Εστάλη',     color:'#1d4ed8' },
  accepted: { label:'Εγκρίθηκε', color:'#059669' },
  rejected: { label:'Απορρίφθηκε',color:'#dc2626' },
  expired:  { label:'Έληξε',      color:'#b45309' },
};

// ═══════════════════════════════════════════════════════════════
// ASSIGNED TO
// ═══════════════════════════════════════════════════════════════
const PRIORITY_CFG = {
  high:   { label:'Υψηλή',  color:'#dc2626', bg:'#fee2e2', icon:'🔴' },
  medium: { label:'Μέτρια', color:'#b45309', bg:'#fef3c7', icon:'🟡' },
  low:    { label:'Χαμηλή', color:'#166534', bg:'#dcfce7', icon:'🟢' },
};

function renderAssigned() {
  const cu = state.cu; if (!cu) return '';
  const isAdminOrMgmt = ['admin','management'].includes(cu.role);
  if (!state.assignedUserId) state.assignedUserId = cu.id;
  const viewUserId = isAdminOrMgmt ? (state.assignedUserId || cu.id) : cu.id;
  const viewUser   = getUser(viewUserId);
  const allProjs = isAdminOrMgmt ? (state.db.projects||[]) : visibleProjects();
  const activeProjects=assignedProjectOrder(
    allProjs.filter(p=>p.status!=='completed'&&!p.standing),viewUser
  );
  const rows=activeProjects.flatMap(proj=>assignedRowsForProject(proj,viewUserId));
  rows.forEach((r,i) => { r.displayRank = i+1; });
  const projectCount=new Set(rows.map(r=>r.proj.id)).size;
  const waitingCount=rows.filter(r=>r.waiting).length;

  const userFilter = isAdminOrMgmt ? `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <label style="font-size:.82rem;font-weight:600;color:var(--navy)">Εργαζόμενος:</label>
      <select class="form-control" style="max-width:200px;font-size:.82rem" onchange="state.assignedUserId=this.value;render()">
        ${sortByName(state.db.users.filter(u=>u.role!=='client')).map(u=>`<option value="${u.id}" ${u.id===viewUserId?'selected':''}>${esc(u.name)}</option>`).join('')}
      </select>
    </div>` : `<div style="font-size:.82rem;color:var(--muted)">Εμφανίζονται οι δικές σου αναθέσεις</div>`;

  const statusLabel = {
    not_started:'Εκκρεμεί', in_progress:'Σε εξέλιξη', internal_processing:'Εσωτερική επεξεργασία',
    waiting_client:'Αναμονή πελάτη', waiting_public:'Αναμονή φορέα', under_review:'Σε έλεγχο',
    blocked:'Αποκλεισμένη', not_required:'Δεν απαιτείται'
  };

  const tableRows = rows.map(r => {
    const stt = r.task.status||'not_started';
    const urgentControl=canSetTaskUrgent(r.proj,r.task)
      ? `<button class="btn btn-sm ${r.task.urgent?'btn-danger':'btn-ghost'}" onclick="setTaskUrgent('${r.proj.id}','${r.ph.id}','${r.task.id}',${r.task.urgent?'false':'true'})" title="Η ένδειξη δεν αλλάζει τη σειρά">${r.task.urgent?'⚡ Επείγον':'⚡ Ορισμός επείγοντος'}</button>`
      : (r.task.urgent?'<span class="badge badge-red" style="font-size:.58rem">⚡ ΕΠΕΙΓΟΝ</span>':'');
    return `<tr class="asgn-row${r.waiting?' asgn-row-waiting':''}">
      <td class="asgn-td" style="width:40px;text-align:center"><span class="asgn-rank-num">${r.displayRank}</span></td>
      <td class="asgn-td asgn-meta" style="font-weight:600"><span class="asgn-task-name" onclick="navigate('project',{projectId:'${r.proj.id}'})" title="Άνοιγμα έργου">${esc(r.proj.name)}</span></td>
      <td class="asgn-td asgn-meta">${esc(r.ph.name)}</td>
      <td class="asgn-td"><span class="asgn-task-name" onclick="navigate('project',{projectId:'${r.proj.id}'})" title="Άνοιγμα έργου">${esc(r.task.name)}</span><div style="margin-top:5px">${urgentControl}</div></td>
      <td class="asgn-td"><span class="asgn-status asgn-status-${stt}">${esc(r.waiting?.label||statusLabel[stt]||stt)}</span>${r.waiting?'<div class="text-sm text-muted" style="margin-top:4px">Εμφανίζεται μαζί με την επόμενη εκτελέσιμη εργασία.</div>':''}</td>
      <td class="asgn-td asgn-meta">${r.task.plannedStart ? fmt(r.task.plannedStart) : '—'}</td>
      <td class="asgn-td asgn-meta">${r.task.plannedEnd ? fmt(r.task.plannedEnd) : '—'}</td>
    </tr>`;
  }).join('');

  const emptyState = rows.length===0
    ? `<div class="empty-state"><div class="es-icon">✅</div><h3>Δεν υπάρχουν ανοιχτές αναθέσεις</h3><p class="es-sub">Δεν υπάρχει αυτή τη στιγμή εργασία της οποίας έχει έρθει η σειρά για τον επιλεγμένο εργαζόμενο.</p></div>`
    : '';

  return `
  <div class="asgn-page">
    <div class="asgn-header">
      <div>
        <h2 class="asgn-title">👤 Assigned To${viewUser ? ' — '+esc(viewUser.name) : ''}</h2>
        <p class="asgn-subtitle">${projectCount} ενεργά έργα · ${rows.length-waitingCount} εκτελέσιμες εργασίες${waitingCount?' · '+waitingCount+' σε αναμονή':''}</p>
      </div>
      ${userFilter}
    </div>
    ${rows.length>0 ? `
    <div class="asgn-table-wrap">
      <table class="asgn-table">
        <thead>
          <tr>
            <th class="asgn-th" style="width:40px">#</th>
            <th class="asgn-th" style="width:360px">Έργο</th>
            <th class="asgn-th" style="width:360px">Φάση</th>
            <th class="asgn-th">Εργασία</th>
            <th class="asgn-th">Κατάσταση</th>
            <th class="asgn-th">Έναρξη</th>
            <th class="asgn-th">Λήξη</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>` : emptyState}
  </div>`;
}

window.toggleAssignedGroup = function(projId) {
  if (!state.assignedCollapsed) state.assignedCollapsed = {};
  state.assignedCollapsed[projId] = !state.assignedCollapsed[projId];
  render();
};

window.setTaskPriority = async function(pid, phid, tid, priority) {
  const proj = getProject(pid); if (!proj) return;
  const ph = proj.phases.find(p=>p.id===phid); if (!ph) return;
  const task = ph.tasks.find(t=>t.id===tid); if (!task) return;
  task.priority = priority || null;
  auditLog('Προτεραιότητα εργασίας', `"${task.name}" → ${priority||'—'}`);
  await dbSaveProject(proj);
  render();
};

window.setTaskUrgent = async function(pid,phid,tid,urgent) {
  const proj=getProject(pid); const ph=proj?.phases.find(p=>p.id===phid);
  const task=ph?.tasks.find(t=>t.id===tid); if(!task) return;
  if(!canSetTaskUrgent(proj,task)) {
    showToast('Μόνο ο Υπεύθυνος Έργου ή ο Υπεύθυνος Εργασίας μπορεί να αλλάξει την ένδειξη.','error');
    return;
  }
  try {
    if(isSupabaseAuthMode()) {
      await secureProjectRpc('app_task_set_urgent',{
        p_project_id:pid,p_phase_id:phid,p_task_id:tid,p_urgent:!!urgent
      },pid);
    } else {
      task.urgent=!!urgent;
      await dbSaveProject(proj);
      await emitProjectNotification('urgent_changed',proj,ph,task,null,String(!!urgent));
    }
    auditLog('Ένδειξη επείγοντος',`"${task.name}" → ${urgent?'Επείγον':'Κανονικό'}`);
    render();
    showToast(urgent?'Η εργασία χαρακτηρίστηκε επείγουσα.':'Η ένδειξη επείγοντος αφαιρέθηκε.','success');
  } catch(error) {
    showToast('Η ένδειξη δεν ενημερώθηκε: '+(error.message||error),'error');
  }
};

window.shiftTaskRank = async function(pid, phid, tid, dir) {
  // Collect current ordered rows (same logic as renderAssigned) to find neighbors
  const cu = state.cu; if (!cu) return;
  const isAdminOrMgmt = ['admin','management'].includes(cu.role);
  const viewUserId = isAdminOrMgmt ? (state.assignedUserId || cu.id) : cu.id;
  const allProjs = isAdminOrMgmt ? (state.db.projects||[]) : visibleProjects();

  const rows = [];
  allProjs.filter(p=>p.status!=='completed'&&!p.standing).forEach(proj=>{
    const ph=(proj.phases||[]).find(x=>!isPhaseComplete(x));
    if(!ph) return;
    (ph.tasks||[]).forEach(task=>{
      const isAssignee = task.assigneeId === viewUserId;
      const isMember   = (task.memberIds||[]).includes(viewUserId);
      if (!isAssignee && !isMember) return;
      if (['completed','cancelled','not_required'].includes(task.status)) return;
      if ((proj.enforceDeps||task.enforceDeps) && !isTaskUnlocked(ph,task)) return;
      rows.push({ proj, ph, task });
    });
  });

  const prioOrder = { high:0, medium:1, low:2 };
  rows.sort((a,b)=>{
    const pa = prioOrder[a.task.priority] ?? 99;
    const pb = prioOrder[b.task.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    const ra = a.task.assigneeRank ?? 9999;
    const rb = b.task.assigneeRank ?? 9999;
    if (ra !== rb) return ra - rb;
    return (a.task.name||'').localeCompare(b.task.name||'', 'el');
  });

  const idx = rows.findIndex(r => r.task.id === tid);
  if (idx < 0) return;
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= rows.length) return;

  // Assign clean sequential ranks to all tasks, then swap the two
  rows.forEach((r, i) => { r.task.assigneeRank = i + 1; });
  rows[idx].task.assigneeRank      = swapIdx + 1;
  rows[swapIdx].task.assigneeRank  = idx + 1;

  // Save affected projects (deduplicated)
  const projsToSave = [...new Set([rows[idx].proj, rows[swapIdx].proj])];
  for (const p of projsToSave) await dbSaveProject(p);
  render();
};

window.setTaskRankManual = async function(pid, phid, tid, total) {
  const input = prompt(`Νέα σειρά προτεραιότητας (1 – ${total}):`, '');
  if (input === null) return; // cancelled
  const newRank = parseInt(input, 10);
  if (isNaN(newRank) || newRank < 1 || newRank > total) {
    alert(`Παρακαλώ εισάγετε αριθμό μεταξύ 1 και ${total}.`);
    return;
  }

  // Rebuild the same ordered rows as shiftTaskRank
  const cu = state.cu; if (!cu) return;
  const isAdminOrMgmt = ['admin','management'].includes(cu.role);
  const viewUserId = isAdminOrMgmt ? (state.assignedUserId || cu.id) : cu.id;
  const allProjs = isAdminOrMgmt ? (state.db.projects||[]) : visibleProjects();

  const rows = [];
  allProjs.filter(p=>p.status!=='completed'&&!p.standing).forEach(proj=>{
    const ph=(proj.phases||[]).find(x=>!isPhaseComplete(x));
    if(!ph) return;
    (ph.tasks||[]).forEach(task=>{
      const isAssignee = task.assigneeId === viewUserId;
      const isMember   = (task.memberIds||[]).includes(viewUserId);
      if (!isAssignee && !isMember) return;
      if (['completed','cancelled','not_required'].includes(task.status)) return;
      if ((proj.enforceDeps||task.enforceDeps) && !isTaskUnlocked(ph,task)) return;
      rows.push({ proj, ph, task });
    });
  });

  const prioOrder = { high:0, medium:1, low:2 };
  rows.sort((a,b)=>{
    const pa = prioOrder[a.task.priority] ?? 99;
    const pb = prioOrder[b.task.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    const ra = a.task.assigneeRank ?? 9999;
    const rb = b.task.assigneeRank ?? 9999;
    if (ra !== rb) return ra - rb;
    return (a.task.name||'').localeCompare(b.task.name||'', 'el');
  });

  const fromIdx = rows.findIndex(r => r.task.id === tid);
  if (fromIdx < 0) return;
  const toIdx = newRank - 1; // 0-based
  if (fromIdx === toIdx) return;

  // First assign clean sequential ranks to all
  rows.forEach((r, i) => { r.task.assigneeRank = i + 1; });

  // Insert: remove from current position, splice into target position
  const [moved] = rows.splice(fromIdx, 1);
  rows.splice(toIdx, 0, moved);

  // Re-assign sequential ranks after re-ordering
  rows.forEach((r, i) => { r.task.assigneeRank = i + 1; });

  // Save all affected projects
  const affectedProjs = [...new Set(rows.map(r=>r.proj))];
  for (const p of affectedProjs) await dbSaveProject(p);
  render();
};

function renderOffers() {
  const canEdit = state.cu && ['admin','management'].includes(state.cu.role);
  const q = (state.offersSearch||'').toLowerCase();
  const stFilter = state.offersStatus||'';
  let offers = (state.db.offers||[]).filter(o=>{
    if (stFilter && o.status !== stFilter) return false;
    if (!q) return true;
    return (o.code||'').toLowerCase().includes(q)
        || (o.title||'').toLowerCase().includes(q)
        || (o.clientName||'').toLowerCase().includes(q)
        || (o.notes||'').toLowerCase().includes(q);
  });

  const users = state.db.users||[];
  const getUserName = id => { const u=users.find(x=>x.id===id); return u?u.name:'—'; };

  const statusBtns = ['',...Object.keys(OFFER_STATUSES)].map(s=>{
    const active=stFilter===s;
    const label=s?OFFER_STATUSES[s].label:'Όλα';
    const color=s?OFFER_STATUSES[s].color:'#1e293b';
    return `<button class="crm-filter-btn${active?' active':''}" style="${active?`background:${color}20;color:${color};border-color:${color}`:''}" onclick="state.offersStatus='${s}';render()">${label}</button>`;
  }).join('');

  const rows = offers.map(o=>{
    const st=OFFER_STATUSES[o.status]||OFFER_STATUSES.draft;
    const amountStr=o.amount?new Intl.NumberFormat('el-GR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(o.amount):'—';
    const fileHref = o.fileUrl||'';
    const fileName = fileHref ? fileHref.replace(/\\/g,'/').split('/').pop() : '';
    const fileLink = fileHref
      ? `<a href="${esc(fileHref)}" target="_blank" style="font-size:.72rem;color:var(--blue);display:block;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px" title="${esc(fileHref)}">📎 ${esc(decodeURIComponent(fileName))}</a>`
      : '';
    const fileBtn = canEdit
      ? `<button class="btn btn-ghost btn-sm" data-action="offer-file" data-oid="${o.id}" title="Σύνδεση αρχείου" style="font-size:.78rem;padding:3px 7px">${fileHref?'📎':'📁'}</button>`
      : '';
    return `<tr class="crm-tr">
      <td class="crm-td">
        <div class="crm-co-name">${esc(o.code||'')} ${esc(o.title||'')}</div>
        ${o.clientName?`<div class="crm-sub">${esc(o.clientName)}</div>`:''}
        ${o.notes?`<div class="crm-sub" style="color:var(--muted);font-style:italic;margin-top:2px">${esc(o.notes)}</div>`:''}
        ${fileLink}
      </td>
      <td class="crm-td">${fmt(o.date)}</td>
      <td class="crm-td">${getUserName(o.managerId)}</td>
      <td class="crm-td"><span class="crm-badge" style="background:${st.color}20;color:${st.color}">${st.label}</span></td>
      <td class="crm-td" style="font-weight:600;color:var(--navy)">${amountStr}</td>
      <td class="crm-td" style="text-align:right;white-space:nowrap">
        ${fileBtn}
        ${canEdit?`<button class="btn btn-ghost btn-sm" data-action="offer-edit" data-oid="${o.id}" style="font-size:.72rem">✏</button>
        <button class="btn btn-danger btn-sm" data-action="offer-delete" data-oid="${o.id}" style="font-size:.72rem">✕</button>`:''}
      </td>
    </tr>`;
  }).join('');

  return `<div class="page-hd">
    <div><h1>Offers</h1><div class="page-hd-sub">${offers.length} από ${(state.db.offers||[]).length} offers</div></div>
    <div class="page-hd-actions">
      ${canEdit?`<button class="btn btn-primary" data-action="offer-add">+ Νέο Offer</button>`:''}
    </div>
  </div>
  <div class="crm-toolbar">
    <input class="form-control crm-search" placeholder="🔍 Αναζήτηση…" value="${esc(state.offersSearch||'')}" oninput="state.offersSearch=this.value;render()" style="max-width:300px">
    <div class="crm-filters">${statusBtns}</div>
  </div>
  ${offers.length ? `<div class="crm-table-wrap"><table class="crm-table">
    <thead><tr>
      <th class="crm-th">Offer</th>
      <th class="crm-th">Ημερομηνία</th>
      <th class="crm-th">Υπεύθυνος</th>
      <th class="crm-th">Κατάσταση</th>
      <th class="crm-th">Ποσό</th>
      <th class="crm-th"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`
  : `<div class="empty-state"><div class="es-icon">📋</div><h3>Δεν βρέθηκαν offers</h3>${canEdit?`<button class="btn btn-primary" data-action="offer-add">+ Νέο Offer</button>`:''}</div>`}`;
}

function showModalOffer(id) {
  const o = id ? (state.db.offers||[]).find(x=>x.id===id) : null;
  const users = sortByName((state.db.users||[]).filter(u=>u.role!=='client'));
  const userOpts = users.map(u=>`<option value="${u.id}" ${(o?.managerId||state.cu?.id)===u.id?'selected':''}>${esc(u.name)}</option>`).join('');
  const statusOpts = Object.entries(OFFER_STATUSES).map(([k,v])=>`<option value="${k}" ${(o?.status||'draft')===k?'selected':''}>${v.label}</option>`).join('');

  showModal(`
    <div class="modal-header">
      <div class="modal-title">${o?'Επεξεργασία Offer':'Νέο Offer'}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Κωδικός Offer</label>
          <input class="form-control" id="of-code" placeholder="π.χ. OF26001" value="${esc(o?.code||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Ημερομηνία</label>
          <input class="form-control" type="date" id="of-date" value="${o?.date||today()}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Τίτλος / Περιγραφή</label>
        <input class="form-control" id="of-title" placeholder="π.χ. ACCORD - ΝΕΑ ΟΙΚΟΔΟΜΙΚΗ ΑΔΕΙΑ" value="${esc(o?.title||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">Πελάτης</label>
        <input class="form-control" id="of-client" placeholder="Επωνυμία πελάτη" value="${esc(o?.clientName||'')}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Υπεύθυνος</label>
          <select class="form-control" id="of-manager">${userOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Κατάσταση</label>
          <select class="form-control" id="of-status">${statusOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Ποσό (€)</label>
          <input class="form-control" type="number" id="of-amount" min="0" step="0.01" placeholder="0.00" value="${o?.amount||''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Σημειώσεις</label>
        <textarea class="form-control" id="of-notes" rows="3" placeholder="Προαιρετικές σημειώσεις…">${esc(o?.notes||'')}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>
      <button class="btn btn-primary" onclick='modalSaveOffer(${JSON.stringify(id||null)})'>Αποθήκευση</button>
    </div>`);
}

window.modalSaveOffer = async function(id) {
  const code    = el('of-code')?.value.trim();
  const title   = el('of-title')?.value.trim();
  const client  = el('of-client')?.value.trim();
  const manager = el('of-manager')?.value;
  const status  = el('of-status')?.value;
  const amount  = parseFloat(el('of-amount')?.value)||0;
  const date    = el('of-date')?.value;
  const notes   = el('of-notes')?.value.trim();

  if (!title && !code) { alert('Συμπληρώστε τουλάχιστον κωδικό ή τίτλο.'); return; }

  const existing = id ? (state.db.offers||[]).find(x=>x.id===id) : null;
  const offer = { ...(existing||{}), id:id||uid(), code, title, clientName:client, managerId:manager, status, amount:amount||null, date, notes };
  await dbSaveOffer(offer);
  auditLog(id?'Επεξεργασία Offer':'Νέο Offer', `${code} – ${title}`);
  closeModal();
  render();
  showToast(id?'Offer ενημερώθηκε.':'Offer δημιουργήθηκε.','success');
};

function showModalOfferFile(oid) {
  const o = (state.db.offers||[]).find(x=>x.id===oid); if(!o) return;
  showModal(`
    <div class="modal-header">
      <div class="modal-title">Αρχείο – ${esc(o.code||o.title||'Offer')}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom:12px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:.78rem;color:#92400e;line-height:1.5">
        <strong>Πώς να βρείτε τη διαδρομή:</strong><br>
        Στον Explorer, <strong>Shift + δεξί κλικ</strong> πάνω στο αρχείο → <strong>"Αντιγραφή ως διαδρομή"</strong> → επικολλήστε παρακάτω.
      </div>
      <div class="form-group">
        <label class="form-label">Διαδρομή αρχείου</label>
        <input class="form-control" id="ofile-path" style="font-size:.82rem"
          placeholder="T:\\B&E SOLUTIONS Dropbox\\υποφάκελος\\αρχείο.pdf"
          value="${esc(o.fileUrl?o.fileUrl.replace('file:///', '').replace(/\//g,'\\'):'')}">
      </div>
      ${o.fileUrl?`<div style="margin-top:8px;font-size:.75rem;color:var(--blue)">
        Τρέχον αρχείο: <a href="${esc(o.fileUrl)}" target="_blank">${esc(decodeURIComponent(o.fileUrl.split('/').pop()))}</a>
        <button class="btn btn-ghost btn-sm" style="font-size:.7rem;margin-left:8px" onclick="offerFileClear('${oid}')">✕ Αφαίρεση</button>
      </div>`:''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>
      <button class="btn btn-primary" onclick='offerFileSave(${JSON.stringify(oid)})'>Αποθήκευση</button>
    </div>`);
}

window.offerFileSave = async function(oid) {
  const raw = (document.getElementById('ofile-path')?.value||'').trim().replace(/^"|"$/g,'').trim();
  if (!raw) { alert('Εισάγετε τη διαδρομή αρχείου.'); return; }
  const fileUrl = 'file:///' + raw.replace(/\\/g,'/');
  const o = (state.db.offers||[]).find(x=>x.id===oid); if(!o) return;
  o.fileUrl = fileUrl;
  await dbSaveOffer(o);
  closeModal(); render();
  showToast('Αρχείο συνδέθηκε.','success');
};

window.offerFileClear = async function(oid) {
  const o = (state.db.offers||[]).find(x=>x.id===oid); if(!o) return;
  o.fileUrl = null;
  await dbSaveOffer(o);
  closeModal(); render();
  showToast('Αρχείο αφαιρέθηκε.','');
};

// ── CRM — COMPANY MODAL ───────────────────────────────────────
function showModalCrmCompany(id) {
  const co = id ? (state.db.crmCompanies||[]).find(x=>x.id===id) : null;
  const v = k => esc(co?.[k]||'');
  const phones = co?_crmPhonesList(co):[''];
  const emails = co?_crmEmailsList(co):[''];
  const addrs  = co?_crmAddrsList(co):[{street:'',city:'',postal_code:''}];
  const extras = co?_crmExtrasCo(co):[];

  const phonesHtml = phones.map((p,i)=>`<div class="crm-multi-row" id="co-ph-row-${i}">
    <input class="form-control" id="co-ph-${i}" value="${esc(p)}" placeholder="π.χ. 210 1234567">
    ${phones.length>1?`<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('co-ph-row-${i}').remove()" style="padding:4px 8px">✕</button>`:''}
  </div>`).join('');

  const emailsHtml = emails.map((e,i)=>`<div class="crm-multi-row" id="co-em-row-${i}">
    <input class="form-control" id="co-em-${i}" value="${esc(e)}" placeholder="info@company.gr">
    ${emails.length>1?`<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('co-em-row-${i}').remove()" style="padding:4px 8px">✕</button>`:''}
  </div>`).join('');

  const addrsHtml = addrs.map((a,i)=>`<div class="crm-addr-block" id="co-addr-row-${i}">
    <input class="form-control" id="co-str-${i}" value="${esc(a.street||'')}" placeholder="Οδός" style="margin-bottom:4px">
    <div style="display:grid;grid-template-columns:1fr 100px;gap:6px">
      <input class="form-control" id="co-city-${i}" value="${esc(a.city||'')}" placeholder="Πόλη">
      <input class="form-control" id="co-tk-${i}" value="${esc(a.postal_code||'')}" placeholder="ΤΚ">
    </div>
    ${addrs.length>1?`<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('co-addr-row-${i}').remove()" style="font-size:.7rem;margin-top:4px">Αφαίρεση</button>`:''}
  </div>`).join('');

  const extrasHtml = extras.map((ex,i)=>`<div class="crm-cred-box crm-cred-edit" id="co-ex-row-${i}">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <input class="form-control" id="co-ex-cat-${i}" value="${esc(ex.cat)}" placeholder="Κατηγορία (π.χ. ΕΡΓΑΝΗ)" style="flex:1" list="crm-cred-list">
      <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('co-ex-row-${i}').remove()" style="padding:4px 8px">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <input class="form-control" id="co-ex-u-${i}" value="${esc(ex.u)}" placeholder="Username" autocomplete="off">
      <input class="form-control" id="co-ex-p-${i}" value="${esc(ex.p)}" placeholder="Password" type="password" autocomplete="new-password">
    </div>
  </div>`).join('');

  const catOpts = ['', ...CRM_CATEGORIES].map(c=>`<option value="${c}"${(co?.category||'')===(c)?'selected':''}>${c||'Επιλογή…'}</option>`).join('');
  const lfOpts  = ['', ...CRM_LEGAL_FORMS].map(c=>`<option value="${c}"${(co?.legal_form||'')===(c)?'selected':''}>${c||'Επιλογή…'}</option>`).join('');

  showModal(`<div class="modal-header"><div class="modal-title">${co?'Επεξεργασία':'Νέα'} Εταιρεία</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <datalist id="crm-cred-list">${CRM_CRED_CATS.map(c=>`<option value="${c}">`).join('')}</datalist>
    <div class="form-group"><label class="form-label">Επωνυμία *</label><input class="form-control" id="co-name" value="${v('company_name')}" placeholder="π.χ. Παπαδόπουλος ΑΕ"></div>
    <div class="form-group"><label class="form-label">Δραστηριότητα</label><input class="form-control" id="co-activity" value="${v('activity')}" placeholder="π.χ. Κατασκευές"></div>
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">ΑΦΜ</label><input class="form-control crm-mono" id="co-afm" value="${v('afm')}"></div>
      <div class="form-group"><label class="form-label">ΔΟΥ</label><input class="form-control" id="co-doy" value="${v('doy')}"></div>
    </div>
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">ΓΕΜΗ</label><input class="form-control crm-mono" id="co-gemi" value="${v('gemi')}"></div>
      <div class="form-group"><label class="form-label">Νομ. Μορφή</label><select class="form-control" id="co-lf">${lfOpts}</select></div>
    </div>
    <div class="form-group"><label class="form-label">Κατηγορία</label><select class="form-control" id="co-cat">${catOpts}</select></div>
    <hr style="border:none;border-top:1px solid var(--slate-200);margin:14px 0">
    <div class="form-group"><label class="form-label">Τηλέφωνα</label>
      <div id="co-phones-wrap">${phonesHtml}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:.72rem" onclick="
        const w=document.getElementById('co-phones-wrap');const i=w.children.length;
        w.insertAdjacentHTML('beforeend','<div class=\\'crm-multi-row\\' id=\\'co-ph-row-'+i+'\\'>'+
        '<input class=\\'form-control\\' id=\\'co-ph-'+i+'\\' placeholder=\\'τηλέφωνο\\'>'+
        '<button type=\\'button\\' class=\\'btn btn-ghost btn-sm\\' onclick=\\'this.parentElement.remove()\\' style=\\'padding:4px 8px\\'>✕</button></div>')">+ Τηλέφωνο</button>
    </div>
    <div class="form-group"><label class="form-label">Email</label>
      <div id="co-emails-wrap">${emailsHtml}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:.72rem" onclick="
        const w=document.getElementById('co-emails-wrap');const i=w.children.length;
        w.insertAdjacentHTML('beforeend','<div class=\\'crm-multi-row\\' id=\\'co-em-row-'+i+'\\'>'+
        '<input class=\\'form-control\\' id=\\'co-em-'+i+'\\' placeholder=\\'email\\'>'+
        '<button type=\\'button\\' class=\\'btn btn-ghost btn-sm\\' onclick=\\'this.parentElement.remove()\\' style=\\'padding:4px 8px\\'>✕</button></div>')">+ Email</button>
    </div>
    <div class="form-group"><label class="form-label">Ιστοσελίδα</label><input class="form-control" id="co-web" value="${v('website')}" placeholder="www.company.gr"></div>
    <div class="form-group"><label class="form-label">Διευθύνσεις</label>
      <div id="co-addrs-wrap">${addrsHtml}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:.72rem" onclick="
        const w=document.getElementById('co-addrs-wrap');const i=w.children.length;
        w.insertAdjacentHTML('beforeend','<div class=\\'crm-addr-block\\' id=\\'co-addr-row-'+i+'\\'>'+
        '<input class=\\'form-control\\' id=\\'co-str-'+i+'\\' placeholder=\\'Οδός\\' style=\\'margin-bottom:4px\\'>'+
        '<div style=\\'display:grid;grid-template-columns:1fr 100px;gap:6px\\'>'+
        '<input class=\\'form-control\\' id=\\'co-city-'+i+'\\' placeholder=\\'Πόλη\\'>'+
        '<input class=\\'form-control\\' id=\\'co-tk-'+i+'\\' placeholder=\\'ΤΚ\\'></div>'+
        '<button type=\\'button\\' class=\\'btn btn-ghost btn-sm\\' onclick=\\'this.parentElement.remove()\\' style=\\'font-size:.7rem;margin-top:4px\\'>Αφαίρεση</button></div>')">+ Διεύθυνση</button>
    </div>
    <hr style="border:none;border-top:1px solid var(--slate-200);margin:14px 0">
    <div class="form-group"><label class="form-label">🔐 Κωδικοί Πρόσβασης</label>
      <div id="co-extras-wrap">${extrasHtml}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:.72rem" onclick="
        const w=document.getElementById('co-extras-wrap');const i=w.children.length;
        w.insertAdjacentHTML('beforeend','<div class=\\'crm-cred-box crm-cred-edit\\' id=\\'co-ex-row-'+i+'\\'>'+
        '<div style=\\'display:flex;align-items:center;gap:6px;margin-bottom:6px\\'>'+
        '<input class=\\'form-control\\' id=\\'co-ex-cat-'+i+'\\' placeholder=\\'Κατηγορία\\' style=\\'flex:1\\' list=\\'crm-cred-list\\'>'+
        '<button type=\\'button\\' class=\\'btn btn-ghost btn-sm\\' onclick=\\'this.parentElement.parentElement.remove()\\' style=\\'padding:4px 8px\\'>✕</button></div>'+
        '<div style=\\'display:grid;grid-template-columns:1fr 1fr;gap:6px\\'>'+
        '<input class=\\'form-control\\' id=\\'co-ex-u-'+i+'\\' placeholder=\\'Username\\' autocomplete=\\'off\\'>'+
        '<input class=\\'form-control\\' id=\\'co-ex-p-'+i+'\\' placeholder=\\'Password\\' type=\\'password\\' autocomplete=\\'new-password\\'></div></div>')">+ Κωδικός</button>
    </div>
    <div class="form-group"><label class="form-label">Σημειώσεις</label><textarea class="form-control" id="co-notes" rows="3">${v('notes')}</textarea></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>
    <button class="btn btn-primary" onclick='modalSaveCrmCompany(${JSON.stringify(id||null)})'>Αποθήκευση</button>
  </div>`);
}

window.modalSaveCrmCompany = async function(id) {
  const name = (document.getElementById('co-name')?.value||'').trim();
  if (!name) { alert('Η επωνυμία είναι υποχρεωτική.'); return; }
  if (!isSupabaseAuthMode()) { showToast('Η αποθήκευση στοιχείων CRM απαιτεί σύνδεση μέσω Supabase (κρυπτογράφηση κωδικών).', 'error'); return; }
  // collect phones
  const phones=[]; document.querySelectorAll('input[id^="co-ph-"]').forEach(inp=>{if(inp.value.trim())phones.push(inp.value.trim());});
  const emails=[]; document.querySelectorAll('input[id^="co-em-"]').forEach(inp=>{if(inp.value.trim())emails.push(inp.value.trim());});
  const addrs=[];
  let ai=0; while(document.getElementById('co-str-'+ai)||document.getElementById('co-city-'+ai)){
    const s=document.getElementById('co-str-'+ai)?.value.trim()||'';
    const c=document.getElementById('co-city-'+ai)?.value.trim()||'';
    const t=document.getElementById('co-tk-'+ai)?.value.trim()||'';
    if(s||c) addrs.push({street:s,city:c,postal_code:t});
    ai++;
  }
  // collect extras
  const extras=[]; let ei=0;
  while(document.getElementById('co-ex-cat-'+ei)){
    const cat=document.getElementById('co-ex-cat-'+ei)?.value.trim()||'';
    const u=document.getElementById('co-ex-u-'+ei)?.value.trim()||'';
    const p=document.getElementById('co-ex-p-'+ei)?.value.trim()||'';
    if(cat) extras.push({category:cat,username:u,password:p});
    ei++;
  }
  // encrypt extras' passwords server-side before they ever leave the DB round-trip in cleartext
  let encExtras = extras;
  if (extras.length) {
    try {
      const {data: encData, error: encErr} = await sb.rpc('app_crm_encrypt_extra_creds', {p_items: extras});
      if (encErr) throw encErr;
      encExtras = encData || extras;
    } catch(err) {
      console.error('app_crm_encrypt_extra_creds error:', err);
      showToast('Σφάλμα κρυπτογράφησης στοιχείων: ' + (err?.message||JSON.stringify(err)), 'error');
      return;
    }
  }
  const existing = id ? (state.db.crmCompanies||[]).find(x=>x.id===id) : null;
  const data = Object.assign({}, existing||{}, {
    company_name: name,
    activity: document.getElementById('co-activity')?.value.trim()||null,
    afm:  document.getElementById('co-afm')?.value.trim()||null,
    doy:  document.getElementById('co-doy')?.value.trim()||null,
    gemi: document.getElementById('co-gemi')?.value.trim()||null,
    legal_form: document.getElementById('co-lf')?.value||null,
    category:   document.getElementById('co-cat')?.value||null,
    website:    document.getElementById('co-web')?.value.trim()||null,
    notes:      document.getElementById('co-notes')?.value.trim()||null,
    phone:  phones[0]||null, email: emails[0]||null,
    address: addrs[0]?.street||null, city: addrs[0]?.city||null, postal_code: addrs[0]?.postal_code||null,
    phones_json: phones.length>1?JSON.stringify(phones):null,
    emails_json: emails.length>1?JSON.stringify(emails):null,
    addresses_json: addrs.length>1?JSON.stringify(addrs):null,
    extra_creds_json: encExtras.length?JSON.stringify(encExtras):null,
    created_at: existing?.created_at||new Date().toISOString(),
  });
  // clear legacy credential columns to avoid confusion
  ['taxisnet_username','taxisnet_password','ergani_username','ergani_password',
   'efka_username','efka_password','bank_name','bank_username','bank_password'].forEach(k=>{delete data[k];});
  try {
    await crmSaveCompany(data);
    closeModal();
    render();
    showToast('Εταιρεία αποθηκεύτηκε.','success');
  } catch(err) {
    console.error('crmSaveCompany error:', err);
    showToast('Σφάλμα: ' + (err?.message||JSON.stringify(err)), 'error');
  }
};

// ── CRM — CONTACT MODAL ───────────────────────────────────────
function showModalCrmContact(id) {
  const ct = id ? (state.db.crmContacts||[]).find(x=>x.id===id) : null;
  const v = k => esc(ct?.[k]||'');
  const phones = ct?_crmPhones(ct).map((p,i)=>({label:ct[`phone_${i+1}_label`]||'Mobile',value:p})):[{label:'Mobile',value:''}];
  const emails = ct?_crmEmails(ct).map((e,i)=>({label:ct[`email_${i+1}_label`]?.replace(/^\* /,'')||'Work',value:e})):[{label:'Work',value:''}];

  const coOpts = `<option value="">—</option>` +
    (state.db.crmCompanies||[]).map(co=>`<option value="${co.id}"${ct?.company_id===co.id?' selected':''}>${esc(co.company_name)}</option>`).join('');

  const phonesHtml = phones.map((p,i)=>`<div class="crm-multi-row" id="ct-ph-row-${i}">
    <select class="form-control" id="ct-ph-lbl-${i}" style="width:100px;flex-shrink:0">
      ${['Mobile','Work','Home','Personal','Fax','Άλλο'].map(l=>`<option${p.label===l?' selected':''}>${l}</option>`).join('')}
    </select>
    <input class="form-control" id="ct-ph-${i}" value="${esc(p.value)}" placeholder="τηλέφωνο" style="flex:1">
    ${phones.length>1?`<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('ct-ph-row-${i}').remove()" style="padding:4px 8px">✕</button>`:''}
  </div>`).join('');

  const emailsHtml = emails.map((e,i)=>`<div class="crm-multi-row" id="ct-em-row-${i}">
    <select class="form-control" id="ct-em-lbl-${i}" style="width:90px;flex-shrink:0">
      ${['Work','Home','Other','Προσωπικό'].map(l=>`<option${e.label===l?' selected':''}>${l}</option>`).join('')}
    </select>
    <input class="form-control" id="ct-em-${i}" value="${esc(e.value)}" placeholder="email" style="flex:1">
    ${emails.length>1?`<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('ct-em-row-${i}').remove()" style="padding:4px 8px">✕</button>`:''}
  </div>`).join('');

  showModal(`<div class="modal-header"><div class="modal-title">${ct?'Επεξεργασία':'Νέα'} Επαφή</div><button class="modal-close" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">Όνομα</label><input class="form-control" id="ct-fn" value="${v('first_name')}" placeholder="Γιώργος"></div>
      <div class="form-group"><label class="form-label">Επώνυμο</label><input class="form-control" id="ct-ln" value="${v('last_name')}" placeholder="Παπαδόπουλος"></div>
    </div>
    <div class="form-group"><label class="form-label">Εταιρεία</label><select class="form-control" id="ct-co">${coOpts}</select></div>
    <div class="form-group"><label class="form-label">Τίτλος Θέσης</label><input class="form-control" id="ct-title" value="${v('organization_title')}" placeholder="π.χ. Διευθυντής"></div>
    <hr style="border:none;border-top:1px solid var(--slate-200);margin:14px 0">
    <div class="form-group"><label class="form-label">Τηλέφωνα</label>
      <div id="ct-phones-wrap">${phonesHtml}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:.72rem" onclick="
        const w=document.getElementById('ct-phones-wrap');const i=w.children.length;
        w.insertAdjacentHTML('beforeend','<div class=\\'crm-multi-row\\' id=\\'ct-ph-row-'+i+'\\'>'+
        '<select class=\\'form-control\\' id=\\'ct-ph-lbl-'+i+'\\' style=\\'width:100px;flex-shrink:0\\'><option>Mobile</option><option>Work</option><option>Home</option><option>Άλλο</option></select>'+
        '<input class=\\'form-control\\' id=\\'ct-ph-'+i+'\\' placeholder=\\'τηλέφωνο\\' style=\\'flex:1\\'>'+
        '<button type=\\'button\\' class=\\'btn btn-ghost btn-sm\\' onclick=\\'this.parentElement.remove()\\' style=\\'padding:4px 8px\\'>✕</button></div>')">+ Τηλέφωνο</button>
    </div>
    <div class="form-group"><label class="form-label">Email</label>
      <div id="ct-emails-wrap">${emailsHtml}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="margin-top:4px;font-size:.72rem" onclick="
        const w=document.getElementById('ct-emails-wrap');const i=w.children.length;
        w.insertAdjacentHTML('beforeend','<div class=\\'crm-multi-row\\' id=\\'ct-em-row-'+i+'\\'>'+
        '<select class=\\'form-control\\' id=\\'ct-em-lbl-'+i+'\\' style=\\'width:90px;flex-shrink:0\\'><option>Work</option><option>Home</option><option>Other</option></select>'+
        '<input class=\\'form-control\\' id=\\'ct-em-'+i+'\\' placeholder=\\'email\\' style=\\'flex:1\\'>'+
        '<button type=\\'button\\' class=\\'btn btn-ghost btn-sm\\' onclick=\\'this.parentElement.remove()\\' style=\\'padding:4px 8px\\'>✕</button></div>')">+ Email</button>
    </div>
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">Διεύθυνση</label><input class="form-control" id="ct-str" value="${v('address_1_street')}" placeholder="Οδός"></div>
      <div class="form-group"><label class="form-label">Πόλη</label><input class="form-control" id="ct-city" value="${v('address_1_city')}" placeholder="Αθήνα"></div>
    </div>
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">ΤΚ</label><input class="form-control" id="ct-tk" value="${v('address_1_postal_code')}"></div>
      <div class="form-group"><label class="form-label">Γενέθλια</label><input type="date" class="form-control" id="ct-bday" value="${(ct?.birthday||'').slice(0,10)}"></div>
    </div>
    <hr style="border:none;border-top:1px solid var(--slate-200);margin:14px 0">
    <div class="form-group"><label class="form-label">🔐 Στοιχεία &amp; Κωδικοί</label></div>
    <div class="modal-date-grid">
      <div class="form-group"><label class="form-label">ΑΦΜ</label><input class="form-control crm-mono" id="ct-afm" value="${v('afm')}"></div>
      <div class="form-group"><label class="form-label">ΑΜΚΑ</label><input class="form-control crm-mono" id="ct-amka" value="${v('amka')}"></div>
    </div>
    <div class="form-group"><label class="form-label">Α.Δ.Τ.</label><input class="form-control crm-mono" id="ct-adt" value="${v('id_number')}"></div>
    <div class="crm-cred-box crm-cred-edit">
      <div class="crm-cred-cat">Taxisnet</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <input class="form-control" id="ct-tx-u" value="${v('taxisnet_username')}" placeholder="Username" autocomplete="off">
        <input class="form-control" id="ct-tx-p" value="${v('taxisnet_password')}" placeholder="Password" type="password" autocomplete="new-password">
      </div>
    </div>
    <div class="crm-cred-box crm-cred-edit" style="margin-top:8px">
      <div class="crm-cred-cat">ΗΠΜ</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <input class="form-control" id="ct-hpm-u" value="${v('hpm_username')}" placeholder="Username" autocomplete="off">
        <input class="form-control" id="ct-hpm-p" value="${v('hpm_password')}" placeholder="Password" type="password" autocomplete="new-password">
      </div>
    </div>
    <div class="crm-cred-box crm-cred-edit" style="margin-top:8px">
      <div class="crm-cred-cat">ΗΜΑ</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <input class="form-control" id="ct-hma-u" value="${v('hma_username')}" placeholder="Username" autocomplete="off">
        <input class="form-control" id="ct-hma-p" value="${v('hma_password')}" placeholder="Password" type="password" autocomplete="new-password">
      </div>
    </div>
    <div class="form-group" style="margin-top:14px"><label class="form-label">Σημειώσεις</label><textarea class="form-control" id="ct-notes" rows="3">${v('notes')}</textarea></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-ghost" onclick="closeModal()">Άκυρο</button>
    <button class="btn btn-primary" onclick='modalSaveCrmContact(${JSON.stringify(id||null)})'>Αποθήκευση</button>
  </div>`);
}

window.modalSaveCrmContact = async function(id) {
  if (!isSupabaseAuthMode()) { showToast('Η αποθήκευση στοιχείων CRM απαιτεί σύνδεση μέσω Supabase (κρυπτογράφηση κωδικών).', 'error'); return; }
  const existing = id?(state.db.crmContacts||[]).find(x=>x.id===id):null;
  // collect phones
  const phones=[],phoneLbls=[]; let pi=0;
  while(document.getElementById('ct-ph-'+pi)){
    const v=document.getElementById('ct-ph-'+pi)?.value.trim()||'';
    const l=document.getElementById('ct-ph-lbl-'+pi)?.value||'Mobile';
    if(v){phones.push(v);phoneLbls.push(l);}
    pi++;
  }
  const emails=[],emailLbls=[]; let ei=0;
  while(document.getElementById('ct-em-'+ei)){
    const v=document.getElementById('ct-em-'+ei)?.value.trim()||'';
    const l=document.getElementById('ct-em-lbl-'+ei)?.value||'Work';
    if(v){emails.push(v);emailLbls.push(l);}
    ei++;
  }
  // encrypt taxisnet/hpm/hma passwords server-side before saving
  const rawCreds = {
    taxisnet_password: document.getElementById('ct-tx-p')?.value.trim()||null,
    hpm_password: document.getElementById('ct-hpm-p')?.value.trim()||null,
    hma_password: document.getElementById('ct-hma-p')?.value.trim()||null,
  };
  let encCreds = rawCreds;
  try {
    const {data: encData, error: encErr} = await sb.rpc('app_crm_encrypt_credentials', {p_fields: rawCreds});
    if (encErr) throw encErr;
    encCreds = encData || rawCreds;
  } catch(err) {
    console.error('app_crm_encrypt_credentials error:', err);
    showToast('Σφάλμα κρυπτογράφησης κωδικών: ' + (err?.message||JSON.stringify(err)), 'error');
    return;
  }
  const data = Object.assign({},existing||{},{
    first_name: document.getElementById('ct-fn')?.value.trim()||null,
    last_name:  document.getElementById('ct-ln')?.value.trim()||null,
    company_id: document.getElementById('ct-co')?.value||null,
    organization_title: document.getElementById('ct-title')?.value.trim()||null,
    organization_name: document.getElementById('ct-co')?.selectedOptions[0]?.text!=='—'?document.getElementById('ct-co')?.selectedOptions[0]?.text:null,
    phone_1_label:phones[0]?phoneLbls[0]:null, phone_1_value:phones[0]||null,
    phone_2_label:phones[1]?phoneLbls[1]:null, phone_2_value:phones[1]||null,
    phone_3_label:phones[2]?phoneLbls[2]:null, phone_3_value:phones[2]||null,
    phone_4_label:phones[3]?phoneLbls[3]:null, phone_4_value:phones[3]||null,
    phone_5_label:phones[4]?phoneLbls[4]:null, phone_5_value:phones[4]||null,
    email_1_label:emails[0]?emailLbls[0]:null, email_1_value:emails[0]||null,
    email_2_label:emails[1]?emailLbls[1]:null, email_2_value:emails[1]||null,
    email_3_label:emails[2]?emailLbls[2]:null, email_3_value:emails[2]||null,
    address_1_street:      document.getElementById('ct-str')?.value.trim()||null,
    address_1_city:        document.getElementById('ct-city')?.value.trim()||null,
    address_1_postal_code: document.getElementById('ct-tk')?.value.trim()||null,
    birthday:   document.getElementById('ct-bday')?.value||null,
    afm:        document.getElementById('ct-afm')?.value.trim()||null,
    amka:       document.getElementById('ct-amka')?.value.trim()||null,
    id_number:  document.getElementById('ct-adt')?.value.trim()||null,
    taxisnet_username: document.getElementById('ct-tx-u')?.value.trim()||null,
    taxisnet_password: encCreds.taxisnet_password ?? null,
    hpm_username: document.getElementById('ct-hpm-u')?.value.trim()||null,
    hpm_password: encCreds.hpm_password ?? null,
    hma_username: document.getElementById('ct-hma-u')?.value.trim()||null,
    hma_password: encCreds.hma_password ?? null,
    notes: document.getElementById('ct-notes')?.value.trim()||null,
    created_at: existing?.created_at||new Date().toISOString(),
  });
  try {
    await crmSaveContact(data);
    closeModal();
    render();
    showToast('Επαφή αποθηκεύτηκε.','success');
  } catch(err) {
    console.error('crmSaveContact error:', err);
    showToast('Σφάλμα: ' + (err?.message||JSON.stringify(err)), 'error');
  }
};

// ── TOAST ─────────────────────────────────────────────────────────
function showToast(msg,type='') {
  const wrap=el('toast-wrap'); if(!wrap) return;
  const t=document.createElement('div'); t.className=`toast${type?' t-'+type:''}`;
  t.textContent=msg; wrap.appendChild(t); setTimeout(()=>t.remove(),3500);
}

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); if(state.cu&&state.cu.role!=='client') showGlobalSearch(); }
});

document.addEventListener('DOMContentLoaded', async () => {
  const main=el('main-content');
  if (main) main.innerHTML=`<div class="login-wrap"><div class="login-box" style="text-align:center"><div style="font-size:2rem;margin-bottom:16px">⏳</div><div style="font-weight:700;color:var(--navy)">Έλεγχος συνεδρίας…</div><div class="text-sm text-muted" style="margin-top:6px">Παρακαλώ περιμένετε</div></div></div>`;
  document.body.style.background='var(--navy)';
  const sidebar=document.querySelector('.sidebar'); if(sidebar) sidebar.style.display='none';

  try {
    const {data:{session},error:sessionError}=await sb.auth.getSession();
    if(sessionError) throw sessionError;

    if (session) {
      let profile=await loadCurrentAppUser().catch(()=>null);

      if (!profile) {
        try {
          const {data:claimed,error:claimError}=await sb.rpc('app_claim_my_profile');
          if(!claimError) profile=claimed||await loadCurrentAppUser().catch(()=>null);
        } catch(e) {}
      }

      if (profile) {
        AUTH_MODE='supabase';
        sessionStorage.removeItem('be_pm_user');
        await loadFromDB();
        state.cu=profile;
        const idx=state.db.users.findIndex(u=>u.id===profile.id);
        if(idx>=0) state.db.users[idx]=profile; else state.db.users.push(profile);
        state.view=profile.role==='client'?'client':'dashboard';
        initPresence();
        initProjectsRealtime();
        startNotificationPolling();
      } else {
        await sb.auth.signOut({scope:'local'}).catch(()=>{});
        AUTH_MODE='legacy';
        state.cu=null;
        await loadFromDB();

        const legacy=getCurrentUser();
        if (legacy && !AUTH_REQUIRED_ROLES.has(legacy.role)) {
          const fresh=state.db.users.find(u=>u.id===legacy.id);
          if(fresh){
            state.cu=fresh;
            state.view=fresh.role==='client'?'client':'dashboard';
            initPresence();
            initProjectsRealtime();
          } else clearCurrentUser();
        } else clearCurrentUser();
      }
    } else {
      AUTH_MODE='legacy';
      await loadFromDB();

      const legacy=getCurrentUser();
      if (legacy && !AUTH_REQUIRED_ROLES.has(legacy.role)) {
        const fresh=state.db.users.find(u=>u.id===legacy.id);
        if(fresh){
          state.cu=fresh;
          state.view=fresh.role==='client'?'client':'dashboard';
          initPresence();
          initProjectsRealtime();
        } else {
          clearCurrentUser();
          state.cu=null;
          state.view='login';
        }
      } else {
        clearCurrentUser();
        state.cu=null;
        state.view='login';
      }
    }
  } catch(err) {
    console.error('Transition init failed',err);
    try { await sb.auth.signOut({scope:'local'}); } catch(e) {}
    AUTH_MODE='legacy';
    state.cu=null;
    state.view='login';
    try { await loadFromDB(); } catch(e) { state.db=emptyDbState(); }
    showToast('Αποτυχία αρχικοποίησης: '+(err.message||err),'error');
  }

  if (sidebar) sidebar.style.display='';
  render();

  sb.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_OUT' && isSupabaseAuthMode()){
      AUTH_MODE='legacy';
      state.cu=null;
      state.view='login';
    }
  });
});
