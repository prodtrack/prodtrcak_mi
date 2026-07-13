// ─── PurchaseRequisitionsTab.jsx ────────────────────────────────────────────
// Purchase Requisition (PR): draft → pending_approval → approved (auto-
// generates a matching PO in "draft" status) / rejected, with cancel
// available up to approval. Sits upstream of PurchaseOrdersTab — a PR does
// not touch stock or vendors' hands directly, it only ever produces a PO.

import { useState } from "react";
import { useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle } from "../shared.jsx";
import {
  PLANTS, UNITS, REQUISITION_TYPES, PR_STATUSES, PR_STATUS_LABELS, PR_STATUS_COLORS,
  generatePRNumber, generatePONumber, emptyPRLineItem, lastPORateForMaterial, DEFAULT_GST_RATE,
} from "./purchaseHelpers";
import { printPurchaseRequisition } from "./PRPrintView.jsx";

export default function PurchaseRequisitionsTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  // Reusing the existing Purchase flags — no dedicated PR permission exists
  // yet (AdminPanel.jsx wasn't locatable). Swap these for dedicated flags
  // later if PR needs its own gate separate from PO.
  const canCreate=isAdmin||!!profile.can_purchase;
  const canApprove=isAdmin||!!profile.isPurchaseManager;

  const [prs,setPrs]=useState([]);
  const [vendors,setVendors]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [purchaseOrders,setPurchaseOrders]=useState([]);
  const [statusFilter,setStatusFilter]=useState("all");
  const [plantFilter,setPlantFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [expandedId,setExpandedId]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const [creatingNew,setCreatingNew]=useState(false);

  useEffect(()=>{
    const q=query(collection(db,"purchase_requisitions"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setPrs(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>onSnapshot(collection(db,"supplier_master"),s=>setVendors(s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.active!==false))),[]);
  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),s=>setMaterials(s.docs.map(d=>({id:d.id,...d.data()})))),[]);
  // Loaded read-only, purely to look up "Last PO Rate" per item — PR never
  // writes to purchase_orders directly outside the one auto-generate step.
  useEffect(()=>onSnapshot(collection(db,"purchase_orders"),s=>setPurchaseOrders(s.docs.map(d=>({id:d.id,...d.data()})))),[]);

  const q=search.trim().toLowerCase();
  const filtered=prs.filter(p=>
    (statusFilter==="all"||p.status===statusFilter)&&
    (plantFilter==="all"||p.plant===plantFilter)&&
    (!q||
      p.pr_number?.toLowerCase().includes(q)||
      p.vendor_name?.toLowerCase().includes(q)||
      p.vendor_code?.toLowerCase().includes(q)||
      p.plant?.toLowerCase().includes(q)||
      (p.line_items||[]).some(it=>it.material_name?.toLowerCase().includes(q)||it.item_code?.toLowerCase().includes(q))
    )
  );

  const hasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||q.length>0;

  function toggleExpand(id){setExpandedId(prev=>prev===id?null:id);setEditingId(null);}

  async function cancelPR(pr){
    if(!window.confirm(`Cancel ${pr.pr_number}? This cannot be undone.`))return;
    await updateDoc(doc(db,"purchase_requisitions",pr.id),{status:"cancelled",cancelled_by:profile.name||auth.currentUser.email,cancelled_at:serverTimestamp()});
    showToast(`${pr.pr_number} cancelled`);
  }
  async function deleteDraft(pr){
    if(!window.confirm(`Delete draft ${pr.pr_number}? This cannot be undone.`))return;
    await deleteDoc(doc(db,"purchase_requisitions",pr.id));
    showToast(`${pr.pr_number} deleted`);
  }

  if(creatingNew){
    return <PRForm profile={profile} vendors={vendors} materials={materials} purchaseOrders={purchaseOrders} showToast={showToast} onClose={()=>setCreatingNew(false)}/>;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>{hasActiveNarrowing?`${filtered.length} of ${prs.length} requisition${prs.length!==1?"s":""}`:`${prs.length} requisition${prs.length!==1?"s":""}`}</div>
        {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New Requisition</button>}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All"],...PR_STATUSES.map(s=>[s,PR_STATUS_LABELS[s]])].map(([v,l])=>(
          <button key={v} onClick={()=>setStatusFilter(v)} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
        <select value={plantFilter} onChange={e=>setPlantFilter(e.target.value)} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
          <option value="all">All plants</option>
          {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by PR number, vendor name, or item…" value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {!hasActiveNarrowing
        ?<EmptyState text="Search or select a filter to view requisitions" sub="Use the status chips, plant dropdown, or search box above"/>
        :filtered.length===0
        ?<EmptyState text="No requisitions match" sub={canCreate?"Try a different filter, or click 'New Requisition' to create one":undefined}/>
        :filtered.map(pr=>(
          <PRListItem
            key={pr.id}
            pr={pr}
            profile={profile}
            vendors={vendors}
            materials={materials}
            purchaseOrders={purchaseOrders}
            showToast={showToast}
            canApprove={canApprove}
            canCreate={canCreate}
            expanded={expandedId===pr.id}
            editing={editingId===pr.id}
            onToggle={()=>toggleExpand(pr.id)}
            onEditClick={()=>setEditingId(pr.id)}
            onCancelEdit={()=>setEditingId(null)}
            onCancelPR={()=>cancelPR(pr)}
            onDeleteDraft={()=>deleteDraft(pr)}
          />
        ))
      }
    </div>
  );
}

