/* Action Trauma — version autonome (hors Claude)
   Remplace window.claude (base de données, utilisateur, téléchargements) par Supabase,
   et ajoute l'écran de connexion. Le reste de l'application est identique à la plateforme. */
(function(){
"use strict";
const CFG=window.AT_CONFIG||{};
const T="at_docs";
const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- « Rester connecté » : session dans localStorage (gardée) ou sessionStorage (oubliée à la fermeture) ---------- */
const remember=()=>{try{return localStorage.getItem("at_remember")!=="0"}catch(e){return true}};
const authStore={
 getItem:k=>{try{return (remember()?localStorage:sessionStorage).getItem(k)}catch(e){return null}},
 setItem:(k,v)=>{try{(remember()?localStorage:sessionStorage).setItem(k,v)}catch(e){}},
 removeItem:k=>{try{localStorage.removeItem(k);sessionStorage.removeItem(k)}catch(e){}}
};

let sb=null,user=null,myRole=null;
const cache=new Map();let loaded=false;
const subs=new Set();let tmr=null;
const schedule=()=>{clearTimeout(tmr);tmr=setTimeout(()=>subs.forEach(f=>{try{f()}catch(e){console.error(e)}}),25)};
let readyRes;const ready=new Promise(r=>readyRes=r);

/* ---------- écran de connexion ---------- */
const css=`#atLogin{position:fixed;inset:0;z-index:9999;background:#f4f6f1;display:flex;align-items:flex-start;justify-content:center;padding:max(24px,7vh) 16px 24px;font:15px/1.4 Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1d2a10;overflow:auto}
#atLogin .lg{width:100%;max-width:380px;background:#fff;border:1px solid #dfe5d8;border-radius:16px;padding:28px 24px;box-shadow:0 8px 30px rgba(30,50,10,.08)}
#atLogin .top{background:#dcfa4b;margin:-28px -24px 22px;padding:22px 24px;border-radius:16px 16px 0 0;text-align:center}
#atLogin .top img{max-width:210px;width:70%;height:auto;mix-blend-mode:multiply}
#atLogin h1{font:600 21px Outfit,Inter,system-ui,sans-serif;margin:0 0 4px}#atLogin p.s{margin:0 0 18px;color:#5b6650;font-size:14px}
#atLogin label{display:block;font-size:13px;font-weight:600;margin:12px 0 5px;color:#3a4530}
#atLogin input[type=email],#atLogin input[type=password],#atLogin input[type=text]{width:100%;box-sizing:border-box;font-size:16px;padding:12px 13px;border:1px solid #cfd6c6;border-radius:10px;background:#fff;color:#111}
#atLogin input:focus{outline:2px solid #8bc400;outline-offset:1px;border-color:#8bc400}
#atLogin .pw{position:relative}#atLogin .pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:none;font-size:13px;color:#4b5a3a;padding:8px;cursor:pointer}
#atLogin .rm{display:flex;align-items:center;gap:10px;margin:16px 0 4px;font-size:15px;font-weight:500;cursor:pointer}#atLogin .rm input{width:22px;height:22px;accent-color:#111}
#atLogin .go{width:100%;margin-top:16px;background:#111;color:#dcfa4b;border:0;border-radius:10px;padding:14px;font:600 16px Inter,system-ui,sans-serif;cursor:pointer}#atLogin .go:disabled{opacity:.6}
#atLogin .lk{display:block;text-align:center;margin-top:14px;color:#3d5a00;font-size:14px;background:none;border:0;cursor:pointer;text-decoration:underline;width:100%}
#atLogin .er{background:#fff1f1;color:#b42318;border:1px solid #f5c2c0;border-radius:8px;padding:9px 11px;font-size:14px;margin-top:12px;display:none}
#atLogin .ok{background:#effbe6;color:#2b6a00;border:1px solid #c6e9ae;border-radius:8px;padding:9px 11px;font-size:14px;margin-top:12px;display:none}
#atLogin .wait{text-align:center;padding:20px 0;color:#5b6650}
#atOut{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;border:1.5px solid #111;background:transparent;color:#111;cursor:pointer;margin-left:8px;font-size:18px}
#atOut:hover{background:rgba(255,255,255,.5)}
.atpw{display:flex;gap:6px}.atpw input{flex:1}`;
function shell(inner){let el=document.getElementById("atLogin");if(!el){const st=document.createElement("style");st.textContent=css;document.head.appendChild(st);el=document.createElement("div");el.id="atLogin";document.body.appendChild(el)}
 el.innerHTML=`<div class="lg"><div class="top"><img src="logo.png" alt="Action Trauma"></div>${inner}</div>`;el.style.display="flex";return el}
const hide=()=>{const el=document.getElementById("atLogin");if(el)el.style.display="none"};
const msg=(cls,t)=>{const el=document.querySelector("#atLogin ."+cls);if(el){el.textContent=t;el.style.display=t?"block":"none"}};
const frErr=e=>{const m=String((e&&(e.message||e.error_description))||e||"");
 if(/invalid login|invalid_credentials/i.test(m))return"Courriel ou mot de passe incorrect.";
 if(/email not confirmed/i.test(m))return"Ce compte n'est pas encore confirmé. Demande à l'administrateur de vérifier les réglages Supabase (confirmation du courriel désactivée).";
 if(/already registered|already been registered|exists/i.test(m))return"Un compte existe déjà avec ce courriel.";
 if(/password should be|at least/i.test(m))return"Le mot de passe doit contenir au moins 8 caractères.";
 if(/rate limit|too many/i.test(m))return"Trop de tentatives. Réessaie dans quelques minutes.";
 if(/fetch|network|Failed to/i.test(m))return"Connexion impossible. Vérifie ton accès Internet.";
 return m||"Une erreur est survenue.";};

function loginScreen(note){
 const el=shell(`<h1 style="margin-bottom:14px">Connexion</h1>
 <form id="atF" novalidate><label for="atE">Courriel</label><input id="atE" type="email" autocomplete="username" inputmode="email" required>
 <label for="atP">Mot de passe</label><div class="pw"><input id="atP" type="password" autocomplete="current-password" required><button type="button" id="atShow">Afficher</button></div>
 <label class="rm"><input type="checkbox" id="atR" ${remember()?"checked":""}> Rester connecté</label>
 <button class="go" id="atGo" type="submit">Se connecter</button><div class="er"></div><div class="ok"></div></form>
 <button class="lk" id="atForgot" type="button">Mot de passe oublié?</button>`);
 if(note)setTimeout(()=>msg("ok",note));
 const last=(()=>{try{return localStorage.getItem("at_last_email")||""}catch(e){return""}})();if(last)el.querySelector("#atE").value=last;
 el.querySelector(last?"#atP":"#atE").focus();
 el.querySelector("#atShow").onclick=()=>{const p=el.querySelector("#atP");p.type=p.type==="password"?"text":"password";el.querySelector("#atShow").textContent=p.type==="password"?"Afficher":"Masquer"};
 el.querySelector("#atF").onsubmit=async ev=>{ev.preventDefault();msg("er","");msg("ok","");
  const email=el.querySelector("#atE").value.trim(),password=el.querySelector("#atP").value;
  if(!email||!password){msg("er","Inscris ton courriel et ton mot de passe.");return}
  try{localStorage.setItem("at_remember",el.querySelector("#atR").checked?"1":"0");localStorage.setItem("at_last_email",email)}catch(e){}
  const b=el.querySelector("#atGo");b.disabled=true;b.textContent="Connexion…";
  try{const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;await afterLogin(data.user)}
  catch(e){msg("er",frErr(e));b.disabled=false;b.textContent="Se connecter"}};
 el.querySelector("#atForgot").onclick=async()=>{const email=el.querySelector("#atE").value.trim();msg("er","");msg("ok","");
  if(!email){msg("er","Inscris d'abord ton courriel, puis clique « Mot de passe oublié? ».");return}
  try{const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;msg("ok","Si ce courriel a un compte, un lien pour choisir un nouveau mot de passe vient d'être envoyé.")}
  catch(e){msg("er",frErr(e))}};
}
function newPasswordScreen(){
 const el=shell(`<h1>Nouveau mot de passe</h1><p class="s">Choisis ton nouveau mot de passe (8 caractères minimum).</p>
 <form id="atN"><label for="atN1">Nouveau mot de passe</label><input id="atN1" type="password" autocomplete="new-password"><label for="atN2">Confirmer</label><input id="atN2" type="password" autocomplete="new-password">
 <button class="go" type="submit">Enregistrer</button><div class="er"></div></form>`);
 el.querySelector("#atN").onsubmit=async ev=>{ev.preventDefault();const a=el.querySelector("#atN1").value,b=el.querySelector("#atN2").value;
  if(a.length<8){msg("er","8 caractères minimum.");return}if(a!==b){msg("er","Les deux mots de passe ne sont pas pareils.");return}
  try{const {data,error}=await sb.auth.updateUser({password:a});if(error)throw error;try{history.replaceState(null,"",location.pathname)}catch(e){}await afterLogin(data.user)}catch(e){msg("er",frErr(e))}};
}
function deniedScreen(){
 const el=shell(`<h1>Accès non autorisé</h1><p class="s">Ton compte (${esc(user&&user.email)}) n'a pas encore accès à la plateforme. Demande à un administrateur de te donner un accès dans l'onglet Utilisateurs.</p><button class="go" id="atLo">Se déconnecter</button>`);
 el.querySelector("#atLo").onclick=logout;
}
function setupScreen(t){shell(`<h1>Configuration requise</h1><p class="s">${t}</p>`)}

/* ---------- données ---------- */
async function loadAll(){const out=[];let from=0;const N=1000;
 for(;;){const {data,error}=await sb.from(T).select("path,data").order("path").range(from,from+N-1);if(error)throw error;out.push(...data);if(data.length<N)break;from+=N}
 cache.clear();out.forEach(r=>cache.set(r.path,r.data));loaded=true}
let chan=null;
function realtime(){try{if(chan)sb.removeChannel(chan)}catch(e){}
 chan=sb.channel("at-docs").on("postgres_changes",{event:"*",schema:"public",table:T},p=>{
  if(p.eventType==="DELETE"){const k=p.old&&p.old.path;if(k)cache.delete(k)}else if(p.new&&p.new.path)cache.set(p.new.path,p.new.data);schedule()})
 .subscribe(st=>{if(st==="CHANNEL_ERROR"||st==="TIMED_OUT")setTimeout(async()=>{try{await loadAll();schedule()}catch(e){}realtime()},5000)});}
document.addEventListener("visibilitychange",async()=>{if(document.visibilityState==="visible"&&loaded&&user){try{await loadAll();schedule()}catch(e){}}});

const snap=p=>({id:p.split("/").pop(),ref:docRef(p),exists:cache.has(p),data:()=>clone(cache.get(p)),metadata:{fromCache:false,hasPendingWrites:false}});
async function write(p,d){const prev=cache.has(p)?cache.get(p):undefined;cache.set(p,d);schedule();
 const {error}=await sb.from(T).upsert({path:p,col:p.split("/")[0],data:d,updated_at:new Date().toISOString()});
 if(error){if(prev===undefined)cache.delete(p);else cache.set(p,prev);schedule();throw Object.assign(new Error(error.message||"Écriture refusée"),{code:"permission-denied"})}}
function docRef(p){return{id:p.split("/").pop(),path:p,
 get:async()=>snap(p),
 set:async(d,o)=>write(p,o&&o.merge?{...(clone(cache.get(p))||{}),...clone(d)}:clone(d)),
 update:async d=>{if(!cache.has(p))throw Object.assign(new Error("Document introuvable"),{code:"not-found"});return write(p,{...clone(cache.get(p)),...clone(d)})},
 delete:async()=>{const prev=cache.get(p);cache.delete(p);schedule();const {error}=await sb.from(T).delete().eq("path",p);if(error){if(prev!==undefined)cache.set(p,prev);schedule();throw new Error(error.message)}},
 onSnapshot:(next,err)=>{const f=()=>next(snap(p));subs.add(f);setTimeout(f);return()=>subs.delete(f)}}}
const list=c=>[...cache.keys()].filter(k=>k.startsWith(c+"/")&&k.split("/").length===2).sort();
function col(c){const q={limit:()=>q,where:()=>q,orderBy:()=>q,doc:id=>docRef(c+"/"+(id||rid())),
 add:async d=>{const r=docRef(c+"/"+rid());await r.set(d);return r},
 get:async()=>{const docs=list(c).map(snap);return{docs,size:docs.length,empty:!docs.length}},
 onSnapshot:(next,err)=>{const f=()=>{const docs=list(c).map(snap);next({docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false}})};subs.add(f);setTimeout(f);return()=>subs.delete(f)}};return q}
const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);

