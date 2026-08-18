// ─── QGINTab.jsx ────────────────────────────────────────────────────────────
// Quality GIN: the QC inspection step, one QGIN per GIN line item (a GIN
// with 3 accepted-qty items produces 3 QGINs, created automatically when the
// GIN is approved — see GINTab.jsx's approveAndSendToQGIN). This is the step
// that actually posts the GRN: approving a QGIN creates the `goods_inward`
// doc, bumps rm_inventory stock, and rolls the linked PO's received_qty/
// status forward — same mechanism GRNTab's "Receive against PO" always used,
// just gated behind QC sign-off instead of firing straight from GIN approval.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle } from "../shared.jsx";
import {
  PLANTS, QGIN_STATUSES, QGIN_STATUS_LABELS, QGIN_STATUS_COLORS,
  QUALITY_TYPES, INSPECTION_LOCATIONS, QGIN_PARAMETERS, emptyQGINParameter, UNITS,
  generateGRNNumber, generateQGINNumber, poReceivedStatus, COMPANY_INFO,
} from "./purchaseHelpers";
import { printQualityGIN } from "./QGINPrintView.jsx";
import SelectOrCustom from "./PurchaseFormControls.jsx";

// Roles allowed to approve/reject QC — separate from Purchase Manager, per
// Shan's instruction, since there's no AdminPanel.jsx to add a dedicated
// permission toggle to yet. Set `profile.isQualityInspector = true` on a
// user's Firestore doc manually until a real permission UI exists for it.
function canApproveQC(profile){
  return profile.role==="admin"||!!profile.isQualityInspector;
}

