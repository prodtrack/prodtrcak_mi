// ─── GRNTab.jsx ─────────────────────────────────────────────────────────────
// Merged GIN/GRN tab. "Receipts" is the GIN workflow — raise against an
// approved PO, capture Challan/Vehicle/Bill/LR detail, approve, then QGIN
// inspects and posts the actual GRN. This IS the "Receive against PO" step
// now — there's no separate, thinner "Receive against PO" shortcut anymore;
// that's been folded in here so there's one path in, not two with very
// different amounts of captured data. "Posted History" is the flat, final
// record of everything that has actually hit stock — via this GIN→QGIN
// chain, or via Direct Receipt below, which still posts instantly and skips
// QGIN entirely by design (no PO to inspect against).
// GIN data lives in `goods_inward_notes` (read by QGINTab.jsx — untouched
// by this merge); posted history lives in `goods_inward`.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle, FuzzyAutocomplete } from "../shared.jsx";
import {
  PLANTS, UNITS, GIN_TYPES, GIN_STATUSES, GIN_STATUS_LABELS, GIN_STATUS_COLORS,
  generateGINNumber, generateQGINNumber, generateGRNNumber, poReceivedStatus, PO_STATUS_LABELS,
} from "./purchaseHelpers";
import { printGoodsInwardNote } from "./GINPrintView.jsx";
import { CustomFieldsEditor } from "./PurchaseFormControls.jsx";

