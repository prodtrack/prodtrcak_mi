import { useState, useEffect } from "react";
import { auth, db } from "./firebase";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  collection, doc, getDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, runTransaction, serverTimestamp, where, arrayUnion,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import "./App.css";
import * as XLSX from "xlsx";
import {
  S, ROLES, ROLE_LABELS, ROLE_COLORS, getFY, formatDate, isOverdue,
  Icon, useToast, SectionHeader, EmptyState, AccessDenied, fieldStyle, labelStyle, useIsMobile,
  FuzzyAutocomplete,
} from "./shared.jsx";
import PurchaseTab from "./purchase/PurchaseTab.jsx";
import { COMPANY_LOGO_DATA_URI } from "./purchase/companyLogo.js";
import { printWorkOrder } from "./WOPrintView.jsx";
import { printEnquiry } from "./EnquiryPrintView.jsx";
import SelectOrCustom from "./purchase/PurchaseFormControls.jsx";

// ─── Constants (work order specific) ───────────────────────────────────────────
// Must match INTERNAL_EMAIL_DOMAIN in functions/index.js exactly — this is how
// a plain "store1" User ID becomes a Firebase-Auth-shaped login underneath.
const INTERNAL_EMAIL_DOMAIN="users.mahendraindustries.in";
function userIdToEmail(userId){return `${userId.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;}

const functions=getFunctions();
const callCreateUser=httpsCallable(functions,"createUser");
const callResetPassword=httpsCallable(functions,"resetPassword");
const callDeleteUser=httpsCallable(functions,"deleteUser");

const INSULATION_SCHEMES = ["Bare","Enamel","Fiberglass","Daglass","Mica","Kapton","Nomex","Enamel + FGC","Enamel + DGC","Enamel + Mica","Kapton + FGC","Kapton + DGC","Paper Covered","Enamel + Paper"];
const THERMAL_CLASSES    = ["Class F","Class H","Class S"];
const TEMP_INDEX_LIST    = ["155°C","180°C","200°C","240°C"];
const CONDUCTOR_STAGES   = ["Wire Drawing","Flattening","Annealing","Insulation — Pass 1","Insulation — Pass 2","QC / Inspection","Ready for Dispatch"];
const COIL_STAGES        = ["Wire Drawing","Flattening","Annealing","Insulation — Pass 1","Insulation — Pass 2","Looping","Spreading","Taping","QC / Inspection","Ready for Dispatch"];

// Enquiry-specific dropdown options — deliberately a separate, independent
// list from Purchase's PAYMENT_TERMS_OPTIONS/DELIVERY_TERMS_OPTIONS/
// GST_RATE_OPTIONS in purchaseHelpers.js. Same values today, but editing one
// list has no effect on the other — Purchase and Enquiry are unrelated
// contexts and should be tunable independently.
const ENQ_PAYMENT_TERMS_OPTIONS = [
  "Payment against delivery","100% Advance","30 Days from date of Invoice",
  "45 Days from date of Invoice","60 Days from date of Invoice",
  "50% Advance, 50% on Delivery","Against Bank Guarantee",
];
const ENQ_FREIGHT_OPTIONS = ["FOR (freight paid by you)","FOB","CIF","Ex-Works","DAP","DDP","CPT","CIP"];
const ENQ_GST_OPTIONS = ["Extra 0%","Extra 5%","Extra 12%","Extra 18%","Extra 28%"];

// ─── Helpers (work order specific) ─────────────────────────────────────────────
function stagesFor(type){return type==="coil"?COIL_STAGES:CONDUCTOR_STAGES;}
function stageProgress(stage,type){const s=stagesFor(type);const i=s.indexOf(stage);return i<0?0:Math.round(((i+1)/s.length)*100);}

async function generateWONumber(){
  const fy=getFY();
  const ref=doc(db,"counters",`WO-${fy}`);
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const next=(snap.exists()?snap.data().last:0)+1;
    tx.set(ref,{last:next});
    return `WO/${fy}/${String(next).padStart(3,"0")}`;
  });
}

// Enquiry numbering: a single global counter (no financial-year segment,
// unlike WO/PO) — just ENQ00001, ENQ00002, ... incrementing forever.
async function generateEnqNumber(){
  const ref=doc(db,"counters","ENQ-global");
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const next=(snap.exists()?snap.data().last:0)+1;
    tx.set(ref,{last:next});
    return `ENQ${String(next).padStart(5,"0")}`;
  });
}

// Formats an enquiry item's dimensions the same way WO cards do —
// "W × T mm" (+ corner R) for rectangular strip, "Ø D mm" for round wire.
function itemSizeLabel(it){
  if(!it)return"";
  if(it.conductor_type==="wire")return it.diameter?`Ø ${it.diameter} mm`:"";
  if(!it.width&&!it.thickness)return"";
  return `${it.width||"-"} × ${it.thickness||"-"} mm${it.corner_radius?`, R${it.corner_radius}`:""}`;
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App(){
  const [user,setUser]=useState(null);
  const [profile,setProfile]=useState(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>onAuthStateChanged(auth,async u=>{
    if(u){setUser(u);const s=await getDoc(doc(db,"users",u.uid));setProfile(s.exists()?s.data():null);}
    else{setUser(null);setProfile(null);}
    setLoading(false);
  }),[]);
  if(loading)return<div className="spinner-wrap"><div className="spinner"/></div>;
  if(!user||!profile)return<LoginScreen/>;
  return<MainApp user={user} profile={profile}/>;
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen(){
  const [userId,setUserId]=useState("");
  const [password,setPassword]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const handle=async()=>{
    setError("");setBusy(true);
    try{
      const loginEmail=userId.includes("@")?userId.trim():userIdToEmail(userId);
      await signInWithEmailAndPassword(auth,loginEmail,password);
    }
    catch{setError("Invalid User ID or password.");}
    finally{setBusy(false);}
  };
  return(
    <div style={{background:"#f4f6f9",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380,animation:"fadeUp .3s ease"}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{...S,fontSize:26,fontWeight:700,color:"#e8c547",letterSpacing:".08em"}}>PRODTRACK</div>
          <div style={{fontSize:12,color:"#9ca3af",marginTop:4}}>Mahendra Industries — Production Tracker</div>
        </div>
        <div className="card" style={{padding:28}}>
          <div style={{fontSize:16,fontWeight:600,marginBottom:20,color:"#1a1f2e"}}>Sign in to continue</div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:6}}>User ID</label>
            <input className="input-field" placeholder="e.g. store1" value={userId} onChange={e=>{setUserId(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&handle()}/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:6}}>Password</label>
            <div style={{position:"relative"}}>
              <input className="input-field" type={showPw?"text":"password"} placeholder="Password" value={password} onChange={e=>{setPassword(e.target.value);setError("");}} onKeyDown={e=>e.key==="Enter"&&handle()} style={{paddingRight:48}}/>
              <button onClick={()=>setShowPw(p=>!p)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#9ca3af",fontSize:11,cursor:"pointer"}}>{showPw?"Hide":"Show"}</button>
            </div>
          </div>
          {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,padding:"9px 12px",fontSize:13,color:"#dc2626",marginBottom:16}}>{error}</div>}
          <button className="btn-primary" style={{width:"100%",justifyContent:"center",fontSize:14,padding:12}} disabled={busy} onClick={handle}>{busy?"Signing in…":"Sign In"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function MainApp({user,profile}){
  const [showToast,toastEl]=useToast();
  const isAdmin=profile.role==="admin";

  const canPurchase=isAdmin||!!profile.can_purchase;
  // wo_access / inventory_access are new fields being retrofitted onto
  // existing accounts that have never had them set. Checking !==false (not
  // !!) means "undefined" (every existing user today) reads as granted —
  // nobody loses access on rollout. Only an explicit, deliberate toggle-off
  // takes it away. New users created going forward default this toggle to
  // off in the Add User form, so it's opt-in for them as intended.
  const canWO=isAdmin||profile.wo_access!==false;
  const canTender=isAdmin||profile.role==="sales";
  const canEnquiry=isAdmin||profile.role==="sales";
  const canInventory=isAdmin||profile.inventory_access!==false;
  const canDispatch=isAdmin||["sales"].includes(profile.role)||profile.dispatch_access!==false;

  const TABS=[
    ...(canEnquiry?[{id:"enquiry",label:"Enquiry"}]:[]),
    ...(canTender?[{id:"tender",label:"Tender"}]:[]),
    ...(canWO?[{id:"dashboard",label:"Work Orders"}]:[]),
    ...(canPurchase?[{id:"purchase",label:"Purchase"}]:[]),
    ...(canInventory?[{id:"inventory",label:"Inventory"}]:[]),
    ...(canDispatch?[{id:"dispatch",label:"Dispatch"}]:[]),
    ...(isAdmin?[{id:"admin",label:"Admin"}]:[]),
  ];

  // Default landing tab: first one this profile actually has access to. No
  // hardcoded fallback string here — if TABS is genuinely empty (a user with
  // every access flag off), tab stays undefined and every check below falls
  // through to nothing rendered, rather than assuming any specific tab
  // (dispatch included) is always safe to land on.
  const [tab,setTab]=useState(()=>TABS[0]?.id);

  const isMobile=useIsMobile();
  const shellWidth=isMobile?"100%":900;
  const shellPadding=isMobile?"0 12px":"0 20px";

  return(
    <div style={{background:"#f4f6f9",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #e5e7eb",position:"sticky",top:0,zIndex:200}}>
        <div style={{maxWidth:shellWidth,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",rowGap:8,minHeight:56,padding:isMobile?"10px 12px":"0 20px",transition:"max-width .15s",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
            <img src={COMPANY_LOGO_DATA_URI} alt="Mahendra Industries" style={{height:isMobile?24:28,flexShrink:0}}/>
            <span style={{...S,fontSize:isMobile?14:18,fontWeight:700,color:"#e8c547",letterSpacing:".06em",flexShrink:0}}>PRODTRACK</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:isMobile?8:12,flexShrink:0}}>
            <span style={{fontSize:12,color:"#6b7280",whiteSpace:"nowrap"}}>{profile.name||user.email}</span>
            <span style={{...S,background:`${ROLE_COLORS[profile.role]}18`,color:ROLE_COLORS[profile.role],padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>{ROLE_LABELS[profile.role]||profile.role}</span>
            <button className="btn-ghost" style={{padding:"6px 10px",fontSize:12,flexShrink:0,whiteSpace:"nowrap"}} onClick={()=>signOut(auth)}><Icon name="logout" size={13}/>Sign out</button>
          </div>
        </div>
        {/* Nav tabs — horizontally scrollable so every tab stays reachable on a narrow screen */}
        <div style={{maxWidth:shellWidth,margin:"0 auto",padding:shellPadding,display:"flex",gap:0,borderTop:"1px solid #f3f4f6",transition:"max-width .15s",overflowX:"auto",WebkitOverflowScrolling:"touch",scrollbarWidth:"none"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:isMobile?"10px 14px":"10px 18px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:tab===t.id?600:400,color:tab===t.id?"#1a1f2e":"#6b7280",borderBottom:tab===t.id?"2px solid #e8c547":"2px solid transparent",transition:"all .15s",fontFamily:"'Roboto',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:shellWidth,margin:"0 auto",padding:isMobile?"20px 12px":"28px 20px",transition:"max-width .15s"}}>
        {tab==="dashboard"    && (canWO?<DashboardTab profile={profile} showToast={showToast} onNavigate={setTab}/>:<AccessDenied/>)}
        {tab==="tender"       && (canTender?<TenderTab profile={profile} showToast={showToast}/>:<AccessDenied/>)}
        {tab==="enquiry"      && (canEnquiry?<EnquiryTab profile={profile} showToast={showToast}/>:<AccessDenied/>)}
        {tab==="purchase"     && (canPurchase?<PurchaseTab profile={profile} showToast={showToast}/>:<AccessDenied/>)}
        {tab==="inventory"    && (canInventory?<InventoryTab profile={profile} showToast={showToast}/>:<AccessDenied/>)}
        {tab==="dispatch"     && (canDispatch?<DispatchTab profile={profile} showToast={showToast}/>:<AccessDenied/>)}
        {tab==="admin"        && (isAdmin?<AdminTab showToast={showToast}/>:<AccessDenied/>)}
        {!tab && <AccessDenied/>}
      </div>
      {toastEl}
    </div>
  );
}


// ─── Dashboard / Work Orders Tab (merged) ─────────────────────────────────────
function DashboardTab({profile,showToast,onNavigate}){
  const [orders,setOrders]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [quickFilter,setQuickFilter]=useState("all");
  const [expandedId,setExpandedId]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const [creatingNew,setCreatingNew]=useState(false);
  // Holds a stripped-down copy of a source WO's shared fields (material,
  // conductor type, insulation, customer, PO number, spool type, remarks) —
  // dimensions/qty/dates/status/stage are deliberately left out so the new
  // order starts fresh, per the "copy for a different size" request. Not an
  // edit target — OrderForm's isEdit checks existing.id, which this lacks.
  const [copySeed,setCopySeed]=useState(null);
  const isAdmin=profile.role==="admin";
  // Create/edit the full order (New Order button, per-row Edit, Edit order in
  // the stage panel) — Production is deliberately excluded from this one,
  // no matter what their wo_access flag says.
  const canEditOrder=isAdmin||(profile.role!=="production"&&profile.wo_access!==false);
  // Advance stage progress (mark a stage complete) — this is the part
  // Production needs day-to-day, so they always have it regardless of
  // wo_access; other roles follow the usual flag.
  const canAdvance=isAdmin||profile.role==="production"||profile.wo_access!==false;
  const canUpdate=canEditOrder; // kept for anything still reading the old name

  useEffect(()=>{
    const q=query(collection(db,"work_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setOrders(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),snap=>setMaterials(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  const now=new Date();
  const weekEnd=new Date(now); weekEnd.setDate(now.getDate()+7);
  const active     =orders.filter(o=>o.status==="in_progress"||o.status==="on_hold");
  const overdueList=orders.filter(o=>isOverdue(o.delivery_date)&&o.status!=="dispatched"&&o.status!=="cancelled");
  const dueThisWeek=orders.filter(o=>{if(!o.delivery_date||o.status==="dispatched"||o.status==="cancelled")return false;const d=new Date(o.delivery_date);return d>=now&&d<=weekEnd;});
  const readyDisp  =orders.filter(o=>o.status==="ready_dispatch");
  const dispatched =orders.filter(o=>o.status==="dispatched");
  const lowStock   =materials.filter(m=>m.current_stock<=(m.low_stock_threshold||0)&&m.low_stock_threshold>0);

  const stats=[
    {label:"Active",   value:active.length,      color:"#1a1f2e",  filter:"active"},
    {label:"WIP",      value:active.filter(o=>o.status==="in_progress").length, color:"#1d4ed8", filter:"in_progress"},
    {label:"On Hold",  value:orders.filter(o=>o.status==="on_hold").length, color:"#b45309", filter:"on_hold"},
    {label:"Overdue",  value:overdueList.length,  color:overdueList.length>0?"#dc2626":"#16a34a", filter:"overdue"},
    {label:"Due 7d",   value:dueThisWeek.length,  color:dueThisWeek.length>0?"#b45309":"#6b7280", filter:"due7d"},
    {label:"Ready",    value:readyDisp.length,    color:readyDisp.length>0?"#7c3aed":"#6b7280", filter:"ready_dispatch"},
    {label:"Dispatched",value:dispatched.length,  color:"#059669",  filter:"dispatched"},
    {label:"Low Stock",value:lowStock.length,     color:lowStock.length>0?"#dc2626":"#16a34a", nav:"inventory"},
  ];

  function matchesFilter(o){
    switch(quickFilter){
      case "all": return true;
      case "active": return o.status==="in_progress"||o.status==="on_hold";
      case "overdue": return isOverdue(o.delivery_date)&&o.status!=="dispatched"&&o.status!=="cancelled";
      case "due7d": { if(!o.delivery_date||o.status==="dispatched"||o.status==="cancelled")return false; const d=new Date(o.delivery_date); return d>=now&&d<=weekEnd; }
      default: return o.status===quickFilter;
    }
  }
  const filtered=orders.filter(matchesFilter);

  function toggleExpand(id){
    setExpandedId(prev=>prev===id?null:id);
    setEditingId(null);
  }
  function openEdit(id){setExpandedId(id);setEditingId(id);}
  // Only the fields that are genuinely shared across sizes of the same
  // order carry over — dimensions, quantity, packing qty, dates, and
  // status/stage are deliberately omitted so the copy starts as a true
  // fresh order (own WO number, own stock deduction, stage 0).
  function copyOrder(o){
    setCopySeed({
      material:o.material,conductor_type:o.conductor_type,product_type:o.product_type,
      insulation:o.insulation,spool_type:o.spool_type,po_number:o.po_number,
      customer_name:o.customer_name,remarks:o.remarks,
    });
  }

  if(creatingNew||copySeed)return<OrderForm profile={profile} existing={copySeed} showToast={showToast} onClose={()=>{setCreatingNew(false);setCopySeed(null);}}/>;

  return(
    <div>
      {/* Header row */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"baseline",gap:10}}>
          <span style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Work Orders</span>
          <span style={{fontSize:12,color:"#9ca3af"}}>{now.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</span>
        </div>
        {canUpdate&&(
          <button className="btn-primary" style={{fontSize:12,padding:"6px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New Order</button>
        )}
      </div>

      {/* Compact stat bar — click to filter the list below, Low Stock jumps to Inventory */}
      <div style={{display:"flex",gap:0,background:"#fff",border:"1px solid #e5e7eb",borderRadius:10,marginBottom:16,overflow:"hidden"}}>
        {stats.map((s,i)=>{
          const isActive=!s.nav&&quickFilter===s.filter;
          const isAlert=(s.label==="Overdue"||s.label==="Low Stock")&&s.value>0;
          return(
            <div key={s.label} onClick={()=>s.nav?onNavigate(s.nav):setQuickFilter(s.filter)} style={{flex:1,padding:"10px 0",textAlign:"center",cursor:"pointer",borderRight:i<stats.length-1?"1px solid #f3f4f6":undefined,background:isAlert?"#fef2f2":(isActive?"#f9fafb":"#fff"),transition:"background .12s"}}
              onMouseEnter={e=>e.currentTarget.style.background=isAlert?"#fee2e2":"#f9fafb"}
              onMouseLeave={e=>e.currentTarget.style.background=isAlert?"#fef2f2":(isActive?"#f9fafb":"#fff")}>
              <div style={{...S,fontSize:18,fontWeight:700,color:s.color,lineHeight:1}}>{s.value}</div>
              <div style={{fontSize:10,color:isAlert?"#991b1b":(isActive?"#1a1f2e":"#9ca3af"),marginTop:3,whiteSpace:"nowrap",fontWeight:isActive||isAlert?600:400}}>{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Overdue alert strip */}
      {overdueList.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10,fontSize:12}}>
          <span style={{color:"#dc2626",fontWeight:600}}>⚠ {overdueList.length} overdue:</span>
          <span style={{color:"#374151"}}>{overdueList.slice(0,4).map(o=>`${o.wo_number} (${o.customer_name})`).join(" · ")}{overdueList.length>4?` +${overdueList.length-4} more`:""}</span>
          <span style={{marginLeft:"auto",color:"#dc2626",cursor:"pointer",fontWeight:500,whiteSpace:"nowrap"}} onClick={()=>setQuickFilter("overdue")}>View all →</span>
        </div>
      )}

      {/* Filter chips */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        {[["all","All"],["active","Active"],["in_progress","In Progress"],["on_hold","On Hold"],["overdue","Overdue"],["due7d","Due 7d"],["ready_dispatch","Ready"],["dispatched","Dispatched"]].map(([v,l])=>(
          <button key={v} onClick={()=>setQuickFilter(v)} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${quickFilter===v?"#1a1f2e":"#d1d5db"}`,background:quickFilter===v?"#1a1f2e":"#fff",color:quickFilter===v?"#fff":"#6b7280",fontSize:12,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
      </div>

      <div style={{fontSize:11,color:"#9ca3af",marginBottom:8}}>{filtered.length} of {orders.length} order{orders.length!==1?"s":""}</div>

      {filtered.length===0
        ? <EmptyState text="No work orders" sub={canUpdate?"Click 'New Order' to create one":undefined}/>
        : filtered.map(o=>(
          <OrderListItem
            key={o.id}
            order={o}
            profile={profile}
            showToast={showToast}
            isAdmin={isAdmin}
            canUpdate={canUpdate}
            canAdvance={canAdvance}
            expanded={expandedId===o.id}
            editing={editingId===o.id}
            onToggle={()=>toggleExpand(o.id)}
            onQuickEdit={()=>openEdit(o.id)}
            onCopy={()=>copyOrder(o)}
            onEditClick={()=>setEditingId(o.id)}
            onCancelEdit={()=>setEditingId(null)}
            onDelete={async()=>{if(window.confirm(`Delete ${o.wo_number}? This cannot be undone.`)){await deleteDoc(doc(db,"work_orders",o.id));showToast(`${o.wo_number} deleted`);}}}
          />
        ))
      }
    </div>
  );
}