/* ---------- utilisateur ---------- */
const cfgDoc=()=>cache.get("config/entreprise")||{};
const userApi={
 isOwner:()=>{const o=cfgDoc().ownerId;return !!user&&(o===user.id||(!o&&myRole==="admin"))},
 canEdit:()=>myRole==="admin",
 id:async()=>user&&user.id,
 me:async()=>user&&{id:user.id,email:user.email,name:user.email},
 profiles:async ids=>{const A=(cache.get("acces/roles")||{}).users||{},o={};(ids||[]).forEach(i=>{if(A[i])o[i]={email:A[i].email||"",name:""}});if(user)o[user.id]={...(o[user.id]||{}),email:user.email};return o},
 search:async()=>[]
};

/* ---------- téléchargements (PDF, CSV, ZIP) ---------- */
const downloads={save:async({filename,data})=>{const blob=data instanceof Blob?data:new Blob([data]);
 const file=typeof File==="function"?new File([blob],filename,{type:blob.type||"application/octet-stream"}):null;
 const mobile=/iPhone|iPad|Android/i.test(navigator.userAgent);
 if(mobile&&file&&navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:filename});return{status:"saved"}}catch(e){if(e&&e.name==="AbortError")throw Object.assign(new Error("annulé"),{code:"declined"})}}
 const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);return{status:"saved"}}};