export default function GRNTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canCreate=isAdmin||["store"].includes(profile.role)||!!profile.can_purchase;
  const canApprove=isAdmin||!!profile.isPurchaseManager;

  // ── shared data ──
  const [gins,setGins]=useState([]);
  const [pos,setPos]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [suppliers,setSuppliers]=useState([]);
  const [holds,setHolds]=useState([]);

  // ── unified list view state ──
  const [statusFilter,setStatusFilter]=useState("all");
  const [plantFilter,setPlantFilter]=useState("all");
  const [ginSearch,setGinSearch]=useState("");
  const [ginExpandedId,setGinExpandedId]=useState(null);
  const [ginEditingId,setGinEditingId]=useState(null);
  const [ginSelectedId,setGinSelectedId]=useState(null);
  const [creatingNew,setCreatingNew]=useState(false);
  const [ginSortField,setGinSortField]=useState("created_at");
  const [ginSortDir,setGinSortDir]=useState("desc");
  const [ginPage,setGinPage]=useState(1);
  const [ginDateFrom,setGinDateFrom]=useState("");
  const [ginDateTo,setGinDateTo]=useState("");
  const GIN_PAGE_SIZE=10;

  const [mode,setMode]=useState(null); // null | "direct"
  const [holdRemark,setHoldRemark]=useState({});
  const [holdSaving,setHoldSaving]=useState({});

  useEffect(()=>{
    const q=query(collection(db,"goods_inward_notes"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setGins(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>{
    const q=query(collection(db,"purchase_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setPos(s.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),s=>setMaterials(s.docs.map(d=>({id:d.id,...d.data()})))),[]);
  useEffect(()=>onSnapshot(collection(db,"supplier_master"),s=>setSuppliers(s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.active!==false))),[]);
  useEffect(()=>{
    const q=query(collection(db,"grn_holds"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setHolds(s.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  // ── derived state ──
  const gq=ginSearch.trim().toLowerCase();
  const ginFiltered=gins.filter(g=>{
    const d=g.created_at?.toDate?g.created_at.toDate():(g.created_at?new Date(g.created_at):null);
    const dISO=d?d.toISOString().slice(0,10):null;
    return (statusFilter==="all"||g.status===statusFilter)&&
    (plantFilter==="all"||g.plant===plantFilter)&&
    (!ginDateFrom||(dISO&&dISO>=ginDateFrom))&&
    (!ginDateTo||(dISO&&dISO<=ginDateTo))&&
    (!gq||
      g.gin_number?.toLowerCase().includes(gq)||
      g.vendor_name?.toLowerCase().includes(gq)||
      g.po_number?.toLowerCase().includes(gq)||
      g.challan_no?.toLowerCase().includes(gq)
    );
  });
  const ginHasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||gq.length>0;

  function ginField(gin,field){
    switch(field){
      case "gin_number":return gin.gin_number||"";
      case "gin_type":return gin.gin_type||"";
      case "po_number":return gin.po_number||"";
      case "vendor_name":return gin.vendor_name||"";
      case "plant":return gin.plant||"";
      case "created_at":return gin.created_at?.toDate?gin.created_at.toDate().getTime():(gin.created_at?new Date(gin.created_at).getTime():0);
      case "status":return gin.status||"";
      case "vehicle_no":return gin.vehicle_no||"";
      case "grn_number":return gin.grn_number||"";
      default:return "";
    }
  }
  const ginSorted=[...ginFiltered].sort((a,b)=>{
    const va=ginField(a,ginSortField),vb=ginField(b,ginSortField);
    const cmp=typeof va==="number"&&typeof vb==="number"?va-vb:String(va).localeCompare(String(vb));
    return ginSortDir==="asc"?cmp:-cmp;
  });
  const ginTotalPages=Math.max(1,Math.ceil(ginSorted.length/GIN_PAGE_SIZE));
  const ginPageSafe=Math.min(ginPage,ginTotalPages);
  const ginPaginated=ginSorted.slice((ginPageSafe-1)*GIN_PAGE_SIZE,ginPageSafe*GIN_PAGE_SIZE);

  function onGinSort(field){
    if(ginSortField===field)setGinSortDir(d=>d==="asc"?"desc":"asc");
    else{setGinSortField(field);setGinSortDir("asc");}
    setGinPage(1);
  }

  function ginEditability(gin,canCreate){
    const canEdit=["draft","pending_approval","approved"].includes(gin.status)&&canCreate;
    const canCancel=["draft","pending_approval"].includes(gin.status);
    return {canEdit,canCancel};
  }

  function selectGinRow(id){setGinSelectedId(prev=>prev===id?null:id);setGinExpandedId(null);setGinEditingId(null);}
  function openGinView(){if(ginSelectedId){setGinExpandedId(ginSelectedId);setGinEditingId(null);}}
  function openGinEdit(){if(ginSelectedId){setGinExpandedId(ginSelectedId);setGinEditingId(ginSelectedId);}}
  function closeGinDetail(){setGinExpandedId(null);setGinEditingId(null);}

  async function cancelGIN(gin){
    if(!window.confirm(`Cancel ${gin.gin_number}? This cannot be undone.`))return;
    await updateDoc(doc(db,"goods_inward_notes",gin.id),{status:"cancelled",cancelled_by:profile.name||auth.currentUser.email,cancelled_at:serverTimestamp()});
    showToast(`${gin.gin_number} cancelled`);
  }

  function exportGinExcel(){
    const rows=[];
    ginSorted.forEach(gin=>{
      const po=gin.po_id?pos.find(p=>p.id===gin.po_id):null;
      const poDate=po?.created_at?formatDate(po.created_at?.toDate?po.created_at.toDate():po.created_at):"";
      (gin.line_items||[]).forEach(it=>{
        const poLine=po?.line_items?.find(pl=>pl.material_id===it.material_id);
        const acceptedQty=parseFloat(it.accepted_qty)||0;
        const rate=parseFloat(poLine?.rate)||0;
        rows.push({
          "Vendor Name":gin.vendor_name||"",
          "GRN Number":gin.grn_number||"",
          "GRN Date":gin.created_at?formatDate(gin.created_at?.toDate?gin.created_at.toDate():gin.created_at):"",
          "GRN Status":GIN_STATUS_LABELS[gin.status]||gin.status||"",
          "Challan/Invoice No":gin.challan_no||"",
          "Challan Date":gin.challan_date?formatDate(gin.challan_date):"",
          "Item Code":it.item_code||"",
          "Item Name":it.material_name||"",
          "Item Description":it.item_description||"",
          "GRN UOM":it.unit||"",
          "Received Qty":it.actual_challan_qty??"",
          "Accepted Qty":acceptedQty,
          "PO/CPO Number":gin.po_number||"",
          "PO/CPO Date":poDate,
          "Required Date":poLine?.required_date?formatDate(poLine.required_date):"",
          "Item Amount":acceptedQty*rate,
        });
      });
    });
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Receipts");
    XLSX.writeFile(wb,`GIN_Receipts_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("Exported to Excel");
  }

  // ── Posted History (GRN) derived state ──
  async function approveHold(hold){
    setHoldSaving(p=>({...p,[hold.id]:true}));
    try{
      const now=serverTimestamp();
      const postedAtStr=new Date().toISOString().split("T")[0];
      const operatorName=profile.name||auth.currentUser.email;
      const newRef=await addDoc(collection(db,"rm_inventory"),{
        material_name:hold.material_name,unit:hold.unit||"kg",
        current_stock:hold.quantity,low_stock_threshold:0,
        created_at:now,
      });
      const grnNumber=await generateGRNNumber(hold.plant);
      await addDoc(collection(db,"goods_inward_notes"),{
        gin_number:null,grn_number:grnNumber,source:"direct",
        plant:hold.plant,vendor_id:null,vendor_name:hold.supplier_name||"",
        po_id:null,po_number:null,
        line_items:[{
          item_code:"",material_id:newRef.id,material_name:hold.material_name,
          item_description:"",unit:hold.unit||"kg",
          challan_qty:hold.quantity,accepted_qty:hold.quantity,rejected_qty:0,actual_challan_qty:hold.quantity,
          remarks:holdRemark[hold.id]||hold.remarks||"",
          posted:true,posted_qty:hold.quantity,posted_at:postedAtStr,posted_by:hold.operator_name,
        }],
        remarks:holdRemark[hold.id]||hold.remarks||null,comments:null,
        status:"completed",
        created_by:hold.operator_uid,created_by_name:hold.operator_name,created_at:now,
      });
      await updateDoc(doc(db,"grn_holds",hold.id),{status:"approved",approved_at:now,approved_by:operatorName,admin_remarks:holdRemark[hold.id]||null});
      showToast(`${hold.material_name} approved & added to inventory`);
    }catch(e){showToast("Error: "+e.message,"error");}
    finally{setHoldSaving(p=>({...p,[hold.id]:false}));}
  }
  async function rejectHold(hold){
    await updateDoc(doc(db,"grn_holds",hold.id),{status:"rejected",rejected_at:serverTimestamp(),rejected_by:profile.name||auth.currentUser.email});
    showToast(`Hold rejected for ${hold.material_name}`);
  }

  const pendingHolds=holds.filter(h=>h.status==="pending");

  // ── Full-page detail / form / mode overrides ──
  if(creatingNew){
    return <GINForm profile={profile} pos={pos} showToast={showToast} onClose={()=>setCreatingNew(false)}/>;
  }
  if(mode==="direct"){
    return <DirectReceipt profile={profile} materials={materials} suppliers={suppliers} showToast={showToast} onClose={()=>setMode(null)}/>;
  }
  if(ginExpandedId){
    const gin=gins.find(g=>g.id===ginExpandedId);
    if(gin){
      const {canEdit,canCancel}=ginEditability(gin,canCreate);
      return(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={closeGinDetail}><Icon name="arrow" size={14}/>Back</button>
            <div style={{fontSize:14,fontWeight:600}}>{gin.gin_number}</div>
          </div>
          {ginEditingId===gin.id
            ? <GINForm profile={profile} pos={pos} existing={gin} showToast={showToast} onClose={closeGinDetail}/>
            : <GINDetailPanel gin={gin} profile={profile} pos={pos} showToast={showToast} canApprove={canApprove} canEdit={canEdit} canCancel={canCancel}
                onEdit={openGinEdit} onCancel={()=>cancelGIN(gin)}/>
          }
        </div>
      );
    }
  }

  return(
    <div>
      {isAdmin&&pendingHolds.length>0&&(
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"14px 16px",marginBottom:20}}>
          <div style={{...S,fontSize:11,color:"#92400e",fontWeight:700,marginBottom:12}}>⚠ {pendingHolds.length} GRN Hold{pendingHolds.length>1?"s":""} pending review</div>
          {pendingHolds.map(h=>(
            <div key={h.id} style={{background:"#fff",border:"1px solid #fde68a",borderRadius:8,padding:"12px 14px",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                <span style={{fontWeight:600,fontSize:13,color:"#1a1f2e"}}>{h.material_name}</span>
                <span style={{...S,fontSize:11,color:"#6b7280"}}>{h.quantity} {h.unit}</span>
                {h.supplier_name&&<span style={{fontSize:11,color:"#6b7280"}}>from {h.supplier_name}</span>}
                <span style={{fontSize:11,color:"#9ca3af"}}>{formatDate(h.date_received)}</span>
                <span style={{fontSize:11,color:"#9ca3af",marginLeft:"auto"}}>by {h.operator_name}</span>
              </div>
              {h.remarks&&<div style={{fontSize:12,color:"#6b7280",marginBottom:8}}>"{h.remarks}"</div>}
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <input style={{...fieldStyle,flex:1,padding:"7px 12px",fontSize:12}} placeholder="Admin remarks (optional)" value={holdRemark[h.id]||""} onChange={e=>setHoldRemark(p=>({...p,[h.id]:e.target.value}))}/>
                <button className="btn-primary" style={{padding:"7px 14px",fontSize:12,flexShrink:0}} disabled={holdSaving[h.id]} onClick={()=>approveHold(h)}>{holdSaving[h.id]?"…":"✓ Approve"}</button>
                <button className="btn-ghost" style={{padding:"7px 14px",fontSize:12,flexShrink:0,color:"#dc2626"}} onClick={()=>rejectHold(h)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
          <div style={{fontSize:14,fontWeight:600}}>{ginHasActiveNarrowing?`${ginFiltered.length} of ${gins.length} receipt${gins.length!==1?"s":""}`:`${gins.length} receipt${gins.length!==1?"s":""}`}</div>
          <div style={{display:"flex",gap:8}}>
            {ginSorted.length>0&&<button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportGinExcel}><Icon name="clipboard" size={12}/>Export Excel</button>}
            {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>Receive against PO</button>}
            {canCreate&&<button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setMode("direct")}><Icon name="inbox" size={12}/>Direct Receipt</button>}
          </div>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
          {[["all","All"],...GIN_STATUSES.map(s=>[s,GIN_STATUS_LABELS[s]])].map(([v,l])=>(
            <button key={v} onClick={()=>{setStatusFilter(v);setGinPage(1);}} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
          ))}
          <select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setGinPage(1);}} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
            <option value="all">All plants</option>
            {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div style={{marginBottom:16}}>
          <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by GIN number, vendor, PO, or challan no…" value={ginSearch} onChange={e=>{setGinSearch(e.target.value);setGinPage(1);}}/>
        </div>

        {gins.length===0
          ?<EmptyState text="No receipts yet" sub={canCreate?"Click 'Receive against PO' or 'Direct Receipt' to log an arrival":undefined}/>
          :ginFiltered.length===0
          ?<EmptyState text="No receipts match" sub={canCreate?"Try a different filter":undefined}/>
          :<>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,border:"1px solid #9ca3af"}}>
                <thead>
                  <tr style={{background:"#fafafa"}}>
                    <th style={{padding:"8px 6px",borderBottom:"1px solid #9ca3af",width:28}}></th>
                    <SortTh label="GIN No." field="gin_number" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <SortTh label="GRN No." field="grn_number" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <SortTh label="Type" field="gin_type" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <SortTh label="PO No." field="po_number" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <SortTh label="Vendor name" field="vendor_name" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <SortTh label="Site" field="plant" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <DateRangeTh label="Date" field="created_at" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort} dateFrom={ginDateFrom} dateTo={ginDateTo} onApply={(f,t)=>{setGinDateFrom(f);setGinDateTo(t);setGinPage(1);}}/>
                    <SortTh label="Status" field="status" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <SortTh label="Vehicle" field="vehicle_no" sortField={ginSortField} sortDir={ginSortDir} onSort={onGinSort}/>
                    <th style={{padding:"8px 6px",textAlign:"left",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",fontSize:11,color:"#6b7280",whiteSpace:"nowrap"}}>Custom Field</th>
                  </tr>
                </thead>
                <tbody>
                  {ginPaginated.map(gin=>(
                    <GINTableRow key={gin.id} gin={gin} selected={ginSelectedId===gin.id} onSelect={()=>selectGinRow(gin.id)}/>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
              <div style={{display:"flex",gap:8}}>
                <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:ginSelectedId?1:.4,cursor:ginSelectedId?"pointer":"default"}} disabled={!ginSelectedId} onClick={openGinView}>View</button>
                <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:ginSelectedId&&ginEditability(gins.find(g=>g.id===ginSelectedId)||{},canCreate).canEdit?1:.4,cursor:ginSelectedId&&ginEditability(gins.find(g=>g.id===ginSelectedId)||{},canCreate).canEdit?"pointer":"default"}} disabled={!ginSelectedId||!ginEditability(gins.find(g=>g.id===ginSelectedId)||{},canCreate).canEdit} onClick={openGinEdit}>Edit</button>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#6b7280"}}>
                <span>{ginSorted.length} receipt{ginSorted.length!==1?"s":""}</span>
                <button aria-label="First page" disabled={ginPageSafe<=1} onClick={()=>setGinPage(1)} style={{...pagerBtnStyle,opacity:ginPageSafe<=1?.4:1}}><PagerIcon dir="first"/></button>
                <button aria-label="Previous page" disabled={ginPageSafe<=1} onClick={()=>setGinPage(p=>Math.max(1,p-1))} style={{...pagerBtnStyle,opacity:ginPageSafe<=1?.4:1}}><PagerIcon dir="prev"/></button>
                <span>Page {ginPageSafe} of {ginTotalPages}</span>
                <button aria-label="Next page" disabled={ginPageSafe>=ginTotalPages} onClick={()=>setGinPage(p=>Math.min(ginTotalPages,p+1))} style={{...pagerBtnStyle,opacity:ginPageSafe>=ginTotalPages?.4:1}}><PagerIcon dir="next"/></button>
                <button aria-label="Last page" disabled={ginPageSafe>=ginTotalPages} onClick={()=>setGinPage(ginTotalPages)} style={{...pagerBtnStyle,opacity:ginPageSafe>=ginTotalPages?.4:1}}><PagerIcon dir="last"/></button>
              </div>
            </div>
          </>
        }
      </div>
    </div>
  );
}

const pagerBtnStyle={display:"flex",alignItems:"center",justifyContent:"center",width:26,height:26,padding:0,border:"1px solid #d1d5db",borderRadius:6,background:"#fff",cursor:"pointer"};

function PagerIcon({dir}){
  const chevron=(flip)=><polyline points="15 18 9 12 15 6" transform={flip?"scale(-1,1) translate(-24,0)":undefined}/>;
  return(
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir==="prev"&&chevron(false)}
      {dir==="next"&&chevron(true)}
      {dir==="first"&&<><polyline points="18 17 12 12 18 7"/><polyline points="11 17 5 12 11 7"/></>}
      {dir==="last"&&<><polyline points="6 17 12 12 6 7"/><polyline points="13 17 19 12 13 7"/></>}
    </svg>
  );
}

function SortTh({label,field,sortField,sortDir,onSort,align}){
  const active=sortField===field;
  return(
    <th onClick={()=>onSort(field)} style={{padding:"8px 6px",textAlign:align||"left",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",cursor:"pointer",userSelect:"none",fontSize:11,color:"#6b7280",whiteSpace:"nowrap",...S}}>
      {label}{active&&<span style={{marginLeft:4}}>{sortDir==="asc"?"▲":"▼"}</span>}
    </th>
  );
}

function DateRangeTh({label,field,sortField,sortDir,onSort,dateFrom,dateTo,onApply}){
  const active=sortField===field;
  const filtered=!!(dateFrom||dateTo);
  const [open,setOpen]=useState(false);
  const [from,setFrom]=useState(dateFrom);
  const [to,setTo]=useState(dateTo);
  return(
    <th style={{padding:"8px 6px",textAlign:"left",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",fontSize:11,color:"#6b7280",whiteSpace:"nowrap",position:"relative",...S}}>
      <span style={{userSelect:"none"}}>{label}</span>
      <span onClick={()=>{setFrom(dateFrom);setTo(dateTo);setOpen(o=>!o);}} style={{marginLeft:4,cursor:"pointer",color:filtered?"#1a1f2e":"#9ca3af"}}>▾</span>
      {open&&(
        <div style={{position:"absolute",top:26,left:0,background:"#fff",border:"1px solid #d1d5db",borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,.1)",padding:12,zIndex:20,width:200,textTransform:"none",fontWeight:400}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:11,color:"#6b7280",marginBottom:4}}>From</div>
          <input type="date" style={{...fieldStyle,padding:"5px 8px",fontSize:12,marginBottom:8}} value={from} onChange={e=>setFrom(e.target.value)}/>
          <div style={{fontSize:11,color:"#6b7280",marginBottom:4}}>To</div>
          <input type="date" style={{...fieldStyle,padding:"5px 8px",fontSize:12,marginBottom:10}} value={to} onChange={e=>setTo(e.target.value)}/>
          <div style={{display:"flex",gap:6}}>
            <button className="btn-primary" style={{flex:1,fontSize:11,padding:"5px 8px"}} onClick={()=>{onApply(from,to);setOpen(false);}}>Apply</button>
            <button className="btn-ghost" style={{flex:1,fontSize:11,padding:"5px 8px"}} onClick={()=>{setFrom("");setTo("");onApply("","");setOpen(false);}}>Clear</button>
          </div>
        </div>
      )}
    </th>
  );
}

// ─── GIN table row — select circle only; View/Edit buttons open full detail ─
function GINTableRow({gin,selected,onSelect}){
  const sc=GIN_STATUS_COLORS[gin.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const customFieldText=(gin.line_items||[]).flatMap(it=>it.custom_fields||[]).filter(f=>f.label&&f.value).map(f=>`${f.label}: ${f.value}`).join(", ");
  const cellStyle={padding:"7px 6px",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160};

  return(
    <tr style={{background:selected?"#f5f7fa":"transparent"}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#fafafa";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <td style={{...cellStyle,textAlign:"center",cursor:"pointer"}} onClick={onSelect}>
        <span style={{display:"inline-block",width:13,height:13,borderRadius:"50%",border:`1.5px solid ${selected?"#1a1f2e":"#d1d5db"}`,background:selected?"#1a1f2e":"transparent"}}/>
      </td>
      <td style={{...cellStyle,...S,fontWeight:700,color:"#1a1f2e"}}>{gin.gin_number||"—"}</td>
      <td style={{...cellStyle,...S}}>{gin.grn_number||"—"}</td>
      <td style={cellStyle}>{gin.gin_type||"—"}</td>
      <td style={cellStyle}>{gin.po_number||"—"}</td>
      <td style={cellStyle} title={gin.vendor_name}>{gin.vendor_name}</td>
      <td style={cellStyle}>{gin.plant}</td>
      <td style={cellStyle}>{formatDate(gin.created_at?.toDate?gin.created_at.toDate():gin.created_at)}</td>
      <td style={cellStyle}><span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600}}>{GIN_STATUS_LABELS[gin.status]}</span></td>
      <td style={cellStyle}>{gin.vehicle_no||"—"}</td>
      <td style={cellStyle} title={customFieldText||undefined}>{customFieldText||"—"}</td>
    </tr>
  );
}

function GINDetailPanel({gin,profile,pos,showToast,canApprove,canEdit,canCancel,onEdit,onCancel}){
  const [busy,setBusy]=useState(false);
  const [rejectRemark,setRejectRemark]=useState("");

  async function submitForApproval(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"goods_inward_notes",gin.id),{status:"pending_approval",updated_at:serverTimestamp()});
      showToast(`${gin.gin_number} submitted for approval`);
    }finally{setBusy(false);}
  }

  async function approveAndSendToQGIN(){
    setBusy(true);
    try{
      const now=serverTimestamp();
      const operatorName=profile.name||auth.currentUser.email;
      const operatorUid=auth.currentUser.uid;
      const linesToSend=(gin.line_items||[]).filter(it=>(parseFloat(it.accepted_qty)||0)>0);
      if(linesToSend.length===0){showToast("No accepted quantity on any line — nothing to send to QGIN","error");setBusy(false);return;}

      const qginNumbers=[];
      const qginDate=new Date().toISOString().split("T")[0];
      for(const it of linesToSend){
        const acceptedQty=parseFloat(it.accepted_qty)||0;
        const qginNumber=await generateQGINNumber(gin.plant);
        qginNumbers.push(qginNumber);
        await addDoc(collection(db,"quality_gins"),{
          qgin_number:qginNumber, plant:gin.plant,
          item_code:it.item_code||"", material_id:it.material_id||null, material_name:it.material_name, base_uom:it.unit,
          item_description:it.item_description||"",
          gin_id:gin.id, gin_number:gin.gin_number, po_id:gin.po_id||null, po_number:gin.po_number||null,
          vendor_id:gin.vendor_id||null, vendor_name:gin.vendor_name||null,
          quality_type:null, gin_qty:acceptedQty, testing_qty:null,
          accepted_location:null, rejected_location:null,
          accepted_qty:acceptedQty, rejected_qty:parseFloat(it.rejected_qty)||0, rework_qty:0, scrap_qty:0, pending_qty:0,
          parameters:[], remarks:it.remarks||null, reasons:null,
          status:"pending_approval",
          created_by:operatorUid, created_by_name:operatorName, created_at:now,
        });
      }

      // Stamp each line that was sent with its own QGIN No./Date, so the
      // print (and any per-line QC status display) can reference it
      // directly off the GIN/GRN record without a separate lookup.
      const updatedLines=(gin.line_items||[]).map(it=>{
        const idx=linesToSend.indexOf(it);
        return idx===-1?it:{...it,qgin_number:qginNumbers[idx],qgin_date:qginDate};
      });

      await updateDoc(doc(db,"goods_inward_notes",gin.id),{
        status:"approved", qgin_numbers:qginNumbers, line_items:updatedLines,
        approved_by:profile.name||auth.currentUser.email, approved_at:now,
      });
      showToast(`${gin.gin_number} approved — ${qginNumbers.length} QGIN${qginNumbers.length>1?"s":""} sent for QC`);
    }catch(e){showToast("Error: "+e.message,"error");}
    finally{setBusy(false);}
  }

  async function reject(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"goods_inward_notes",gin.id),{status:"rejected",rejection_remarks:rejectRemark||null,rejected_by:profile.name||auth.currentUser.email,rejected_at:serverTimestamp()});
      showToast(`${gin.gin_number} rejected`);
      setRejectRemark("");
    }finally{setBusy(false);}
  }

  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>{
          const po=gin.po_id?pos.find(p=>p.id===gin.po_id):null;
          printGoodsInwardNote({
            ...gin,
            po_date:po?.created_at?.toDate?po.created_at.toDate().toISOString().split("T")[0]:(po?.created_at||null),
            line_items:(gin.line_items||[]).map(it=>({
              ...it,
              po_qty:po?.line_items?.find(pl=>pl.material_id===it.material_id)?.qty??null,
            })),
          });
        }}><Icon name="clipboard" size={12}/>Print</button>
        {canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={onEdit}><Icon name="edit" size={12}/>Edit</button>}
        {gin.status==="draft"&&canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={submitForApproval}><Icon name="check" size={12}/>Submit for Approval</button>}
        {gin.status==="pending_approval"&&canApprove&&<button className="btn-primary" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={approveAndSendToQGIN}><Icon name="check" size={12}/>Approve & Send to QGIN</button>}
        {canCancel&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px",color:"#dc2626"}} onClick={onCancel}>Cancel GIN</button>}
      </div>

      {gin.status==="pending_approval"&&canApprove&&(
        <div className="card" style={{padding:16,marginBottom:16,background:"#fffbeb",border:"1px solid #fde68a"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#92400e",marginBottom:8}}>Reject this GIN?</div>
          <div style={{display:"flex",gap:8}}>
            <input style={{...fieldStyle,flex:1,fontSize:12}} placeholder="Reason (optional)" value={rejectRemark} onChange={e=>setRejectRemark(e.target.value)}/>
            <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px",color:"#dc2626",flexShrink:0}} disabled={busy} onClick={reject}>Reject</button>
          </div>
        </div>
      )}

      {gin.rejection_remarks&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#dc2626"}}>
          Rejected: "{gin.rejection_remarks}"
        </div>
      )}

      <div className="card" style={{padding:16,marginBottom:14,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Vendor / PO</div>
            <div style={{fontSize:13,fontWeight:600}}>{gin.vendor_name}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Code: {gin.vendor_code||"—"}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>PO: {gin.po_number||"—"}{gin.po_ver?` (Ver ${gin.po_ver})`:""}</div>
          </div>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Transport</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>LR: {gin.lr_no||"—"} {gin.lr_date?`(${formatDate(gin.lr_date)})`:""}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Vehicle: {gin.vehicle_no||"—"} · {gin.delivery_mode||"—"}</div>
          </div>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Challan / Bill</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Challan: {gin.challan_no||"—"} {gin.challan_date?`(${formatDate(gin.challan_date)})`:""}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Bill: {gin.bill_no||"—"} {gin.bill_date?`(${formatDate(gin.bill_date)})`:""}</div>
          </div>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Received</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>By: {gin.received_by||"—"} ({gin.received_by_code||"—"})</div>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:0,marginBottom:14,overflow:"hidden",background:"#fff"}}>
        <div style={{display:"flex",padding:"8px 14px",background:"#f9fafb",fontSize:10,color:"#9ca3af",...S,textTransform:"uppercase",letterSpacing:".05em"}}>
          <span style={{flex:1}}>Item</span><span style={{width:70,textAlign:"right"}}>Challan</span><span style={{width:70,textAlign:"right"}}>Accepted</span><span style={{width:70,textAlign:"right"}}>Rejected</span><span style={{width:80,textAlign:"right"}}>QC</span>
        </div>
        {(gin.line_items||[]).map((it,i)=>(
          <div key={i} style={{display:"flex",padding:"10px 14px",borderTop:"1px solid #f3f4f6",fontSize:12,alignItems:"center"}}>
            <span style={{flex:1}}>
              <div style={{fontWeight:500}}>{it.item_code&&<span style={{...S,color:"#6b7280"}}>{it.item_code} — </span>}{it.material_name}</div>
              {it.remarks&&<div style={{...S,fontSize:10,color:"#9ca3af"}}>{it.remarks}</div>}
              {(it.custom_fields||[]).filter(f=>f.label&&f.value).map((f,fi)=><div key={fi} style={{fontSize:11,color:"#6b7280",marginTop:2}}><b>{f.label}:</b> {f.value}</div>)}
            </span>
            <span style={{width:70,textAlign:"right",...S}}>{it.challan_qty} {it.unit}</span>
            <span style={{width:70,textAlign:"right",...S,color:"#16a34a"}}>{it.accepted_qty} {it.unit}</span>
            <span style={{width:70,textAlign:"right",...S,color:(parseFloat(it.rejected_qty)||0)>0?"#dc2626":"#9ca3af"}}>{it.rejected_qty||0} {it.unit}</span>
            <span style={{width:80,textAlign:"right"}}>
              {it.posted
                ?<span style={{...S,background:"#f0fdf4",color:"#16a34a",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>Posted</span>
                :it.qgin_number
                ?<span style={{...S,background:"#fffbeb",color:"#b45309",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>Pending QC</span>
                :<span style={{fontSize:10,color:"#d1d5db"}}>—</span>
              }
            </span>
          </div>
        ))}
        {gin.qgin_numbers?.length>0&&(
          <div style={{padding:"8px 14px",borderTop:"1px solid #f3f4f6",fontSize:11,color:"#6b7280",background:"#fafafa"}}>
            Sent to QC: {gin.qgin_numbers.map(n=><span key={n} style={{...S,background:"#eef2ff",color:"#4338ca",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600,marginRight:6}}>{n}</span>)}
          </div>
        )}
      </div>

      {gin.remarks&&<div style={{fontSize:12,color:"#6b7280",marginBottom:4}}><span style={{color:"#9ca3af"}}>Remarks:</span> {gin.remarks}</div>}
      {gin.comments&&<div style={{fontSize:12,color:"#6b7280",marginBottom:8}}><span style={{color:"#9ca3af"}}>Comments:</span> {gin.comments}</div>}
      <div style={{fontSize:11,color:"#9ca3af"}}>
        Prepared by {gin.created_by_name} on {formatDate(gin.created_at?.toDate?gin.created_at.toDate():gin.created_at)}
        {gin.approved_by&&` · Approved by ${gin.approved_by}`}
        {gin.rejected_by&&` · Rejected by ${gin.rejected_by}`}
        {gin.cancelled_by&&` · Cancelled by ${gin.cancelled_by}`}
      </div>
    </div>
  );
}

// ─── GIN create / edit form — this IS "Receive against PO" now ─────────────
function GINForm({profile,pos,existing,showToast,onClose}){
  const isEdit=!!existing;
  const qtyLocked=(existing?.qgin_numbers?.length||0)>0;
  const [plant,setPlant]=useState(existing?.plant||"Bidadi");
  const [ginType,setGinType]=useState(existing?.gin_type||"Domestic");
  const [poId,setPoId]=useState(existing?.po_id||"");
  const [receivedByCode,setReceivedByCode]=useState(existing?.received_by_code||"");
  const [receivedBy,setReceivedBy]=useState(existing?.received_by||"");
  const [lrNo,setLrNo]=useState(existing?.lr_no||"");
  const [lrDate,setLrDate]=useState(existing?.lr_date||"");
  const [challanNo,setChallanNo]=useState(existing?.challan_no||"");
  const [challanDate,setChallanDate]=useState(existing?.challan_date||"");
  const [billNo,setBillNo]=useState(existing?.bill_no||"");
  const [billDate,setBillDate]=useState(existing?.bill_date||"");
  const [vehicleNo,setVehicleNo]=useState(existing?.vehicle_no||"");
  const [deliveryMode,setDeliveryMode]=useState(existing?.delivery_mode||"Road");
  const [lineItems,setLineItems]=useState(existing?.line_items?.length?existing.line_items:[]);
  const [remarks,setRemarks]=useState(existing?.remarks||"");
  const [comments,setComments]=useState(existing?.comments||"");
  const [saving,setSaving]=useState(false);
  const [errors,setErrors]=useState([]);

  const receivablePOs=pos.filter(p=>p.plant===plant&&["approved","partially_received"].includes(p.status))
    .map(p=>({...p,po_label:`${p.po_number} — ${p.vendor_name} (${PO_STATUS_LABELS[p.status]})`}));
  const po=pos.find(p=>p.id===poId);

  function onSelectPO(id){
    setPoId(id);
    const selected=pos.find(p=>p.id===id);
    if(!selected||isEdit)return;
    setLineItems((selected.line_items||[]).map(it=>{
      const remaining=Math.max(0,(parseFloat(it.qty)||0)-(it.received_qty||0));
      return {
        item_code:it.part_code||"", material_id:it.material_id||"", material_name:it.material_name,
        item_description:it.item_description||"",
        unit:it.unit, challan_qty:remaining||"", accepted_qty:remaining||"", rejected_qty:0,
        actual_challan_qty:remaining||"", remarks:"",
      };
    }));
  }

  function updateLine(i,k,v){setLineItems(items=>items.map((it,idx)=>idx===i?{...it,[k]:v}:it));}

  async function save(submitForApproval){
    const errs=[];
    if(!po)errs.push("Purchase order");
    if(lineItems.length===0)errs.push("At least one line item");
    if(errs.length){setErrors(errs);return;}
    setErrors([]);setSaving(true);
    try{
      const payload={
        plant, gin_type:ginType, po_id:po.id, po_number:po.po_number, po_ver:po.amd_no||0,
        vendor_id:po.vendor_id||null, vendor_name:po.vendor_name||null, vendor_code:po.vendor_code||null, vendor_address:po.vendor_address||null,
        received_by_code:receivedByCode||null, received_by:receivedBy||null,
        lr_no:lrNo||null, lr_date:lrDate||null,
        challan_no:challanNo||null, challan_date:challanDate||null,
        bill_no:billNo||null, bill_date:billDate||null,
        vehicle_no:vehicleNo||null, delivery_mode:deliveryMode||null,
        line_items:lineItems.map(it=>({
          ...it, challan_qty:parseFloat(it.challan_qty)||0, accepted_qty:parseFloat(it.accepted_qty)||0,
          rejected_qty:parseFloat(it.rejected_qty)||0, actual_challan_qty:parseFloat(it.actual_challan_qty)||0,
        })),
        remarks:remarks||null, comments:comments||null,
        updated_at:serverTimestamp(),
      };
      if(isEdit){
        await updateDoc(doc(db,"goods_inward_notes",existing.id),{
          ...payload, status:submitForApproval?"pending_approval":existing.status,
        });
        showToast(submitForApproval?`${existing.gin_number} submitted for approval`:`${existing.gin_number} updated`);
      }else{
        const ginNumber=await generateGINNumber(plant);
        const grnNumber=await generateGRNNumber(plant);
        await addDoc(collection(db,"goods_inward_notes"),{
          ...payload, gin_number:ginNumber, grn_number:grnNumber, status:submitForApproval?"pending_approval":"draft",
          created_by:auth.currentUser.uid, created_by_name:profile.name||auth.currentUser.email, created_at:serverTimestamp(),
        });
        showToast(`${ginNumber} (${grnNumber}) ${submitForApproval?"submitted for approval":"saved as draft"}`);
      }
      onClose();
    }catch(e){setErrors([`Save failed: ${e.message}`]);}
    finally{setSaving(false);}
  }

  return(
    <div>
      {!isEdit&&<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Receive against PO</div>
      </div>}

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Site / Plant *</label>
            <select style={fieldStyle} value={plant} onChange={e=>{setPlant(e.target.value);if(!isEdit){setPoId("");setLineItems([]);}}}>
              {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>GIN type *</label>
            <select style={fieldStyle} value={ginType} onChange={e=>setGinType(e.target.value)}>
              {GIN_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={{gridColumn:"1/-1"}}>
            <div style={isEdit?{pointerEvents:"none",opacity:.55}:undefined}>
              <FuzzyAutocomplete label="Purchase order *" value={po?`${po.po_number} — ${po.vendor_name} (${PO_STATUS_LABELS[po.status]})`:""} onChange={()=>{}} onSelect={p=>onSelectPO(p.id)} options={receivablePOs} displayKey="po_label" strict placeholder="— Select an approved PO —"/>
            </div>
            {receivablePOs.length===0&&!isEdit&&<div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>No approved POs awaiting receipt for {plant}.</div>}
          </div>
          <div>
            <label style={labelStyle}>Received by (code)</label>
            <input style={fieldStyle} value={receivedByCode} onChange={e=>setReceivedByCode(e.target.value)} placeholder="e.g. store1"/>
          </div>
          <div>
            <label style={labelStyle}>Received by (name)</label>
            <input style={fieldStyle} value={receivedBy} onChange={e=>setReceivedBy(e.target.value)}/>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Transport & document detail</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14}}>
          <div><label style={labelStyle}>LR No</label><input style={fieldStyle} value={lrNo} onChange={e=>setLrNo(e.target.value)}/></div>
          <div><label style={labelStyle}>LR Date</label><input type="date" style={fieldStyle} value={lrDate} onChange={e=>setLrDate(e.target.value)}/></div>
          <div><label style={labelStyle}>Invoice No</label><input style={fieldStyle} value={challanNo} onChange={e=>setChallanNo(e.target.value)}/></div>
          <div><label style={labelStyle}>Invoice Date</label><input type="date" style={fieldStyle} value={challanDate} onChange={e=>setChallanDate(e.target.value)}/></div>
          <div><label style={labelStyle}>Bill No</label><input style={fieldStyle} value={billNo} onChange={e=>setBillNo(e.target.value)}/></div>
          <div><label style={labelStyle}>Bill Date</label><input type="date" style={fieldStyle} value={billDate} onChange={e=>setBillDate(e.target.value)}/></div>
          <div><label style={labelStyle}>Vehicle No</label><input style={fieldStyle} value={vehicleNo} onChange={e=>setVehicleNo(e.target.value)}/></div>
          <div>
            <label style={labelStyle}>Delivery mode</label>
            <select style={fieldStyle} value={deliveryMode} onChange={e=>setDeliveryMode(e.target.value)}>
              {["Road","Rail","Air","Sea","Courier","Hand Delivery"].map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Line items {!po&&<span style={{fontWeight:400,textTransform:"none",letterSpacing:0}}>— select a PO above to load items</span>}</div>
        {qtyLocked&&<div style={{fontSize:11,color:"#b45309",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:6,padding:"6px 10px",marginBottom:12}}>Qty fields are locked — QGIN(s) were already raised from these numbers. Remarks stay editable.</div>}
        {lineItems.map((it,i)=>(
          <div key={i} style={{borderTop:i>0?"1px solid #f3f4f6":undefined,paddingTop:i>0?14:0,marginTop:i>0?14:0}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{it.item_code&&<span style={{...S,color:"#6b7280"}}>{it.item_code} — </span>}{it.material_name}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 2fr",gap:10}}>
              <div><label style={labelStyle}>Challan qty</label><input type="number" disabled={qtyLocked} style={{...fieldStyle,...(qtyLocked?{background:"#f9fafb",color:"#9ca3af"}:{})}} min="0" step="0.01" value={it.challan_qty} onChange={e=>updateLine(i,"challan_qty",e.target.value)}/></div>
              <div><label style={labelStyle}>Accepted qty</label><input type="number" disabled={qtyLocked} style={{...fieldStyle,...(qtyLocked?{background:"#f9fafb",color:"#9ca3af"}:{})}} min="0" step="0.01" value={it.accepted_qty} onChange={e=>updateLine(i,"accepted_qty",e.target.value)}/></div>
              <div><label style={labelStyle}>Rejected qty</label><input type="number" disabled={qtyLocked} style={{...fieldStyle,...(qtyLocked?{background:"#f9fafb",color:"#9ca3af"}:{})}} min="0" step="0.01" value={it.rejected_qty} onChange={e=>updateLine(i,"rejected_qty",e.target.value)}/></div>
              <div><label style={labelStyle}>Actual challan qty</label><input type="number" disabled={qtyLocked} style={{...fieldStyle,...(qtyLocked?{background:"#f9fafb",color:"#9ca3af"}:{})}} min="0" step="0.01" value={it.actual_challan_qty} onChange={e=>updateLine(i,"actual_challan_qty",e.target.value)}/></div>
              <div><label style={labelStyle}>Remarks</label><textarea style={{...fieldStyle,minHeight:44,resize:"vertical"}} value={it.remarks} onChange={e=>updateLine(i,"remarks",e.target.value)} placeholder="e.g. LME rate, coil no."/></div>
            </div>
            <div style={{marginTop:10}}>
              <CustomFieldsEditor fields={it.custom_fields} onChange={v=>updateLine(i,"custom_fields",v)}/>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{...fieldStyle,minHeight:56,resize:"vertical"}} value={remarks} onChange={e=>setRemarks(e.target.value)}/>
        </div>
        <div>
          <label style={labelStyle}>Comments</label>
          <textarea style={{...fieldStyle,minHeight:56,resize:"vertical"}} value={comments} onChange={e=>setComments(e.target.value)}/>
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
        <button className="btn-ghost" disabled={saving} onClick={()=>save(false)}>{saving?"Saving…":"Save as Draft"}</button>
        <button className="btn-primary" disabled={saving} onClick={()=>save(true)}><Icon name="check" size={14}/>{saving?"Saving…":"Submit for Approval"}</button>
      </div>
    </div>
  );
}

// ─── Direct receipt (no PO) — unchanged: posts stock immediately, skips QGIN ─
function DirectReceipt({profile,materials,suppliers,showToast,onClose}){
  const [plant,setPlant]=useState("Bidadi");
  const [matId,setMatId]=useState("");
  const [matName,setMatName]=useState("");
  const [isNew,setIsNew]=useState(false);
  const [suppId,setSuppId]=useState("");
  const [suppName,setSuppName]=useState("");
  const [qty,setQty]=useState("");
  const [unit,setUnit]=useState("kg");
  const [dateRcvd,setDateRcvd]=useState(new Date().toISOString().split("T")[0]);
  const [remarks,setRemarks]=useState("");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  function handleMatSelect(e){
    const v=e.target.value;
    if(v==="__new__"){setIsNew(true);setMatId("");setMatName("");}
    else{setIsNew(false);setMatId(v);const m=materials.find(m=>m.id===v);if(m)setUnit(m.unit||"kg");}
  }

  async function submit(){
    if(!qty||isNaN(qty)||Number(qty)<=0){setError("Enter a valid quantity");return;}
    const qtyNum=Number(qty);
    setError("");setSaving(true);
    try{
      const now=serverTimestamp();
      const postedAtStr=new Date().toISOString().split("T")[0];
      const operatorName=profile.name||auth.currentUser.email;
      const operatorUid=auth.currentUser.uid;

      if(isNew){
        if(!matName.trim()){setError("Enter the material name");setSaving(false);return;}
        await addDoc(collection(db,"grn_holds"),{
          material_name:matName.trim(),supplier_name:suppName||suppId||"",
          quantity:qtyNum,unit,date_received:dateRcvd,plant,
          remarks:remarks||null,status:"pending",
          operator_uid:operatorUid,operator_name:operatorName,
          created_at:now,
        });
        showToast("Material not recognised — GRN hold raised for admin review");
      }else{
        if(!matId){setError("Select a material");setSaving(false);return;}
        const mat=materials.find(m=>m.id===matId);
        const grnNumber=await generateGRNNumber(plant);
        await addDoc(collection(db,"goods_inward_notes"),{
          gin_number:null,grn_number:grnNumber,source:"direct",
          plant,vendor_id:suppId||null,vendor_name:suppName||suppId||"",
          po_id:null,po_number:null,
          line_items:[{
            item_code:"",material_id:matId,material_name:mat?.material_name||"",
            item_description:"",unit,
            challan_qty:qtyNum,accepted_qty:qtyNum,rejected_qty:0,actual_challan_qty:qtyNum,
            remarks:remarks||"",posted:true,posted_qty:qtyNum,posted_at:postedAtStr,posted_by:operatorName,
          }],
          remarks:remarks||null,comments:null,
          status:"completed",
          created_by:operatorUid,created_by_name:operatorName,created_at:now,
        });
        const newStock=(mat?.current_stock||0)+qtyNum;
        await updateDoc(doc(db,"rm_inventory",matId),{current_stock:newStock,updated_at:now});
        showToast(`${grnNumber} — inwarded ${qtyNum} ${unit} of ${mat?.material_name}`);
      }
      onClose();
    }catch(e){setError("Error: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Direct Receipt</div>
      </div>

      <div className="card animate-in" style={{padding:20,marginBottom:20}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div>
            <label style={labelStyle}>Plant *</label>
            <select style={fieldStyle} value={plant} onChange={e=>setPlant(e.target.value)}>
              {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Date Received *</label>
            <input type="date" style={fieldStyle} value={dateRcvd} onChange={e=>setDateRcvd(e.target.value)}/>
          </div>

          <div style={{gridColumn:"1/-1"}}>
            <label style={labelStyle}>Material *</label>
            <select style={fieldStyle} value={isNew?"__new__":matId} onChange={handleMatSelect}>
              <option value="">— Select material —</option>
              {materials.map(m=><option key={m.id} value={m.id}>{m.material_name}</option>)}
              <option value="__new__">+ New material (will raise GRN Hold)</option>
            </select>
          </div>
          {isNew&&(
            <div style={{gridColumn:"1/-1"}}>
              <label style={labelStyle}>New Material Name *</label>
              <input style={{...fieldStyle,borderColor:"#fde68a",background:"#fffbeb"}} placeholder="Enter exact material name" value={matName} onChange={e=>setMatName(e.target.value)}/>
              <div style={{fontSize:11,color:"#92400e",marginTop:4}}>⚠ This will be sent to admin for review before stock is updated</div>
            </div>
          )}

          <div>
            <label style={labelStyle}>Supplier</label>
            {suppliers.length>0
              ?<FuzzyAutocomplete value={suppName} onChange={()=>{}} onSelect={s=>{setSuppId(s.id);setSuppName(s.name);}} options={suppliers} displayKey="name" strict placeholder="— Select supplier —"/>
              :<input style={fieldStyle} placeholder="Supplier name" value={suppName} onChange={e=>setSuppName(e.target.value)}/>
            }
          </div>

          <div>
            <label style={labelStyle}>Quantity *</label>
            <div style={{display:"flex",gap:8}}>
              <input type="number" style={{...fieldStyle,flex:1}} placeholder="0" value={qty} onChange={e=>setQty(e.target.value)} min="0"/>
              <div style={{width:110,flexShrink:0}}><UomField value={unit} onChange={setUnit}/></div>
            </div>
          </div>

          <div style={{gridColumn:"1/-1"}}>
            <label style={labelStyle}>Remarks</label>
            <input style={fieldStyle} placeholder="Optional notes" value={remarks} onChange={e=>setRemarks(e.target.value)}/>
          </div>
        </div>

        {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"9px 12px",fontSize:13,color:"#dc2626",marginBottom:14}}>{error}</div>}

        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={submit}><Icon name="check" size={13}/>{saving?"Saving…":isNew?"Submit for Review":"Record Inward"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── UOM field with a "Other (specify)" escape hatch ───────────────────────
function UomField({value,onChange}){
  const isCustom=!!value&&!UNITS.includes(value);
  if(isCustom){
    return(
      <div style={{display:"flex",gap:4}}>
        <input style={{...fieldStyle,flex:1}} value={value} onChange={e=>onChange(e.target.value)} placeholder="Unit"/>
        <button type="button" className="btn-ghost" style={{padding:"0 8px",flexShrink:0}} title="Choose from list" onClick={()=>onChange(UNITS[0])}><Icon name="arrow" size={11}/></button>
      </div>
    );
  }
  return(
    <select style={fieldStyle} value={value} onChange={e=>onChange(e.target.value==="__other__"?"":e.target.value)}>
      {UNITS.map(u=><option key={u}>{u}</option>)}
      <option value="__other__">Other (specify)</option>
    </select>
  );
}
