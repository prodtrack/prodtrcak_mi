// ─── GINTab.jsx ─────────────────────────────────────────────────────────────
// Goods Inward Note: gate log against an approved/partially-received PO.
// Captures Challan/LR/Bill/Vehicle detail and an Accepted/Rejected Qty
// decision per line. Approving a GIN does NOT post a GRN directly — it
// generates one QGIN per line item with accepted qty > 0 (see QGINTab.jsx),
// and only an approved QGIN posts the actual GRN.
// Stored in `goods_inward_notes` — deliberately NOT `goods_inward`, since
// that collection name is already used by GRN's receipt history.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle } from "../shared.jsx";
import {
  PLANTS, GIN_TYPES, GIN_STATUSES, GIN_STATUS_LABELS, GIN_STATUS_COLORS,
  generateGINNumber, generateQGINNumber, PO_STATUS_LABELS,
} from "./purchaseHelpers";
import { printGoodsInwardNote } from "./GINPrintView.jsx";

export default function GINTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canCreate=isAdmin||["store"].includes(profile.role)||!!profile.can_purchase;
  const canApprove=isAdmin||!!profile.isPurchaseManager;

  const [gins,setGins]=useState([]);
  const [pos,setPos]=useState([]);
  const [statusFilter,setStatusFilter]=useState("all");
  const [plantFilter,setPlantFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [expandedId,setExpandedId]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const [selectedId,setSelectedId]=useState(null);
  const [creatingNew,setCreatingNew]=useState(false);
  const [sortField,setSortField]=useState("created_at");
  const [sortDir,setSortDir]=useState("desc");
  const [page,setPage]=useState(1);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const PAGE_SIZE=10;

  useEffect(()=>{
    const q=query(collection(db,"goods_inward_notes"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setGins(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>{
    const q=query(collection(db,"purchase_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setPos(s.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  const q=search.trim().toLowerCase();
  const filtered=gins.filter(g=>{
    const d=g.created_at?.toDate?g.created_at.toDate():(g.created_at?new Date(g.created_at):null);
    const dISO=d?d.toISOString().slice(0,10):null;
    return (statusFilter==="all"||g.status===statusFilter)&&
    (plantFilter==="all"||g.plant===plantFilter)&&
    (!dateFrom||(dISO&&dISO>=dateFrom))&&
    (!dateTo||(dISO&&dISO<=dateTo))&&
    (!q||
      g.gin_number?.toLowerCase().includes(q)||
      g.vendor_name?.toLowerCase().includes(q)||
      g.po_number?.toLowerCase().includes(q)||
      g.challan_no?.toLowerCase().includes(q)
    );
  });
  const hasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||q.length>0;

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
  const sorted=[...filtered].sort((a,b)=>{
    const va=ginField(a,sortField),vb=ginField(b,sortField);
    const cmp=typeof va==="number"&&typeof vb==="number"?va-vb:String(va).localeCompare(String(vb));
    return sortDir==="asc"?cmp:-cmp;
  });
  const totalPages=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE));
  const pageSafe=Math.min(page,totalPages);
  const paginated=sorted.slice((pageSafe-1)*PAGE_SIZE,pageSafe*PAGE_SIZE);

  function onSort(field){
    if(sortField===field)setSortDir(d=>d==="asc"?"desc":"asc");
    else{setSortField(field);setSortDir("asc");}
    setPage(1);
  }

  function ginEditability(gin,canCreate){
    const canEdit=["draft","pending_approval","approved"].includes(gin.status)&&canCreate;
    const canCancel=["draft","pending_approval"].includes(gin.status);
    return {canEdit,canCancel};
  }

  function selectRow(id){setSelectedId(prev=>prev===id?null:id);setExpandedId(null);setEditingId(null);}
  function openView(){if(selectedId){setExpandedId(selectedId);setEditingId(null);}}
  function openEdit(){if(selectedId){setExpandedId(selectedId);setEditingId(selectedId);}}
  function closeDetail(){setExpandedId(null);setEditingId(null);}

  async function cancelGIN(gin){
    if(!window.confirm(`Cancel ${gin.gin_number}? This cannot be undone.`))return;
    await updateDoc(doc(db,"goods_inward_notes",gin.id),{status:"cancelled",cancelled_by:profile.name||auth.currentUser.email,cancelled_at:serverTimestamp()});
    showToast(`${gin.gin_number} cancelled`);
  }

  if(creatingNew){
    return <GINForm profile={profile} pos={pos} showToast={showToast} onClose={()=>setCreatingNew(false)}/>;
  }

  if(expandedId){
    const gin=gins.find(g=>g.id===expandedId);
    if(gin){
      const {canEdit,canCancel}=ginEditability(gin,canCreate);
      return(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={closeDetail}><Icon name="arrow" size={14}/>Back</button>
            <div style={{fontSize:14,fontWeight:600}}>{gin.gin_number}</div>
          </div>
          {editingId===gin.id
            ? <GINForm profile={profile} pos={pos} existing={gin} showToast={showToast} onClose={closeDetail}/>
            : <GINDetailPanel gin={gin} profile={profile} showToast={showToast} canApprove={canApprove} canEdit={canEdit} canCancel={canCancel}
                onEdit={openEdit} onCancel={()=>cancelGIN(gin)}/>
          }
        </div>
      );
    }
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>{hasActiveNarrowing?`${filtered.length} of ${gins.length} GIN${gins.length!==1?"s":""}`:`${gins.length} GIN${gins.length!==1?"s":""}`}</div>
        {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New GIN</button>}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All"],...GIN_STATUSES.map(s=>[s,GIN_STATUS_LABELS[s]])].map(([v,l])=>(
          <button key={v} onClick={()=>{setStatusFilter(v);setPage(1);}} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
        <select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setPage(1);}} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
          <option value="all">All plants</option>
          {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by GIN number, vendor, PO, or challan no…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
      </div>

      {gins.length===0
        ?<EmptyState text="No GINs yet" sub={canCreate?"Click 'New GIN' to log an arrival":undefined}/>
        :filtered.length===0
        ?<EmptyState text="No GINs match" sub={canCreate?"Try a different filter, or click 'New GIN' to log an arrival":undefined}/>
        :<>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"#fafafa"}}>
                  <th style={{padding:"8px 6px",borderBottom:"1px solid #e5e7eb",width:28}}></th>
                  <SortTh label="GIN No." field="gin_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Type" field="gin_type" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="PO No." field="po_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Vendor name" field="vendor_name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Site" field="plant" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <DateRangeTh label="Date" field="created_at" sortField={sortField} sortDir={sortDir} onSort={onSort} dateFrom={dateFrom} dateTo={dateTo} onApply={(f,t)=>{setDateFrom(f);setDateTo(t);setPage(1);}}/>
                  <SortTh label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Vehicle" field="vehicle_no" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="GRN" field="grn_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                </tr>
              </thead>
              <tbody>
                {paginated.map(gin=>(
                  <GINTableRow key={gin.id} gin={gin} selected={selectedId===gin.id} onSelect={()=>selectRow(gin.id)}/>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={openView}>View</button>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId&&ginEditability(gins.find(g=>g.id===selectedId)||{},canCreate).canEdit?1:.4,cursor:selectedId&&ginEditability(gins.find(g=>g.id===selectedId)||{},canCreate).canEdit?"pointer":"default"}} disabled={!selectedId||!ginEditability(gins.find(g=>g.id===selectedId)||{},canCreate).canEdit} onClick={openEdit}>Edit</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#6b7280"}}>
              <span>{sorted.length} GIN{sorted.length!==1?"s":""}</span>
              <button aria-label="First page" disabled={pageSafe<=1} onClick={()=>setPage(1)} style={{...pagerBtnStyle,opacity:pageSafe<=1?.4:1}}><PagerIcon dir="first"/></button>
              <button aria-label="Previous page" disabled={pageSafe<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} style={{...pagerBtnStyle,opacity:pageSafe<=1?.4:1}}><PagerIcon dir="prev"/></button>
              <span>Page {pageSafe} of {totalPages}</span>
              <button aria-label="Next page" disabled={pageSafe>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} style={{...pagerBtnStyle,opacity:pageSafe>=totalPages?.4:1}}><PagerIcon dir="next"/></button>
              <button aria-label="Last page" disabled={pageSafe>=totalPages} onClick={()=>setPage(totalPages)} style={{...pagerBtnStyle,opacity:pageSafe>=totalPages?.4:1}}><PagerIcon dir="last"/></button>
            </div>
          </div>
        </>
      }
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
    <th onClick={()=>onSort(field)} style={{padding:"8px 6px",textAlign:align||"left",borderBottom:"1px solid #e5e7eb",cursor:"pointer",userSelect:"none",fontSize:11,color:"#6b7280",whiteSpace:"nowrap",...S}}>
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
    <th style={{padding:"8px 6px",textAlign:"left",borderBottom:"1px solid #e5e7eb",fontSize:11,color:"#6b7280",whiteSpace:"nowrap",position:"relative",...S}}>
      <span onClick={()=>onSort(field)} style={{cursor:"pointer",userSelect:"none"}}>{label}{active&&<span style={{marginLeft:4}}>{sortDir==="asc"?"▲":"▼"}</span>}</span>
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
  const cellStyle={padding:"7px 6px",borderBottom:"1px solid #f3f4f6",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160};

  return(
    <tr onClick={onSelect} style={{cursor:"pointer",background:selected?"#f5f7fa":"transparent"}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#fafafa";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <td style={{...cellStyle,textAlign:"center"}}>
        <span style={{display:"inline-block",width:13,height:13,borderRadius:"50%",border:`1.5px solid ${selected?"#1a1f2e":"#d1d5db"}`,background:selected?"#1a1f2e":"transparent"}}/>
      </td>
      <td style={{...cellStyle,...S,fontWeight:700,color:"#1a1f2e"}}>{gin.gin_number}</td>
      <td style={cellStyle}>{gin.gin_type||"—"}</td>
      <td style={cellStyle}>{gin.po_number||"—"}</td>
      <td style={cellStyle} title={gin.vendor_name}>{gin.vendor_name}</td>
      <td style={cellStyle}>{gin.plant}</td>
      <td style={cellStyle}>{formatDate(gin.created_at?.toDate?gin.created_at.toDate():gin.created_at)}</td>
      <td style={cellStyle}><span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600}}>{GIN_STATUS_LABELS[gin.status]}</span></td>
      <td style={cellStyle}>{gin.vehicle_no||"—"}</td>
      <td style={cellStyle}>{gin.grn_number||"—"}</td>
    </tr>
  );
}

function GINDetailPanel({gin,profile,showToast,canApprove,canEdit,canCancel,onEdit,onCancel}){
  const [busy,setBusy]=useState(false);
  const [rejectRemark,setRejectRemark]=useState("");

  async function submitForApproval(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"goods_inward_notes",gin.id),{status:"pending_approval",updated_at:serverTimestamp()});
      showToast(`${gin.gin_number} submitted for approval`);
    }finally{setBusy(false);}
  }

  // Approving a GIN no longer posts a GRN directly — it generates one QGIN
  // per line item with an accepted qty (pending_approval, ready for QC),
  // carrying over the vendor/PO/plant context each QGIN needs. GRN posting
  // now happens only when QC approves the corresponding QGIN.
  async function approveAndSendToQGIN(){
    setBusy(true);
    try{
      const now=serverTimestamp();
      const operatorName=profile.name||auth.currentUser.email;
      const operatorUid=auth.currentUser.uid;
      const linesToSend=(gin.line_items||[]).filter(it=>(parseFloat(it.accepted_qty)||0)>0);
      if(linesToSend.length===0){showToast("No accepted quantity on any line — nothing to send to QGIN","error");setBusy(false);return;}

      const qginNumbers=[];
      for(const it of linesToSend){
        const acceptedQty=parseFloat(it.accepted_qty)||0;
        const qginNumber=await generateQGINNumber(gin.plant);
        qginNumbers.push(qginNumber);
        await addDoc(collection(db,"quality_gins"),{
          qgin_number:qginNumber, plant:gin.plant,
          item_code:it.item_code||"", material_id:it.material_id||null, material_name:it.material_name, base_uom:it.unit,
          gin_id:gin.id, gin_number:gin.gin_number, po_id:gin.po_id||null, po_number:gin.po_number||null,
          vendor_id:gin.vendor_id||null, vendor_name:gin.vendor_name||null,
          quality_type:null, gin_qty:acceptedQty, testing_qty:null,
          accepted_location:null, rejected_location:null,
          accepted_qty:acceptedQty, rejected_qty:parseFloat(it.rejected_qty)||0, rework_qty:0, scrap_qty:0, pending_qty:0,
          parameters:[], remarks:null, reasons:null,
          status:"pending_approval",
          created_by:operatorUid, created_by_name:operatorName, created_at:now,
        });
      }

      await updateDoc(doc(db,"goods_inward_notes",gin.id),{
        status:"approved", qgin_numbers:qginNumbers,
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
        <button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>printGoodsInwardNote(gin)}><Icon name="clipboard" size={12}/>Print GIN</button>
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
          <span style={{flex:1}}>Item</span><span style={{width:70,textAlign:"right"}}>Challan</span><span style={{width:70,textAlign:"right"}}>Accepted</span><span style={{width:70,textAlign:"right"}}>Rejected</span>
        </div>
        {(gin.line_items||[]).map((it,i)=>(
          <div key={i} style={{display:"flex",padding:"10px 14px",borderTop:"1px solid #f3f4f6",fontSize:12,alignItems:"center"}}>
            <span style={{flex:1}}>
              <div style={{fontWeight:500}}>{it.item_code&&<span style={{...S,color:"#6b7280"}}>{it.item_code} — </span>}{it.material_name}</div>
              {it.remarks&&<div style={{...S,fontSize:10,color:"#9ca3af"}}>{it.remarks}</div>}
            </span>
            <span style={{width:70,textAlign:"right",...S}}>{it.challan_qty} {it.unit}</span>
            <span style={{width:70,textAlign:"right",...S,color:"#16a34a"}}>{it.accepted_qty} {it.unit}</span>
            <span style={{width:70,textAlign:"right",...S,color:(parseFloat(it.rejected_qty)||0)>0?"#dc2626":"#9ca3af"}}>{it.rejected_qty||0} {it.unit}</span>
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

// ─── GIN create / edit form ──────────────────────────────────────────────────
function GINForm({profile,pos,existing,showToast,onClose}){
  const isEdit=!!existing;
  // Once QGINs have already been spawned from this GIN's accepted/rejected
  // qty, those numbers are locked — QGIN docs already snapshotted them, and
  // silently changing the GIN afterward would desync from QC's records.
  // Header/transport fields (Vehicle No, Challan No, remarks, etc.) stay
  // editable regardless, for correcting typos after the fact.
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

  const receivablePOs=pos.filter(p=>p.plant===plant&&["approved","partially_received"].includes(p.status));
  const po=pos.find(p=>p.id===poId);

  // Selecting a PO seeds one GIN line per PO line item, defaulting Challan
  // Qty/Actual Challan Qty to the remaining ordered qty and Accepted Qty to
  // match (the common case — full acceptance) — all editable per line.
  function onSelectPO(id){
    setPoId(id);
    const selected=pos.find(p=>p.id===id);
    if(!selected||isEdit)return;
    setLineItems((selected.line_items||[]).map(it=>{
      const remaining=Math.max(0,(parseFloat(it.qty)||0)-(it.received_qty||0));
      return {
        item_code:it.part_code||"", material_id:it.material_id||"", material_name:it.material_name,
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
        vendor_id:po.vendor_id||null, vendor_name:po.vendor_name||null, vendor_code:po.vendor_code||null,
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
        await addDoc(collection(db,"goods_inward_notes"),{
          ...payload, gin_number:ginNumber, status:submitForApproval?"pending_approval":"draft",
          created_by:auth.currentUser.uid, created_by_name:profile.name||auth.currentUser.email, created_at:serverTimestamp(),
        });
        showToast(`${ginNumber} ${submitForApproval?"submitted for approval":"saved as draft"}`);
      }
      onClose();
    }catch(e){setErrors([`Save failed: ${e.message}`]);}
    finally{setSaving(false);}
  }

  return(
    <div>
      {!isEdit&&<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>New Goods Inward Note</div>
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
            <label style={labelStyle}>Purchase order *</label>
            <select style={fieldStyle} value={poId} onChange={e=>onSelectPO(e.target.value)} disabled={isEdit}>
              <option value="">— Select an approved PO —</option>
              {receivablePOs.map(p=><option key={p.id} value={p.id}>{p.po_number} — {p.vendor_name} ({PO_STATUS_LABELS[p.status]})</option>)}
            </select>
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
              <div><label style={labelStyle}>Remarks</label><input style={fieldStyle} value={it.remarks} onChange={e=>updateLine(i,"remarks",e.target.value)} placeholder="e.g. LME rate, coil no."/></div>
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