window.claude={use:async n=>{await ready;if(n==="db")return{doc:docRef,collection:col};if(n==="user")return userApi;if(n==="downloads")return downloads;return null}};

/* ---------- boîtes de dialogue intégrées (remplacent alert/confirm/prompt, bloqués dans certains navigateurs) ---------- */
function dlg({title,text,input,ok="OK",cancel}){return new Promise(res=>{const w=document.createElement("div");
 w.style.cssText="position:fixed;inset:0;z-index:10000;background:rgba(20,25,15,.45);display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.45 Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif";
 w.innerHTML=`<div role="dialog" aria-modal="true" style="background:#fff;color:#1d2a10;border-radius:14px;max-width:420px;width:100%;padding:22px;box-shadow:0 10px 40px rgba(0,0,0,.25)">${title?`<h3 style="margin:0 0 8px;font:600 18px Outfit,Inter,sans-serif">${esc(title)}</h3>`:""}<div style="white-space:pre-line">${esc(text||"")}</div>${input!=null?`<input id="atDlgIn" type="text" value="${esc(input)}" style="width:100%;box-sizing:border-box;margin-top:12px;font-size:16px;padding:10px 12px;border:1px solid #cfd6c6;border-radius:9px">`:""}<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">${cancel?`<button data-v="0" style="padding:10px 16px;border-radius:9px;border:1px solid #cfd6c6;background:#fff;font:600 15px Inter,sans-serif;cursor:pointer">${esc(cancel)}</button>`:""}<button data-v="1" style="padding:10px 18px;border-radius:9px;border:0;background:#111;color:#dcfa4b;font:600 15px Inter,sans-serif;cursor:pointer">${esc(ok)}</button></div></div>`;
 document.body.appendChild(w);const i=w.querySelector("#atDlgIn");(i||w.querySelector('[data-v="1"]')).focus();if(i)i.select();
 const done=v=>{w.remove();res(input!=null?(v?i.value:null):v)};
 w.querySelectorAll("button").forEach(b=>b.onclick=()=>done(b.dataset.v==="1"));
 w.addEventListener("keydown",e=>{if(e.key==="Escape")done(false);if(e.key==="Enter"&&i)done(true)})})}
