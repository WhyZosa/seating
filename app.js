const SUPABASE_URL = "https://ludzkvlzkpvgcskgwshy.supabase.co";
const SUPABASE_ANON = "sb_publishable_onHivOUsUImJY_v4tDyLzA_BWkEX9Tt";
const APP_URL = "https://whyzosa.github.io/seating/";
const FALLBACK_TEACHER_EMAILS = ["zasimukd@mail.ru"];

function rowsRange(a,b,blocks){const o=[];for(let n=a;n<=b;n++)o.push({n,blocks:blocks.slice()});return o;}
const ROOMS={
  R401:{name:"R401",kind:"rows",rows:[
    {n:1,blocks:[8,6,8]},
    ...rowsRange(2,10,[23]),
    {n:11,blocks:[15]},
  ]},
  R304:{name:"R304",kind:"rows",rows: rowsRange(1,11,[18]) },
  R503:{name:"R503",kind:"sectors",sectors:[
    {name:"Ряд 1",offset:1,desks:[4,4,4,4,4]},
    {name:"Ряд 2",offset:1,desks:[6,6,6,6,6,6,6]},
    {name:"Ряд 3",offset:0,desks:[2,4,4,4,4,4,4,4]},
  ]},
};

let current="R401";
let isAdmin=false;
let configured = SUPABASE_URL.startsWith("http") && SUPABASE_ANON.length>20;
let sb=null;
let assignments={}; Object.keys(ROOMS).forEach(r=>assignments[r]={});
let editing=null, modalPresent=false;

const idRow=(n,s)=>`r${n}s${s}`, posRow=(n,s)=>`Ряд ${n}, место ${s}`;
const idSec=(c,d,s)=>`c${c}d${d}s${s}`, posSec=(name,d,s)=>`${name} (сектор), линия ${d}, место ${s}`;
function enumerate(room){const R=ROOMS[room],out=[];
  if(R.kind==="rows"){R.rows.forEach(r=>{let c=0;r.blocks.forEach(b=>{for(let i=0;i<b;i++){c++;out.push({id:idRow(r.n,c),pos:posRow(r.n,c)});}});});}
  else{R.sectors.forEach((sec,si)=>{const c=si+1;sec.desks.forEach((d,di)=>{const dn=di+1;for(let s=1;s<=d;s++)out.push({id:idSec(c,dn,s),pos:posSec(sec.name,dn,s)});});});}
  return out;}
