// ─── PurchaseTab.jsx ────────────────────────────────────────────────────────
// Master tab for the Purchase module. Owns only sub-navigation — all real
// logic lives in the individual sub-tab files. This is the ONE file App.jsx
// needs to know about; everything else under /purchase is private to this
// module.

import { useState } from "react";
import { SectionHeader } from "../shared.jsx";
import PurchaseRequisitionsTab from "./PurchaseRequisitionsTab.jsx";
import PurchaseOrdersTab from "./PurchaseOrdersTab.jsx";
import GINTab from "./GINTab.jsx";
import QGINTab from "./QGINTab.jsx";
import GRNTab from "./GRNTab.jsx";
import PurchaseVendorsTab from "./PurchaseVendorsTab.jsx";
import MRPQueueTab from "./MRPQueueTab.jsx";

const SUBTABS=[
  {id:"requisitions", label:"Requisitions"},
  {id:"orders", label:"Purchase Orders"},
  {id:"gin",    label:"Goods Inward"},
  {id:"qgin",   label:"Quality GIN"},
  {id:"grn",    label:"GRN"},
  {id:"vendors",label:"Vendors"},
  {id:"mrp",    label:"MRP Queue"},
];

export default function PurchaseTab({profile,showToast}){
  const [subtab,setSubtab]=useState("requisitions");

  return(
    <div>
      <div style={{marginBottom:16}}><SectionHeader mono="Procurement" title="Purchase" sub="Vendors, purchase orders, and goods receipt"/></div>

      <div style={{display:"flex",gap:0,background:"#f3f4f6",border:"1px solid #e5e7eb",borderRadius:8,padding:3,width:"fit-content",marginBottom:24,flexWrap:"wrap"}}>
        {SUBTABS.map(t=>(
          <button key={t.id} onClick={()=>setSubtab(t.id)} style={{padding:"7px 16px",borderRadius:6,border:"none",cursor:"pointer",fontSize:13,fontWeight:subtab===t.id?600:400,background:subtab===t.id?"#e8c547":"transparent",color:subtab===t.id?"#1a1f2e":"#6b7280",fontFamily:"'Roboto',sans-serif",transition:"all .15s"}}>
            {t.label}
          </button>
        ))}
      </div>

      {subtab==="requisitions" &&<PurchaseRequisitionsTab profile={profile} showToast={showToast}/>}
      {subtab==="orders" &&<PurchaseOrdersTab profile={profile} showToast={showToast}/>}
      {subtab==="gin"    &&<GINTab            profile={profile} showToast={showToast}/>}
      {subtab==="qgin"   &&<QGINTab           profile={profile} showToast={showToast}/>}
      {subtab==="grn"    &&<GRNTab            profile={profile} showToast={showToast}/>}
      {subtab==="vendors"&&<PurchaseVendorsTab profile={profile} showToast={showToast}/>}
      {subtab==="mrp"    &&<MRPQueueTab       profile={profile} showToast={showToast}/>}
    </div>
  );
}