// ─── PR list item — inline expand, same interaction pattern as PO ───────────
function PRListItem({pr,profile,vendors,materials,purchaseOrders,showToast,canApprove,canCreate,expanded,editing,onToggle,onEditClick,onCancelEdit,onCancelPR,onDeleteDraft}){
  const sc=PR_STATUS_COLORS[pr.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const isDraft=pr.status==="draft";
  const canEdit=["draft","pending_approval"].includes(pr.status)&&canCreate;
  const canCancel=["draft","pending_approval"].includes(pr.status);

  return(
    <div className="card animate-in" style={{padding:0,marginBottom:8,overflow:"hidden"}}>
      <div onClick={onToggle} style={{padding:"14px 18px",cursor:"pointer"}}
        onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
          <span style={{...S,fontSize:13,fontWeight:700,color:"#1a1f2e"}}>{pr.pr_number}</span>
          <span style={{...S,background:"#f3f4f6",color:"#374151",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>{pr.plant}</span>
          <span style={{...S,background:"#eef2ff",color:"#4338ca",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>{pr.requisition_type}</span>
          <span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600,flexShrink:0}}>{PR_STATUS_LABELS[pr.status]}</span>
          {pr.converted_po_number&&<span style={{...S,background:"#f0fdf4",color:"#16a34a",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>→ {pr.converted_po_number}</span>}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" style={{transform:expanded?"rotate(90deg)":"none",transition:"transform .15s"}}><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:0,flexWrap:"wrap",fontSize:13,marginBottom:6}}>
          <span style={{fontWeight:600,color:"#1a1f2e",marginRight:12}}>{pr.vendor_name||"— no vendor —"}</span>
          <span style={{...S,fontSize:11,color:"#6b7280"}}>{(pr.line_items||[]).length} item{(pr.line_items||[]).length!==1?"s":""}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:"#9ca3af",display:"flex",alignItems:"center",gap:4}}>
            <Icon name="calendar" size={11}/>Requested {formatDate(pr.created_at?.toDate?pr.created_at.toDate():pr.created_at)}
          </span>
          <span style={{fontSize:11,color:"#9ca3af"}}>by {pr.created_by_name}</span>
        </div>
      </div>

      {expanded&&(
        <div style={{borderTop:"1px solid #f3f4f6",padding:20,background:"#fafbfc"}} onClick={e=>e.stopPropagation()}>
          {editing
            ? <PRForm profile={profile} vendors={vendors} materials={materials} purchaseOrders={purchaseOrders} existing={pr} showToast={showToast} onClose={onCancelEdit}/>
            : <PRDetailPanel pr={pr} profile={profile} showToast={showToast} canApprove={canApprove} canEdit={canEdit} canCancel={canCancel}
                onEdit={onEditClick} onCancel={onCancelPR} onDeleteDraft={onDeleteDraft}/>
          }
        </div>
      )}
    </div>
  );
}

function PRDetailPanel({pr,profile,showToast,canApprove,canEdit,canCancel,onEdit,onCancel,onDeleteDraft}){
  const [busy,setBusy]=useState(false);
  const [rejectRemark,setRejectRemark]=useState("");

  async function submitForApproval(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"purchase_requisitions",pr.id),{status:"pending_approval",updated_at:serverTimestamp()});
      showToast(`${pr.pr_number} submitted for approval`);
    }finally{setBusy(false);}
  }

  // Approving a PR immediately raises a matching PO in "draft" status —
  // pre-filled from the PR, using the item's Last PO Rate where available
  // (0 if the item has never been bought before) — the buyer still reviews
  // and submits that PO through the normal PO approval flow.
  async function approveAndConvert(){
    setBusy(true);
    try{
      const poNumber=await generatePONumber(pr.plant);
      const poLineItems=(pr.line_items||[]).map(it=>({
        part_code:it.item_code||"", material_id:it.material_id||"", material_name:it.material_name,
        hsn_code:"", qty:parseFloat(it.qty)||0, unit:it.unit, rate:it.last_po_rate||0,
        required_date:it.required_date||"", received_qty:0,
      }));
      await addDoc(collection(db,"purchase_orders"),{
        plant:pr.plant, vendor_id:pr.vendor_id||null, vendor_name:pr.vendor_name||null, vendor_code:pr.vendor_code||null,
        vendor_gstin:pr.vendor_gstin||null, vendor_state_code:pr.vendor_state_code||null,
        vendor_address:pr.vendor_address||null, vendor_phone:pr.vendor_phone||null, vendor_email:pr.vendor_email||null, vendor_pan:pr.vendor_pan||null,
        line_items:poLineItems, gst_rate:DEFAULT_GST_RATE, total_amount:0,
        expected_delivery:(poLineItems.map(l=>l.required_date).filter(Boolean).sort()[0])||null,
        your_reference:pr.pr_number, payment_terms:null, terms_of_delivery:null, mode_of_delivery:null,
        remarks:`Auto-generated from requisition ${pr.pr_number}${!pr.vendor_id?" — vendor not set on PR, select before submitting":""}`,
        po_number:poNumber, status:"draft", pr_reference:pr.pr_number,
        created_by:auth.currentUser.uid, created_by_name:profile.name||auth.currentUser.email, created_at:serverTimestamp(),
      });
      await updateDoc(doc(db,"purchase_requisitions",pr.id),{
        status:"approved", approved_by:profile.name||auth.currentUser.email, approved_at:serverTimestamp(),
        converted_po_number:poNumber,
      });
      showToast(`${pr.pr_number} approved — ${poNumber} created as draft`);
    }finally{setBusy(false);}
  }

  async function reject(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"purchase_requisitions",pr.id),{status:"rejected",rejection_remarks:rejectRemark||null,rejected_by:profile.name||auth.currentUser.email,rejected_at:serverTimestamp()});
      showToast(`${pr.pr_number} rejected`);
      setRejectRemark("");
    }finally{setBusy(false);}
  }

  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>printPurchaseRequisition(pr)}><Icon name="clipboard" size={12}/>Print PR</button>
        {canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={onEdit}><Icon name="edit" size={12}/>Edit</button>}
        {pr.status==="draft"&&canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={submitForApproval}><Icon name="check" size={12}/>Submit for Approval</button>}
        {pr.status==="pending_approval"&&canApprove&&<button className="btn-primary" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={approveAndConvert}><Icon name="check" size={12}/>Approve & Create PO</button>}
        {canCancel&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px",color:"#dc2626"}} onClick={onCancel}>Cancel PR</button>}
        {pr.status==="draft"&&canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px",color:"#dc2626"}} onClick={onDeleteDraft}><Icon name="trash" size={12}/>Delete</button>}
      </div>

      {pr.status==="pending_approval"&&canApprove&&(
        <div className="card" style={{padding:16,marginBottom:16,background:"#fffbeb",border:"1px solid #fde68a"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#92400e",marginBottom:8}}>Reject this requisition?</div>
          <div style={{display:"flex",gap:8}}>
            <input style={{...fieldStyle,flex:1,fontSize:12}} placeholder="Reason (optional)" value={rejectRemark} onChange={e=>setRejectRemark(e.target.value)}/>
            <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px",color:"#dc2626",flexShrink:0}} disabled={busy} onClick={reject}>Reject</button>
          </div>
        </div>
      )}

      {pr.rejection_remarks&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#dc2626"}}>
          Rejected: "{pr.rejection_remarks}"
        </div>
      )}

      <div className="card" style={{padding:16,marginBottom:14,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:12}}>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Vendor</div>
            <div style={{fontSize:13,fontWeight:600}}>{pr.vendor_name||"— not set —"}</div>
            {pr.vendor_code&&<div style={{fontSize:11,color:"#9ca3af"}}>Code: {pr.vendor_code}</div>}
          </div>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Details</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Requested by: {pr.requested_by_code||"—"}</div>
            {pr.job_order&&<div style={{fontSize:11,color:"#9ca3af"}}>Job order: {pr.job_order}</div>}
          </div>
        </div>
      </div>

      <div className="card" style={{padding:0,marginBottom:14,overflow:"hidden",background:"#fff"}}>
        <div style={{display:"flex",padding:"8px 14px",background:"#f9fafb",fontSize:10,color:"#9ca3af",...S,textTransform:"uppercase",letterSpacing:".05em"}}>
          <span style={{flex:1}}>Item</span><span style={{width:70,textAlign:"right"}}>Inv Qty</span><span style={{width:70,textAlign:"right"}}>Req Qty</span><span style={{width:80,textAlign:"right"}}>Last Rate</span>
        </div>
        {(pr.line_items||[]).map((it,i)=>(
          <div key={i} style={{display:"flex",padding:"10px 14px",borderTop:"1px solid #f3f4f6",fontSize:12,alignItems:"center"}}>
            <span style={{flex:1}}>
              <div style={{fontWeight:500}}>{it.item_code&&<span style={{...S,color:"#6b7280"}}>{it.item_code} — </span>}{it.material_name}</div>
              {it.required_date&&<div style={{...S,fontSize:10,color:"#9ca3af"}}>Req {formatDate(it.required_date)}</div>}
            </span>
            <span style={{width:70,textAlign:"right",...S}}>{it.inventory_qty} {it.unit}</span>
            <span style={{width:70,textAlign:"right",...S}}>{it.qty} {it.unit}</span>
            <span style={{width:80,textAlign:"right",...S}}>{it.last_po_rate!=null?`₹${it.last_po_rate}`:"—"}</span>
          </div>
        ))}
      </div>

      {pr.remarks&&<div style={{fontSize:12,color:"#6b7280",marginBottom:4}}><span style={{color:"#9ca3af"}}>Remarks:</span> {pr.remarks}</div>}
      {pr.comments&&<div style={{fontSize:12,color:"#6b7280",marginBottom:8}}><span style={{color:"#9ca3af"}}>Comments:</span> {pr.comments}</div>}
      <div style={{fontSize:11,color:"#9ca3af"}}>
        Created by {pr.created_by_name} on {formatDate(pr.created_at?.toDate?pr.created_at.toDate():pr.created_at)}
        {pr.approved_by&&` · Approved by ${pr.approved_by}`}
        {pr.rejected_by&&` · Rejected by ${pr.rejected_by}`}
        {pr.cancelled_by&&` · Cancelled by ${pr.cancelled_by}`}
      </div>
    </div>
  );
}

// ─── PR create / edit form ──────────────────────────────────────────────────
function PRForm({profile,vendors,materials,purchaseOrders,existing,showToast,onClose}){
  const isEdit=!!existing;
  const [plant,setPlant]=useState(existing?.plant||"Bidadi");
  const [requisitionType,setRequisitionType]=useState(existing?.requisition_type||"Internal");
  const [vendorId,setVendorId]=useState(existing?.vendor_id||"");
  const [requestedByCode,setRequestedByCode]=useState(existing?.requested_by_code||"");
  const [jobOrder,setJobOrder]=useState(existing?.job_order||"");
  const [lineItems,setLineItems]=useState(existing?.line_items?.length?existing.line_items:[emptyPRLineItem()]);
  const [remarks,setRemarks]=useState(existing?.remarks||"");
  const [comments,setComments]=useState(existing?.comments||"");
  const [saving,setSaving]=useState(false);
  const [errors,setErrors]=useState([]);

  const vendor=vendors.find(v=>v.id===vendorId)||null;

  function updateLine(i,k,v){setLineItems(items=>items.map((it,idx)=>idx===i?{...it,[k]:v}:it));}
  function addLine(){setLineItems(items=>[...items,emptyPRLineItem()]);}
  function removeLine(i){setLineItems(items=>items.filter((_,idx)=>idx!==i));}
  function selectMaterial(i,materialId){
    if(materialId==="__custom__"){updateLine(i,"material_id","");return;}
    const m=materials.find(m=>m.id===materialId);
    if(!m)return;
    const lastRate=lastPORateForMaterial(purchaseOrders,materialId,m.material_name);
    setLineItems(items=>items.map((it,idx)=>idx===i?{
      // Inventory qty is manual-only now — no longer pre-filled from
      // rm_inventory's current_stock, since stock counts get verified/typed
      // in by hand at requisition time rather than trusted from the system.
      ...it, material_id:materialId, material_name:m.material_name||it.material_name,
      unit:m.unit||it.unit, last_po_rate:lastRate,
    }:it));
  }

  async function save(submitForApproval){
    const errs=[];
    const cleanLines=lineItems.filter(it=>it.material_name?.trim());
    if(cleanLines.length===0)errs.push("At least one line item with an item description");
    if(cleanLines.some(it=>!it.qty||parseFloat(it.qty)<=0))errs.push("Required qty on all line items");
    if(errs.length){setErrors(errs);return;}
    setErrors([]);setSaving(true);
    try{
      const payload={
        plant, requisition_type:requisitionType,
        vendor_id:vendor?.id||null, vendor_name:vendor?.name||null, vendor_code:vendor?.vendor_code||null,
        vendor_gstin:vendor?.gstin||null, vendor_state_code:vendor?.state_code||null,
        vendor_address:vendor?.address||null, vendor_phone:vendor?.phone||null, vendor_email:vendor?.email||null, vendor_pan:vendor?.pan||null,
        requested_by_code:requestedByCode||null, job_order:jobOrder||null,
        line_items:cleanLines.map(it=>({...it,qty:parseFloat(it.qty),inventory_qty:parseFloat(it.inventory_qty)||0})),
        remarks:remarks||null, comments:comments||null,
        updated_at:serverTimestamp(),
      };
      if(isEdit){
        await updateDoc(doc(db,"purchase_requisitions",existing.id),{
          ...payload, status:submitForApproval?"pending_approval":existing.status,
        });
        showToast(submitForApproval?`${existing.pr_number} submitted for approval`:`${existing.pr_number} updated`);
      }else{
        const prNumber=await generatePRNumber(plant);
        await addDoc(collection(db,"purchase_requisitions"),{
          ...payload, pr_number:prNumber, status:submitForApproval?"pending_approval":"draft",
          created_by:auth.currentUser.uid, created_by_name:profile.name||auth.currentUser.email, created_at:serverTimestamp(),
        });
        showToast(`${prNumber} ${submitForApproval?"submitted for approval":"saved as draft"}`);
      }
      onClose();
    }catch(e){setErrors([`Save failed: ${e.message}`]);}
    finally{setSaving(false);}
  }

  return(
    <div>
      {!isEdit&&<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>New Purchase Requisition</div>
      </div>}

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Site / Plant *</label>
            <select style={fieldStyle} value={plant} onChange={e=>setPlant(e.target.value)}>
              {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Requisition type *</label>
            <select style={fieldStyle} value={requisitionType} onChange={e=>setRequisitionType(e.target.value)}>
              {REQUISITION_TYPES.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Vendor {vendor?"":<span style={{color:"#9ca3af",fontWeight:400}}>(optional — can be set later on the PO)</span>}</label>
            <select style={fieldStyle} value={vendorId} onChange={e=>setVendorId(e.target.value)}>
              <option value="">— Select vendor —</option>
              {vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_code} — {v.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Requested by (code)</label>
            <input style={fieldStyle} value={requestedByCode} onChange={e=>setRequestedByCode(e.target.value)} placeholder="e.g. store1"/>
          </div>
          <div>
            <label style={labelStyle}>Job order</label>
            <input style={fieldStyle} value={jobOrder} onChange={e=>setJobOrder(e.target.value)} placeholder="Optional reference"/>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Line items</div>
        {lineItems.map((it,i)=>(
          <div key={i} style={{borderTop:i>0?"1px solid #f3f4f6":undefined,paddingTop:i>0?14:0,marginTop:i>0?14:0}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{...S,fontSize:11,color:"#6b7280",fontWeight:600}}>ITEM {i+1}</span>
              {lineItems.length>1&&<button className="btn-danger" style={{padding:"3px 8px",fontSize:11}} onClick={()=>removeLine(i)}><Icon name="x" size={11}/>Remove</button>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10,marginBottom:10}}>
              <div>
                <label style={labelStyle}>Item (from catalog, or type a new item)</label>
                <select style={{...fieldStyle,marginBottom:6}} value={it.material_id||"__custom__"} onChange={e=>selectMaterial(i,e.target.value)}>
                  <option value="__custom__">— Custom / non-catalog item —</option>
                  {materials.map(m=><option key={m.id} value={m.id}>{m.material_name}</option>)}
                </select>
                <input style={fieldStyle} placeholder="Item description" value={it.material_name} onChange={e=>updateLine(i,"material_name",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>Item code</label>
                <input style={fieldStyle} value={it.item_code||""} onChange={e=>updateLine(i,"item_code",e.target.value)} placeholder="e.g. F361"/>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:10}}>
              <div>
                <label style={labelStyle}>Inventory qty</label>
                <input type="number" style={fieldStyle} min="0" step="0.01" value={it.inventory_qty} onChange={e=>updateLine(i,"inventory_qty",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>Required qty *</label>
                <input type="number" style={fieldStyle} min="0" step="0.01" value={it.qty} onChange={e=>updateLine(i,"qty",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>UOM</label>
                <select style={fieldStyle} value={it.unit} onChange={e=>updateLine(i,"unit",e.target.value)}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Required date</label>
                <input type="date" style={fieldStyle} value={it.required_date||""} onChange={e=>updateLine(i,"required_date",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>Last PO rate</label>
                <div style={{...fieldStyle,...S,background:"#f9fafb"}}>{it.last_po_rate!=null?`₹${it.last_po_rate}`:"—"}</div>
              </div>
            </div>
            <div style={{marginTop:10}}>
              <label style={labelStyle}>Item remarks</label>
              <input style={fieldStyle} value={it.remarks||""} onChange={e=>updateLine(i,"remarks",e.target.value)} placeholder="Optional"/>
            </div>
          </div>
        ))}
        <button className="btn-ghost" style={{width:"100%",justifyContent:"center",marginTop:16,borderStyle:"dashed"}} onClick={addLine}><Icon name="plus" size={13}/>Add item</button>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Remarks</label>
          <textarea style={{...fieldStyle,minHeight:56,resize:"vertical"}} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Any additional notes for this requisition..."/>
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