const _pos={};
function posOf(room,id){if(!_pos[room]){_pos[room]={};enumerate(room).forEach(x=>_pos[room][x.id]=x.pos);}return _pos[room][id]||id;}
const totalSeats=room=>enumerate(room).length;
const surname=f=>(f||"").trim().split(/\s+/)[0]||"";
const escapeHtml=s=>(s+"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const isTaken=d=>d&&(d.fio||d.var||d.group||d.present);
function authRedirectUrl(){
  const productionUrl=new URL(APP_URL).href;
  if(!["http:","https:"].includes(location.protocol))return productionUrl;
  if(["localhost","127.0.0.1","::1"].includes(location.hostname))return productionUrl;
  const url=new URL(location.href);
  url.search="";
  url.hash="";
  if(!url.pathname.endsWith("/"))url.pathname=url.pathname.replace(/\/[^/]*$/,"/");
  return url.href;
}
function authErrorFromUrl(){
  const raw=(location.hash||"").replace(/^#/,"");
  if(!raw.includes("error"))return "";
  const p=new URLSearchParams(raw);
  return (p.get("error_description")||p.get("error_code")||p.get("error")||"").replace(/\+/g," ");
}
function friendlyAuthError(error){
  const msg=error&&(error.message||String(error));
  if(error&&(error.status===429||/rate limit|too many/i.test(msg)))return "Слишком много запросов. Попробуй ещё раз через минуту; если Supabase всё равно просит ждать часы, уменьши лимиты/срок OTP в настройках Auth.";
  return msg||"Неизвестная ошибка";
}
async function checkTeacher(session){
  if(!session)return false;
  try{
    const {data,error}=await sb.rpc("is_current_teacher");
    if(!error)return data===true;
  }catch(e){}
  const email=((session.user&&session.user.email)||"").toLowerCase();
  return FALLBACK_TEACHER_EMAILS.includes(email);
}
async function isTeacherEmail(email){
  try{
    const {data,error}=await sb.rpc("is_teacher_email",{check_email:email});
    if(!error)return data===true;
  }catch(e){}
  return FALLBACK_TEACHER_EMAILS.includes(email);
}

async function loadAll(){
  if(!sb) return;
  Object.keys(ROOMS).forEach(r=>assignments[r]={});
  try{
    if(isAdmin){
      const {data,error}=await sb.from("seats").select("room,seat_id,fio,grp,variant,present");
      if(error)throw error;
      (data||[]).forEach(r=>{if(assignments[r.room])assignments[r.room][r.seat_id]={fio:r.fio,group:r.grp,var:r.variant,present:r.present};});
    }else{
      const {data,error}=await sb.from("seats_public").select("room,seat_id,fio,grp,present");
      if(error)throw error;
      (data||[]).forEach(r=>{if(assignments[r.room])assignments[r.room][r.seat_id]={fio:r.fio,group:r.grp,present:r.present};});
    }
    setStatus("Обновлено: "+new Date().toLocaleTimeString());
  }catch(e){ setStatus("Ошибка загрузки: "+(e.message||e)); }
}
async function saveSeat(room,id,d){
  if(!sb||!isAdmin)return;
  const row={room,seat_id:id,fio:d.fio||null,grp:d.group||null,variant:d.var||null,present:!!d.present};
  const {error}=await sb.from("seats").upsert(row,{onConflict:"room,seat_id"});
  if(error)setStatus("Ошибка сохранения: "+error.message);
}
async function deleteSeat(room,id){
  if(!sb||!isAdmin)return;
  const {error}=await sb.from("seats").delete().eq("room",room).eq("seat_id",id);
  if(error)setStatus("Ошибка удаления: "+error.message);
}
function setStatus(t){document.getElementById("status").textContent=t;}

function makeSeat(room,id,pos,fallbackNo){
  const d=(assignments[room]||{})[id];
  const s=document.createElement("div");s.className="seat";s.dataset.id=id;s.dataset.pos=pos;
  if(isTaken(d)){
    s.classList.add("taken");
    if(d.present)s.classList.add("present");
    const showVar=isAdmin&&d.var;
    s.innerHTML=`<div class="name">${escapeHtml(surname(d.fio)||"—")}</div>`+(showVar?`<div class="var">в.${escapeHtml(d.var)}</div>`:"")+`<div class="check">✓</div>`;
    s.title=`${pos}\n${d.fio||""}\nГруппа: ${d.group||"—"}`+(isAdmin?` · Вариант: ${d.var||"—"}`:"")+`\n${d.present?"Пришёл":"Не отмечен"}`;
  }else{
    s.innerHTML=`<div class="num">${fallbackNo}</div><div class="check">✓</div>`;
    s.title=`${pos} — свободно`;
  }
  s.onclick=()=>openModal(room,id,pos);
  return s;
}

function renderRoom(){
  const root=document.getElementById("room");root.innerHTML="";const R=ROOMS[current];
  if(R.kind==="rows"){
    R.rows.forEach(rowDef=>{
      const rowEl=document.createElement("div");rowEl.className="row";
      const lab=document.createElement("div");lab.className="row-label";lab.innerHTML=`ряд<b>${rowDef.n}</b>`;rowEl.appendChild(lab);
      const blocksEl=document.createElement("div");blocksEl.className="blocks";let c=0;
      rowDef.blocks.forEach(count=>{const blk=document.createElement("div");blk.className="block";
        for(let i=0;i<count;i++){c++;blk.appendChild(makeSeat(current,idRow(rowDef.n,c),posRow(rowDef.n,c),c));}
        blocksEl.appendChild(blk);});
      rowEl.appendChild(blocksEl);root.appendChild(rowEl);
    });
  }else{
    const cont=document.createElement("div");cont.className="sectors";
    R.sectors.forEach((sec,si)=>{const c=si+1;
      const col=document.createElement("div");col.className="sector";
      const t=document.createElement("div");t.className="sec-title";t.textContent=sec.name;col.appendChild(t);
      if(sec.offset){const sp=document.createElement("div");sp.style.height=(53*sec.offset-9)+"px";sp.style.flex="0 0 auto";col.appendChild(sp);}
      sec.desks.forEach((d,di)=>{const dn=di+1;
        const deskEl=document.createElement("div");deskEl.className="desk";
        const no=document.createElement("div");no.className="desk-no";no.textContent=dn;deskEl.appendChild(no);
        for(let s=1;s<=d;s++)deskEl.appendChild(makeSeat(current,idSec(c,dn,s),posSec(sec.name,dn,s),s));
        col.appendChild(deskEl);});
      cont.appendChild(col);
    });
    root.appendChild(cont);
  }
  applyFinderHighlight();
}

function renderTabs(){const t=document.getElementById("tabs");t.innerHTML="";
  Object.keys(ROOMS).forEach(room=>{const occ=Object.values(assignments[room]||{}).filter(isTaken).length;
    const b=document.createElement("button");b.className="tab";b.setAttribute("role","tab");b.setAttribute("aria-selected",room===current);
    b.innerHTML=`${ROOMS[room].name}<small>${occ}/${totalSeats(room)} мест</small>`;
    b.onclick=()=>{current=room;renderTabs();renderRoom();};t.appendChild(b);});}

function setPresence(v){modalPresent=v;const b=document.getElementById("mPres");if(!b)return;b.setAttribute("aria-pressed",v);b.textContent=v?"✓ Пришёл":"Отметить, что пришёл";}
function openModal(room,id,pos){
  editing={room,id};const d=(assignments[room]||{})[id]||{};
  const m=document.getElementById("modal");
  if(isAdmin){
    m.innerHTML=`<h3>${ROOMS[room].name}</h3><div class="seatpos">${escapeHtml(pos)}</div>
      <div class="field"><label>ФИО</label><input id="mFio" placeholder="Иванов Иван Иванович"></div>
      <div class="field"><label>Группа</label><input id="mGroup" placeholder="БПМИ245"></div>
      <div class="field"><label>Вариант</label><input id="mVar" placeholder="3"></div>
      <div class="presence"><label>Явка</label><button id="mPres" aria-pressed="false">Отметить, что пришёл</button></div>
      <div class="actions"><button class="btn primary grow" id="mSave">Сохранить</button>
        <button class="btn warn" id="mClearOne">Удалить</button>
        <button class="btn" id="mCancel">Отмена</button></div>`;
    document.getElementById("mFio").value=d.fio||"";
    document.getElementById("mGroup").value=d.group||"";
    document.getElementById("mVar").value=d.var||"";
    setPresence(!!d.present);
    document.getElementById("mSave").onclick=saveModal;
    document.getElementById("mClearOne").onclick=clearOne;
    document.getElementById("mCancel").onclick=closeModal;
    document.getElementById("mPres").onclick=()=>setPresence(!modalPresent);
    setTimeout(()=>document.getElementById("mFio").focus(),50);
  }else{
    let body;
    if(isTaken(d)){
      body=`<div class="ro"><b>${escapeHtml(d.fio||"—")}</b><br>
        Группа: ${escapeHtml(d.group||"—")}<br>
        Аудитория: ${ROOMS[room].name}<br>
        ${escapeHtml(pos)}<br>
        Статус: ${d.present?'<b style="color:var(--good)">пришёл</b>':"не отмечен"}</div>`;
    }else{
      body=`<div class="ro free">${escapeHtml(pos)} — свободно</div>`;
    }
    m.innerHTML=`<h3>${ROOMS[room].name}</h3><div class="seatpos">${escapeHtml(pos)}</div>
      ${body}<div class="actions"><button class="btn grow" id="mCancel">Закрыть</button></div>`;
    document.getElementById("mCancel").onclick=closeModal;
  }
  document.getElementById("overlay").classList.add("open");
}
function closeModal(){document.getElementById("overlay").classList.remove("open");editing=null;}
async function saveModal(){if(!editing)return;const id=editing.id,room=editing.room;
  const fio=document.getElementById("mFio").value.trim(),group=document.getElementById("mGroup").value.trim(),v=document.getElementById("mVar").value.trim();
  if(!fio&&!group&&!v&&!modalPresent){delete assignments[room][id];deleteSeat(room,id);}
  else{assignments[room][id]={fio,group,var:v,present:modalPresent};saveSeat(room,id,assignments[room][id]);}
  closeModal();renderRoom();renderTabs();}
async function clearOne(){if(!editing)return;const room=editing.room,id=editing.id;
  delete assignments[room][id];deleteSeat(room,id);closeModal();renderRoom();renderTabs();}

function buildIndex(){const idx=[];Object.keys(ROOMS).forEach(room=>{Object.entries(assignments[room]||{}).forEach(([id,d])=>{if(isTaken(d))idx.push({room,id,pos:posOf(room,id),...d});});});return idx;}
let sgItems=[],sgActive=-1;
function showSuggest(){
  const q=document.getElementById("finder").value.trim().toLowerCase();const box=document.getElementById("suggest");
  if(!q){box.classList.remove("open");applyFinderHighlight();return;}
  sgItems=buildIndex().filter(x=>((x.fio||"")+" "+(x.group||"")).toLowerCase().includes(q)).slice(0,8);
  if(!sgItems.length){box.innerHTML='<div class="sg"><div class="meta">Никого не нашлось</div></div>';box.classList.add("open");return;}
  box.innerHTML=sgItems.map((x,i)=>`<div class="sg" data-i="${i}"><div class="nm">${escapeHtml(x.fio||"—")} ${x.present?'<span style="color:var(--good)">✓</span>':''}</div>
    <div class="meta">${escapeHtml(x.group||"без группы")} · ${x.room} · ${escapeHtml(x.pos)}${isAdmin?` · вариант ${escapeHtml(x.var||"—")}`:""}</div></div>`).join("");
  box.classList.add("open");sgActive=-1;
  box.querySelectorAll(".sg").forEach(el=>{el.onclick=()=>pickSuggest(+el.dataset.i);});applyFinderHighlight();
}
function pickSuggest(i){const x=sgItems[i];if(!x)return;document.getElementById("suggest").classList.remove("open");current=x.room;renderTabs();renderRoom();openModal(x.room,x.id,x.pos);}
function applyFinderHighlight(){
  const q=document.getElementById("finder").value.trim().toLowerCase();
  document.querySelectorAll(".seat").forEach(s=>s.classList.remove("match","dim"));if(!q)return;
  document.querySelectorAll(".seat").forEach(s=>{const d=(assignments[current]||{})[s.dataset.id];const hay=((d&&d.fio)||"")+" "+((d&&d.group)||"");
    if(isTaken(d)&&hay.toLowerCase().includes(q))s.classList.add("match");else s.classList.add("dim");});
}

function renderRole(){
  const rb=document.getElementById("rolebox");
  if(isAdmin){
    rb.innerHTML=`<span class="badge admin">Преподаватель</span><button class="btn small" id="logout">Выйти</button>`;
    document.getElementById("logout").onclick=async()=>{await sb.auth.signOut();};
  }else{
    rb.innerHTML=`<button class="btn small" id="login">Вход для преподавателя</button>`;
    document.getElementById("login").onclick=loginFlow;
  }
}
async function loginFlow(){
  const email=prompt("Почта преподавателя (придёт письмо для входа):");
  if(!email)return;
  const cleanEmail=email.trim().toLowerCase();
  if(!await isTeacherEmail(cleanEmail)){
    alert("Этой почты нет в списке преподавателей. Письмо не отправлено.");
    return;
  }
  const existingToken=prompt("Если код из письма уже есть, введи его сюда.\n\nЕсли кода ещё нет и нужно отправить новое письмо, оставь поле пустым.");
  if(existingToken){
    await verifyLoginCode(cleanEmail,existingToken);
    return;
  }
  const {error}=await sb.auth.signInWithOtp({email:cleanEmail,options:{emailRedirectTo:authRedirectUrl()}});
  if(error){alert("Ошибка: "+friendlyAuthError(error));return;}
  setStatus("Письмо отправлено на "+cleanEmail);
  const token=prompt("Письмо отправлено на "+cleanEmail+".\n\nЕсли в письме есть цифровой код, введи его здесь. Если хочешь войти по кнопке из письма, оставь поле пустым.");
  if(!token)return;
  await verifyLoginCode(cleanEmail,token);
}
async function verifyLoginCode(email,token){
  const cleanToken=token.trim().replace(/\s+/g,"");
  if(!/^\d{6,10}$/.test(cleanToken)){alert("Введи цифровой код из письма без пробелов.");return;}
  const {error:verifyError}=await sb.auth.verifyOtp({email,token:cleanToken,type:"email"});
  if(verifyError)alert("Ошибка кода: "+friendlyAuthError(verifyError));
}

document.getElementById("overlay").onclick=e=>{if(e.target.id==="overlay")closeModal();};
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();
  if(e.key==="Enter"&&editing&&isAdmin&&document.getElementById("overlay").classList.contains("open"))saveModal();});
