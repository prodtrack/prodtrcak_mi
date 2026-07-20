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
    inbox:<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></>,
    alert:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
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
// Free-text input with a live-filtered suggestions dropdown underneath —
// typing anything not in `options` is still accepted as-is (this never
// forces a selection). Clicking a suggestion fills the text field with
// `record[displayKey]` and, if provided, hands the FULL matched record to
// onSelect — so a caller can pull extra fields (address/GSTIN/PAN etc.)
// off a match even though this input itself only ever displays the name.
export function FuzzyAutocomplete({label,value,onChange,onSelect,options,displayKey="name",placeholder="Start typing…",required=false}){
  const [open,setOpen]=useState(false);
  const matches=fuzzyMatch(value,options,displayKey);

  return(
    <div style={{position:"relative"}}>
      {label&&<label style={labelStyle}>{label}{required&&" *"}</label>}
      <input
        style={fieldStyle}
        value={value||""}
        placeholder={placeholder}
        onChange={e=>{onChange(e.target.value);setOpen(true);}}
        onFocus={()=>setOpen(true)}
        onBlur={()=>setTimeout(()=>setOpen(false),150)}
      />
      {open&&matches.length>0&&(
        <div style={{position:"absolute",zIndex:20,top:"100%",left:0,right:0,background:"#fff",border:"1px solid #e5e7eb",borderRadius:8,marginTop:4,boxShadow:"0 4px 12px rgba(0,0,0,.1)",maxHeight:200,overflowY:"auto"}}>
          {matches.map((m,i)=>{
            const text=typeof m==="string"?m:m?.[displayKey];
            return(
              <div key={i}
                style={{padding:"8px 12px",cursor:"pointer",fontSize:13,color:"#1a1f2e",borderBottom:i<matches.length-1?"1px solid #f3f4f6":undefined}}
                onMouseDown={()=>{onChange(text);onSelect&&onSelect(typeof m==="string"?{[displayKey]:m}:m);setOpen(false);}}
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