export default function QGINTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canCreate=isAdmin||["store"].includes(profile.role)||!!profile.can_purchase;
  const canApprove=canApproveQC(profile);

  const [qgins,setQgins]=useState([]);
  const [approvedGins,setApprovedGins]=useState([]);
  const [pickerOpen,setPickerOpen]=useState(false);
  const [statusFilter,setStatusFilter]=useState("all");
  const [plantFilter,setPlantFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [expandedId,setExpandedId]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const [selectedId,setSelectedId]=useState(null);
  const [sortField,setSortField]=useState("created_at");
  const [sortDir,setSortDir]=useState("desc");
  const [page,setPage]=useState(1);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const PAGE_SIZE=10;

  useEffect(()=>{
    const q=query(collection(db,"quality_gins"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setQgins(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  // Loaded so the manual "New QGIN" picker can list approved GINs' line
  // items — used only as a fallback when auto-creation was missed, or a
  // second/re-inspection QGIN is needed against the same line.
  useEffect(()=>{
    const q=query(collection(db,"goods_inward_notes"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setApprovedGins(snap.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.status==="approved")));
  },[]);

  const [manualSeed,setManualSeed]=useState(null);

  // Manual picker no longer writes to Firestore immediately — it builds a
  // seed object from the GIN line and opens the same form used for editing,
  // in "new" mode. The QGIN document only actually gets created once the
  // user clicks Save as Draft or Submit for Approval on that form. Auto-
  // creation (GINTab's approveAndSendToQGIN) is untouched — it still writes
  // a real draft doc immediately, by design.
  function startManualQGIN(gin,lineIdx){
    const line=gin.line_items[lineIdx];
    setManualSeed({
      plant:gin.plant,
      item_code:line.item_code||"", material_id:line.material_id||null, material_name:line.material_name, base_uom:line.unit,
      gin_id:gin.id, gin_number:gin.gin_number, po_id:gin.po_id||null, po_number:gin.po_number||null,
      vendor_id:gin.vendor_id||null, vendor_name:gin.vendor_name||null,
      gin_qty:parseFloat(line.accepted_qty)||0,
      accepted_qty:parseFloat(line.accepted_qty)||0, rejected_qty:parseFloat(line.rejected_qty)||0,
    });
    setPickerOpen(false);
  }

  const q=search.trim().toLowerCase();
  const filtered=qgins.filter(g=>{
    const d=g.created_at?.toDate?g.created_at.toDate():(g.created_at?new Date(g.created_at):null);
    const dISO=d?d.toISOString().slice(0,10):null;
    return (statusFilter==="all"||g.status===statusFilter)&&
    (plantFilter==="all"||g.plant===plantFilter)&&
    (!dateFrom||(dISO&&dISO>=dateFrom))&&
    (!dateTo||(dISO&&dISO<=dateTo))&&
    (!q||
      g.qgin_number?.toLowerCase().includes(q)||
      g.gin_number?.toLowerCase().includes(q)||
      g.po_number?.toLowerCase().includes(q)||
      g.material_name?.toLowerCase().includes(q)||
      g.item_code?.toLowerCase().includes(q)
    );
  });
  const hasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||q.length>0;

  function qginField(qgin,field){
    switch(field){
      case "qgin_number":return qgin.qgin_number||"";
      case "gin_number":return qgin.gin_number||"";
      case "po_number":return qgin.po_number||"";
      case "material_name":return qgin.material_name||"";
      case "plant":return qgin.plant||"";
      case "created_at":return qgin.created_at?.toDate?qgin.created_at.toDate().getTime():(qgin.created_at?new Date(qgin.created_at).getTime():0);
      case "status":return qgin.status||"";
      case "gin_qty":return parseFloat(qgin.gin_qty)||0;
      case "grn_number":return qgin.grn_number||"";
      default:return "";
    }
  }
  const sorted=[...filtered].sort((a,b)=>{
    const va=qginField(a,sortField),vb=qginField(b,sortField);
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

  function qginEditability(qgin,canCreate,canApprove){
    const canEdit=["draft","pending_approval"].includes(qgin.status)&&(canCreate||canApprove);
    const canCancel=["draft","pending_approval"].includes(qgin.status);
    return {canEdit,canCancel};
  }

  function selectRow(id){setSelectedId(prev=>prev===id?null:id);setExpandedId(null);setEditingId(null);}
  function openView(){if(selectedId){setExpandedId(selectedId);setEditingId(null);}}
  function openEdit(){if(selectedId){setExpandedId(selectedId);setEditingId(selectedId);}}
  function closeDetail(){setExpandedId(null);setEditingId(null);}

  async function cancelQGIN(qgin){
    if(!window.confirm(`Cancel ${qgin.qgin_number}? This cannot be undone.`))return;
    await updateDoc(doc(db,"quality_gins",qgin.id),{status:"cancelled",cancelled_by:profile.name||auth.currentUser.email,cancelled_at:serverTimestamp()});
    showToast(`${qgin.qgin_number} cancelled`);
  }

  if(manualSeed){
    return(
      <div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
          <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={()=>setManualSeed(null)}><Icon name="arrow" size={14}/>Back</button>
          <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>New Quality GIN</div>
        </div>
        <QGINForm profile={profile} existing={manualSeed} showToast={showToast} onClose={()=>setManualSeed(null)}/>
      </div>
    );
  }

  if(pickerOpen){
    return <QGINPicker approvedGins={approvedGins} onCreate={startManualQGIN} onClose={()=>setPickerOpen(false)}/>;
  }

  if(expandedId){
    const qgin=qgins.find(g=>g.id===expandedId);
    if(qgin){
      const {canEdit,canCancel}=qginEditability(qgin,canCreate,canApprove);
      return(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={closeDetail}><Icon name="arrow" size={14}/>Back</button>
            <div style={{fontSize:14,fontWeight:600}}>{qgin.qgin_number}</div>
          </div>
          {editingId===qgin.id
            ? <QGINForm profile={profile} existing={qgin} showToast={showToast} onClose={closeDetail}/>
            : <QGINDetailPanel qgin={qgin} profile={profile} showToast={showToast} canApprove={canApprove} canEdit={canEdit} canCancel={canCancel}
                onEdit={openEdit} onCancel={()=>cancelQGIN(qgin)}/>
          }
        </div>
      );
    }
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>{hasActiveNarrowing?`${filtered.length} of ${qgins.length} QGIN${qgins.length!==1?"s":""}`:`${qgins.length} QGIN${qgins.length!==1?"s":""}`}</div>
        {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setPickerOpen(true)}><Icon name="plus" size={12}/>New QGIN</button>}
      </div>
      <div style={{fontSize:12,color:"#9ca3af",marginTop:-10,marginBottom:16}}>QGINs are created automatically when a GIN is approved — use "New QGIN" only if one was missed or a line needs re-inspection.</div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All"],...QGIN_STATUSES.map(s=>[s,QGIN_STATUS_LABELS[s]])].map(([v,l])=>(
          <button key={v} onClick={()=>{setStatusFilter(v);setPage(1);}} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
        <select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setPage(1);}} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
          <option value="all">All plants</option>
          {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by QGIN, GIN, PO number, or item…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
      </div>

      {qgins.length===0
        ?<EmptyState text="No QGINs yet" sub="QGINs are created automatically when a GIN is approved"/>
        :filtered.length===0
        ?<EmptyState text="No QGINs match" sub="Try a different filter"/>
        :<>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"#fafafa"}}>
                  <th style={{padding:"8px 6px",borderBottom:"1px solid #e5e7eb",width:28}}></th>
                  <SortTh label="QGIN No." field="qgin_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="GIN No." field="gin_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="PO No." field="po_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Material" field="material_name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Site" field="plant" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <DateRangeTh label="Date" field="created_at" sortField={sortField} sortDir={sortDir} onSort={onSort} dateFrom={dateFrom} dateTo={dateTo} onApply={(f,t)=>{setDateFrom(f);setDateTo(t);setPage(1);}}/>
                  <SortTh label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="GIN Qty" field="gin_qty" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right"/>
                  <SortTh label="GRN" field="grn_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                </tr>
              </thead>
              <tbody>
                {paginated.map(qgin=>(
                  <QGINTableRow key={qgin.id} qgin={qgin} selected={selectedId===qgin.id} onSelect={()=>selectRow(qgin.id)}/>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={openView}>View</button>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId&&qginEditability(qgins.find(g=>g.id===selectedId)||{},canCreate,canApprove).canEdit?1:.4,cursor:selectedId&&qginEditability(qgins.find(g=>g.id===selectedId)||{},canCreate,canApprove).canEdit?"pointer":"default"}} disabled={!selectedId||!qginEditability(qgins.find(g=>g.id===selectedId)||{},canCreate,canApprove).canEdit} onClick={openEdit}>Edit</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#6b7280"}}>
              <span>{sorted.length} QGIN{sorted.length!==1?"s":""}</span>
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

// ─── QGIN table row — select circle only; View/Edit buttons open full detail ─
function QGINTableRow({qgin,selected,onSelect}){
  const sc=QGIN_STATUS_COLORS[qgin.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const cellStyle={padding:"7px 6px",borderBottom:"1px solid #f3f4f6",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160};

  return(
    <tr onClick={onSelect} style={{cursor:"pointer",background:selected?"#f5f7fa":"transparent"}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#fafafa";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <td style={{...cellStyle,textAlign:"center"}}>
        <span style={{display:"inline-block",width:13,height:13,borderRadius:"50%",border:`1.5px solid ${selected?"#1a1f2e":"#d1d5db"}`,background:selected?"#1a1f2e":"transparent"}}/>
      </td>
      <td style={{...cellStyle,...S,fontWeight:700,color:"#1a1f2e"}}>{qgin.qgin_number}</td>
      <td style={cellStyle}>{qgin.gin_number||"—"}</td>
      <td style={cellStyle}>{qgin.po_number||"—"}</td>
      <td style={cellStyle} title={qgin.material_name}>{qgin.item_code?`${qgin.item_code} — `:""}{qgin.material_name}</td>
      <td style={cellStyle}>{qgin.plant}</td>
      <td style={cellStyle}>{formatDate(qgin.created_at?.toDate?qgin.created_at.toDate():qgin.created_at)}</td>
      <td style={cellStyle}><span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600}}>{QGIN_STATUS_LABELS[qgin.status]}</span></td>
      <td style={{...cellStyle,textAlign:"right"}}>{qgin.gin_qty} {qgin.base_uom}</td>
      <td style={cellStyle}>{qgin.grn_number||"—"}</td>
    </tr>
  );
}

function QGINDetailPanel({qgin,profile,showToast,canApprove,canEdit,canCancel,onEdit,onCancel}){
  const [busy,setBusy]=useState(false);
  const [rejectRemark,setRejectRemark]=useState("");

  async function submitForApproval(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"quality_gins",qgin.id),{status:"pending_approval",updated_at:serverTimestamp()});
      showToast(`${qgin.qgin_number} submitted for approval`);
    }finally{setBusy(false);}
  }

  // Approving a QGIN is what actually posts the GRN — using THIS document's
  // accepted_qty (the QC-confirmed number), not the GIN's original gate
  // figure. Mirrors GRNTab's ReceiveAgainstPO.post() exactly: one
  // goods_inward doc, rm_inventory bumped, PO received_qty/status rolled
  // forward.
  async function approveAndPostGRN(){
    setBusy(true);
    try{
      const now=serverTimestamp();
      const operatorName=profile.name||auth.currentUser.email;
      const operatorUid=auth.currentUser.uid;
      const acceptedQty=parseFloat(qgin.accepted_qty)||0;
      if(acceptedQty<=0){showToast("Accepted qty must be greater than 0 to post a GRN","error");setBusy(false);return;}

      const grnNumber=await generateGRNNumber(qgin.plant);
      await addDoc(collection(db,"goods_inward"),{
        material_id:qgin.material_id||null,material_name:qgin.material_name,
        supplier_id:qgin.vendor_id||null,supplier_name:qgin.vendor_name,
        quantity:acceptedQty,unit:qgin.base_uom,date_received:new Date().toISOString().split("T")[0],
        po_id:qgin.po_id||null,po_number:qgin.po_number||null,grn_number:grnNumber,plant:qgin.plant,
        remarks:`From ${qgin.gin_number} via ${qgin.qgin_number}`,
        operator_uid:operatorUid,operator_name:operatorName,created_at:now,
      });
      if(qgin.material_id){
        const matRef=doc(db,"rm_inventory",qgin.material_id);
        const matSnap=await getDoc(matRef);
        const current=matSnap.exists()?(matSnap.data().current_stock||0):0;
        await updateDoc(matRef,{current_stock:current+acceptedQty,updated_at:now});
      }
      if(qgin.po_id){
        const poSnap=await getDoc(doc(db,"purchase_orders",qgin.po_id));
        if(poSnap.exists()){
          const po=poSnap.data();
          const updatedLines=(po.line_items||[]).map(pit=>
            (qgin.material_id&&pit.material_id===qgin.material_id)
              ?{...pit,received_qty:(pit.received_qty||0)+acceptedQty}
              :pit
          );
          await updateDoc(doc(db,"purchase_orders",qgin.po_id),{line_items:updatedLines,status:poReceivedStatus(updatedLines),updated_at:now});
        }
      }
      await updateDoc(doc(db,"quality_gins",qgin.id),{
        status:"approved", grn_number:grnNumber,
        approved_by:profile.name||auth.currentUser.email, approved_at:now,
      });
      showToast(`${qgin.qgin_number} approved — ${grnNumber} posted`);
    }catch(e){showToast("Error: "+e.message,"error");}
    finally{setBusy(false);}
  }

  async function reject(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"quality_gins",qgin.id),{status:"rejected",rejection_remarks:rejectRemark||null,rejected_by:profile.name||auth.currentUser.email,rejected_at:serverTimestamp()});
      showToast(`${qgin.qgin_number} rejected`);
      setRejectRemark("");
    }finally{setBusy(false);}
  }

  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>printQualityGIN(qgin)}><Icon name="clipboard" size={12}/>Print QGIN</button>
        {canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={onEdit}><Icon name="edit" size={12}/>Edit</button>}
        {qgin.status==="draft"&&canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={submitForApproval}><Icon name="check" size={12}/>Submit for Approval</button>}
        {qgin.status==="pending_approval"&&canApprove&&<button className="btn-primary" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={approveAndPostGRN}><Icon name="check" size={12}/>Approve & Post GRN</button>}
        {canCancel&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px",color:"#dc2626"}} onClick={onCancel}>Cancel QGIN</button>}
      </div>

      {qgin.status==="pending_approval"&&canApprove&&(
        <div className="card" style={{padding:16,marginBottom:16,background:"#fffbeb",border:"1px solid #fde68a"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#92400e",marginBottom:8}}>Reject this QGIN?</div>
          <div style={{display:"flex",gap:8}}>
            <input style={{...fieldStyle,flex:1,fontSize:12}} placeholder="Reason (optional)" value={rejectRemark} onChange={e=>setRejectRemark(e.target.value)}/>
            <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px",color:"#dc2626",flexShrink:0}} disabled={busy} onClick={reject}>Reject</button>
          </div>
        </div>
      )}

      {qgin.rejection_remarks&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#dc2626"}}>
          Rejected: "{qgin.rejection_remarks}"
        </div>
      )}

      <div className="card" style={{padding:16,marginBottom:14,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Item</div>
            <div style={{fontSize:13,fontWeight:600}}>{qgin.item_code&&<span style={{...S,color:"#6b7280"}}>{qgin.item_code} — </span>}{qgin.material_name}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>GIN: {qgin.gin_number} · PO: {qgin.po_number||"—"}</div>
          </div>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Inspection</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Type: {qgin.quality_type||"—"}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Accepted loc: {qgin.accepted_location||"—"} · Rejected loc: {qgin.rejected_location||"—"}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:16,marginBottom:14,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12}}>
          <QtyStat label="GIN Qty" value={qgin.gin_qty} unit={qgin.base_uom}/>
          <QtyStat label="Testing Qty" value={qgin.testing_qty} unit={qgin.base_uom}/>
          <QtyStat label="Accepted" value={qgin.accepted_qty} unit={qgin.base_uom} color="#16a34a"/>
          <QtyStat label="Rejected" value={qgin.rejected_qty} unit={qgin.base_uom} color={(qgin.rejected_qty||0)>0?"#dc2626":undefined}/>
          <QtyStat label="Rework / Scrap / Pending" value={`${qgin.rework_qty||0} / ${qgin.scrap_qty||0} / ${qgin.pending_qty||0}`} unit=""/>
        </div>
      </div>

      {qgin.parameters?.length>0&&(
        <div className="card" style={{padding:0,marginBottom:14,overflow:"hidden",background:"#fff"}}>
          <div style={{display:"flex",padding:"8px 14px",background:"#f9fafb",fontSize:10,color:"#9ca3af",...S,textTransform:"uppercase",letterSpacing:".05em"}}>
            <span style={{width:110}}>Parameter</span><span style={{flex:1}}>Description</span><span style={{width:70}}>Visual</span><span style={{width:60}}>UOM</span><span style={{width:80,textAlign:"right"}}>Standard</span><span style={{width:80,textAlign:"right"}}>Actual</span>
          </div>
          {qgin.parameters.map((p,i)=>(
            <div key={i} style={{display:"flex",padding:"8px 14px",borderTop:"1px solid #f3f4f6",fontSize:12,alignItems:"center"}}>
              <span style={{width:110,fontWeight:500}}>{p.parameter}</span>
              <span style={{flex:1,color:"#6b7280"}}>{p.parameter_description||"—"}</span>
              <span style={{width:70,color:"#6b7280"}}>{p.visual||"—"}</span>
              <span style={{width:60,color:"#6b7280"}}>{p.uom||"—"}</span>
              <span style={{width:80,textAlign:"right",...S}}>{p.standard_value||"—"}</span>
              <span style={{width:80,textAlign:"right",...S}}>{p.actual_value||"—"}</span>
            </div>
          ))}
        </div>
      )}

      {qgin.remarks&&<div style={{fontSize:12,color:"#6b7280",marginBottom:4}}><span style={{color:"#9ca3af"}}>Remarks:</span> {qgin.remarks}</div>}
      {qgin.reasons&&<div style={{fontSize:12,color:"#6b7280",marginBottom:8}}><span style={{color:"#9ca3af"}}>Reasons:</span> {qgin.reasons}</div>}
      <div style={{fontSize:11,color:"#9ca3af"}}>
        Prepared by {qgin.created_by_name} on {formatDate(qgin.created_at?.toDate?qgin.created_at.toDate():qgin.created_at)}
        {qgin.approved_by&&` · Approved by ${qgin.approved_by}`}
        {qgin.rejected_by&&` · Rejected by ${qgin.rejected_by}`}
        {qgin.cancelled_by&&` · Cancelled by ${qgin.cancelled_by}`}
      </div>
    </div>
  );
}

function QtyStat({label,value,unit,color}){
  return(
    <div>
      <div style={{fontSize:10,color:"#9ca3af",textTransform:"uppercase",letterSpacing:".05em",marginBottom:4}}>{label}</div>
      <div style={{...S,fontSize:14,fontWeight:700,color:color||"#1a1f2e"}}>{value??0}{unit?` ${unit}`:""}</div>
    </div>
  );
}

// ─── Manual QGIN picker ──────────────────────────────────────────────────────
// Fallback for when auto-creation was missed, or a line needs a second QGIN
// (re-inspection). Lists every accepted-qty line item across all approved
// GINs — including lines that already have a QGIN, since re-inspection is a
// valid reason to raise another one.
function QGINPicker({approvedGins,onCreate,onClose}){
  const rows=[];
  approvedGins.forEach(gin=>{
    (gin.line_items||[]).forEach((line,idx)=>{
      if((parseFloat(line.accepted_qty)||0)>0)rows.push({gin,line,idx});
    });
  });

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Raise a QGIN manually</div>
      </div>
      {rows.length===0
        ?<EmptyState text="No eligible lines" sub="No approved GINs with accepted quantity found"/>
        :(
          <div className="card" style={{padding:0,overflow:"hidden"}}>
            <div style={{display:"flex",gap:8,padding:"8px 14px",background:"#fafafa",borderBottom:"1px solid #f3f4f6",fontSize:10,color:"#9ca3af",...S,textTransform:"uppercase"}}>
              <span style={{flex:1}}>Item</span><span style={{width:110}}>GIN</span><span style={{width:80,textAlign:"right"}}>Accepted</span><span style={{width:120}}></span>
            </div>
            {rows.map(({gin,line,idx})=>{
              const key=`${gin.id}-${idx}`;
              return(
                <div key={key} style={{display:"flex",gap:8,padding:"10px 14px",borderBottom:"1px solid #f9fafb",alignItems:"center",fontSize:12}}>
                  <span style={{flex:1}}>
                    <div style={{fontWeight:500}}>{line.item_code&&<span style={{...S,color:"#6b7280"}}>{line.item_code} — </span>}{line.material_name}</div>
                    <div style={{...S,fontSize:10,color:"#9ca3af"}}>Vendor: {gin.vendor_name}</div>
                  </span>
                  <span style={{width:110,...S,fontSize:11,color:"#6b7280"}}>{gin.gin_number}</span>
                  <span style={{width:80,textAlign:"right",...S}}>{line.accepted_qty} {line.unit}</span>
                  <span style={{width:120,textAlign:"right"}}>
                    <button className="btn-primary" style={{fontSize:11,padding:"6px 10px"}} onClick={()=>onCreate(gin,idx)}>
                      Start QGIN
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

// ─── QGIN form ───────────────────────────────────────────────────────────────
// Handles both modes: editing a real doc (existing.id present — updateDoc),
// and filling in a brand-new manual QGIN before it's ever been written
// (existing is just a seed built from a GIN line — addDoc happens on save).
// Auto-created QGINs always arrive here in edit mode, unaffected by this.
function QGINForm({profile,existing,showToast,onClose}){
  const isNew=!existing.id;
  const [qualityDate,setQualityDate]=useState(existing.quality_date||new Date().toISOString().split("T")[0]);
  const [qualityType,setQualityType]=useState(existing.quality_type||QUALITY_TYPES[0]);
  const [testingQty,setTestingQty]=useState(existing.testing_qty??"");
  const [acceptedLocation,setAcceptedLocation]=useState(existing.accepted_location||"");
  const [rejectedLocation,setRejectedLocation]=useState(existing.rejected_location||"");
  const [acceptedQty,setAcceptedQty]=useState(existing.accepted_qty??"");
  const [rejectedQty,setRejectedQty]=useState(existing.rejected_qty??0);
  const [reworkQty,setReworkQty]=useState(existing.rework_qty??0);
  const [scrapQty,setScrapQty]=useState(existing.scrap_qty??0);
  const [pendingQty,setPendingQty]=useState(existing.pending_qty??0);
  const [parameters,setParameters]=useState(existing.parameters?.length?existing.parameters:[emptyQGINParameter()]);
  const [remarks,setRemarks]=useState(existing.remarks||"");
  const [reasons,setReasons]=useState(existing.reasons||"");
  const [saving,setSaving]=useState(false);
  const [errors,setErrors]=useState([]);

  function updateParam(i,k,v){setParameters(ps=>ps.map((p,idx)=>idx===i?{...p,[k]:v}:p));}
  function addParam(){setParameters(ps=>[...ps,emptyQGINParameter()]);}
  function removeParam(i){setParameters(ps=>ps.filter((_,idx)=>idx!==i));}

  async function save(submitForApproval){
    const errs=[];
    if(acceptedQty===""||parseFloat(acceptedQty)<0)errs.push("Accepted qty");
    if(errs.length){setErrors(errs);return;}
    setErrors([]);setSaving(true);
    try{
      const payload={
        quality_date:qualityDate, quality_type:qualityType,
        testing_qty:parseFloat(testingQty)||0,
        accepted_location:acceptedLocation||null, rejected_location:rejectedLocation||null,
        accepted_qty:parseFloat(acceptedQty)||0, rejected_qty:parseFloat(rejectedQty)||0,
        rework_qty:parseFloat(reworkQty)||0, scrap_qty:parseFloat(scrapQty)||0, pending_qty:parseFloat(pendingQty)||0,
        parameters:parameters.filter(p=>p.parameter),
        remarks:remarks||null, reasons:reasons||null,
        updated_at:serverTimestamp(),
      };
      if(isNew){
        const qginNumber=await generateQGINNumber(existing.plant);
        await addDoc(collection(db,"quality_gins"),{
          ...payload,
          qgin_number:qginNumber, plant:existing.plant,
          item_code:existing.item_code||"", material_id:existing.material_id||null, material_name:existing.material_name, base_uom:existing.base_uom,
          gin_id:existing.gin_id, gin_number:existing.gin_number, po_id:existing.po_id||null, po_number:existing.po_number||null,
          vendor_id:existing.vendor_id||null, vendor_name:existing.vendor_name||null,
          gin_qty:existing.gin_qty,
          status:submitForApproval?"pending_approval":"draft",
          created_by:auth.currentUser.uid, created_by_name:profile.name||auth.currentUser.email, created_at:serverTimestamp(),
        });
        showToast(`${qginNumber} ${submitForApproval?"submitted for approval":"saved as draft"}`);
      }else{
        await updateDoc(doc(db,"quality_gins",existing.id),{
          ...payload,
          status:submitForApproval?"pending_approval":existing.status,
        });
        showToast(submitForApproval?`${existing.qgin_number} submitted for approval`:`${existing.qgin_number} updated`);
      }
      onClose();
    }catch(e){setErrors([`Save failed: ${e.message}`]);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>{existing.item_code&&<span style={{...S,color:"#6b7280"}}>{existing.item_code} — </span>}{existing.material_name} <span style={{...S,fontSize:11,color:"#9ca3af",fontWeight:400}}>(from {existing.gin_number})</span></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
          <div><label style={labelStyle}>Quality date</label><input type="date" style={fieldStyle} value={qualityDate} onChange={e=>setQualityDate(e.target.value)}/></div>
          <div>
            <label style={labelStyle}>Quality type</label>
            <select style={fieldStyle} value={qualityType} onChange={e=>setQualityType(e.target.value)}>
              {QUALITY_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label style={labelStyle}>Testing qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={testingQty} onChange={e=>setTestingQty(e.target.value)}/></div>
          <div>
            <label style={labelStyle}>Accepted location</label>
            <select style={fieldStyle} value={acceptedLocation} onChange={e=>setAcceptedLocation(e.target.value)}>
              <option value="">— Select —</option>
              {INSPECTION_LOCATIONS.map(l=><option key={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Rejected location</label>
            <select style={fieldStyle} value={rejectedLocation} onChange={e=>setRejectedLocation(e.target.value)}>
              <option value="">— Select —</option>
              {INSPECTION_LOCATIONS.map(l=><option key={l}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Quantity breakdown</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:12}}>
          <div><label style={labelStyle}>Accepted qty *</label><input type="number" style={fieldStyle} min="0" step="0.01" value={acceptedQty} onChange={e=>setAcceptedQty(e.target.value)}/></div>
          <div><label style={labelStyle}>Rejected qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={rejectedQty} onChange={e=>setRejectedQty(e.target.value)}/></div>
          <div><label style={labelStyle}>Rework qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={reworkQty} onChange={e=>setReworkQty(e.target.value)}/></div>
          <div><label style={labelStyle}>Scrap qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={scrapQty} onChange={e=>setScrapQty(e.target.value)}/></div>
          <div><label style={labelStyle}>Pending qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={pendingQty} onChange={e=>setPendingQty(e.target.value)}/></div>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Inspection parameters</div>
        {parameters.map((p,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr 1fr 1fr 1fr auto",gap:8,marginBottom:8,alignItems:"end"}}>
            <div>
              <label style={labelStyle}>Parameter</label>
              <select style={fieldStyle} value={p.parameter} onChange={e=>updateParam(i,"parameter",e.target.value)}>
                <option value="">— Select —</option>
                {QGIN_PARAMETERS.map(opt=><option key={opt}>{opt}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>Description</label><input style={fieldStyle} value={p.parameter_description} onChange={e=>updateParam(i,"parameter_description",e.target.value)}/></div>
            <div><label style={labelStyle}>Visual</label><input style={fieldStyle} value={p.visual} onChange={e=>updateParam(i,"visual",e.target.value)}/></div>
            <div><SelectOrCustom label="UOM" value={p.uom} onChange={v=>updateParam(i,"uom",v)} options={UNITS} placeholder="— Select —"/></div>
            <div><label style={labelStyle}>Standard value</label><input style={fieldStyle} value={p.standard_value} onChange={e=>updateParam(i,"standard_value",e.target.value)}/></div>
            <div><label style={labelStyle}>Actual value</label><input style={fieldStyle} value={p.actual_value} onChange={e=>updateParam(i,"actual_value",e.target.value)}/></div>
            {parameters.length>1&&<button className="btn-ghost" style={{padding:"7px 8px"}} onClick={()=>removeParam(i)}><Icon name="x" size={12}/></button>}
          </div>
        ))}
        <button className="btn-ghost" style={{width:"100%",justifyContent:"center",marginTop:8,borderStyle:"dashed"}} onClick={addParam}><Icon name="plus" size={13}/>Add parameter</button>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{...fieldStyle,minHeight:56,resize:"vertical"}} value={remarks} onChange={e=>setRemarks(e.target.value)}/>
        </div>
        <div>
          <label style={labelStyle}>Reasons</label>
          <textarea style={{...fieldStyle,minHeight:56,resize:"vertical"}} value={reasons} onChange={e=>setReasons(e.target.value)} placeholder="Reason for rejection/rework, if any"/>
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
