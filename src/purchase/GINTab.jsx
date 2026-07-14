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
  const [creatingNew,setCreatingNew]=useState(false);

  useEffect(()=>{
    const q=query(collection(db,"goods_inward_notes"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setGins(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>{
    const q=query(collection(db,"purchase_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setPos(s.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  const q=search.trim().toLowerCase();
  const filtered=gins.filter(g=>
    (statusFilter==="all"||g.status===statusFilter)&&
    (plantFilter==="all"||g.plant===plantFilter)&&
    (!q||
      g.gin_number?.toLowerCase().includes(q)||
      g.vendor_name?.toLowerCase().includes(q)||
      g.po_number?.toLowerCase().includes(q)||
      g.challan_no?.toLowerCase().includes(q)
    )
  );
  const hasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||q.length>0;

  function toggleExpand(id){setExpandedId(prev=>prev===id?null:id);setEditingId(null);}

  async function cancelGIN(gin){
    if(!window.confirm(`Cancel ${gin.gin_number}? This cannot be undone.`))return;
    await updateDoc(doc(db,"goods_inward_notes",gin.id),{status:"cancelled",cancelled_by:profile.name||auth.currentUser.email,cancelled_at:serverTimestamp()});
    showToast(`${gin.gin_number} cancelled`);
  }

  if(creatingNew){
    return <GINForm profile={profile} pos={pos} showToast={showToast} onClose={()=>setCreatingNew(false)}/>;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>{hasActiveNarrowing?`${filtered.length} of ${gins.length} GIN${gins.length!==1?"s":""}`:`${gins.length} GIN${gins.length!==1?"s":""}`}</div>
        {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New GIN</button>}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All"],...GIN_STATUSES.map(s=>[s,GIN_STATUS_LABELS[s]])].map(([v,l])=>(
          <button key={v} onClick={()=>setStatusFilter(v)} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
        <select value={plantFilter} onChange={e=>setPlantFilter(e.target.value)} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
          <option value="all">All plants</option>
          {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by GIN number, vendor, PO, or challan no…" value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {!hasActiveNarrowing
        ?<EmptyState text="Search or select a filter to view GINs" sub="Use the status chips, plant dropdown, or search box above"/>
        :filtered.length===0
        ?<EmptyState text="No GINs match" sub={canCreate?"Try a different filter, or click 'New GIN' to log an arrival":undefined}/>
        :filtered.map(gin=>(
          <GINListItem
            key={gin.id}
            gin={gin}
            profile={profile}
            pos={pos}
            showToast={showToast}
            canApprove={canApprove}
            canCreate={canCreate}
            expanded={expandedId===gin.id}
            editing={editingId===gin.id}
            onToggle={()=>toggleExpand(gin.id)}
            onEditClick={()=>setEditingId(gin.id)}
            onCancelEdit={()=>setEditingId(null)}
            onCancelGIN={()=>cancelGIN(gin)}
          />
        ))
      }
    </div>
  );
}

function GINListItem({gin,profile,pos,showToast,canApprove,canCreate,expanded,editing,onToggle,onEditClick,onCancelEdit,onCancelGIN}){
  const sc=GIN_STATUS_COLORS[gin.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const canEdit=["draft","pending_approval"].includes(gin.status)&&canCreate;
  const canCancel=["draft","pending_approval"].includes(gin.status);

  return(
    <div className="card animate-in" style={{padding:0,marginBottom:8,overflow:"hidden"}}>
      <div onClick={onToggle} style={{padding:"14px 18px",cursor:"pointer"}}
        onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
          <span style={{...S,fontSize:13,fontWeight:700,color:"#1a1f2e"}}>{gin.gin_number}</span>
          <span style={{...S,background:"#f3f4f6",color:"#374151",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>{gin.plant}</span>
          <span style={{...S,background:"#eef2ff",color:"#4338ca",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>{gin.gin_type}</span>
          <span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600,flexShrink:0}}>{GIN_STATUS_LABELS[gin.status]}</span>
          {gin.grn_number&&<span style={{...S,background:"#f0fdf4",color:"#16a34a",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>→ {gin.grn_number}</span>}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" style={{transform:expanded?"rotate(90deg)":"none",transition:"transform .15s"}}><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:0,flexWrap:"wrap",fontSize:13,marginBottom:6}}>
          <span style={{fontWeight:600,color:"#1a1f2e",marginRight:12}}>{gin.vendor_name}</span>
          <span style={{...S,fontSize:11,color:"#6b7280",marginRight:12}}>PO {gin.po_number}</span>
          <span style={{...S,fontSize:11,color:"#6b7280"}}>{(gin.line_items||[]).length} item{(gin.line_items||[]).length!==1?"s":""}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:"#9ca3af",display:"flex",alignItems:"center",gap:4}}>
            <Icon name="truck" size={11}/>Vehicle {gin.vehicle_no||"—"}
          </span>
          <span style={{fontSize:11,color:"#9ca3af"}}>by {gin.created_by_name}</span>
        </div>
      </div>

      {expanded&&(
        <div style={{borderTop:"1px solid #f3f4f6",padding:20,background:"#fafbfc"}} onClick={e=>e.stopPropagation()}>
          {editing
            ? <GINForm profile={profile} pos={pos} existing={gin} showToast={showToast} onClose={onCancelEdit}/>
            : <GINDetailPanel gin={gin} profile={profile} showToast={showToast} canApprove={canApprove} canEdit={canEdit} canCancel={canCancel}
                onEdit={onEditClick} onCancel={onCancelGIN}/>
          }
        </div>
      )}
    </div>
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
          <div><label style={labelStyle}>Challan No</label><input style={fieldStyle} value={challanNo} onChange={e=>setChallanNo(e.target.value)}/></div>
          <div><label style={labelStyle}>Challan Date</label><input type="date" style={fieldStyle} value={challanDate} onChange={e=>setChallanDate(e.target.value)}/></div>
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
        {lineItems.map((it,i)=>(
          <div key={i} style={{borderTop:i>0?"1px solid #f3f4f6":undefined,paddingTop:i>0?14:0,marginTop:i>0?14:0}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>{it.item_code&&<span style={{...S,color:"#6b7280"}}>{it.item_code} — </span>}{it.material_name}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 2fr",gap:10}}>
              <div><label style={labelStyle}>Challan qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={it.challan_qty} onChange={e=>updateLine(i,"challan_qty",e.target.value)}/></div>
              <div><label style={labelStyle}>Accepted qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={it.accepted_qty} onChange={e=>updateLine(i,"accepted_qty",e.target.value)}/></div>
              <div><label style={labelStyle}>Rejected qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={it.rejected_qty} onChange={e=>updateLine(i,"rejected_qty",e.target.value)}/></div>
              <div><label style={labelStyle}>Actual challan qty</label><input type="number" style={fieldStyle} min="0" step="0.01" value={it.actual_challan_qty} onChange={e=>updateLine(i,"actual_challan_qty",e.target.value)}/></div>
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