// ─── Order list item — click to expand inline (stage view or edit form) ───────
function OrderListItem({order,profile,showToast,isAdmin,canUpdate,canAdvance,expanded,editing,onToggle,onQuickEdit,onCopy,onEditClick,onCancelEdit,onDelete}){
  const overdue=isOverdue(order.delivery_date)&&order.status!=="dispatched";
  const progress=stageProgress(order.current_stage,order.product_type);
  const statusColors={in_progress:{bg:"#eff6ff",c:"#1d4ed8"},ready_dispatch:{bg:"#f0fdf4",c:"#16a34a"},dispatched:{bg:"#f3f4f6",c:"#6b7280"},on_hold:{bg:"#fffbeb",c:"#b45309"},cancelled:{bg:"#fef2f2",c:"#dc2626"}};
  const sc=statusColors[order.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const dims=order.conductor_type==="conductor"
    ?`${order.dimensions?.width}×${order.dimensions?.thickness}mm${order.dimensions?.cornerRadius?` R${order.dimensions.cornerRadius}`:""}`
    :`Ø${order.dimensions?.diameter}mm`;
  const insLabels=order.insulation?.map(ins=>`${ins.scheme}·${ins.tempIndex}`).join("  ");
  return(
    <div className="card animate-in" style={{padding:0,marginBottom:8,borderLeft:overdue?"3px solid #dc2626":"3px solid transparent",overflow:"hidden"}}>
      <div onClick={onToggle} style={{padding:"14px 18px",cursor:"pointer"}}
        onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

        {/* Row 1: WO# + badges + Edit + chevron */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          <span style={{...S,fontSize:13,fontWeight:700,color:"#1a1f2e",flexShrink:0}}>{order.wo_number}</span>
          <span style={{...S,background:order.material==="copper"?"#fffbeb":"#eff6ff",color:order.material==="copper"?"#92400e":"#1e3a5f",padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600,flexShrink:0}}>{order.material}</span>
          <span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600,textTransform:"capitalize",flexShrink:0}}>{(order.status||"").replace(/_/g," ")}</span>
          {overdue&&<span className="badge badge-danger" style={{flexShrink:0}}>Overdue</span>}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
            {canUpdate&&<button className="btn-ghost" style={{padding:"3px 8px",fontSize:11}} onClick={e=>{e.stopPropagation();onQuickEdit();}}><Icon name="edit" size={11}/>Edit</button>}
            {canUpdate&&<button className="btn-ghost" style={{padding:"3px 8px",fontSize:11}} onClick={e=>{e.stopPropagation();onCopy();}} title="Copy — same details, new size"><Icon name="clipboard" size={11}/>Copy</button>}
            {canUpdate&&<button className="btn-ghost" style={{padding:"3px 8px",fontSize:11}} onClick={e=>{e.stopPropagation();printWorkOrder(order);}} title="Print work order"><Icon name="printer" size={11}/>Print</button>}
            {isAdmin&&<button className="btn-ghost" style={{padding:"3px 8px",fontSize:11,color:"#dc2626"}} onClick={e=>{e.stopPropagation();onDelete();}} title="Delete order">✕</button>}
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" style={{transform:expanded?"rotate(90deg)":"none",transition:"transform .15s"}}><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>

        {/* Row 2: key details inline */}
        <div style={{display:"flex",alignItems:"baseline",gap:0,flexWrap:"wrap",fontSize:13,marginBottom:8}}>
          <span style={{fontWeight:600,color:"#1a1f2e",marginRight:12}}>{insLabels||"—"}</span>
          <span style={{...S,fontSize:11,color:"#6b7280",marginRight:12}}>{order.customer_name}</span>
          <span style={{...S,fontSize:11,color:"#374151",marginRight:12}}>{dims}</span>
          <span style={{...S,fontSize:11,color:"#374151",marginRight:12}}>{order.quantity} {order.quantity_unit}</span>
          {order.packing_qty&&<span style={{fontSize:11,color:"#6b7280",marginRight:12}}>Pack: {order.packing_qty} {order.quantity_unit}</span>}
          {order.spool_type&&<span style={{fontSize:11,color:"#6b7280"}}>Spool: {order.spool_type}</span>}
        </div>

        {/* Row 3: stage progress bar */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
          <span style={{fontSize:11,color:"#6b7280",flexShrink:0,minWidth:140}}>{order.current_stage||"Not started"}</span>
          <div style={{flex:1,height:3,background:"#f3f4f6",borderRadius:4,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${progress}%`,background:progress===100?"#16a34a":"#e8c547",borderRadius:4,transition:"width .3s"}}/>
          </div>
          <span style={{...S,fontSize:11,color:"#9ca3af",flexShrink:0}}>{progress}%</span>
        </div>

        {/* Row 4: delivery + type */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:overdue?"#dc2626":"#9ca3af",display:"flex",alignItems:"center",gap:4}}>
            <Icon name="calendar" size={11}/>{formatDate(order.delivery_date)}
          </span>
          <span style={{...S,fontSize:10,color:"#9ca3af"}}>{order.conductor_type==="conductor"?"Rect. strip":"Round wire"}</span>
        </div>
      </div>

      {/* Expanded inline panel — stage view, or edit form when editing */}
      {expanded&&(
        <div style={{borderTop:"1px solid #f3f4f6",padding:20,background:"#fafbfc"}} onClick={e=>e.stopPropagation()}>
          {editing
            ? <OrderForm profile={profile} existing={order} showToast={showToast} onClose={onCancelEdit}/>
            : <InlineStagePanel order={order} profile={profile} showToast={showToast} canUpdate={canAdvance} onEdit={canUpdate?onEditClick:null}/>
          }
        </div>
      )}
    </div>
  );
}


// ─── Order Form ───────────────────────────────────────────────────────────────
function OrderForm({profile,existing,showToast,onClose,onSaved}){
  const isEdit=!!existing?.id;
  const [material,setMaterial]=useState(existing?.material||"copper");
  const [conductorType,setConductorType]=useState(existing?.conductor_type||"conductor");
  const [productType,setProductType]=useState(existing?.product_type||"conductor");
  const [dims,setDims]=useState(existing?.dimensions||{});
  const [insulation,setInsulation]=useState(existing?.insulation||[{scheme:"",thermal:"",tempIndex:"",covering:"",spec:"",rawMaterial:"",qtyUsed:""}]);
  const [allMaterials,setAllMaterials]=useState([]);
  const insulationMaterials=allMaterials.filter(m=>["Varnish","Insulation"].includes(m.category));
  const baseMaterials=allMaterials.filter(m=>["Copper","Aluminium"].includes(m.category));
  const [qty,setQty]=useState(existing?.quantity||"");
  const [qtyUnit,setQtyUnit]=useState(existing?.quantity_unit||"kg");
  const [packQty,setPackQty]=useState(existing?.packing_qty||"");
  const [spoolType,setSpoolType]=useState(existing?.spool_type||"");
  const [poNumber,setPoNumber]=useState(existing?.po_number||"");
  const [customer,setCustomer]=useState(existing?.customer_name||"");
  const [customerMaster,setCustomerMaster]=useState([]);
  useEffect(()=>onSnapshot(collection(db,"customer_master"),snap=>setCustomerMaster(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);
  const [poDate,setPoDate]=useState(existing?.po_date||existing?.receipt_date||"");
  const [deliveryDate,setDeliveryDate]=useState(existing?.delivery_date||"");
  const [remarks,setRemarks]=useState(existing?.remarks||"");
  const [saving,setSaving]=useState(false);
  const [errors,setErrors]=useState([]);

  useEffect(()=>{
    return onSnapshot(collection(db,"rm_inventory"),snap=>{
      setAllMaterials(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
  },[]);

  const fieldStyle={background:"#fff",border:"1px solid #d1d5db",borderRadius:8,padding:"9px 13px",color:"#1a1f2e",fontSize:13,width:"100%",outline:"none",transition:"border .15s"};
  const labelStyle={fontSize:12,color:"#6b7280",display:"block",marginBottom:6};

  function updateDim(k,v){setDims(d=>({...d,[k]:v}));}
  function addIns(){setInsulation(i=>[...i,{scheme:"",thermal:"",tempIndex:"",covering:"",spec:"",rawMaterial:"",qtyUsed:""}]);}
  function removeIns(i){setInsulation(ins=>ins.filter((_,idx)=>idx!==i));}
  function updateIns(i,k,v){setInsulation(ins=>ins.map((r,idx)=>idx===i?{...r,[k]:v}:r));}

  async function handleSave(){
    const errs=[];
    if(conductorType==="conductor"){if(!dims.width)errs.push("Width");if(!dims.thickness)errs.push("Thickness");}
    else{if(!dims.diameter)errs.push("Diameter");}
    if(!insulation.length)errs.push("At least one insulation layer");
    if(insulation.some(r=>!r.scheme))errs.push("Insulation scheme on all layers");
    if(insulation.some(r=>!r.thermal))errs.push("Thermal class on all layers");
    if(insulation.some(r=>!r.tempIndex))errs.push("Temp index on all layers");
    if(insulation.some(r=>!r.covering))errs.push("Covering (mm) on all layers");
    if(!qty)errs.push("Quantity");
    if(!poNumber)errs.push("PO number");
    if(!customer)errs.push("Customer name");
    if(!deliveryDate)errs.push("Delivery date");
    if(errs.length){setErrors(errs);return;}
    setSaving(true);
    try{
      const stages=stagesFor(productType);
      const payload={material,conductor_type:conductorType,product_type:productType,dimensions:dims,insulation,quantity:parseFloat(qty),quantity_unit:qtyUnit,packing_qty:packQty?parseFloat(packQty):null,spool_type:spoolType||null,po_number:poNumber,customer_name:customer,po_date:poDate||null,delivery_date:deliveryDate,remarks:remarks||null,status:existing?.status||"in_progress",current_stage:existing?.current_stage||stages[0],stage_index:existing?.stage_index??0};
      if(isEdit){
        await updateDoc(doc(db,"work_orders",existing.id),{...payload,updated_at:serverTimestamp()});
        showToast("Work order updated");
      }else{
        const woNumber=await generateWONumber();
        const woRef=doc(collection(db,"work_orders"));

        // Stock consumed by this WO: the base metal (Copper/Aluminium) at the
        // order quantity, plus whatever Quantity Used was entered on each
        // insulation layer. Deducted once, at creation, in the same
        // transaction as the WO write so the two can never go out of sync.
        const deductions=[];
        const baseMat=baseMaterials.find(m=>m.category?.toLowerCase()===material);
        if(baseMat&&qty)deductions.push({id:baseMat.id,name:baseMat.material_name,unit:baseMat.unit,qtyUsed:parseFloat(qty)});
        insulation.forEach(ins=>{
          if(ins.rawMaterial&&ins.qtyUsed){
            const im=insulationMaterials.find(m=>m.material_name===ins.rawMaterial);
            if(im)deductions.push({id:im.id,name:im.material_name,unit:im.unit,qtyUsed:parseFloat(ins.qtyUsed)});
          }
        });

        await runTransaction(db,async tx=>{
          const matSnaps=await Promise.all(deductions.map(d=>tx.get(doc(db,"rm_inventory",d.id))));
          matSnaps.forEach((snap,idx)=>{
            const d=deductions[idx];
            const current=snap.exists()?(snap.data().current_stock||0):0;
            d.newStock=Math.round((current-d.qtyUsed)*100)/100;
            tx.update(doc(db,"rm_inventory",d.id),{current_stock:d.newStock,updated_at:serverTimestamp()});
          });
          tx.set(woRef,{...payload,wo_number:woNumber,created_by:auth.currentUser.uid,created_at:serverTimestamp()});
        });

        showToast("Work order created");
        if(onSaved)onSaved({id:woRef.id,wo_number:woNumber});
        const negatives=deductions.filter(d=>d.newStock<0);
        if(negatives.length>0){
          showToast(`⚠ Stock now negative: ${negatives.map(d=>`${d.name} (${d.newStock} ${d.unit})`).join(", ")}`,"error");
        }
      }
      onClose();
    }catch(e){setErrors([`Save failed: ${e.message}`]);}
    finally{setSaving(false);}
  }

  const segStyle=(active)=>({padding:"8px 0",border:"none",background:active?"#fff":"#f3f4f6",color:active?"#1a1f2e":"#6b7280",fontWeight:active?600:400,cursor:"pointer",fontSize:13,fontFamily:"'Roboto',sans-serif",transition:"all .12s",flex:1});

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <SectionHeader mono="Work Orders" title={isEdit?"Edit Work Order":"New Work Order"}/>
      </div>

      {/* WO number preview */}
      {!isEdit&&<div style={{...S,display:"inline-flex",alignItems:"center",gap:8,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"6px 14px",fontSize:12,color:"#1d4ed8",marginBottom:20}}>Auto-generated WO / {getFY()} / 00X on save</div>}
      {isEdit&&<div style={{...S,display:"inline-flex",alignItems:"center",gap:8,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"6px 14px",fontSize:12,color:"#92400e",marginBottom:20}}>{existing.wo_number}</div>}

      {/* Material */}
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Material</div>
        <div style={{display:"flex",background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden"}}>
          {["copper","aluminium"].map(m=><button key={m} style={segStyle(material===m)} onClick={()=>setMaterial(m)}>{m.charAt(0).toUpperCase()+m.slice(1)}</button>)}
        </div>
        {(()=>{
          const selBase=baseMaterials.find(m=>m.category?.toLowerCase()===material);
          return selBase?<div style={{fontSize:11,color:"#9ca3af",marginTop:8}}>Current stock: {selBase.current_stock??0} {selBase.unit} — Quantity below will be deducted on save</div>:null;
        })()}
      </div>

      {/* Conductor type */}
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Conductor type</div>
        <div style={{display:"flex",background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden",marginBottom:14}}>
          {[["conductor","Rectangular strip"],["wire","Round wire"]].map(([v,l])=><button key={v} style={segStyle(conductorType===v)} onClick={()=>{setConductorType(v);if(v==="wire")setProductType("wire");}}>{l}</button>)}
        </div>

        {conductorType==="conductor"&&(
          <>
            <div style={{display:"flex",background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden",marginBottom:14}}>
              {[["conductor","Conductor / Strip"],["coil","Coil / Stator"]].map(([v,l])=><button key={v} style={segStyle(productType===v)} onClick={()=>setProductType(v)}>{l}</button>)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              {[["Width (mm)","width"],["Thickness (mm)","thickness"],["Corner R (mm)","cornerRadius"]].map(([label,key])=>(
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input style={fieldStyle} type="number" min="0" step="0.01" placeholder="0.00" value={dims[key]||""} onChange={e=>updateDim(key,e.target.value)}/>
                </div>
              ))}
            </div>
            {dims.width&&dims.thickness&&<div style={{...S,fontSize:11,color:"#6b7280",marginTop:8}}>{dims.width} × {dims.thickness} mm{dims.cornerRadius?`, R${dims.cornerRadius}`:""}</div>}
          </>
        )}
        {conductorType==="wire"&&(
          <div style={{maxWidth:200}}>
            <label style={labelStyle}>Diameter (mm)</label>
            <input style={fieldStyle} type="number" min="0" step="0.01" placeholder="0.00" value={dims.diameter||""} onChange={e=>updateDim("diameter",e.target.value)}/>
          </div>
        )}
      </div>

      {/* Insulation */}
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:16}}>Insulation scheme</div>
        {insulation.map((ins,i)=>(
          <div key={i} style={{borderTop:i>0?"1px solid #f3f4f6":undefined,paddingTop:i>0?16:0,marginTop:i>0?16:0}}>
            {insulation.length>1&&(
              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
                <button className="btn-danger" style={{padding:"3px 8px",fontSize:11}} onClick={()=>removeIns(i)}><Icon name="x" size={11}/>Remove</button>
              </div>
            )}
            {insulationMaterials.length>0&&(
              <div style={{marginBottom:12}}>
                <label style={labelStyle}>Raw material</label>
                <select style={fieldStyle} value={ins.rawMaterial} onChange={e=>updateIns(i,"rawMaterial",e.target.value)}>
                  <option value="">— Select —</option>
                  {insulationMaterials.map(m=><option key={m.id} value={m.material_name}>{m.material_name}</option>)}
                </select>
                {ins.rawMaterial&&(()=>{
                  const selMat=insulationMaterials.find(m=>m.material_name===ins.rawMaterial);
                  return(
                    <div style={{marginTop:10}}>
                      <label style={labelStyle}>Quantity used ({selMat?.unit||"units"})</label>
                      <input style={fieldStyle} type="number" min="0" step="0.01" placeholder="0.00" value={ins.qtyUsed} onChange={e=>updateIns(i,"qtyUsed",e.target.value)}/>
                      <div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>Current stock: {selMat?.current_stock??0} {selMat?.unit}</div>
                    </div>
                  );
                })()}
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
              <div>
                <label style={labelStyle}>Insulation scheme</label>
                <select style={fieldStyle} value={ins.scheme} onChange={e=>updateIns(i,"scheme",e.target.value)}>
                  <option value="">— Select —</option>
                  {INSULATION_SCHEMES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Thermal class</label>
                <select style={fieldStyle} value={ins.thermal} onChange={e=>updateIns(i,"thermal",e.target.value)}>
                  <option value="">— Select —</option>
                  {THERMAL_CLASSES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Temp index</label>
                <select style={fieldStyle} value={ins.tempIndex} onChange={e=>updateIns(i,"tempIndex",e.target.value)}>
                  <option value="">— Select —</option>
                  {TEMP_INDEX_LIST.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Covering (mm)</label>
                <input style={fieldStyle} type="number" min="0" step="0.001" placeholder="e.g. 0.250" value={ins.covering} onChange={e=>updateIns(i,"covering",e.target.value)}/>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Specification reference</label>
              <input style={fieldStyle} type="text" placeholder="e.g. IS 13730 / IEC 60317" value={ins.spec} onChange={e=>updateIns(i,"spec",e.target.value)}/>
            </div>
          </div>
        ))}
        <button className="btn-ghost" style={{padding:"6px 14px",fontSize:12,marginTop:16,borderStyle:"dashed"}} onClick={addIns}><Icon name="plus" size={12}/>Add insulation layer</button>
      </div>

      {/* Order details */}
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:16}}>Order details</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Quantity</label>
            <div style={{display:"flex"}}>
              <input style={{...fieldStyle,borderRadius:"8px 0 0 8px",borderRight:"none"}} type="number" min="0" step="0.1" placeholder="0" value={qty} onChange={e=>setQty(e.target.value)}/>
              <select value={qtyUnit} onChange={e=>setQtyUnit(e.target.value)} style={{...fieldStyle,width:"auto",borderRadius:"0 8px 8px 0",minWidth:64}}>
                <option>kg</option><option>m</option><option>nos</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Packing qty ({qtyUnit})</label>
            <input style={fieldStyle} type="number" min="0" step="0.1" placeholder="0" value={packQty} onChange={e=>setPackQty(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Spool type</label>
            <input style={fieldStyle} type="text" placeholder="e.g. PT-100, wooden bobbin" value={spoolType} onChange={e=>setSpoolType(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>PO number</label>
            <input style={{...fieldStyle,...S}} type="text" placeholder="Customer PO ref" value={poNumber} onChange={e=>setPoNumber(e.target.value)}/>
          </div>
        </div>
        <div style={{marginBottom:14}}>
          <FuzzyAutocomplete label="Customer name" value={customer} onChange={setCustomer} options={customerMaster} displayKey="name" placeholder="Party name"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>PO date</label>
            <input style={fieldStyle} type="date" value={poDate} onChange={e=>setPoDate(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Delivery date</label>
            <input style={fieldStyle} type="date" value={deliveryDate} onChange={e=>setDeliveryDate(e.target.value)}/>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{...fieldStyle,minHeight:72,resize:"vertical"}} placeholder="Any additional notes..." value={remarks} onChange={e=>setRemarks(e.target.value)}/>
        </div>
      </div>

      {errors.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#dc2626"}}>
          <strong>Please fix the following:</strong>
          <ul style={{marginTop:6,paddingLeft:18}}>{errors.map((e,i)=><li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={handleSave}><Icon name="check" size={14}/>{saving?"Saving…":isEdit?"Update Order":"Save Work Order"}</button>
      </div>
    </div>
  );
}


function InlineStagePanel({order,profile,showToast,canUpdate,onEdit}){
  const stages=stagesFor(order.product_type);
  const [saving,setSaving]=useState(false);
  const [remarks,setRemarks]=useState("");
  const [scrapQty,setScrapQty]=useState("");
  const currentIdx=order.stage_index??0;
  const history=order.stage_history||[];
  const unit=order.quantity_unit||"kg";
  const totalScrap=history.reduce((sum,h)=>sum+(parseFloat(h.scrap_qty)||0),0);

  async function advance(){
    const nextIdx=currentIdx+1;if(nextIdx>=stages.length)return;
    if(scrapQty===""||isNaN(parseFloat(scrapQty))||parseFloat(scrapQty)<0){showToast("Scrap generated is required","error");return;}
    setSaving(true);
    try{
      const nextStage=stages[nextIdx];
      const isLast=nextIdx===stages.length-1;
      const completedDate=new Date().toISOString().split("T")[0];
      const historyEntry={stage:order.current_stage||stages[currentIdx],scrap_qty:parseFloat(scrapQty),scrap_unit:unit,completed_date:completedDate,remarks:remarks||null,operator_name:profile.name||auth.currentUser.email};
      await updateDoc(doc(db,"work_orders",order.id),{current_stage:nextStage,stage_index:nextIdx,status:isLast?"ready_dispatch":"in_progress",updated_at:serverTimestamp(),stage_history:arrayUnion(historyEntry)});
      await addDoc(collection(db,"stage_logs"),{wo_id:order.id,wo_number:order.wo_number,stage:nextStage,status:"completed",operator_uid:auth.currentUser.uid,operator_name:profile.name||auth.currentUser.email,remarks:remarks||null,timestamp:serverTimestamp()});
      showToast(`Stage updated: ${nextStage}`);
      setRemarks("");
      setScrapQty("");
    }catch(e){showToast("Update failed: "+e.message,"error");}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div className="card animate-in" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[["Customer",order.customer_name],["Material",order.material],["Dimensions",order.conductor_type==="conductor"?`${order.dimensions?.width} × ${order.dimensions?.thickness} mm`:`Ø ${order.dimensions?.diameter} mm`],["Delivery",formatDate(order.delivery_date)],["Specification No.",order.insulation?.map(ins=>ins.spec).filter(Boolean).join(", ")||"—"],["PO Date",(order.po_date||order.receipt_date)?formatDate(order.po_date||order.receipt_date):"—"]].map(([k,v])=>(
            <div key={k}><div style={{fontSize:11,color:"#9ca3af",marginBottom:2}}>{k}</div><div style={{fontSize:13,fontWeight:500}}>{v}</div></div>
          ))}
        </div>
      </div>

      <div className="card animate-in" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>Stage progress</span>
          {history.length>0&&<span style={{...S,fontSize:11,color:"#374151",textTransform:"none",letterSpacing:0}}>Total scrap so far: {totalScrap} {unit}</span>}
        </div>
        {stages.map((s,i)=>{
          const done=i<currentIdx,current=i===currentIdx,next=i===currentIdx+1;
          const hist=history.find(h=>h.stage===s);
          return(
            <div key={s} style={{display:"flex",alignItems:"center",gap:14,padding:"10px 0",borderBottom:i<stages.length-1?"1px solid #f3f4f6":undefined}}>
              <div style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:done?"#f0fdf4":current?"#e8c547":"#f3f4f6",border:next?"2px dashed #d1d5db":"none"}}>
                {done&&<Icon name="check" size={13}/>}
                {!done&&<span style={{...S,fontSize:11,fontWeight:700,color:current?"#1a1f2e":"#9ca3af"}}>{i+1}</span>}
              </div>
              <span style={{fontSize:14,fontWeight:current?600:400,color:done?"#9ca3af":"#1a1f2e"}}>{s}</span>
              {current&&<span className="badge badge-gold" style={{marginLeft:"auto"}}>Current</span>}
              {done&&(
                <span style={{marginLeft:"auto",textAlign:"right"}}>
                  <span style={{...S,fontSize:10,color:"#16a34a",display:"block"}}>✓ Done{hist?.completed_date?` · ${formatDate(hist.completed_date)}`:""}</span>
                  {hist&&<span style={{fontSize:11,color:"#6b7280"}}>Scrap: {hist.scrap_qty} {hist.scrap_unit}</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {canUpdate&&currentIdx<stages.length-1&&(
        <div className="card animate-in" style={{padding:20,background:"#fff"}}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Complete current stage</div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:6}}>Scrap generated ({unit}) <span style={{color:"#dc2626"}}>*</span></label>
            <input type="number" min="0" step="0.01" style={{background:"#fff",border:"1px solid #d1d5db",borderRadius:8,padding:"9px 13px",fontSize:13,width:"100%",outline:"none"}} placeholder="0" value={scrapQty} onChange={e=>setScrapQty(e.target.value)}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:"#6b7280",display:"block",marginBottom:6}}>Remarks (optional)</label>
            <textarea style={{background:"#fff",border:"1px solid #d1d5db",borderRadius:8,padding:"9px 13px",fontSize:13,width:"100%",minHeight:72,resize:"vertical",outline:"none"}} placeholder="Notes for this stage..." value={remarks} onChange={e=>setRemarks(e.target.value)}/>
          </div>
          <button className="btn-primary" style={{width:"100%",justifyContent:"center"}} disabled={saving} onClick={advance}>
            <Icon name="check" size={14}/>{saving?"Updating…":`Mark complete → ${stages[currentIdx+1]}`}
          </button>
        </div>
      )}
      {currentIdx>=stages.length-1&&(
        <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:20,textAlign:"center",fontSize:14,fontWeight:600,color:"#16a34a"}}>
          ✓ Ready for dispatch
        </div>
      )}
    </div>
  );
}

// ─── Tender Tab ───────────────────────────────────────────────────────────────
// Simple manual-entry tracker for tenders — no numbering scheme, no approval
// workflow, no auto-fill. Every field is plain text/number/date, matching
// what was asked for "for now" — fields can be extended or made smarter
// (dropdowns, linked to WO, etc.) later without restructuring this tab.
function TenderTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canManage=isAdmin||profile.role==="sales";
  const [tenders,setTenders]=useState([]);
  const [showForm,setShowForm]=useState(false);
  const [editTender,setEditTender]=useState(null);
  const [viewTender,setViewTender]=useState(null);

  useEffect(()=>{
    const q=query(collection(db,"tenders"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setTenders(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  // Upcoming-only: due_date within the next 7 days and not already passed —
  // already-overdue tenders keep their existing red-text treatment in the
  // table row itself, this banner is specifically the heads-up warning.
  const now=new Date();now.setHours(0,0,0,0);
  const weekEnd=new Date(now);weekEnd.setDate(weekEnd.getDate()+7);
  const dueSoon=tenders.filter(t=>{
    if(!t.due_date)return false;
    const d=new Date(t.due_date);
    return d>=now&&d<=weekEnd;
  });

  async function removeTender(t){
    if(!window.confirm(`Delete tender ${t.tender_number||"(no number)"}? This cannot be undone.`))return;
    await deleteDoc(doc(db,"tenders",t.id));
    showToast("Tender deleted");
  }

  if(viewTender){
    return <TenderDetailView tender={viewTender} onBack={()=>setViewTender(null)}/>;
  }

  if(showForm||editTender){
    return <TenderForm existing={editTender} profile={profile} showToast={showToast} tenders={tenders} onClose={()=>{setShowForm(false);setEditTender(null);}}/>;
  }

  return(
    <div>
      <div style={{marginBottom:16}}><SectionHeader mono="Sales" title="Tender" sub="Tender tracking — manual entry"/></div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600}}>{tenders.length} tender{tenders.length!==1?"s":""}</div>
        {canManage&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setShowForm(true)}><Icon name="plus" size={12}/>New Tender</button>}
      </div>

      {dueSoon.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"8px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10,fontSize:12,flexWrap:"wrap"}}>
          <span style={{color:"#dc2626",fontWeight:600}}>⚠ {dueSoon.length} due within 7 days:</span>
          <span style={{color:"#374151"}}>{dueSoon.slice(0,4).map(t=>`${t.tender_number||"—"}${t.company?` (${t.company})`:""}`).join(" · ")}{dueSoon.length>4?` +${dueSoon.length-4} more`:""}</span>
        </div>
      )}

      {tenders.length===0
        ?<EmptyState text="No tenders yet" sub={canManage?"Click 'New Tender' to add one":undefined}/>
        :(
          <div className="card" style={{padding:0,overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{background:"#f3f4f6",borderBottom:"1px solid #e5e7eb"}}>
                {["Tender No","Tender Date","LOI No.","Spec. No.","Company","Size","Insulation Type","Quantity","UOM","Fabrication Rate","BME/Copper Price","Bid Due Date","Actions"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",color:"#6b7280",fontWeight:500,fontSize:11,whiteSpace:"nowrap",...S}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {tenders.map(t=>{
                  const overdue=isOverdue(t.due_date);
                  return(
                    <tr key={t.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td onClick={()=>setViewTender(t)} style={{padding:"10px 12px",...S,fontWeight:600,color:"#2563eb",cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                        onMouseEnter={e=>e.currentTarget.style.textDecorationColor="#2563eb"}
                        onMouseLeave={e=>e.currentTarget.style.textDecorationColor="transparent"}>
                        {t.tender_number||"—"}
                      </td>
                      <td style={{padding:"10px 12px",...S}}>{t.tender_date?formatDate(t.tender_date):"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{t.loi_no||"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{t.specification_number||"—"}</td>
                      <td style={{padding:"10px 12px"}}>{t.company||"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{t.size||"—"}</td>
                      <td style={{padding:"10px 12px"}}>{t.insulation_type||"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{t.quantity||"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{t.uom||"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{t.fabrication_rate||"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{t.bme_copper_price||"—"}</td>
                      <td style={{padding:"10px 12px",...S,color:overdue?"#dc2626":"#1a1f2e",fontWeight:overdue?600:400}}>{t.due_date?formatDate(t.due_date):"—"}{overdue&&" ⚠"}</td>
                      <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                        {canManage&&<>
                          <button className="btn-ghost" style={{padding:"3px 8px",fontSize:11,marginRight:6}} onClick={e=>{e.stopPropagation();setEditTender(t);}}><Icon name="edit" size={11}/>Edit</button>
                          <button className="btn-danger" style={{padding:"3px 8px",fontSize:11}} onClick={e=>{e.stopPropagation();removeTender(t);}}><Icon name="trash" size={11}/>Delete</button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

// ─── Tender read-only detail view ───────────────────────────────────────────
// Opened by clicking the Tender No cell — pure display, no inputs, no
// Update/Cancel/Delete. Editing still only happens via the row's own Edit
// button, which opens the existing TenderForm exactly as before.
function TenderDetailView({tender:t,onBack}){
  const overdue=isOverdue(t.due_date);
  const Field=({label,value})=>(
    <div>
      <div style={{fontSize:11,color:"#9ca3af",textTransform:"uppercase",letterSpacing:".04em",marginBottom:4}}>{label}</div>
      <div style={{fontSize:14,color:"#1a1f2e"}}>{value||"—"}</div>
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onBack}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>{t.tender_number||"Tender"}</div>
      </div>

      <div className="card" style={{padding:20}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20,marginBottom:20}}>
          <Field label="Tender Number" value={t.tender_number}/>
          <Field label="Tender Date" value={t.tender_date?formatDate(t.tender_date):null}/>
          <Field label="LOI No." value={t.loi_no}/>
          <Field label="Specification No." value={t.specification_number}/>
          <Field label="Company" value={t.company}/>
          <Field label="Size" value={t.size}/>
          <Field label="Insulation Type" value={t.insulation_type}/>
          <Field label="Quantity" value={t.quantity!=null?`${t.quantity}${t.uom?` ${t.uom}`:""}`:null}/>
          <Field label="Fabrication Rate" value={t.fabrication_rate}/>
          <Field label="BME/Copper Price" value={t.bme_copper_price}/>
          <Field label="Bid Due Date" value={t.due_date?<span style={{color:overdue?"#dc2626":"#1a1f2e",fontWeight:overdue?600:400}}>{formatDate(t.due_date)}{overdue&&" ⚠"}</span>:null}/>
        </div>
      </div>
    </div>
  );
}

function TenderForm({existing,profile,showToast,tenders,onClose}){
  const isEdit=!!existing;
  const [tenderNumber,setTenderNumber]=useState(existing?.tender_number||"");
  const [tenderDate,setTenderDate]=useState(existing?.tender_date||"");
  const [loiNo,setLoiNo]=useState(existing?.loi_no||"");
  const [specNumber,setSpecNumber]=useState(existing?.specification_number||"");
  const [company,setCompany]=useState(existing?.company||"");
  const [size,setSize]=useState(existing?.size||"");
  const [insulationType,setInsulationType]=useState(existing?.insulation_type||"");
  const [quantity,setQuantity]=useState(existing?.quantity||"");
  const [uom,setUom]=useState(existing?.uom||"");
  const [fabricationRate,setFabricationRate]=useState(existing?.fabrication_rate||"");
  const [bmeCopperPrice,setBmeCopperPrice]=useState(existing?.bme_copper_price||"");
  const [dueDate,setDueDate]=useState(existing?.due_date||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  // Real master list now available — replaces the earlier "grow from past
  // tenders" approach, since Admin can maintain an actual customer master.
  const [customerMaster,setCustomerMaster]=useState([]);
  useEffect(()=>onSnapshot(collection(db,"customer_master"),snap=>setCustomerMaster(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  async function save(){
    if(!tenderNumber.trim()){setError("Tender number is required");return;}
    setError("");setSaving(true);
    try{
      const payload={
        tender_number:tenderNumber.trim(),tender_date:tenderDate||null,loi_no:loiNo.trim()||null,
        specification_number:specNumber.trim()||null,company:company.trim()||null,size:size.trim()||null,
        insulation_type:insulationType||null,quantity:quantity||null,uom:uom||null,
        fabrication_rate:fabricationRate.trim()||null,bme_copper_price:bmeCopperPrice.trim()||null,due_date:dueDate||null,
        updated_at:serverTimestamp(),
      };
      if(isEdit){
        await updateDoc(doc(db,"tenders",existing.id),payload);
        showToast("Tender updated");
      }else{
        await addDoc(collection(db,"tenders"),{
          ...payload,created_by:profile.name||auth.currentUser.email,created_at:serverTimestamp(),
        });
        showToast("Tender created");
      }
      onClose();
    }catch(e){setError("Save failed: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>{isEdit?"Edit Tender":"New Tender"}</div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Tender number *</label>
            <input style={fieldStyle} value={tenderNumber} onChange={e=>setTenderNumber(e.target.value)} placeholder="e.g. TND-2026-014"/>
          </div>
          <div>
            <label style={labelStyle}>Tender date</label>
            <input style={fieldStyle} type="date" value={tenderDate} onChange={e=>setTenderDate(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>LOI No. <span style={{color:"#9ca3af",fontWeight:400}}>(optional)</span></label>
            <input style={fieldStyle} value={loiNo} onChange={e=>setLoiNo(e.target.value)} placeholder="e.g. LOI-2026-014"/>
          </div>
          <div>
            <label style={labelStyle}>Specification number</label>
            <input style={fieldStyle} value={specNumber} onChange={e=>setSpecNumber(e.target.value)} placeholder="e.g. IS 13730"/>
          </div>
          <div>
            <FuzzyAutocomplete label="Company" value={company} onChange={setCompany} options={customerMaster} displayKey="name" placeholder="Start typing…"/>
          </div>
          <div>
            <label style={labelStyle}>Size</label>
            <input style={fieldStyle} value={size} onChange={e=>setSize(e.target.value)} placeholder="e.g. 10x8mm"/>
          </div>
          <div>
            <label style={labelStyle}>Insulation type</label>
            <select style={fieldStyle} value={insulationType} onChange={e=>setInsulationType(e.target.value)}>
              <option value="">— Select —</option>
              {INSULATION_SCHEMES.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Quantity</label>
            <input style={fieldStyle} type="number" min="0" step="0.01" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="0"/>
          </div>
          <div>
            <label style={labelStyle}>UOM</label>
            <select style={fieldStyle} value={uom} onChange={e=>setUom(e.target.value)}>
              <option value="">— Select —</option>
              <option>kg</option><option>pcs</option><option>mtr</option><option>ltr</option><option>rolls</option><option>nos</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Fabrication rate</label>
            <input style={fieldStyle} value={fabricationRate} onChange={e=>setFabricationRate(e.target.value)} placeholder="Fabrication rate"/>
          </div>
          <div>
            <label style={labelStyle}>BME/Copper price <span style={{color:"#9ca3af",fontWeight:400}}>(considered for bid)</span></label>
            <input style={fieldStyle} value={bmeCopperPrice} onChange={e=>setBmeCopperPrice(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Bid due date</label>
            <input style={fieldStyle} type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/>
          </div>
        </div>
      </div>

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626"}}>{error}</div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}><Icon name="check" size={14}/>{saving?"Saving…":isEdit?"Update Tender":"Save Tender"}</button>
      </div>
    </div>
  );
}

// ─── Enquiry Tab ────────────────────────────────────────────────────────────
// Separate from Tender — its own collection, own numbering (ENQ00001... —
// a single global counter, no financial-year segment), same admin/sales
// access as Tender. An enquiry can be converted into one or more Work
// Orders (different sizes from the same enquiry are common), tracked via
// linked_wos on the enquiry document. Conversion reuses OrderForm exactly
// as-is — the resulting WO is a completely normal, fully-editable WO.
function EnquiryTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canManage=isAdmin||profile.role==="sales";
  const [enquiries,setEnquiries]=useState([]);
  const [showForm,setShowForm]=useState(false);
  const [editEnquiry,setEditEnquiry]=useState(null);
  const [viewEnquiry,setViewEnquiry]=useState(null);

  useEffect(()=>{
    const q=query(collection(db,"enquiries"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setEnquiries(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  async function removeEnquiry(e){
    if(!window.confirm(`Delete enquiry ${e.enq_number||"(no number)"}? This cannot be undone.`))return;
    await deleteDoc(doc(db,"enquiries",e.id));
    showToast("Enquiry deleted");
  }

  function exportExcel(){
    const rows=[];
    enquiries.forEach(e=>{
      const items=e.items?.length?e.items:[{}];
      items.forEach(it=>{
        const f=parseFloat(it.fabrication_rate),c=parseFloat(it.copper_price);
        const fp=(isNaN(f)&&isNaN(c))?null:(isNaN(f)?0:f)+(isNaN(c)?0:c);
        rows.push({
          "Enq No":e.enq_number||"","Enq Date":e.enq_date?formatDate(e.enq_date):"",
          "Spec No":e.specification_number||"","Company":e.company||"",
          "Description":it.description||"","Size":itemSizeLabel(it),"Covering (mm)":it.covering||"",
          "Quantity":it.quantity??"","UOM":it.uom||"","Fabrication Rate":it.fabrication_rate||"",
          "Copper Price":it.copper_price||"","Final Price":fp??"","Packing":it.packing||"","Remarks":it.remarks||"",
          "Delivery":e.delivery_terms||"","Payment":e.payment_terms||"",
          "Tolerance":e.tolerance||"","Freight":e.freight||"","GST":e.gst||"",
          "Validity":e.validity_date?`${formatDate(e.validity_date)}${e.validity_time?` ${e.validity_time}`:""}`:"",
          "WOs Generated":(e.linked_wos||[]).length||"",
        });
      });
    });
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Enquiries");
    XLSX.writeFile(wb,`Enquiries_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("Exported to Excel");
  }

  if(viewEnquiry){
    // Re-read the latest copy from state so linked_wos stays fresh after a conversion.
    const live=enquiries.find(x=>x.id===viewEnquiry.id)||viewEnquiry;
    return <EnquiryDetailView enquiry={live} profile={profile} showToast={showToast} onBack={()=>setViewEnquiry(null)}/>;
  }

  if(showForm||editEnquiry){
    return <EnquiryForm existing={editEnquiry} profile={profile} showToast={showToast} onClose={()=>{setShowForm(false);setEditEnquiry(null);}}/>;
  }

  return(
    <div>
      <div style={{marginBottom:16}}><SectionHeader mono="Sales" title="Enquiry" sub="Enquiry tracking — manual entry"/></div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600}}>{enquiries.length} enquir{enquiries.length!==1?"ies":"y"}</div>
        <div style={{display:"flex",gap:10}}>
          {enquiries.length>0&&<button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>}
          {canManage&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setShowForm(true)}><Icon name="plus" size={12}/>New Enquiry</button>}
        </div>
      </div>

      {enquiries.length===0
        ?<EmptyState text="No enquiries yet" sub={canManage?"Click 'New Enquiry' to add one":undefined}/>
        :(
          <div className="card" style={{padding:0,overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{background:"#f3f4f6",borderBottom:"1px solid #e5e7eb"}}>
                {["Enq No","Enq Date","Spec. No.","Company","Items","Validity","WOs","Actions"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",color:"#6b7280",fontWeight:500,fontSize:11,whiteSpace:"nowrap",...S}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {enquiries.map(e=>{
                  const linkedCount=(e.linked_wos||[]).length;
                  const items=e.items||[];
                  return(
                    <tr key={e.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td onClick={()=>setViewEnquiry(e)} style={{padding:"10px 12px",...S,fontWeight:600,color:"#2563eb",cursor:"pointer",textDecoration:"underline",textDecorationColor:"transparent"}}
                        onMouseEnter={ev=>ev.currentTarget.style.textDecorationColor="#2563eb"}
                        onMouseLeave={ev=>ev.currentTarget.style.textDecorationColor="transparent"}>
                        {e.enq_number||"—"}
                      </td>
                      <td style={{padding:"10px 12px",...S}}>{e.enq_date?formatDate(e.enq_date):"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{e.specification_number||"—"}</td>
                      <td style={{padding:"10px 12px"}}>{e.company||"—"}</td>
                      <td style={{padding:"10px 12px"}}>{items.length?items.map(it=>itemSizeLabel(it)||"—").join(", "):"—"}</td>
                      <td style={{padding:"10px 12px",...S}}>{e.validity_date?`${formatDate(e.validity_date)}${e.validity_time?` ${e.validity_time}`:""}`:"—"}</td>
                      <td style={{padding:"10px 12px",...S,textAlign:"center"}}>{linkedCount>0?linkedCount:"—"}</td>
                      <td style={{padding:"10px 12px",whiteSpace:"nowrap"}}>
                        {canManage&&<>
                          <button className="btn-ghost" style={{padding:"3px 8px",fontSize:11,marginRight:6}} onClick={ev=>{ev.stopPropagation();setEditEnquiry(e);}}><Icon name="edit" size={11}/>Edit</button>
                          <button className="btn-danger" style={{padding:"3px 8px",fontSize:11}} onClick={ev=>{ev.stopPropagation();removeEnquiry(e);}}><Icon name="trash" size={11}/>Delete</button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

// ─── Enquiry read-only detail view ─────────────────────────────────────────
// Same read-only pattern as TenderDetailView, plus the WO-conversion action
// and a running list of every WO already generated from this enquiry.
function EnquiryDetailView({enquiry:e,profile,showToast,onBack}){
  const [convertingItem,setConvertingItem]=useState(null); // index of item being converted, or null
  const isAdmin=profile.role==="admin";
  const canManage=isAdmin||profile.role==="sales";
  const items=e.items||[];
  const Field=({label,value})=>(
    <div>
      <div style={{fontSize:11,color:"#9ca3af",textTransform:"uppercase",letterSpacing:".04em",marginBottom:4}}>{label}</div>
      <div style={{fontSize:14,color:"#1a1f2e"}}>{value||"—"}</div>
    </div>
  );
  function finalPrice(it){
    const f=parseFloat(it.fabrication_rate),c=parseFloat(it.copper_price);
    if(isNaN(f)&&isNaN(c))return null;
    return (( isNaN(f)?0:f)+(isNaN(c)?0:c));
  }

  if(convertingItem!=null){
    // Pre-fill a brand-new WO (no id → OrderForm treats this as "New Work
    // Order", generating its own WO number) from the selected item. Now that
    // items carry structured dimensions (matching WO's own conductor_type/
    // product_type/dimensions shape), those auto-fill directly — only PO
    // number and delivery date are left blank for the user to fill in here,
    // this being the review/confirm step, not a silent auto-create.
    const it=items[convertingItem];
    const dims=it.conductor_type==="wire"
      ?{diameter:it.diameter||""}
      :{width:it.width||"",thickness:it.thickness||"",cornerRadius:it.corner_radius||""};
    const prefill={
      customer_name:e.company||"",
      conductor_type:it.conductor_type||"conductor",
      product_type:it.product_type||"conductor",
      dimensions:dims,
      quantity:it.quantity||"",
      quantity_unit:it.uom&&["kg","nos"].includes(it.uom)?it.uom:"kg",
      insulation:[{scheme:it.insulation_type||"",thermal:"",tempIndex:"",covering:it.covering||"",spec:e.specification_number||"",rawMaterial:"",qtyUsed:""}],
      remarks:`From Enquiry ${e.enq_number||""}${it.description?` — ${it.description}`:""}`.trim(),
    };
    return <OrderForm
      profile={profile}
      existing={prefill}
      showToast={showToast}
      onClose={()=>setConvertingItem(null)}
      onSaved={async({id,wo_number})=>{
        await updateDoc(doc(db,"enquiries",e.id),{
          linked_wos:arrayUnion({wo_id:id,wo_number,item_size:itemSizeLabel(it)||null,created_at:new Date().toISOString()}),
        });
      }}
    />;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onBack}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>{e.enq_number||"Enquiry"}</div>
        {canManage&&<button className="btn-ghost" style={{marginLeft:"auto",fontSize:12,padding:"7px 14px"}} onClick={()=>printEnquiry(e)}><Icon name="printer" size={12}/>Print</button>}
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:16}}>Enquiry details</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20}}>
          <Field label="Enq Number" value={e.enq_number}/>
          <Field label="Enq Date" value={e.enq_date?formatDate(e.enq_date):null}/>
          <Field label="Specification No." value={e.specification_number}/>
          <Field label="Company" value={e.company}/>
          <Field label="Delivery" value={e.delivery_terms}/>
          <Field label="Payment" value={e.payment_terms}/>
          <Field label="Tolerance" value={e.tolerance}/>
          <Field label="Freight" value={e.freight}/>
          <Field label="GST" value={e.gst}/>
          <Field label="Validity" value={e.validity_date?`${formatDate(e.validity_date)}${e.validity_time?` ${e.validity_time}`:""}`:null}/>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:16}}>Items</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {items.map((it,i)=>{
            const fp=finalPrice(it);
            return(
              <div key={i} style={{border:"1px solid #e5e7eb",borderRadius:10,padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:12,flexWrap:"wrap"}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#1a1f2e"}}>{it.description||`Item ${i+1}`}</div>
                  {canManage&&<button className="btn-primary" style={{fontSize:11,padding:"5px 12px",flexShrink:0}} onClick={()=>setConvertingItem(i)}><Icon name="plus" size={11}/>Create Work Order</button>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
                  <Field label="Size" value={itemSizeLabel(it)}/>
                  <Field label="Insulation Type" value={it.insulation_type}/>
                  <Field label="Covering (mm)" value={it.covering}/>
                  <Field label="Quantity" value={it.quantity!=null&&it.quantity!==""?`${it.quantity}${it.uom?` ${it.uom}`:""}`:null}/>
                  <Field label="Fabrication Rate" value={it.fabrication_rate}/>
                  <Field label="Copper Price" value={it.copper_price}/>
                  <Field label="Final Price" value={fp!=null?`₹${fp}${it.uom?` / ${it.uom}`:""}`:null}/>
                  <Field label="Packing" value={it.packing}/>
                </div>
                {it.remarks&&(
                  <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid #f3f4f6"}}>
                    <Field label="Remarks" value={it.remarks}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{padding:20}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Work orders generated from this enquiry</div>
        {(e.linked_wos||[]).length===0
          ?<div style={{fontSize:13,color:"#9ca3af"}}>None yet — use "Create Work Order" on an item above.</div>
          :(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {e.linked_wos.map((w,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 0",borderBottom:i<e.linked_wos.length-1?"1px solid #f3f4f6":undefined}}>
                  <span style={{fontWeight:600,color:"#1a1f2e"}}>{w.wo_number}{w.item_size?` (${w.item_size})`:""}</span>
                  <span style={{color:"#9ca3af"}}>{w.created_at?formatDate(w.created_at):"—"}</span>
                </div>
              ))}
            </div>
          )
        }
      </div>
    </div>
  );
}

function EnquiryForm({existing,profile,showToast,onClose}){
  const isEdit=!!existing;
  const [enqDate,setEnqDate]=useState(existing?.enq_date||"");
  const [specNumber,setSpecNumber]=useState(existing?.specification_number||"");
  const [company,setCompany]=useState(existing?.company||"");
  const [deliveryTerms,setDeliveryTerms]=useState(existing?.delivery_terms||"");
  const [paymentTerms,setPaymentTerms]=useState(existing?.payment_terms||"");
  const [tolerance,setTolerance]=useState(existing?.tolerance||"");
  const [freight,setFreight]=useState(existing?.freight||"");
  const [gst,setGst]=useState(existing?.gst||"");
  const [validityDate,setValidityDate]=useState(existing?.validity_date||"");
  const [validityTime,setValidityTime]=useState(existing?.validity_time||"");
  const [items,setItems]=useState(existing?.items?.length?existing.items:[{description:"",conductor_type:"conductor",product_type:"conductor",width:"",thickness:"",corner_radius:"",diameter:"",insulation_type:"",covering:"",packing:"",remarks:"",quantity:"",uom:"",fabrication_rate:"",copper_price:""}]);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  const [customerMaster,setCustomerMaster]=useState([]);
  useEffect(()=>onSnapshot(collection(db,"customer_master"),snap=>setCustomerMaster(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  function addItem(){setItems(i=>[...i,{description:"",conductor_type:"conductor",product_type:"conductor",width:"",thickness:"",corner_radius:"",diameter:"",insulation_type:"",covering:"",packing:"",remarks:"",quantity:"",uom:"",fabrication_rate:"",copper_price:""}]);}
  function removeItem(i){setItems(its=>its.filter((_,idx)=>idx!==i));}
  function updateItem(i,k,v){setItems(its=>its.map((r,idx)=>idx===i?{...r,[k]:v}:r));}

  async function save(){
    setError("");setSaving(true);
    try{
      const payload={
        enq_date:enqDate||null,
        specification_number:specNumber.trim()||null,company:company.trim()||null,
        delivery_terms:deliveryTerms.trim()||null,payment_terms:paymentTerms.trim()||null,
        tolerance:tolerance.trim()||null,freight:freight.trim()||null,gst:gst.trim()||null,
        validity_date:validityDate||null,validity_time:validityTime||null,
        items,
        updated_at:serverTimestamp(),
      };
      if(isEdit){
        await updateDoc(doc(db,"enquiries",existing.id),payload);
        showToast("Enquiry updated");
      }else{
        const enqNumber=await generateEnqNumber();
        await addDoc(collection(db,"enquiries"),{
          ...payload,enq_number:enqNumber,created_by:profile.name||auth.currentUser.email,created_at:serverTimestamp(),
        });
        showToast("Enquiry created");
      }
      onClose();
    }catch(e){setError("Save failed: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>{isEdit?"Edit Enquiry":"New Enquiry"}</div>
      </div>

      {!isEdit&&<div style={{...S,display:"inline-flex",alignItems:"center",gap:8,background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"6px 14px",fontSize:12,color:"#1d4ed8",marginBottom:20}}>Auto-generated Enq No. on save</div>}
      {isEdit&&<div style={{...S,display:"inline-flex",alignItems:"center",gap:8,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"6px 14px",fontSize:12,color:"#92400e",marginBottom:20}}>{existing.enq_number}</div>}

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:16}}>Enquiry details</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Enquiry date</label>
            <input style={fieldStyle} type="date" value={enqDate} onChange={e=>setEnqDate(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Specification Number</label>
            <input style={fieldStyle} value={specNumber} onChange={e=>setSpecNumber(e.target.value)} placeholder="e.g. IS 13730"/>
          </div>
          <div>
            <FuzzyAutocomplete label="Company" value={company} onChange={setCompany} options={customerMaster} displayKey="name" placeholder="Start typing…"/>
          </div>
          <div>
            <label style={labelStyle}>Delivery</label>
            <input style={fieldStyle} value={deliveryTerms} onChange={e=>setDeliveryTerms(e.target.value)} placeholder="e.g. 3 weeks"/>
          </div>
          <div>
            <SelectOrCustom label="Payment" value={paymentTerms} onChange={setPaymentTerms} options={ENQ_PAYMENT_TERMS_OPTIONS} placeholder="— Select payment terms —"/>
          </div>
          <div>
            <label style={labelStyle}>Tolerance</label>
            <input style={fieldStyle} value={tolerance} onChange={e=>setTolerance(e.target.value)} placeholder="e.g. ±2%"/>
          </div>
          <div>
            <SelectOrCustom label="Freight" value={freight} onChange={setFreight} options={ENQ_FREIGHT_OPTIONS} placeholder="— Select freight terms —"/>
          </div>
          <div>
            <SelectOrCustom label="GST" value={gst} onChange={setGst} options={ENQ_GST_OPTIONS} placeholder="— Select GST —"/>
          </div>
          <div>
            <label style={labelStyle}>Validity date</label>
            <input style={fieldStyle} type="date" value={validityDate} onChange={e=>setValidityDate(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Validity time <span style={{color:"#9ca3af",fontWeight:400}}>(optional)</span></label>
            <input style={fieldStyle} type="time" value={validityTime} onChange={e=>setValidityTime(e.target.value)}/>
          </div>
        </div>
      </div>

      {/* Items — repeatable, one per size/description. Add another for a
          second size under the same enquiry (same Enq No.), e.g. when an
          offer quotes multiple sizes at once. */}
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em"}}>Items</div>
        </div>
        {items.map((it,i)=>(
          <div key={i} style={{border:"1px solid #e5e7eb",borderRadius:10,padding:16,marginBottom:12,position:"relative"}}>
            {items.length>1&&<button className="btn-ghost" style={{position:"absolute",top:10,right:10,padding:"3px 8px",fontSize:11,color:"#dc2626"}} onClick={()=>removeItem(i)}><Icon name="trash" size={11}/></button>}
            <div style={{fontSize:12,fontWeight:600,color:"#6b7280",marginBottom:12}}>Item {i+1}</div>
            <div style={{marginBottom:12}}>
              <label style={labelStyle}>Description</label>
              <input style={fieldStyle} value={it.description} onChange={e=>updateItem(i,"description",e.target.value)} placeholder="e.g. 1 layer 66% overlap Kapton covered copper conductor"/>
            </div>

            {/* Conductor type — same toggle set as the WO form, so this
                data lines up 1:1 with WO dimensions on conversion. */}
            <div style={{marginBottom:12}}>
              <div style={{display:"flex",background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden",marginBottom:it.conductor_type==="conductor"?10:0}}>
                {[["conductor","Rectangular strip"],["wire","Round wire"]].map(([v,l])=><button key={v} type="button" style={{padding:"7px 0",border:"none",background:it.conductor_type===v?"#fff":"#f3f4f6",color:it.conductor_type===v?"#1a1f2e":"#6b7280",fontWeight:it.conductor_type===v?600:400,cursor:"pointer",fontSize:12,flex:1}} onClick={()=>{updateItem(i,"conductor_type",v);if(v==="wire")updateItem(i,"product_type","wire");}}>{l}</button>)}
              </div>
              {it.conductor_type==="conductor"&&(
                <div style={{display:"flex",background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,overflow:"hidden"}}>
                  {[["conductor","Conductor / Strip"],["coil","Coil / Stator"]].map(([v,l])=><button key={v} type="button" style={{padding:"7px 0",border:"none",background:it.product_type===v?"#fff":"#f3f4f6",color:it.product_type===v?"#1a1f2e":"#6b7280",fontWeight:it.product_type===v?600:400,cursor:"pointer",fontSize:12,flex:1}} onClick={()=>updateItem(i,"product_type",v)}>{l}</button>)}
                </div>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {it.conductor_type==="conductor"&&(
                <>
                  <div>
                    <label style={labelStyle}>Width (mm)</label>
                    <input style={fieldStyle} type="number" min="0" step="0.01" value={it.width} onChange={e=>updateItem(i,"width",e.target.value)} placeholder="0.00"/>
                  </div>
                  <div>
                    <label style={labelStyle}>Thickness (mm)</label>
                    <input style={fieldStyle} type="number" min="0" step="0.01" value={it.thickness} onChange={e=>updateItem(i,"thickness",e.target.value)} placeholder="0.00"/>
                  </div>
                  <div>
                    <label style={labelStyle}>Corner R (mm)</label>
                    <input style={fieldStyle} type="number" min="0" step="0.01" value={it.corner_radius} onChange={e=>updateItem(i,"corner_radius",e.target.value)} placeholder="0.00"/>
                  </div>
                </>
              )}
              {it.conductor_type==="wire"&&(
                <div>
                  <label style={labelStyle}>Diameter (mm)</label>
                  <input style={fieldStyle} type="number" min="0" step="0.01" value={it.diameter} onChange={e=>updateItem(i,"diameter",e.target.value)} placeholder="0.00"/>
                </div>
              )}
              <div>
                <label style={labelStyle}>Insulation type</label>
                <select style={fieldStyle} value={it.insulation_type} onChange={e=>updateItem(i,"insulation_type",e.target.value)}>
                  <option value="">— Select —</option>
                  {INSULATION_SCHEMES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Covering (mm)</label>
                <input style={fieldStyle} type="number" min="0" step="0.001" value={it.covering} onChange={e=>updateItem(i,"covering",e.target.value)} placeholder="e.g. 0.250"/>
              </div>
              <div>
                <label style={labelStyle}>Quantity</label>
                <input style={fieldStyle} type="number" min="0" step="0.01" value={it.quantity} onChange={e=>updateItem(i,"quantity",e.target.value)} placeholder="0"/>
              </div>
              <div>
                <label style={labelStyle}>UOM</label>
                <select style={fieldStyle} value={it.uom} onChange={e=>updateItem(i,"uom",e.target.value)}>
                  <option value="">— Select —</option>
                  <option>kg</option><option>pcs</option><option>mtr</option><option>ltr</option><option>rolls</option><option>nos</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Fabrication rate</label>
                <input style={fieldStyle} value={it.fabrication_rate} onChange={e=>updateItem(i,"fabrication_rate",e.target.value)} placeholder="Fabrication rate"/>
              </div>
              <div>
                <label style={labelStyle}>Copper price <span style={{color:"#9ca3af",fontWeight:400}}>(considered for bid)</span></label>
                <input style={fieldStyle} value={it.copper_price} onChange={e=>updateItem(i,"copper_price",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>Packing</label>
                <input style={fieldStyle} value={it.packing} onChange={e=>updateItem(i,"packing",e.target.value)} placeholder="e.g. Please confirm"/>
              </div>
            </div>
            <div style={{marginTop:12}}>
              <label style={labelStyle}>Remarks</label>
              <textarea style={{...fieldStyle,minHeight:56,resize:"vertical"}} value={it.remarks} onChange={e=>updateItem(i,"remarks",e.target.value)} placeholder="Notes for this item…"/>
            </div>
          </div>
        ))}
        <button className="btn-ghost" style={{padding:"6px 14px",fontSize:12,borderStyle:"dashed"}} onClick={addItem}><Icon name="plus" size={12}/>Add item</button>
      </div>

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626"}}>{error}</div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}><Icon name="check" size={14}/>{saving?"Saving…":isEdit?"Update Enquiry":"Save Enquiry"}</button>
      </div>
    </div>
  );
}

// ─── Inventory Tab ────────────────────────────────────────────────────────────
function InventoryTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canAddMaterial=isAdmin||profile.role==="sales";
  const [materials,setMaterials]=useState([]);
  const [vendors,setVendors]=useState([]);
  const [pos,setPos]=useState([]);
  const [search,setSearch]=useState("");
  const [vendorFilter,setVendorFilter]=useState("all");
  const [showZeroOnly,setShowZeroOnly]=useState(false);
  const [creatingNew,setCreatingNew]=useState(false);
  const [editingId,setEditingId]=useState(null);
  const [quickEdit,setQuickEdit]=useState(null); // {id, field, value}

  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),snap=>setMaterials(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);
  useEffect(()=>onSnapshot(collection(db,"supplier_master"),snap=>setVendors(snap.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.active!==false))),[]);
  useEffect(()=>onSnapshot(collection(db,"purchase_orders"),snap=>setPos(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  const vendorMap=Object.fromEntries(vendors.map(v=>[v.id,v]));
  function poInProgressFor(materialId){
    return pos.find(po=>["pending_approval","approved","partially_received"].includes(po.status)&&(po.line_items||[]).some(it=>it.material_id===materialId));
  }

  const atZero=materials.filter(m=>(m.current_stock||0)<=0);
  const zeroNeedingPO=atZero.filter(m=>!poInProgressFor(m.id));
  const zeroWithPO=atZero.filter(m=>poInProgressFor(m.id));
  const stats=[
    {label:"Unique Items",value:materials.length,color:"#1d4ed8"},
    {label:"Items with Stock",value:materials.filter(m=>(m.current_stock||0)>0).length,color:"#16a34a"},
    {label:"Items at Zero",value:atZero.length,color:atZero.length>0?"#dc2626":"#9ca3af"},
    {label:"Missing Vendor",value:materials.filter(m=>!m.vendor_id).length,color:"#9ca3af"},
  ];

  let filtered=materials.filter(m=>{
    if(vendorFilter!=="all"&&m.vendor_id!==vendorFilter)return false;
    if(showZeroOnly&&(m.current_stock||0)>0)return false;
    if(search){
      const q=search.toLowerCase();
      if(!(m.item_code?.toLowerCase().includes(q)||m.material_name?.toLowerCase().includes(q)))return false;
    }
    return true;
  });
  filtered=[...filtered].sort((a,b)=>{
    const az=(a.current_stock||0)<=0,bz=(b.current_stock||0)<=0;
    if(az&&!bz)return -1;
    if(!az&&bz)return 1;
    return(a.material_name||"").localeCompare(b.material_name||"");
  });

  async function saveQuickEdit(){
    if(!quickEdit)return;
    if(quickEdit.field==="bin_location"){
      await updateDoc(doc(db,"rm_inventory",quickEdit.id),{bin_location:quickEdit.value.trim()||null,updated_at:serverTimestamp()});
      setQuickEdit(null);
      return;
    }
    const val=parseFloat(quickEdit.value);
    if(isNaN(val)||val<0){showToast("Enter a valid number","error");return;}
    await updateDoc(doc(db,"rm_inventory",quickEdit.id),{[quickEdit.field]:val,updated_at:serverTimestamp()});
    setQuickEdit(null);
  }

  async function deleteMaterial(m){
    if(!window.confirm(`Delete ${m.material_name}? This cannot be undone.`))return;
    await deleteDoc(doc(db,"rm_inventory",m.id));
    showToast(`${m.material_name} deleted`);
  }

  function exportExcel(){
    const rows=materials.map(m=>({
      "Item Code":m.item_code||"","Description":m.material_name||"","Vendor":vendorMap[m.vendor_id]?.name||"",
      "UoM":m.unit||"","Qty in Stock":m.current_stock??0,"Min Qty":m.low_stock_threshold??0,
      "Bin/Rack/Box":m.bin_location||"","Added":m.created_at?.toDate?formatDate(m.created_at.toDate()):"",
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"RM Inventory");
    XLSX.writeFile(wb,`RM_Inventory_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("Exported to Excel");
  }

  if(creatingNew||editingId){
    const existing=editingId?materials.find(m=>m.id===editingId):null;
    return <MaterialForm existing={existing} vendors={vendors} showToast={showToast} onClose={()=>{setCreatingNew(false);setEditingId(null);}}/>;
  }

  const QtyCell=({m,field,label})=>{
    const editing=quickEdit&&quickEdit.id===m.id&&quickEdit.field===field;
    if(editing){
      return(
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <input autoFocus type="number" min="0" step="0.01" value={quickEdit.value} onChange={e=>setQuickEdit(q=>({...q,value:e.target.value}))}
            onKeyDown={e=>{if(e.key==="Enter")saveQuickEdit();if(e.key==="Escape")setQuickEdit(null);}}
            style={{width:70,padding:"3px 6px",border:"1px solid #1a1f2e",borderRadius:5,fontSize:12,...S}}/>
          <button onClick={saveQuickEdit} style={{background:"none",border:"none",cursor:"pointer",color:"#16a34a",padding:2}}><Icon name="check" size={13}/></button>
          <button onClick={()=>setQuickEdit(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#dc2626",padding:2}}><Icon name="x" size={13}/></button>
        </div>
      );
    }
    return(
      <span style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer"}} onClick={()=>setQuickEdit({id:m.id,field,value:String(m[field]??0)})} title={`Edit ${label}`}>
        <span style={{...S,fontWeight:field==="current_stock"?700:400,color:field==="current_stock"&&(m.current_stock||0)<=0?"#dc2626":field==="current_stock"?"#16a34a":"#374151"}}>{m[field]??0}</span>
        <Icon name="edit" size={10}/>
      </span>
    );
  };

  const TextCell=({m,field,label,placeholder})=>{
    const editing=quickEdit&&quickEdit.id===m.id&&quickEdit.field===field;
    if(editing){
      return(
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          <input autoFocus type="text" value={quickEdit.value} onChange={e=>setQuickEdit(q=>({...q,value:e.target.value}))}
            onKeyDown={e=>{if(e.key==="Enter")saveQuickEdit();if(e.key==="Escape")setQuickEdit(null);}}
            style={{width:90,padding:"3px 6px",border:"1px solid #1a1f2e",borderRadius:5,fontSize:12}}/>
          <button onClick={saveQuickEdit} style={{background:"none",border:"none",cursor:"pointer",color:"#16a34a",padding:2}}><Icon name="check" size={13}/></button>
          <button onClick={()=>setQuickEdit(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#dc2626",padding:2}}><Icon name="x" size={13}/></button>
        </div>
      );
    }
    return(
      <span style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer"}} onClick={()=>setQuickEdit({id:m.id,field,value:m[field]||""})} title={`Edit ${label}`}>
        <span style={{fontSize:12,color:m[field]?"#374151":"#d1d5db",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m[field]||placeholder}</span>
        <Icon name="edit" size={10}/>
      </span>
    );
  };

  return(
    <div style={{maxWidth:900,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <SectionHeader mono="Store" title="RM Inventory" sub="Raw material stock levels"/>
        {canAddMaterial&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New Item</button>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20}}>
        {stats.map(s=>{
          const isZeroAlert=s.label==="Items at Zero"&&s.value>0;
          return(
            <div key={s.label} className="card" style={{padding:"16px 18px",...(isZeroAlert?{border:"1px solid #dc2626",background:"#fef2f2"}:{})}}>
              <div style={{...S,fontSize:26,fontWeight:700,color:s.color}}>{s.value}</div>
              <div style={{fontSize:12,color:isZeroAlert?"#991b1b":"#6b7280",marginTop:2}}>{s.label}</div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{padding:16,marginBottom:16,display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:1,minWidth:200}}>
          <label style={labelStyle}>Item Code / Description</label>
          <input style={fieldStyle} placeholder="Search item code or description…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        <div style={{minWidth:180}}>
          <label style={labelStyle}>Vendor</label>
          <select style={fieldStyle} value={vendorFilter} onChange={e=>setVendorFilter(e.target.value)}>
            <option value="all">All vendors</option>
            {vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_code} — {v.name}</option>)}
          </select>
        </div>
        <button className="btn-ghost" style={{padding:"9px 14px",fontSize:12}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>
      </div>

      {zeroNeedingPO.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"12px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <span style={{fontSize:13,color:"#dc2626"}}><strong>{zeroNeedingPO.length} item{zeroNeedingPO.length!==1?"s":""}</strong> at zero stock and need to be purchased. They are highlighted in red and sorted to top.</span>
          <button onClick={()=>setShowZeroOnly(z=>!z)} style={{marginLeft:"auto",background:showZeroOnly?"#dc2626":"#fff",color:showZeroOnly?"#fff":"#dc2626",border:"1px solid #dc2626",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer",flexShrink:0}}>{showZeroOnly?"Show all":"Show zero only"}</button>
        </div>
      )}
      {zeroWithPO.length>0&&(
        <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:13,color:"#15803d",display:"flex",alignItems:"center",gap:8}}>
          <Icon name="check" size={14}/>{zeroWithPO.length} alert{zeroWithPO.length!==1?"s":""} acknowledged — PO in progress
        </div>
      )}

      <div className="card" style={{padding:0,overflow:"hidden"}}>
       <div style={{overflowX:"auto"}}>
        <div style={{minWidth:1050}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#f3f4f6",borderBottom:"1px solid #e5e7eb",fontSize:11,color:"#6b7280",...S,textTransform:"uppercase"}}>
          <span style={{width:130,flexShrink:0}}>Item Code</span>
          <span style={{flex:1,minWidth:160}}>Description</span>
          <span style={{width:160,flexShrink:0}}>Vendor</span>
          <span style={{width:50,flexShrink:0,textAlign:"center"}}>UoM</span>
          <span style={{width:150,flexShrink:0}}>Qty in Stock</span>
          <span style={{width:100,flexShrink:0}}>Min Qty</span>
          <span style={{width:150,flexShrink:0}}>Bin/Rack/Box</span>
          <span style={{width:90,flexShrink:0}}>Added</span>
          <span style={{width:70,flexShrink:0,textAlign:"right"}}>Actions</span>
        </div>

        {materials.length===0
          ?<EmptyState text="No materials configured" sub="Click 'New Item' to add one"/>
          :filtered.length===0
          ?<EmptyState text="No items match your search"/>
          :filtered.map((m,i)=>{
            const zero=(m.current_stock||0)<=0;
            const hasPO=poInProgressFor(m.id);
            const vendor=vendorMap[m.vendor_id];
            return(
              <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderBottom:i<filtered.length-1?"1px solid #f9fafb":undefined,borderLeft:zero?"3px solid #dc2626":"3px solid transparent",background:zero?"#fef2f2":"#fff",fontSize:13}}
                onMouseEnter={e=>e.currentTarget.style.background=zero?"#fee2e2":"#fafafa"}
                onMouseLeave={e=>e.currentTarget.style.background=zero?"#fef2f2":"#fff"}>
                <span style={{...S,width:130,flexShrink:0,fontWeight:600,color:"#1d4ed8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.item_code||"—"}</span>
                <span style={{flex:1,minWidth:160,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.material_name}</span>
                <span style={{width:160,flexShrink:0}}>
                  {vendor
                    ?<span style={{...S,background:"#f5f3ff",color:"#7c3aed",padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:600,whiteSpace:"nowrap"}}>{vendor.name}</span>
                    :<span style={{fontSize:11,color:"#d1d5db"}}>—</span>}
                </span>
                <span style={{width:50,flexShrink:0,textAlign:"center",...S,fontSize:11,color:"#6b7280"}}>{m.unit}</span>
                <span style={{width:150,flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
                  <QtyCell m={m} field="current_stock" label="Qty in Stock"/>
                  {zero&&(hasPO
                    ?<span style={{...S,background:"#f0fdf4",color:"#16a34a",padding:"1px 7px",borderRadius:20,fontSize:9,fontWeight:700,whiteSpace:"nowrap"}}>PO IN PROGRESS</span>
                    :<span style={{...S,background:"#dc2626",color:"#fff",padding:"1px 7px",borderRadius:20,fontSize:9,fontWeight:700,whiteSpace:"nowrap"}}>REORDER</span>)}
                </span>
                <span style={{width:100,flexShrink:0}}><QtyCell m={m} field="low_stock_threshold" label="Min Qty"/></span>
                <span style={{width:150,flexShrink:0}}><TextCell m={m} field="bin_location" label="Bin/Rack/Box" placeholder="+ Set bin"/></span>
                <span style={{width:90,flexShrink:0,fontSize:11,color:"#9ca3af"}}>{m.created_at?.toDate?formatDate(m.created_at.toDate()):"—"}</span>
                <span style={{width:70,flexShrink:0,display:"flex",gap:4,justifyContent:"flex-end"}}>
                  {isAdmin&&<button className="btn-ghost" style={{padding:"3px 6px",fontSize:11}} onClick={()=>setEditingId(m.id)}><Icon name="edit" size={11}/></button>}
                  {isAdmin&&<button className="btn-ghost" style={{padding:"3px 6px",fontSize:11,color:"#dc2626"}} onClick={()=>deleteMaterial(m)}><Icon name="trash" size={11}/></button>}
                </span>
              </div>
            );
          })
        }
        </div>
       </div>
      </div>
    </div>
  );
}

// ─── Material create / edit form (RM Inventory) ────────────────────────────
function MaterialForm({existing,vendors,showToast,onClose}){
  const isEdit=!!existing;
  const [itemCode,setItemCode]=useState(existing?.item_code||"");
  const [name,setName]=useState(existing?.material_name||"");
  const [category,setCategory]=useState(existing?.category||"");
  const [unit,setUnit]=useState(existing?.unit||"kg");
  const [vendorId,setVendorId]=useState(existing?.vendor_id||"");
  const [currentStock,setCurrentStock]=useState(existing?.current_stock??0);
  const [minQty,setMinQty]=useState(existing?.low_stock_threshold??0);
  const [binLocation,setBinLocation]=useState(existing?.bin_location||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  useEffect(()=>{
    if(!isEdit&&!itemCode){
      (async()=>{
        const ref=doc(db,"counters","ITEM_CODE");
        const code=await runTransaction(db,async tx=>{
          const snap=await tx.get(ref);
          const next=(snap.exists()?snap.data().last:0)+1;
          tx.set(ref,{last:next});
          return `M${String(next).padStart(3,"0")}`;
        });
        setItemCode(code);
      })();
    }
    // eslint-disable-next-line
  },[]);

  async function save(){
    if(!name.trim()){setError("Item description is required");return;}
    setError("");setSaving(true);
    try{
      const payload={
        item_code:itemCode||null,material_name:name.trim(),category:category||null,unit,
        vendor_id:vendorId||null,current_stock:parseFloat(currentStock)||0,low_stock_threshold:parseFloat(minQty)||0,
        bin_location:binLocation||null,
      };
      if(isEdit){
        await updateDoc(doc(db,"rm_inventory",existing.id),{...payload,updated_at:serverTimestamp()});
        showToast("Item updated");
      }else{
        await addDoc(collection(db,"rm_inventory"),{...payload,created_at:serverTimestamp()});
        showToast(`${itemCode} created`);
      }
      onClose();
    }catch(e){setError("Save failed: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>{isEdit?`Edit ${existing.item_code||existing.material_name}`:"New Item"}</div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Item code</label>
            <input style={fieldStyle} value={itemCode} onChange={e=>setItemCode(e.target.value)} placeholder="M001"/>
          </div>
          <div>
            <label style={labelStyle}>Description *</label>
            <input style={fieldStyle} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Copper rod / wire"/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Category</label>
            <input style={fieldStyle} value={category} onChange={e=>setCategory(e.target.value)} placeholder="e.g. Copper"/>
          </div>
          <div>
            <label style={labelStyle}>UoM</label>
            <select style={fieldStyle} value={unit} onChange={e=>setUnit(e.target.value)}>
              {["kg","L","pcs","mtr","rolls","nos"].map(u=><option key={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Vendor</label>
            <select style={fieldStyle} value={vendorId} onChange={e=>setVendorId(e.target.value)}>
              <option value="">— No vendor —</option>
              {vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_code} — {v.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
          <div>
            <label style={labelStyle}>Qty in stock</label>
            <input type="number" style={fieldStyle} min="0" step="0.01" value={currentStock} onChange={e=>setCurrentStock(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Min qty (reorder point)</label>
            <input type="number" style={fieldStyle} min="0" step="0.01" value={minQty} onChange={e=>setMinQty(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Bin / Rack / Box</label>
            <input style={fieldStyle} value={binLocation} onChange={e=>setBinLocation(e.target.value)} placeholder="e.g. Rack 3 - Bin B12"/>
          </div>
        </div>
      </div>

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626"}}>{error}</div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}><Icon name="check" size={14}/>{saving?"Saving…":isEdit?"Update Item":"Save Item"}</button>
      </div>
    </div>
  );
}

// ─── Dispatch Tab ─────────────────────────────────────────────────────────────
function DispatchTab({profile,showToast}){
  const [orders,setOrders]=useState([]);
  // Admin and Sales always have dispatch access by role; anyone else's
  // access is governed by the dispatch_access toggle. Existing users who
  // predate this flag default to enabled (!==false) so nobody's silently
  // locked out — new users created going forward start disabled until an
  // Admin explicitly turns it on, same pattern as wo_access/inventory_access.
  const canDispatch=["admin","sales"].includes(profile.role)||profile.dispatch_access!==false;
  useEffect(()=>{
    const q=query(collection(db,"work_orders"),where("status","==","ready_dispatch"));
    return onSnapshot(q,snap=>setOrders(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  async function dispatch(order,vehicleLR){
    await updateDoc(doc(db,"work_orders",order.id),{status:"dispatched",updated_at:serverTimestamp()});
    await addDoc(collection(db,"dispatch_log"),{wo_id:order.id,wo_number:order.wo_number,customer_name:order.customer_name,quantity:order.quantity,quantity_unit:order.quantity_unit,vehicle_lr:vehicleLR||null,dispatch_date:new Date().toISOString().split("T")[0],user_uid:auth.currentUser.uid,timestamp:serverTimestamp()});
    showToast(`${order.wo_number} dispatched`);
  }

  return(
    <div>
      <div style={{marginBottom:20}}><SectionHeader mono="Dispatch" title="Ready for Dispatch" sub={`${orders.length} order${orders.length!==1?"s":""} ready`}/></div>
      {orders.length===0
        ?<EmptyState text="No orders ready for dispatch"/>
        :orders.map(o=><DispatchCard key={o.id} order={o} canDispatch={canDispatch} onDispatch={dispatch}/>)
      }
    </div>
  );
}

function DispatchCard({order,canDispatch,onDispatch}){
  const [vehicleLR,setVehicleLR]=useState("");
  const [busy,setBusy]=useState(false);
  const fieldStyle={background:"#fff",border:"1px solid #d1d5db",borderRadius:8,padding:"9px 13px",color:"#1a1f2e",fontSize:13,width:"100%",outline:"none"};
  async function handle(){setBusy(true);await onDispatch(order,vehicleLR);setBusy(false);}
  return(
    <div className="card animate-in" style={{padding:20,marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <span style={{...S,fontSize:13,fontWeight:700}}>{order.wo_number}</span>
        <span style={{...S,background:order.material==="copper"?"#fffbeb":"#eff6ff",color:order.material==="copper"?"#92400e":"#1e3a5f",padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:600}}>{order.material}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:canDispatch?14:0}}>
        {[["Customer",order.customer_name],["Qty",`${order.quantity} ${order.quantity_unit}`],["PO",order.po_number||"—"],["Delivery",formatDate(order.delivery_date)]].map(([k,v])=>(
          <div key={k}><div style={{fontSize:11,color:"#9ca3af",marginBottom:2}}>{k}</div><div style={{fontSize:13,fontWeight:500}}>{v}</div></div>
        ))}
      </div>
      {canDispatch&&(
        <>
          <input style={{...fieldStyle,marginBottom:10}} type="text" placeholder="Vehicle / LR number (optional)" value={vehicleLR} onChange={e=>setVehicleLR(e.target.value)}/>
          <button className="btn-primary" style={{width:"100%",justifyContent:"center"}} disabled={busy} onClick={handle}><Icon name="check" size={14}/>{busy?"Dispatching…":"Confirm Dispatch"}</button>
        </>
      )}
    </div>
  );
}

// ─── Admin Tab ────────────────────────────────────────────────────────────────
function AdminTab({showToast}){
  const [subtab,setSubtab]=useState("users");
  const tabs=[["users","Users"],["customers","Customer Master"],["vendors","Vendor Master"],["seed","Seed Data"]];
  return(
    <div>
      <div style={{marginBottom:20}}><SectionHeader mono="Admin" title="Admin Panel"/></div>
      <div style={{display:"flex",gap:0,background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,padding:3,width:"fit-content",marginBottom:24}}>
        {tabs.map(([id,label])=>(
          <button key={id} onClick={()=>setSubtab(id)} style={{padding:"7px 18px",borderRadius:6,border:"none",cursor:"pointer",fontSize:13,fontWeight:subtab===id?600:400,background:subtab===id?"#e8c547":"transparent",color:subtab===id?"#1a1f2e":"#6b7280",fontFamily:"'Roboto',sans-serif",transition:"all .15s"}}>{label}</button>
        ))}
      </div>
      {subtab==="users"&&<UserManager showToast={showToast}/>}
      {subtab==="customers"&&<CustomerMasterAdmin showToast={showToast}/>}
      {subtab==="vendors"&&<VendorMasterAdmin showToast={showToast}/>}
      {subtab==="seed"&&<SeedData showToast={showToast}/>}
    </div>
  );
}

// ─── Customer Master List (Admin only) ──────────────────────────────────────
// Full-record master (Name/Address/GSTIN/PAN) built from an uploaded Excel —
// new names get merged with what's already there, nothing gets overwritten
// on re-upload. Feeds FuzzyAutocomplete on Tender's Company field and Work
// Order's Customer name field. Only `name` is actually displayed/used by
// those two forms today — address/GSTIN/PAN ride along on the record for
// whenever those forms grow fields for them.
function CustomerMasterAdmin({showToast}){
  const [customers,setCustomers]=useState([]);
  const [search,setSearch]=useState("");
  const [uploading,setUploading]=useState(false);
  const [editCustomer,setEditCustomer]=useState(null);

  useEffect(()=>onSnapshot(collection(db,"customer_master"),snap=>setCustomers(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  async function handleUpload(e){
    const file=e.target.files?.[0];
    if(!file)return;
    setUploading(true);
    try{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:""});

      // Flexible header matching — same spirit as MOTRAK's Excel import —
      // so slightly different column naming in someone's sheet doesn't
      // silently fail to pick up the data.
      function pick(row,candidates){
        for(const key of Object.keys(row)){
          const norm=key.trim().toLowerCase();
          if(candidates.some(c=>norm.includes(c)))return String(row[key]||"").trim();
        }
        return "";
      }

      const existingNames=new Set(customers.map(c=>c.name?.toLowerCase()));
      let added=0;
      for(const row of rows){
        const name=pick(row,["customer name","company","name"]);
        if(!name||existingNames.has(name.toLowerCase()))continue;
        const address=pick(row,["address"]);
        const gstin=pick(row,["gstin","gst"]);
        const pan=pick(row,["pan"]);
        await addDoc(collection(db,"customer_master"),{name,address:address||null,gstin:gstin||null,pan:pan||null,created_at:serverTimestamp()});
        existingNames.add(name.toLowerCase());
        added++;
      }
      showToast(added>0?`${added} new customer${added!==1?"s":""} added`:"No new customers found — all names already in the master list");
    }catch(err){showToast("Import failed: "+err.message,"error");}
    finally{setUploading(false);e.target.value="";}
  }

  async function removeCustomer(c){
    if(!window.confirm(`Remove ${c.name} from the customer master list?`))return;
    await deleteDoc(doc(db,"customer_master",c.id));
    showToast(`${c.name} removed`);
  }

  // Exports ALL customers, ignoring the current search filter — the point
  // of export is a full backup/round-trip, not "export what I'm looking at".
  function exportExcel(){
    const rows=customers.map(c=>({
      "Customer Name":c.name||"","Address":c.address||"","GSTIN":c.gstin||"","PAN":c.pan||"",
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Customers");
    XLSX.writeFile(wb,`customer_master_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  const filtered=search.trim()
    ?customers.filter(c=>c.name?.toLowerCase().includes(search.toLowerCase()))
    :customers;

  if(editCustomer){
    return <CustomerEditForm customer={editCustomer} showToast={showToast} onClose={()=>setEditCustomer(null)}/>;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:600}}>{customers.length} customer{customers.length!==1?"s":""}</div>
          <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>Upload an Excel with Customer Name, Address, GSTIN, PAN columns. New names are merged with the existing list.</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>
          <label className="btn-primary" style={{fontSize:12,padding:"7px 14px",cursor:"pointer"}}>
            <Icon name="plus" size={12}/>{uploading?"Uploading…":"Upload Excel"}
            <input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading} style={{display:"none"}}/>
          </label>
        </div>
      </div>

      <input style={{...fieldStyle,marginBottom:16,maxWidth:280}} placeholder="Search customer name…" value={search} onChange={e=>setSearch(e.target.value)}/>

      {customers.length===0
        ?<EmptyState text="No customers in the master list yet" sub="Upload an Excel to get started"/>
        :filtered.length===0
          ?<EmptyState text={`No customers match "${search.trim()}"`}/>
          :(
            <div className="card" style={{padding:0,overflow:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f3f4f6",borderBottom:"1px solid #e5e7eb"}}>
                  {["Customer Name","Address","GSTIN","PAN","Actions"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",color:"#6b7280",fontWeight:500,fontSize:10,whiteSpace:"nowrap",...S}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filtered.map(c=>(
                    <tr key={c.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"6px 10px",fontWeight:600}}>{c.name}</td>
                      <td style={{padding:"6px 10px",maxWidth:280}}>{c.address||"—"}</td>
                      <td style={{padding:"6px 10px",...S}}>{c.gstin||"—"}</td>
                      <td style={{padding:"6px 10px",...S}}>{c.pan||"—"}</td>
                      <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}>
                        <button className="btn-ghost" style={{padding:"3px 8px",fontSize:11,marginRight:6}} onClick={()=>setEditCustomer(c)}><Icon name="edit" size={11}/>Edit</button>
                        <button className="btn-danger" style={{padding:"3px 8px",fontSize:11}} onClick={()=>removeCustomer(c)}><Icon name="trash" size={11}/>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      }
    </div>
  );
}

// ─── Vendor Master List (Admin only) ────────────────────────────────────────
// Full-record master built from the uploaded Party List export — every
// column from that sheet gets stored even where nothing uses it yet.
// Feeds FuzzyAutocomplete on the Vendor creation form (PurchaseVendorsTab)
// for auto-fill, and a STRICT variant on PO/GRN/MRP Queue's vendor pickers
// (sourced from already-onboarded supplier_master vendors, not this raw
// import — see FuzzyAutocomplete's strict mode in shared.jsx).
function VendorMasterAdmin({showToast}){
  const [vendors,setVendors]=useState([]);
  const [search,setSearch]=useState("");
  const [uploading,setUploading]=useState(false);
  const [editVendor,setEditVendor]=useState(null);

  useEffect(()=>onSnapshot(collection(db,"vendor_master"),snap=>setVendors(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  function combineAddress(v){
    return [v.address_line1,v.address_line2,v.address_line3,v.city,v.state,v.pincode].filter(Boolean).join(", ");
  }

  async function handleUpload(e){
    const file=e.target.files?.[0];
    if(!file)return;
    setUploading(true);
    try{
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:""});

      function pick(row,candidates){
        for(const key of Object.keys(row)){
          const norm=key.trim().toLowerCase();
          if(candidates.some(c=>norm.includes(c)))return String(row[key]||"").trim();
        }
        return "";
      }

      // Name → existing doc, so a duplicate name in the sheet backfills any
      // currently-blank fields on the record already imported, instead of
      // being silently discarded — the source sheet has 6 duplicate party
      // names, and for 3 of them the SECOND occurrence has the real
      // Payment Term/GSTIN while the first is blank. Never overwrites a
      // field that already has a value.
      const byName=new Map(vendors.map(v=>[v.name?.toLowerCase(),v]));
      let added=0,backfilled=0;
      for(const row of rows){
        const name=pick(row,["party name"]);
        if(!name)continue;
        const fields={
          party_type:pick(row,["party type"])||null,
          category:pick(row,["category"])||null,
          currency:pick(row,["currency"])||null,
          address_type:pick(row,["address type"])||null,
          address_description:pick(row,["address description"])||null,
          address_line1:pick(row,["address line1"])||null,
          address_line2:pick(row,["address line2"])||null,
          address_line3:pick(row,["address line3"])||null,
          city:pick(row,["city"])||null,
          state:pick(row,["state"])||null,
          country:pick(row,["country"])||null,
          pincode:pick(row,["pin code","pincode"])||null,
          contact_person:pick(row,["contact person"])||null,
          email1:pick(row,["email id1"])||null,
          email2:pick(row,["email id2"])||null,
          phone1:pick(row,["phone 1"])||null,
          phone2:pick(row,["phone 2"])||null,
          phone3:pick(row,["phone 3"])||null,
          tax_code:pick(row,["tax code"])||null,
          tax_description:pick(row,["tax description"])||null,
          tax_percent:pick(row,["tax %","tax percent"])||null,
          account_type:pick(row,["a/c type","account type"])||null,
          site:pick(row,["site"])||null,
          account_code:pick(row,["account code"])||null,
          payment_term:pick(row,["payment term"])||null,
          payment_term_description:pick(row,["payment term description"])||null,
          gst_party_type:pick(row,["gst party type"])||null,
          gstin:pick(row,["gstin"])||null,
        };

        const existing=byName.get(name.toLowerCase());
        if(existing){
          const patch={};
          for(const [k,v] of Object.entries(fields)){
            if(v&&!existing[k])patch[k]=v;
          }
          if(Object.keys(patch).length>0){
            await updateDoc(doc(db,"vendor_master",existing.id),{...patch,updated_at:serverTimestamp()});
            byName.set(name.toLowerCase(),{...existing,...patch});
            backfilled++;
          }
          continue;
        }

        const record={name,...fields,created_at:serverTimestamp()};
        const ref=await addDoc(collection(db,"vendor_master"),record);
        byName.set(name.toLowerCase(),{id:ref.id,...record});
        added++;
      }
      const parts=[];
      if(added>0)parts.push(`${added} new vendor${added!==1?"s":""} added`);
      if(backfilled>0)parts.push(`${backfilled} existing vendor${backfilled!==1?"s":""} backfilled with missing detail`);
      showToast(parts.length>0?parts.join(", "):"No new or missing data found — master list already up to date");
    }catch(err){showToast("Import failed: "+err.message,"error");}
    finally{setUploading(false);e.target.value="";}
  }

  async function removeVendor(v){
    if(!window.confirm(`Remove ${v.name} from the vendor master list?`))return;
    await deleteDoc(doc(db,"vendor_master",v.id));
    showToast(`${v.name} removed`);
  }

  function exportExcel(){
    const rows=vendors.map(v=>({
      "Party Name":v.name||"","Party Type":v.party_type||"","Category":v.category||"","Currency":v.currency||"",
      "Address Type":v.address_type||"","Address Description":v.address_description||"",
      "Address Line1":v.address_line1||"","Address Line2":v.address_line2||"","Address Line3":v.address_line3||"",
      "City":v.city||"","State":v.state||"","Country":v.country||"","Pin Code":v.pincode||"",
      "Contact Person 1":v.contact_person||"","Email Id1":v.email1||"","Email Id2":v.email2||"",
      "Phone 1":v.phone1||"","Phone 2":v.phone2||"","Phone 3":v.phone3||"",
      "Tax Code":v.tax_code||"","Tax Description":v.tax_description||"","Tax %":v.tax_percent||"",
      "A/C Type":v.account_type||"","Site":v.site||"","Account Code":v.account_code||"",
      "Payment Term":v.payment_term||"","Payment Term Description":v.payment_term_description||"",
      "GST Party Type":v.gst_party_type||"","GSTIN No":v.gstin||"",
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Vendors");
    XLSX.writeFile(wb,`vendor_master_${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  const filtered=search.trim()
    ?vendors.filter(v=>v.name?.toLowerCase().includes(search.toLowerCase()))
    :vendors;

  if(editVendor){
    return <VendorMasterEditForm vendor={editVendor} showToast={showToast} onClose={()=>setEditVendor(null)}/>;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:600}}>{vendors.length} vendor{vendors.length!==1?"s":""}</div>
          <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>Upload the Party List export. Every column is stored; new names are merged with the existing list.</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>
          <label className="btn-primary" style={{fontSize:12,padding:"7px 14px",cursor:"pointer"}}>
            <Icon name="plus" size={12}/>{uploading?"Uploading…":"Upload Excel"}
            <input type="file" accept=".xlsx,.xls" onChange={handleUpload} disabled={uploading} style={{display:"none"}}/>
          </label>
        </div>
      </div>

      <input style={{...fieldStyle,marginBottom:16,maxWidth:280}} placeholder="Search vendor name…" value={search} onChange={e=>setSearch(e.target.value)}/>

      {vendors.length===0
        ?<EmptyState text="No vendors in the master list yet" sub="Upload the Party List Excel to get started"/>
        :filtered.length===0
          ?<EmptyState text={`No vendors match "${search.trim()}"`}/>
          :(
            <div className="card" style={{padding:0,overflow:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#f3f4f6",borderBottom:"1px solid #e5e7eb"}}>
                  {["Vendor Name","Address","GSTIN","Phone","Email","Category","Actions"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",color:"#6b7280",fontWeight:500,fontSize:10,whiteSpace:"nowrap",...S}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filtered.map(v=>(
                    <tr key={v.id} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"6px 10px",fontWeight:600}}>{v.name}</td>
                      <td style={{padding:"6px 10px",maxWidth:260}}>{combineAddress(v)||"—"}</td>
                      <td style={{padding:"6px 10px",...S}}>{v.gstin||"—"}</td>
                      <td style={{padding:"6px 10px",...S}}>{v.phone1||"—"}</td>
                      <td style={{padding:"6px 10px"}}>{v.email1||"—"}</td>
                      <td style={{padding:"6px 10px"}}>{v.category||"—"}</td>
                      <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}>
                        <button className="btn-ghost" style={{padding:"3px 8px",fontSize:11,marginRight:6}} onClick={()=>setEditVendor(v)}><Icon name="edit" size={11}/>Edit</button>
                        <button className="btn-danger" style={{padding:"3px 8px",fontSize:11}} onClick={()=>removeVendor(v)}><Icon name="trash" size={11}/>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      }
    </div>
  );
}

// Covers the fields someone's actually likely to correct by hand — the rest
// (tax code, account code, site, currency, etc.) stay stored untouched since
// updateDoc only overwrites the fields listed here.
function VendorMasterEditForm({vendor,showToast,onClose}){
  const [name,setName]=useState(vendor.name||"");
  const [addressLine1,setAddressLine1]=useState(vendor.address_line1||"");
  const [city,setCity]=useState(vendor.city||"");
  const [state,setState]=useState(vendor.state||"");
  const [pincode,setPincode]=useState(vendor.pincode||"");
  const [gstin,setGstin]=useState(vendor.gstin||"");
  const [contactPerson,setContactPerson]=useState(vendor.contact_person||"");
  const [email1,setEmail1]=useState(vendor.email1||"");
  const [phone1,setPhone1]=useState(vendor.phone1||"");
  const [category,setCategory]=useState(vendor.category||"");
  const [paymentTermDescription,setPaymentTermDescription]=useState(vendor.payment_term_description||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  async function save(){
    if(!name.trim()){setError("Vendor name is required");return;}
    setError("");setSaving(true);
    try{
      await updateDoc(doc(db,"vendor_master",vendor.id),{
        name:name.trim(),address_line1:addressLine1.trim()||null,city:city.trim()||null,state:state.trim()||null,pincode:pincode.trim()||null,
        gstin:gstin.trim()||null,contact_person:contactPerson.trim()||null,email1:email1.trim()||null,phone1:phone1.trim()||null,
        category:category.trim()||null,payment_term_description:paymentTermDescription.trim()||null,
        updated_at:serverTimestamp(),
      });
      showToast(`${name.trim()} updated`);
      onClose();
    }catch(e){setError("Save failed: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Edit Vendor</div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Vendor name *</label>
          <input style={fieldStyle} value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>GSTIN</label>
            <input style={fieldStyle} value={gstin} onChange={e=>setGstin(e.target.value.toUpperCase())} maxLength={15}/>
          </div>
          <div>
            <label style={labelStyle}>Contact person</label>
            <input style={fieldStyle} value={contactPerson} onChange={e=>setContactPerson(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input style={fieldStyle} value={phone1} onChange={e=>setPhone1(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={fieldStyle} value={email1} onChange={e=>setEmail1(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <input style={fieldStyle} value={category} onChange={e=>setCategory(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Payment terms</label>
            <input style={fieldStyle} value={paymentTermDescription} onChange={e=>setPaymentTermDescription(e.target.value)}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:14}}>
          <div>
            <label style={labelStyle}>Address line 1</label>
            <input style={fieldStyle} value={addressLine1} onChange={e=>setAddressLine1(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>City</label>
            <input style={fieldStyle} value={city} onChange={e=>setCity(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>State</label>
            <input style={fieldStyle} value={state} onChange={e=>setState(e.target.value)}/>
          </div>
        </div>
      </div>

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626"}}>{error}</div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}><Icon name="check" size={14}/>{saving?"Saving…":"Update Vendor"}</button>
      </div>
    </div>
  );
}

function CustomerEditForm({customer,showToast,onClose}){
  const [name,setName]=useState(customer.name||"");
  const [address,setAddress]=useState(customer.address||"");
  const [gstin,setGstin]=useState(customer.gstin||"");
  const [pan,setPan]=useState(customer.pan||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  async function save(){
    if(!name.trim()){setError("Customer name is required");return;}
    setError("");setSaving(true);
    try{
      await updateDoc(doc(db,"customer_master",customer.id),{
        name:name.trim(),address:address.trim()||null,gstin:gstin.trim()||null,pan:pan.trim()||null,
        updated_at:serverTimestamp(),
      });
      showToast(`${name.trim()} updated`);
      onClose();
    }catch(e){setError("Save failed: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Edit Customer</div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Customer name *</label>
          <input style={fieldStyle} value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>GSTIN</label>
            <input style={fieldStyle} value={gstin} onChange={e=>setGstin(e.target.value.toUpperCase())} maxLength={15}/>
          </div>
          <div>
            <label style={labelStyle}>PAN</label>
            <input style={fieldStyle} value={pan} onChange={e=>setPan(e.target.value.toUpperCase())} maxLength={10}/>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Address</label>
          <textarea style={{...fieldStyle,minHeight:64,resize:"vertical"}} value={address} onChange={e=>setAddress(e.target.value)}/>
        </div>
      </div>

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626"}}>{error}</div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}><Icon name="check" size={14}/>{saving?"Saving…":"Update Customer"}</button>
      </div>
    </div>
  );
}

function UserManager({showToast}){
  const [users,setUsers]=useState([]);
  const [showAdd,setShowAdd]=useState(false);
  const [editUser,setEditUser]=useState(null); // user object currently being edited, or null
  const [newUser,setNewUser]=useState({userId:"",name:"",role:"production",password:"",confirmPassword:"",can_purchase:false,isPurchaseManager:false,wo_access:false,inventory_access:false,dispatch_access:false});
  const [saving,setSaving]=useState(false);
  const [busyId,setBusyId]=useState(null); // uid currently mid-action (remove), disables its row buttons

  useEffect(()=>onSnapshot(collection(db,"users"),snap=>setUsers(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  async function addUser(){
    if(!newUser.userId.trim()||!newUser.name.trim()){showToast("User ID and name are required","error");return;}
    if(newUser.password.length<6){showToast("Password must be at least 6 characters","error");return;}
    if(newUser.password!==newUser.confirmPassword){showToast("Passwords don't match","error");return;}
    setSaving(true);
    try{
      await callCreateUser({
        userId:newUser.userId.trim(),name:newUser.name.trim(),role:newUser.role,password:newUser.password,
        can_purchase:newUser.can_purchase,isPurchaseManager:newUser.isPurchaseManager,
        wo_access:newUser.wo_access,inventory_access:newUser.inventory_access,dispatch_access:newUser.dispatch_access,
      });
      setNewUser({userId:"",name:"",role:"production",password:"",confirmPassword:"",can_purchase:false,isPurchaseManager:false,wo_access:false,inventory_access:false,dispatch_access:false});
      setShowAdd(false);showToast(`User "${newUser.userId.trim()}" created`);
    }catch(e){showToast(e.message||"Could not create user","error");}
    finally{setSaving(false);}
  }

  async function removeUser(u){
    if(!window.confirm(`Remove ${u.name} (${u.user_id||u.email})? This deletes their login entirely and cannot be undone.`))return;
    setBusyId(u.id);
    try{
      await callDeleteUser({uid:u.id});
      showToast(`${u.name} removed`);
    }catch(e){showToast(e.message||"Could not remove user","error");}
    finally{setBusyId(null);}
  }

  return(
    <div>
      <div className="card" style={{padding:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:14,fontWeight:600}}>{users.length} user{users.length!==1?"s":""} registered</div>
          <button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setShowAdd(true)}><Icon name="plus" size={12}/>Add User</button>
        </div>
        <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{background:"#f3f4f6",borderBottom:"1px solid #e5e7eb"}}>
            {["User ID","Name","Role","Purchase Access","PO Approval","WO Access","Inventory Reports","Dispatch Access","Actions"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",color:"#6b7280",fontWeight:500,fontSize:10,whiteSpace:"nowrap",...S}}>{h}</th>)}
          </tr></thead>
          <tbody>{users.map((u,i)=>(
            <tr key={u.id} className="table-row" style={{borderBottom:"1px solid #f3f4f6",background:i%2===0?"#fff":"#fafafa"}}>
              <td style={{padding:"6px 10px",...S,fontWeight:600,color:"#1d4ed8"}}>{u.user_id||u.email}</td>
              <td style={{padding:"6px 10px",fontWeight:500}}>{u.name}</td>
              <td style={{padding:"6px 10px"}}>
                <span style={{...S,background:`${ROLE_COLORS[u.role]||"#6b7280"}18`,color:ROLE_COLORS[u.role]||"#6b7280",padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:600}}>{ROLE_LABELS[u.role]||u.role}</span>
              </td>
              <td style={{padding:"6px 10px"}}>
                <span style={{...S,background:u.can_purchase?"rgba(22,163,74,.1)":"#f3f4f6",border:`1px solid ${u.can_purchase?"rgba(22,163,74,.35)":"#e5e7eb"}`,color:u.can_purchase?"#15803d":"#9ca3af",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
                  {u.can_purchase?"✓ Enabled":"— Disabled"}
                </span>
              </td>
              <td style={{padding:"6px 10px"}}>
                <span style={{...S,background:u.isPurchaseManager?"rgba(124,58,237,.1)":"#f3f4f6",border:`1px solid ${u.isPurchaseManager?"rgba(124,58,237,.35)":"#e5e7eb"}`,color:u.isPurchaseManager?"#6d28d9":"#9ca3af",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
                  {u.isPurchaseManager?"✓ Enabled":"— Cannot Approve"}
                </span>
              </td>
              <td style={{padding:"6px 10px"}}>
                <span style={{...S,background:u.wo_access!==false?"rgba(29,78,216,.1)":"#f3f4f6",border:`1px solid ${u.wo_access!==false?"rgba(29,78,216,.35)":"#e5e7eb"}`,color:u.wo_access!==false?"#1d4ed8":"#9ca3af",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
                  {u.wo_access!==false?"✓ Enabled":"— Disabled"}
                </span>
              </td>
              <td style={{padding:"6px 10px"}}>
                <span style={{...S,background:u.inventory_access!==false?"rgba(180,83,9,.1)":"#f3f4f6",border:`1px solid ${u.inventory_access!==false?"rgba(180,83,9,.35)":"#e5e7eb"}`,color:u.inventory_access!==false?"#b45309":"#9ca3af",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
                  {u.inventory_access!==false?"✓ Enabled":"— Disabled"}
                </span>
              </td>
              <td style={{padding:"6px 10px"}}>
                <span style={{...S,background:u.dispatch_access!==false?"rgba(13,148,136,.1)":"#f3f4f6",border:`1px solid ${u.dispatch_access!==false?"rgba(13,148,136,.35)":"#e5e7eb"}`,color:u.dispatch_access!==false?"#0d9488":"#9ca3af",borderRadius:20,padding:"3px 10px",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>
                  {u.dispatch_access!==false?"✓ Enabled":"— Disabled"}
                </span>
              </td>
              <td style={{padding:"6px 10px"}}>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn-ghost" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setEditUser(u)}><Icon name="edit" size={11}/>Edit</button>
                  {u.role!=="admin"&&<button className="btn-ghost" style={{padding:"4px 10px",fontSize:11,color:"#dc2626"}} disabled={busyId===u.id} onClick={()=>removeUser(u)}><Icon name="trash" size={11}/>{busyId===u.id?"…":"Remove"}</button>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
        </div>
      </div>

      {showAdd&&(
        <div className="modal-overlay" onClick={()=>setShowAdd(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()} style={{padding:28}}>
            <div style={{fontSize:16,fontWeight:600,marginBottom:6}}>Add User</div>
            <p style={{fontSize:12,color:"#9ca3af",marginBottom:16,lineHeight:1.5}}>Creates the login and profile in one step — no Firebase Console needed.</p>
            <div style={{marginBottom:14}}>
              <label style={labelStyle}>User ID *</label>
              <input style={fieldStyle} placeholder="e.g. store1" value={newUser.userId} onChange={e=>setNewUser(p=>({...p,userId:e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g,"")}))}/>
              <div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>Lowercase letters, numbers, dots, underscores, hyphens only. This is what they'll type to log in.</div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={labelStyle}>Full name *</label>
              <input style={fieldStyle} placeholder="Ravi Kumar" value={newUser.name} onChange={e=>setNewUser(p=>({...p,name:e.target.value}))}/>
            </div>
            <div style={{marginBottom:14}}>
              <label style={labelStyle}>Role *</label>
              <select style={fieldStyle} value={newUser.role} onChange={e=>setNewUser(p=>({...p,role:e.target.value}))}>
                {ROLES.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={labelStyle}>Password *</label>
                <input style={fieldStyle} type="password" placeholder="Min. 6 characters" value={newUser.password} onChange={e=>setNewUser(p=>({...p,password:e.target.value}))}/>
              </div>
              <div>
                <label style={labelStyle}>Confirm password *</label>
                <input style={fieldStyle} type="password" placeholder="Repeat password" value={newUser.confirmPassword} onChange={e=>setNewUser(p=>({...p,confirmPassword:e.target.value}))}/>
              </div>
            </div>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div><div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Purchase / PO access</div><div style={{fontSize:11,color:"#9ca3af"}}>Allow raising POs and GRNs</div></div>
              <button onClick={()=>setNewUser(p=>({...p,can_purchase:!p.can_purchase}))} style={{...S,background:newUser.can_purchase?"rgba(22,163,74,.1)":"#f3f4f6",border:`1px solid ${newUser.can_purchase?"rgba(22,163,74,.4)":"#d1d5db"}`,color:newUser.can_purchase?"#15803d":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {newUser.can_purchase?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div><div style={{fontSize:12,fontWeight:600,color:"#374151"}}>PO approval rights</div><div style={{fontSize:11,color:"#9ca3af"}}>Can approve/reject pending purchase orders</div></div>
              <button onClick={()=>setNewUser(p=>({...p,isPurchaseManager:!p.isPurchaseManager}))} style={{...S,background:newUser.isPurchaseManager?"rgba(124,58,237,.1)":"#f3f4f6",border:`1px solid ${newUser.isPurchaseManager?"rgba(124,58,237,.4)":"#d1d5db"}`,color:newUser.isPurchaseManager?"#6d28d9":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {newUser.isPurchaseManager?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div><div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Work Order access</div><div style={{fontSize:11,color:"#9ca3af"}}>View and update work orders</div></div>
              <button onClick={()=>setNewUser(p=>({...p,wo_access:!p.wo_access}))} style={{...S,background:newUser.wo_access?"rgba(29,78,216,.1)":"#f3f4f6",border:`1px solid ${newUser.wo_access?"rgba(29,78,216,.4)":"#d1d5db"}`,color:newUser.wo_access?"#1d4ed8":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {newUser.wo_access?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div><div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Inventory Reports access</div><div style={{fontSize:11,color:"#9ca3af"}}>View and update RM Inventory</div></div>
              <button onClick={()=>setNewUser(p=>({...p,inventory_access:!p.inventory_access}))} style={{...S,background:newUser.inventory_access?"rgba(180,83,9,.1)":"#f3f4f6",border:`1px solid ${newUser.inventory_access?"rgba(180,83,9,.4)":"#d1d5db"}`,color:newUser.inventory_access?"#b45309":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {newUser.inventory_access?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:20,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div><div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Dispatch access</div><div style={{fontSize:11,color:"#9ca3af"}}>Mark ready orders as dispatched</div></div>
              <button onClick={()=>setNewUser(p=>({...p,dispatch_access:!p.dispatch_access}))} style={{...S,background:newUser.dispatch_access?"rgba(13,148,136,.1)":"#f3f4f6",border:`1px solid ${newUser.dispatch_access?"rgba(13,148,136,.4)":"#d1d5db"}`,color:newUser.dispatch_access?"#0d9488":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {newUser.dispatch_access?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button className="btn-ghost" onClick={()=>setShowAdd(false)}>Cancel</button>
              <button className="btn-primary" disabled={saving} onClick={addUser}><Icon name="check" size={13}/>{saving?"Creating…":"Add User"}</button>
            </div>
          </div>
        </div>
      )}

      {editUser&&<EditUserModal user={editUser} showToast={showToast} onClose={()=>setEditUser(null)}/>}
    </div>
  );
}

// ─── Edit user: name/role/flags via plain Firestore write, password via Cloud Function ──
function EditUserModal({user,showToast,onClose}){
  const [name,setName]=useState(user.name||"");
  const [role,setRole]=useState(user.role||"production");
  const [canPurchase,setCanPurchase]=useState(!!user.can_purchase);
  const [isPOManager,setIsPOManager]=useState(!!user.isPurchaseManager);
  const [woAccess,setWoAccess]=useState(user.wo_access!==false);
  const [inventoryAccess,setInventoryAccess]=useState(user.inventory_access!==false);
  const [dispatchAccess,setDispatchAccess]=useState(user.dispatch_access!==false);
  const [saving,setSaving]=useState(false);
  const [newPassword,setNewPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [resetting,setResetting]=useState(false);

  async function saveProfile(){
    if(!name.trim()){showToast("Name is required","error");return;}
    setSaving(true);
    try{
      await updateDoc(doc(db,"users",user.id),{name:name.trim(),role,can_purchase:canPurchase,isPurchaseManager:isPOManager,wo_access:woAccess,inventory_access:inventoryAccess,dispatch_access:dispatchAccess});
      showToast("Profile updated");
      onClose();
    }catch(e){showToast("Update failed: "+e.message,"error");}
    finally{setSaving(false);}
  }

  async function resetPassword(){
    if(newPassword.length<6){showToast("Password must be at least 6 characters","error");return;}
    if(newPassword!==confirmPassword){showToast("Passwords don't match","error");return;}
    setResetting(true);
    try{
      await callResetPassword({uid:user.id,newPassword});
      showToast(`Password reset for ${user.user_id||user.name}`);
      setNewPassword("");setConfirmPassword("");
    }catch(e){showToast(e.message||"Reset failed","error");}
    finally{setResetting(false);}
  }

  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{padding:28}}>
        <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>Edit {user.user_id||user.name}</div>
        <div style={{fontSize:12,color:"#9ca3af",marginBottom:20}}>User ID can't be changed after creation.</div>

        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Full name</label>
          <input style={fieldStyle} value={name} onChange={e=>setName(e.target.value)}/>
        </div>
        <div style={{marginBottom:20}}>
          <label style={labelStyle}>Role</label>
          <select style={fieldStyle} value={role} onChange={e=>setRole(e.target.value)}>
            {ROLES.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        {role==="admin"
          ?<div style={{marginBottom:20,padding:"10px 14px",background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:8,fontSize:12,color:"#6d28d9"}}>
              Admins always have full access to every module and permission — these toggles don't apply.
            </div>
          :<>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Purchase / PO access</div>
              <button onClick={()=>setCanPurchase(v=>!v)} style={{...S,background:canPurchase?"rgba(22,163,74,.1)":"#f3f4f6",border:`1px solid ${canPurchase?"rgba(22,163,74,.4)":"#d1d5db"}`,color:canPurchase?"#15803d":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {canPurchase?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>PO approval rights</div>
              <button onClick={()=>setIsPOManager(v=>!v)} style={{...S,background:isPOManager?"rgba(124,58,237,.1)":"#f3f4f6",border:`1px solid ${isPOManager?"rgba(124,58,237,.4)":"#d1d5db"}`,color:isPOManager?"#6d28d9":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {isPOManager?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Work Order access</div>
              <button onClick={()=>setWoAccess(v=>!v)} style={{...S,background:woAccess?"rgba(29,78,216,.1)":"#f3f4f6",border:`1px solid ${woAccess?"rgba(29,78,216,.4)":"#d1d5db"}`,color:woAccess?"#1d4ed8":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {woAccess?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:14,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Inventory Reports access</div>
              <button onClick={()=>setInventoryAccess(v=>!v)} style={{...S,background:inventoryAccess?"rgba(180,83,9,.1)":"#f3f4f6",border:`1px solid ${inventoryAccess?"rgba(180,83,9,.4)":"#d1d5db"}`,color:inventoryAccess?"#b45309":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {inventoryAccess?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
            <div style={{marginBottom:20,padding:"10px 14px",background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#374151"}}>Dispatch access</div>
              <button onClick={()=>setDispatchAccess(v=>!v)} style={{...S,background:dispatchAccess?"rgba(13,148,136,.1)":"#f3f4f6",border:`1px solid ${dispatchAccess?"rgba(13,148,136,.4)":"#d1d5db"}`,color:dispatchAccess?"#0d9488":"#6b7280",borderRadius:20,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                {dispatchAccess?"✓ Enabled":"✕ Disabled"}
              </button>
            </div>
          </>
        }
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginBottom:24}}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={saveProfile}><Icon name="check" size={13}/>{saving?"Saving…":"Save Changes"}</button>
        </div>

        <div style={{borderTop:"1px solid #f3f4f6",paddingTop:18}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:10,color:"#1a1f2e"}}>Reset password</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div>
              <label style={labelStyle}>New password</label>
              <input style={fieldStyle} type="password" placeholder="Min. 6 characters" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
            </div>
            <div>
              <label style={labelStyle}>Confirm</label>
              <input style={fieldStyle} type="password" placeholder="Repeat password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/>
            </div>
          </div>
          <button className="btn-ghost" disabled={resetting||!newPassword} onClick={resetPassword}>{resetting?"Resetting…":"Reset Password"}</button>
        </div>
      </div>
    </div>
  );
}

function SeedData({showToast}){
  const [done,setDone]=useState(false);
  const [busy,setBusy]=useState(false);
  const RM=[
    {material_name:"Copper rod / wire",category:"Copper",unit:"kg",current_stock:0,low_stock_threshold:50},
    {material_name:"Aluminium rod / wire",category:"Aluminium",unit:"kg",current_stock:0,low_stock_threshold:50},
    {material_name:"Insulation tape / paper",category:"Insulation",unit:"kg",current_stock:0,low_stock_threshold:20},
    {material_name:"Varnish",category:"Varnish",unit:"L",current_stock:0,low_stock_threshold:10},
  ];
  async function seed(){
    setBusy(true);
    try{
      for(const m of RM)await addDoc(collection(db,"rm_inventory"),{...m,lead_time_days:30,monthly_consumption:0,consumption_mode:"manual",months_to_order:3,safety_stock_days:0,reorder_point:0,suggested_order_qty:0,created_at:serverTimestamp()});
      setDone(true);showToast("RM materials seeded successfully");
    }catch(e){showToast("Seed failed: "+e.message,"error");}
    finally{setBusy(false);}
  }
  return(
    <div className="card" style={{padding:20}}>
      <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>Seed RM materials</div>
      <p style={{fontSize:13,color:"#6b7280",marginBottom:16,lineHeight:1.5}}>Populates the 4 default raw material categories into Firestore. Run once after initial setup.</p>
      {done
        ?<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"12px 16px",fontSize:13,color:"#16a34a",fontWeight:600}}>✓ Materials seeded successfully</div>
        :<button className="btn-primary" disabled={busy} onClick={seed}><Icon name="check" size={13}/>{busy?"Seeding…":"Seed RM Materials"}</button>
      }
    </div>
  );
}