const atAlert=(text,title)=>dlg({title,text});
const atConfirm=(text,ok="Confirmer",title)=>dlg({title,text,ok,cancel:"Annuler"});
const atPrompt=(text,def,title)=>dlg({title,text,input:def||"",ok:"Enregistrer",cancel:"Annuler"});

/* ---------- connexion / déconnexion ---------- */
async function afterLogin(u){user=u;
 shell(`<div class="wait">Chargement de tes données…</div>`);
 try{const {data,error}=await sb.rpc("at_my_role");if(error)throw error;myRole=data||null}
 catch(e){setupScreen("La base de données n'est pas encore prête (script SQL non exécuté?). Détail : "+esc(e.message||e));return}
 if(!myRole){deniedScreen();return}
 try{await loadAll()}catch(e){setupScreen("Impossible de lire les données : "+esc(e.message||e));return}
 realtime();hide();addLogout();readyRes();
}
async function logout(){try{await sb.auth.signOut()}catch(e){}try{sessionStorage.clear()}catch(e){}location.reload()}
window.AT_logout=logout;
function addLogout(){const put=()=>{if(document.getElementById("atOut"))return;const g=document.getElementById("gear");if(!g||!g.parentNode)return;const b=document.createElement("button");b.id="atOut";b.type="button";b.title="Se déconnecter ("+(user&&user.email||"")+")";b.setAttribute("aria-label","Se déconnecter");b.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';b.onclick=async()=>{if(await atConfirm("Te déconnecter de la plateforme?","Se déconnecter"))logout()};g.parentNode.appendChild(b)};put();setTimeout(put,500);setTimeout(put,2000)}

/* ---------- gestion des utilisateurs (onglet Utilisateurs) ---------- */
function bindCopy(toast){const c=document.getElementById("nu-cp");if(c)c.onclick=()=>navigator.clipboard.writeText(window.AT_SA._info||"").then(()=>toast("Copié")).catch(()=>toast("Sélectionne le texte pour le copier"))}
const genPw=()=>{const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";let s="";const r=crypto.getRandomValues(new Uint32Array(10));r.forEach(x=>s+=a[x%a.length]);return s};
window.AT_SA={
 addCardHTML:emps=>`<div class="card"><h3>Ajouter un utilisateur</h3>
  <p class="note" style="margin-top:0">Crée son compte ici, puis donne-lui son courriel, son mot de passe et le lien de l'application. Il pourra se connecter tout de suite.</p>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 14px;align-items:end">
   <div><label for="nu-e">Employé</label><select id="nu-e"><option value="">— Choisir —</option>${emps.map(e=>`<option value="${esc(e.id)}" data-mail="${esc(e.courriel||"")}">${esc(e.nom)}</option>`).join("")}</select></div>
   <div><label for="nu-r">Type d'utilisateur</label><select id="nu-r"><option value="chef">Chef d'équipe</option><option value="compta">Comptabilité</option><option value="admin">Administrateur</option></select></div>
   <div><label for="nu-m">Courriel (sert à se connecter)</label><input id="nu-m" type="email" autocomplete="off"></div>
   <div><label for="nu-p">Mot de passe</label><div class="atpw"><input id="nu-p" type="text" autocomplete="off" placeholder="8 caractères minimum"><button class="btn" id="nu-g" type="button" title="Générer un mot de passe">🎲</button></div></div>
  </div><div class="actions" style="margin-top:12px;justify-content:flex-end"><button class="btn p" id="nu-ok">Créer le compte</button></div>
  <div id="nu-done" style="margin-top:12px">${window.AT_SA._done||""}</div></div>`,
 bindUsers:({A,en,toast,fail,ask,setEmpChef,saveRoles})=>{
  const e=document.getElementById("nu-e");if(!e)return;
  e.onchange=()=>{const o=e.selectedOptions[0];const m=document.getElementById("nu-m");if(o&&o.dataset.mail&&!m.value)m.value=o.dataset.mail};
  document.getElementById("nu-g").onclick=()=>{document.getElementById("nu-p").value=genPw()};
  document.getElementById("nu-ok").onclick=async ev=>{const emp=e.value,role=document.getElementById("nu-r").value,email=document.getElementById("nu-m").value.trim().toLowerCase(),pw=document.getElementById("nu-p").value;
   if(!emp){toast("Choisis l'employé.");return}if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast("Courriel invalide.");return}if(pw.length<8){toast("Le mot de passe doit avoir au moins 8 caractères.");return}
   if(Object.values(A).some(u=>(u.email||"").toLowerCase()===email)){toast("Ce courriel a déjà un accès.");return}
   const b=ev.currentTarget;b.disabled=true;b.textContent="Création…";
   try{const tmp=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:"at_tmp_signup"}});
    const {data,error}=await tmp.auth.signUp({email,password:pw});if(error)throw error;
    const nu=data&&data.user;if(!nu||(nu.identities&&nu.identities.length===0))throw new Error("already registered");
    try{await tmp.auth.signOut()}catch(x){}
    await saveRoles({...A,[nu.id]:{emp,role,email}});if(role==="chef")await setEmpChef(emp);
    window.AT_SA._info=`Plateforme Action Trauma\nLien : ${location.origin+location.pathname}\nCourriel : ${email}\nMot de passe : ${pw}`;
    window.AT_SA._done=`<div class="banner" style="margin:0"><b>Compte créé pour ${esc(en(emp))}.</b> Transmets-lui ces informations :<br>Lien : <b>${esc(location.origin+location.pathname)}</b><br>Courriel : <b>${esc(email)}</b><br>Mot de passe : <b>${esc(pw)}</b><br><button class="btn" id="nu-cp" style="margin-top:8px">Copier ces informations</button></div>`;
    const d=document.getElementById("nu-done");if(d){d.innerHTML=window.AT_SA._done;bindCopy(toast)}
    toast("Compte créé");}
   catch(x){toast(frErr(x));b.disabled=false;b.textContent="Créer le compte"}};
  bindCopy(toast);
  document.querySelectorAll("[data-upw]").forEach(btn=>btn.onclick=async()=>{const id=btn.dataset.upw,u=A[id];
   const pw=await atPrompt(`Nouveau mot de passe pour ${en(u.emp)} (8 caractères minimum) :`,genPw(),"Changer le mot de passe");if(pw===null)return;
   if(pw.length<8){toast("8 caractères minimum.");return}
   const {error}=await sb.rpc("at_set_password",{uid:id,pw});if(error){fail(error);return}
   try{await navigator.clipboard.writeText(pw)}catch(x){}toast("Mot de passe changé"+(navigator.clipboard?" (copié)":""))});
 },
 deleteUser:async uid=>{const {error}=await sb.rpc("at_delete_user",{uid});if(error)throw error},
 importJSON:()=>{const inp=document.createElement("input");inp.type="file";inp.accept=".json,application/json";
  inp.style.display="none";document.body.appendChild(inp);
  inp.onchange=async()=>{setTimeout(()=>inp.remove(),1000);const f=inp.files&&inp.files[0];if(!f)return;let j;try{j=JSON.parse(await f.text())}catch(e){atAlert("Ce fichier est illisible.");return}
   const D=j&&j.docs;if(!D||typeof D!=="object"){atAlert("Ce fichier ne vient pas de l'export de la plateforme.");return}
   const n=Object.keys(D).length;if(!await atConfirm(`Importer ${n} éléments? Les documents qui ont le même numéro seront remplacés.`,"Importer","Importer les données"))return;
   const rows=Object.entries(D).filter(([p])=>/^(docs|orgs)\/[^/]+$/.test(p)||p==="config/entreprise").map(([p,d])=>{if(p==="config/entreprise"){d={...d,ownerId:user.id}}return{path:p,col:p.split("/")[0],data:d,updated_at:new Date().toISOString()}});
   try{for(let i=0;i<rows.length;i+=200){const {error}=await sb.from(T).upsert(rows.slice(i,i+200));if(error)throw error}
    const roles=cache.get("acces/roles");if(!roles){await sb.from(T).upsert({path:"acces/roles",col:"acces",data:{users:{}},updated_at:new Date().toISOString()})}
    await loadAll();schedule();atAlert(`${rows.length} éléments importés. Tes soumissions, factures, clients et paramètres sont maintenant dans l'application.`,"Import terminé")}catch(e){atAlert("L'import a échoué : "+(e.message||e),"Erreur")}};
  inp.click()}
};