const finderEl=document.getElementById("finder");
finderEl.addEventListener("input",showSuggest);finderEl.addEventListener("focus",showSuggest);
finderEl.addEventListener("keydown",e=>{const box=document.getElementById("suggest");if(!box.classList.contains("open"))return;
  if(e.key==="ArrowDown"){sgActive=Math.min(sgActive+1,sgItems.length-1);e.preventDefault();}
  else if(e.key==="ArrowUp"){sgActive=Math.max(sgActive-1,0);e.preventDefault();}
  else if(e.key==="Enter"){if(sgActive>=0){pickSuggest(sgActive);e.preventDefault();}return;}
  box.querySelectorAll(".sg").forEach((el,i)=>el.classList.toggle("active",i===sgActive));});
document.addEventListener("click",e=>{if(!e.target.closest(".finder"))document.getElementById("suggest").classList.remove("open");});

async function refreshAndRender(){await loadAll();
  if(!document.getElementById("overlay").classList.contains("open")){renderRoom();}
  renderTabs();}
async function init(){
  if(!configured){
    document.getElementById("banner").innerHTML="";
    document.getElementById("rolebox").innerHTML='<button class="btn small" id="login">Вход для преподавателя</button>';
    document.getElementById("login").onclick=loginFlow;
    renderTabs();renderRoom();return;
  }
  sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON,{auth:{flowType:"implicit",persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const authError=authErrorFromUrl();
  const {data:{session}}=await sb.auth.getSession();
  isAdmin=await checkTeacher(session);
  sb.auth.onAuthStateChange(async(_e,s)=>{const was=isAdmin;isAdmin=await checkTeacher(s);if(was!==isAdmin){renderRole();refreshAndRender();}});
  renderRole();
  await refreshAndRender();
  if(authError)setStatus("Ошибка входа: "+authError);
  setInterval(refreshAndRender,5000);
}
init();
