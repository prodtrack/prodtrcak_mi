// ─── shared.jsx ─────────────────────────────────────────────────────────────
// Cross-cutting constants and UI primitives shared between App.jsx and every
// module under /purchase. Keep this file generic — anything specific to work
// orders, purchasing, etc. belongs in its own module, not here.

import { useState, useEffect } from "react";

// ─── Design tokens ──────────────────────────────────────────────────────────
export const S = { fontFamily:"'Space Mono',monospace" };

// ─── Roles (shared across all modules) ──────────────────────────────────────
export const ROLES        = ["admin","production","store","sales","purchase"];
export const ROLE_LABELS  = {admin:"Admin",production:"Production",store:"Store",sales:"Sales / Dispatch",purchase:"Purchase"};
export const ROLE_COLORS  = {admin:"#e8c547",production:"#059669",store:"#2563eb",sales:"#7c3aed",purchase:"#d97706"};

// ─── Mobile detection ───────────────────────────────────────────────────────
// Single source of truth for "are we on a phone-width screen" — every
// component that needs to swap a layout for mobile uses this instead of its
// own resize listener. 768px matches the usual tablet/phone breakpoint.
export function useIsMobile(){
  const [isMobile,setIsMobile]=useState(typeof window!=="undefined"?window.innerWidth<=768:false);
  useEffect(()=>{
    function onResize(){setIsMobile(window.innerWidth<=768);}
    window.addEventListener("resize",onResize);
    return()=>window.removeEventListener("resize",onResize);
  },[]);
  return isMobile;
}

// ─── Date / FY helpers ───────────────────────────────────────────────────────
export function getFY(){const n=new Date(),y=n.getFullYear(),m=n.getMonth(),s=m>=3?y:y-1;return String(s).slice(2)+String(s+1).slice(2);}
export function formatDate(d){if(!d)return"—";return new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});}
export function isOverdue(d){if(!d)return false;return new Date(d)<new Date();}