/* ---------- démarrage ---------- */
async function boot(){
 if(!CFG.url||!CFG.key||!window.supabase){setupScreen(!window.supabase?"Impossible de charger le module de connexion. Vérifie ta connexion Internet, puis recharge la page.":"L'adresse Supabase et la clé publique ne sont pas encore inscrites dans config.js.");return}
 sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{storage:authStore,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"at_auth"}});
 window.AT_sb=sb;
 const isRecovery=/type=recovery/.test(location.hash+location.search);
 sb.auth.onAuthStateChange((ev,session)=>{if(ev==="PASSWORD_RECOVERY")newPasswordScreen();if(ev==="SIGNED_OUT"&&user)location.reload()});
 if(isRecovery){newPasswordScreen();return}
 shell(`<div class="wait">Ouverture…</div>`);
 let s=null;try{s=(await sb.auth.getSession()).data.session}catch(e){}
 if(s&&s.user)await afterLogin(s.user);else loginScreen();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
if("serviceWorker" in navigator&&location.protocol==="https:")window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
})();

/* ---------- avis de nouvelle version : l'application ouverte se met à jour en un clic ---------- */
(function(){
  const cur=(()=>{const s=[...document.scripts].map(x=>x.src).find(x=>/standalone\.js\?v=\d+/.test(x));return s?s.match(/v=(\d+)/)[1]:null})();
  if(!cur)return;let shown=false;
  async function check(){if(shown||document.hidden)return;try{const r=await fetch("index.html?chk="+Date.now(),{cache:"no-store"});if(!r.ok)return;const t=await r.text(),m=t.match(/standalone\.js\?v=(\d+)/);
    if(m&&m[1]!==cur){shown=true;const b=document.createElement("div");b.id="atUpd";b.style.cssText="position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;background:#16181a;color:#fff;padding:10px 14px;border-radius:10px;display:flex;gap:12px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.25);font:14px Inter,system-ui,sans-serif";
      b.innerHTML='<span>Une nouvelle version de l’application est disponible.</span><button style="background:#dcf34a;color:#16181a;border:0;border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer">Mettre à jour</button>';
      b.querySelector("button").onclick=()=>location.reload();document.body.appendChild(b)}}catch(e){}}
  setInterval(check,5*60*1000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)check()});window.addEventListener("focus",check);setTimeout(check,30000);
})();