// ─── Icon ─────────────────────────────────────────────────────────────────────
export function Icon({name,size=14}){
  const icons={
    plus:<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    check:<polyline points="20 6 9 17 4 12"/>,
    x:<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    edit:<><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></>,
    logout:<><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    arrow:<polyline points="15 18 9 12 15 6"/>,
    calendar:<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
    user:<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    truck:<><rect x="1" y="7" width="15" height="10" rx="1"/><path d="M16 10h3l3 3v4h-6z"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></>,
    building:<><rect x="4" y="3" width="16" height="18" rx="1"/><line x1="8" y1="7" x2="8" y2="7.01"/><line x1="12" y1="7" x2="12" y2="7.01"/><line x1="16" y1="7" x2="16" y2="7.01"/><line x1="8" y1="11" x2="8" y2="11.01"/><line x1="12" y1="11" x2="12" y2="11.01"/><line x1="16" y1="11" x2="16" y2="11.01"/><line x1="8" y1="15" x2="16" y2="15"/></>,
    clipboard:<><rect x="6" y="3" width="12" height="4" rx="1"/><path d="M9 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-3"/></>,
    file:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
    inbox:<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></>,
    alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    printer:<><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
    menu:<><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    document:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></>,
    list:<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    bag:<><path d="M6 2l-2 5h16l-2-5"/><path d="M4 7h16v13a2 2 0 01-2 2H6a2 2 0 01-2-2V7z"/><path d="M9 11a3 3 0 006 0"/></>,
    box:<><path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
    "help-circle":<><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    award:<><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></>,
    tool:<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>,
    cart:<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>,
    layers:<><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    send:<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    sliders:<><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>{icons[name]||null}</svg>;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
export function useToast(){
  const [toast,setToast]=useState(null);
  const show=(msg,type="ok")=>{setToast({msg,type});setTimeout(()=>setToast(null),3000);};
  const el=toast&&<div className={`toast${toast.type==="error"?" error":""}`}>{toast.msg}</div>;
  return [show,el];
}

// ─── Section header ────────────────────────────────────────────────────────────
export function SectionHeader({mono,title,sub}){
  return(
    <div style={{marginBottom:4}}>
      {mono&&<div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{mono}</div>}
      <div style={{fontSize:18,fontWeight:700,color:"#1a1f2e"}}>{title}</div>
      {sub&&<div style={{fontSize:13,color:"#6b7280",marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export function EmptyState({text,sub}){
  return(
    <div style={{textAlign:"center",padding:"60px 24px",color:"#9ca3af"}}>
      <div style={{fontSize:40,marginBottom:12}}>📋</div>
      <div style={{fontSize:14,fontWeight:500,color:"#6b7280",marginBottom:4}}>{text}</div>
      {sub&&<div style={{fontSize:12,color:"#9ca3af"}}>{sub}</div>}
    </div>
  );
}

// ─── Access denied ──────────────────────────────────────────────────────────
// Shown when a tab's content is reached without the required permission —
// a defense-in-depth check behind the nav filter, not just a nicety. If the
// nav ever fails to hide a tab (a bug, or the tab's own state getting set
// directly), this stops the actual content from rendering regardless.
export function AccessDenied(){
  return(
    <div style={{textAlign:"center",padding:"80px 24px",color:"#9ca3af"}}>
      <div style={{fontSize:40,marginBottom:12}}>🔒</div>
      <div style={{fontSize:14,fontWeight:500,color:"#6b7280",marginBottom:4}}>You don't have access to this</div>
      <div style={{fontSize:12,color:"#9ca3af"}}>Ask an Admin to enable this permission for your account.</div>
    </div>
  );
}

// ─── Shared field styles (form inputs across modules) ──────────────────────────
export const fieldStyle={background:"#fff",border:"1px solid #9ca3af",borderRadius:8,padding:"9px 13px",color:"#1a1f2e",fontSize:13,width:"100%",outline:"none",fontFamily:"'Roboto',sans-serif",transition:"border .15s,box-shadow .15s"};
export const labelStyle={fontSize:12,color:"#374151",fontWeight:600,display:"block",marginBottom:6};

// ─── Fuzzy matching (no external dependency — dedicated to typo/partial
// tolerance on short-to-medium strings like customer names, not a general
// search engine) ──────────────────────────────────────────────────────────────
export function levenshteinDistance(a,b){
  a=(a||"").toLowerCase(); b=(b||"").toLowerCase();
  const m=a.length,n=b.length;
  if(m===0)return n;
  if(n===0)return m;
  const dp=Array.from({length:m+1},()=>new Array(n+1).fill(0));
  for(let i=0;i<=m;i++)dp[i][0]=i;
  for(let j=0;j<=n;j++)dp[0][j]=j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// Ranks `list` against `query` — exact match first, then starts-with, then
// contains (handles partial typing), then close-edit-distance (handles
// typos on the full string) — anything not matching any of those is
// excluded entirely rather than scored low, so the list stays short and
// relevant instead of showing everything sorted by "how different is it".
export function fuzzyMatch(query,list,key="name",limit=6){
  const q=(query||"").trim().toLowerCase();
  if(!q)return [];
  const scored=[];
  for(const item of (list||[])){
    const text=(typeof item==="string"?item:item?.[key]||"").toLowerCase();
    if(!text)continue;
    let score=null;
    if(text===q)score=0;
    else if(text.startsWith(q))score=1;
    else if(text.includes(q))score=2;
    else{
      const dist=levenshteinDistance(q,text);
      const threshold=Math.max(2,Math.floor(q.length*0.4));
      if(dist<=threshold)score=3+dist;
    }
    if(score!==null)scored.push({item,score});
  }
  scored.sort((a,b)=>a.score-b.score);
  return scored.slice(0,limit).map(s=>s.item);
}

// ─── Fuzzy autocomplete input ────────────────────────────────────────────────
// Free-text input with a live-filtered suggestions dropdown underneath.
// Two modes:
//  - Default (strict=false): typing anything not in `options` is still
//    accepted as-is — used where there's no linked record behind the value
//    (Tender's Company, WO's Customer name — plain text fields).
//  - strict=true: the field must resolve to an actual clicked suggestion.
//    Typing is tracked in a local draft buffer; if the field is left without
//    picking a real match, it snaps back to the last confirmed value on
//    blur. Used wherever the selection has to stay linked to a real record
//    (a vendor_id, not just a name) — PO/GRN/MRP's vendor pickers.
// Either way, clicking a suggestion hands the FULL matched record to
// onSelect, not just the display text, so a caller can pull extra fields
// (address/GSTIN/id etc.) off a match.
export function FuzzyAutocomplete({label,value,onChange,onSelect,options,displayKey="name",placeholder="Start typing…",required=false,strict=false}){
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState(value||"");

  useEffect(()=>{ if(strict) setDraft(value||""); },[value,strict]);

  const displayValue=strict?draft:(value||"");
  const matches=fuzzyMatch(displayValue,options,displayKey);

  function handleTyping(v){
    if(strict)setDraft(v);
    else onChange(v);
    setOpen(true);
  }
  function handlePick(m){
    const text=typeof m==="string"?m:m?.[displayKey];
    if(strict)setDraft(text);
    onChange(text);
    onSelect&&onSelect(typeof m==="string"?{[displayKey]:m}:m);
    setOpen(false);
  }
  function handleBlur(){
    setTimeout(()=>{
      setOpen(false);
      if(strict)setDraft(value||""); // snap back — no real match was confirmed
    },150);
  }

  return(
    <div style={{position:"relative"}}>
      {label&&<label style={labelStyle}>{label}{required&&" *"}</label>}
      <input
        style={fieldStyle}
        value={displayValue}
        placeholder={placeholder}
        onChange={e=>handleTyping(e.target.value)}
        onFocus={()=>setOpen(true)}
        onBlur={handleBlur}
      />
      {open&&matches.length>0&&(
        <div style={{position:"absolute",zIndex:20,top:"100%",left:0,right:0,background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,marginTop:4,boxShadow:"0 4px 12px rgba(0,0,0,.1)",maxHeight:200,overflowY:"auto"}}>
          {matches.map((m,i)=>{
            const text=typeof m==="string"?m:m?.[displayKey];
            return(
              <div key={i}
                style={{padding:"8px 12px",cursor:"pointer",fontSize:13,color:"#1a1f2e",borderBottom:i<matches.length-1?"1px solid #f3f4f6":undefined}}
                onMouseDown={()=>handlePick(m)}
                onMouseEnter={e=>e.currentTarget.style.background="#f9fafb"}
                onMouseLeave={e=>e.currentTarget.style.background="#fff"}
              >
                {text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
