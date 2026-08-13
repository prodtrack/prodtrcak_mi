// ─── PurchaseOrdersTab.jsx ──────────────────────────────────────────────────
// Purchase Order lifecycle: draft → pending_approval → approved →
// partially_received/received → closed, with cancel available up to the
// point goods start arriving. Line items are matched to `rm_inventory` where
// possible (so GRN can auto-update stock) but also support free-text items
// (tools, spares, capex — anything outside the RM catalog), matching how
// real POs at Mahendra Industries are actually raised.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle, FuzzyAutocomplete } from "../shared.jsx";
import {
  PLANTS, COMPANY_INFO, UNITS, PO_STATUSES, PO_STATUS_LABELS, PO_STATUS_COLORS,
  generatePONumber, lineAmount, poTotals, emptyLineItem, DEFAULT_GST_RATE,
  GST_RATE_OPTIONS, DELIVERY_TERMS_OPTIONS, DELIVERY_MODE_OPTIONS, PAYMENT_TERMS_OPTIONS,
  earliestRequiredDate,
} from "./purchaseHelpers";
import { printPurchaseOrder } from "./POPrintView.jsx";
import SelectOrCustom from "./PurchaseFormControls.jsx";

export default function PurchaseOrdersTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canCreate=isAdmin||!!profile.can_purchase;
  const canApprove=isAdmin||!!profile.isPurchaseManager;

  const [pos,setPos]=useState([]);
  const [vendors,setVendors]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [statusFilter,setStatusFilter]=useState("all");
  const [plantFilter,setPlantFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [expandedId,setExpandedId]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const [creatingNew,setCreatingNew]=useState(false);

  useEffect(()=>{
    const q=query(collection(db,"purchase_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setPos(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>onSnapshot(collection(db,"supplier_master"),s=>setVendors(s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.active!==false))),[]);
  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),s=>setMaterials(s.docs.map(d=>({id:d.id,...d.data()})))),[]);

  const q=search.trim().toLowerCase();
  const filtered=pos.filter(p=>
    (statusFilter==="all"||p.status===statusFilter)&&
    (plantFilter==="all"||p.plant===plantFilter)&&
    (!q||
      p.po_number?.toLowerCase().includes(q)||
      p.vendor_name?.toLowerCase().includes(q)||
      p.vendor_code?.toLowerCase().includes(q)||
      p.your_reference?.toLowerCase().includes(q)||
      p.plant?.toLowerCase().includes(q)||
      (p.line_items||[]).some(it=>it.material_name?.toLowerCase().includes(q)||it.part_code?.toLowerCase().includes(q))
    )
  );

  const hasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||q.length>0;

  function toggleExpand(id){setExpandedId(prev=>prev===id?null:id);setEditingId(null);}

  async function cancelPO(po){
    if(!window.confirm(`Cancel ${po.po_number}? This cannot be undone.`))return;
    await updateDoc(doc(db,"purchase_orders",po.id),{status:"cancelled",cancelled_by:profile.name||auth.currentUser.email,cancelled_at:serverTimestamp()});
    showToast(`${po.po_number} cancelled`);
  }
  async function deleteDraft(po){
    if(!window.confirm(`Delete draft ${po.po_number}? This cannot be undone.`))return;
    await deleteDoc(doc(db,"purchase_orders",po.id));
    showToast(`${po.po_number} deleted`);
  }
  async function closePO(po){
    await updateDoc(doc(db,"purchase_orders",po.id),{status:"closed",closed_by:profile.name||auth.currentUser.email,closed_at:serverTimestamp()});
    showToast(`${po.po_number} closed`);
  }

  if(creatingNew){
    return <POForm profile={profile} vendors={vendors} materials={materials} showToast={showToast} onClose={()=>setCreatingNew(false)}/>;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>{hasActiveNarrowing?`${filtered.length} of ${pos.length} purchase order${pos.length!==1?"s":""}`:`${pos.length} purchase order${pos.length!==1?"s":""}`}</div>
        {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New Purchase Order</button>}
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All"],...PO_STATUSES.map(s=>[s,PO_STATUS_LABELS[s]])].map(([v,l])=>(
          <button key={v} onClick={()=>setStatusFilter(v)} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
        <select value={plantFilter} onChange={e=>setPlantFilter(e.target.value)} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
          <option value="all">All plants</option>
          {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by PO number, vendor name, or vendor code…" value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {!hasActiveNarrowing
        ?<EmptyState text="Search or select a filter to view purchase orders" sub="Use the status chips, plant dropdown, or search box above"/>
        :filtered.length===0
        ?<EmptyState text="No purchase orders match" sub={canCreate?"Try a different filter, or click 'New Purchase Order' to create one":undefined}/>
        :filtered.map(po=>(
          <POListItem
            key={po.id}
            po={po}
            profile={profile}
            vendors={vendors}
            materials={materials}
            showToast={showToast}
            canApprove={canApprove}
            canCreate={canCreate}
            expanded={expandedId===po.id}
            editing={editingId===po.id}
            onToggle={()=>toggleExpand(po.id)}
            onEditClick={()=>setEditingId(po.id)}
            onCancelEdit={()=>setEditingId(null)}
            onCancelPO={()=>cancelPO(po)}
            onDeleteDraft={()=>deleteDraft(po)}
            onClosePO={()=>closePO(po)}
          />
        ))
      }
    </div>
  );
}

// ─── PO list item — inline expand, same interaction pattern as Work Orders ─────
function POListItem({po,profile,vendors,materials,showToast,canApprove,canCreate,expanded,editing,onToggle,onEditClick,onCancelEdit,onCancelPO,onDeleteDraft,onClosePO}){
  const sc=PO_STATUS_COLORS[po.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const totals=poTotals(po.plant,po.vendor_state_code,po.line_items,po.gst_rate||DEFAULT_GST_RATE);
  const isDraft=po.status==="draft";
  const hasReceipts=(po.line_items||[]).some(it=>(it.received_qty||0)>0);
  const canEdit=(["draft","pending_approval","approved"].includes(po.status))&&canCreate&&!hasReceipts;
  const isAmendment=!isDraft&&po.status!=="pending_approval"; // editing an approved PO = amendment
  const canCancel=["draft","pending_approval","approved"].includes(po.status)&&!hasReceipts;

  return(
    <div className="card animate-in" style={{padding:0,marginBottom:8,overflow:"hidden"}}>
      <div onClick={onToggle} style={{padding:"14px 18px",cursor:"pointer"}}
        onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap"}}>
          <span style={{...S,fontSize:13,fontWeight:700,color:"#1a1f2e"}}>{po.po_number}</span>
          <span style={{...S,background:"#f3f4f6",color:"#374151",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>{po.plant}</span>
          <span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600,flexShrink:0}}>{PO_STATUS_LABELS[po.status]}</span>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" style={{transform:expanded?"rotate(90deg)":"none",transition:"transform .15s"}}><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:0,flexWrap:"wrap",fontSize:13,marginBottom:6}}>
          <span style={{fontWeight:600,color:"#1a1f2e",marginRight:12}}>{po.vendor_name}</span>
          <span style={{...S,fontSize:11,color:"#6b7280",marginRight:12}}>{(po.line_items||[]).length} line{(po.line_items||[]).length!==1?"s":""}</span>
          <span style={{...S,fontSize:13,fontWeight:700,color:"#1a1f2e"}}>₹{totals.grandTotal.toLocaleString("en-IN")}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:11,color:"#9ca3af",display:"flex",alignItems:"center",gap:4}}>
            <Icon name="calendar" size={11}/>Required by {formatDate(po.expected_delivery||earliestRequiredDate(po.line_items))}
          </span>
          <span style={{fontSize:11,color:"#9ca3af"}}>by {po.created_by_name}</span>
        </div>
      </div>

      {expanded&&(
        <div style={{borderTop:"1px solid #f3f4f6",padding:20,background:"#fafbfc"}} onClick={e=>e.stopPropagation()}>
          {editing
            ? <POForm profile={profile} vendors={vendors} materials={materials} existing={po} isAmendment={isAmendment} showToast={showToast} onClose={onCancelEdit}/>
            : <PODetailPanel po={po} profile={profile} showToast={showToast} canApprove={canApprove} canEdit={canEdit} isAmendment={isAmendment} canCancel={canCancel}
                onEdit={onEditClick} onCancel={onCancelPO} onDeleteDraft={onDeleteDraft} onClose={onClosePO}/>
          }
        </div>
      )}
    </div>
  );
}

function PODetailPanel({po,profile,showToast,canApprove,canEdit,isAmendment,canCancel,onEdit,onCancel,onDeleteDraft,onClose}){
  const [busy,setBusy]=useState(false);
  const [rejectRemark,setRejectRemark]=useState("");
  const totals=poTotals(po.plant,po.vendor_state_code,po.line_items,po.gst_rate||DEFAULT_GST_RATE);
  const company=COMPANY_INFO[po.plant]||{};

  async function submitForApproval(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"purchase_orders",po.id),{status:"pending_approval",updated_at:serverTimestamp()});
      showToast(`${po.po_number} submitted for approval`);
    }finally{setBusy(false);}
  }
  async function approve(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"purchase_orders",po.id),{status:"approved",approved_by:profile.name||auth.currentUser.email,approved_at:serverTimestamp()});
      showToast(`${po.po_number} approved`);
    }finally{setBusy(false);}
  }
  async function reject(){
    setBusy(true);
    try{
      await updateDoc(doc(db,"purchase_orders",po.id),{status:"draft",rejection_remarks:rejectRemark||null,rejected_by:profile.name||auth.currentUser.email,rejected_at:serverTimestamp()});
      showToast(`${po.po_number} sent back to draft`);
      setRejectRemark("");
    }finally{setBusy(false);}
  }

  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>printPurchaseOrder(po)}><Icon name="clipboard" size={12}/>Print PO</button>
        {canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={onEdit}><Icon name="edit" size={12}/>{isAmendment?"Amend":"Edit"}</button>}
        {canEdit&&!isAmendment&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={submitForApproval}><Icon name="check" size={12}/>Submit for Approval</button>}
        {po.status==="pending_approval"&&canApprove&&<button className="btn-primary" style={{fontSize:12,padding:"6px 12px"}} disabled={busy} onClick={approve}><Icon name="check" size={12}/>Approve</button>}
        {po.status==="received"&&canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={onClose}><Icon name="check" size={12}/>Close PO</button>}
        {canCancel&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px",color:"#dc2626"}} onClick={onCancel}>Cancel PO</button>}
        {po.status==="draft"&&canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px",color:"#dc2626"}} onClick={onDeleteDraft}><Icon name="trash" size={12}/>Delete</button>}
      </div>

      {po.amd_no>0&&(
        <div style={{background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:8,padding:"8px 14px",marginBottom:14,fontSize:12,color:"#6d28d9"}}>
          Amendment #{po.amd_no} on {formatDate(po.amd_date)}
        </div>
      )}

      {po.status==="pending_approval"&&canApprove&&(
        <div className="card" style={{padding:16,marginBottom:16,background:"#fffbeb",border:"1px solid #fde68a"}}>
          <div style={{fontSize:12,fontWeight:600,color:"#92400e",marginBottom:8}}>Reject back to draft?</div>
          <div style={{display:"flex",gap:8}}>
            <input style={{...fieldStyle,flex:1,fontSize:12}} placeholder="Reason (optional)" value={rejectRemark} onChange={e=>setRejectRemark(e.target.value)}/>
            <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px",color:"#dc2626",flexShrink:0}} disabled={busy} onClick={reject}>Reject</button>
          </div>
        </div>
      )}

      {po.rejection_remarks&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#dc2626"}}>
          Last rejected: "{po.rejection_remarks}"
        </div>
      )}

      {/* Vendor / ship-to */}
      <div className="card" style={{padding:16,marginBottom:14,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:12}}>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Vendor</div>
            <div style={{fontSize:13,fontWeight:600}}>{po.vendor_name}</div>
            {po.vendor_code&&<div style={{fontSize:11,color:"#9ca3af"}}>Code: {po.vendor_code}</div>}
            {po.vendor_gstin&&<div style={{fontSize:11,color:"#9ca3af"}}>GSTIN: {po.vendor_gstin}</div>}
            {po.your_reference&&<div style={{fontSize:11,color:"#9ca3af"}}>Your ref: {po.your_reference}</div>}
          </div>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Ship to</div>
            <div style={{fontSize:13,fontWeight:600}}>{company.name} — {po.plant}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>GSTIN: {company.gstin}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:11,color:"#6b7280",paddingTop:10,borderTop:"1px solid #f3f4f6"}}>
          {po.payment_terms&&<span><span style={{color:"#9ca3af"}}>Payment:</span> {po.payment_terms}</span>}
          {po.terms_of_delivery&&<span><span style={{color:"#9ca3af"}}>Delivery:</span> {po.terms_of_delivery}</span>}
          {po.mode_of_delivery&&<span><span style={{color:"#9ca3af"}}>Mode:</span> {po.mode_of_delivery}</span>}
        </div>
      </div>


      {/* Line items */}
      <div className="card" style={{padding:0,marginBottom:14,background:"#fff",overflow:"hidden"}}>
        <div style={{display:"flex",gap:8,padding:"8px 14px",background:"#fafafa",borderBottom:"1px solid #f3f4f6",fontSize:10,color:"#9ca3af",...S,textTransform:"uppercase"}}>
          <span style={{flex:1}}>Item</span><span style={{width:70,textAlign:"right"}}>Qty</span><span style={{width:70,textAlign:"right"}}>Received</span><span style={{width:80,textAlign:"right"}}>Rate</span><span style={{width:90,textAlign:"right"}}>Amount</span>
        </div>
        {(po.line_items||[]).map((it,i)=>(
          <div key={i} style={{display:"flex",gap:8,padding:"9px 14px",borderBottom:i<po.line_items.length-1?"1px solid #f9fafb":undefined,fontSize:12,alignItems:"center"}}>
            <span style={{flex:1}}>
              <div style={{fontWeight:500}}>{it.part_code&&<span style={{...S,color:"#6b7280"}}>{it.part_code} — </span>}{it.material_name}</div>
              <div style={{...S,fontSize:10,color:"#9ca3af"}}>{it.hsn_code&&`HSN ${it.hsn_code}`}{it.hsn_code&&it.required_date?" · ":""}{it.required_date&&`Req ${formatDate(it.required_date)}`}</div>
            </span>
            <span style={{width:70,textAlign:"right",...S}}>{it.qty} {it.unit}</span>
            <span style={{width:70,textAlign:"right",...S,color:(it.received_qty||0)>=parseFloat(it.qty)?"#16a34a":"#6b7280"}}>{it.received_qty||0}</span>
            <span style={{width:80,textAlign:"right",...S}}>₹{it.rate}</span>
            <span style={{width:90,textAlign:"right",...S,fontWeight:600}}>₹{lineAmount(it).toLocaleString("en-IN")}</span>
          </div>
        ))}
        <div style={{padding:"10px 14px",background:"#fafafa"}}>
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>Subtotal</span><span style={{...S,width:90,textAlign:"right"}}>₹{totals.subtotal.toLocaleString("en-IN")}</span></div>
          {totals.treatment==="IGST"
            ?<div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>IGST {totals.gstRate}%</span><span style={{...S,width:90,textAlign:"right"}}>₹{totals.igst.toLocaleString("en-IN")}</span></div>
            :<>
              <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>CGST {totals.gstRate/2}%</span><span style={{...S,width:90,textAlign:"right"}}>₹{totals.cgst.toLocaleString("en-IN")}</span></div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>SGST {totals.gstRate/2}%</span><span style={{...S,width:90,textAlign:"right"}}>₹{totals.sgst.toLocaleString("en-IN")}</span></div>
            </>
          }
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:13,fontWeight:700,paddingTop:6,borderTop:"1px solid #e5e7eb"}}><span>Total</span><span style={{...S,width:90,textAlign:"right"}}>₹{totals.grandTotal.toLocaleString("en-IN")}</span></div>
        </div>
      </div>

      {po.remarks&&<div style={{fontSize:12,color:"#6b7280",marginBottom:8}}><span style={{color:"#9ca3af"}}>Remarks:</span> {po.remarks}</div>}
      <div style={{fontSize:11,color:"#9ca3af"}}>
        Created by {po.created_by_name} on {formatDate(po.created_at?.toDate?po.created_at.toDate():po.created_at)}
        {po.approved_by&&` · Approved by ${po.approved_by}`}
        {po.cancelled_by&&` · Cancelled by ${po.cancelled_by}`}
        {po.closed_by&&` · Closed by ${po.closed_by}`}
      </div>
    </div>
  );
}

// ─── PO create / edit form ──────────────────────────────────────────────────
function POForm({profile,vendors,materials,existing,isAmendment,showToast,onClose}){
  const isEdit=!!existing;
  const [plant,setPlant]=useState(existing?.plant||"Bidadi");
  const [vendorId,setVendorId]=useState(existing?.vendor_id||"");
  const [lineItems,setLineItems]=useState(existing?.line_items?.length?existing.line_items:[emptyLineItem()]);
  const [yourReference,setYourReference]=useState(existing?.your_reference||"");
  const [paymentTerms,setPaymentTerms]=useState(existing?.payment_terms||"");
  const [termsOfDelivery,setTermsOfDelivery]=useState(existing?.terms_of_delivery||"FOR (freight paid by you)");
  const [modeOfDelivery,setModeOfDelivery]=useState(existing?.mode_of_delivery||"Road");
  const [remarks,setRemarks]=useState(existing?.remarks||"");
  const [gstRate,setGstRate]=useState(existing?.gst_rate??DEFAULT_GST_RATE);
  const [saving,setSaving]=useState(false);
  const [errors,setErrors]=useState([]);

  const vendor=vendors.find(v=>v.id===vendorId)||(existing?{id:existing.vendor_id,name:existing.vendor_name,vendor_code:existing.vendor_code,gstin:existing.vendor_gstin,state_code:existing.vendor_state_code,address:existing.vendor_address,phone:existing.vendor_phone,email:existing.vendor_email,pan:existing.vendor_pan}:null);
  const totals=poTotals(plant,vendor?.state_code,lineItems,gstRate);

  // Pre-fill payment terms from the vendor master the first time one is picked
  // on a brand-new PO — doesn't override a value already typed or an existing PO.
  function onSelectVendor(id){
    setVendorId(id);
    if(!isEdit&&!paymentTerms){
      const v=vendors.find(v=>v.id===id);
      if(v?.payment_terms)setPaymentTerms(v.payment_terms);
    }
  }

  function updateLine(i,k,v){setLineItems(items=>items.map((it,idx)=>idx===i?{...it,[k]:v}:it));}
  function addLine(){setLineItems(items=>[...items,emptyLineItem()]);}
  function removeLine(i){setLineItems(items=>items.filter((_,idx)=>idx!==i));}
  function selectMaterial(i,materialId){
    if(materialId==="__custom__"){updateLine(i,"material_id","");return;}
    const m=materials.find(m=>m.id===materialId);
    setLineItems(items=>items.map((it,idx)=>idx===i?{...it,material_id:materialId,material_name:m?.material_name||it.material_name,unit:m?.unit||it.unit}:it));
  }

  async function save(submitForApproval){
    const errs=[];
    if(!vendor)errs.push("Vendor");
    const cleanLines=lineItems.filter(it=>it.material_name?.trim());
    if(cleanLines.length===0)errs.push("At least one line item with a material name");
    if(cleanLines.some(it=>!it.qty||parseFloat(it.qty)<=0))errs.push("Quantity on all line items");
    if(cleanLines.some(it=>!it.rate||parseFloat(it.rate)<0))errs.push("Rate on all line items");
    if(cleanLines.some(it=>!it.required_date))errs.push("Required date on all line items");
    if(errs.length){setErrors(errs);return;}
    if(isAmendment&&!window.confirm(`This PO is already approved. Saving will create Amendment #${(existing.amd_no||0)+1} and send it back for re-approval. Continue?`))return;
    setErrors([]);setSaving(true);
    try{
      const payload={
        plant, vendor_id:vendor.id, vendor_name:vendor.name, vendor_code:vendor.vendor_code||null,
        vendor_gstin:vendor.gstin||null, vendor_state_code:vendor.state_code||null,
        vendor_address:vendor.address||null, vendor_phone:vendor.phone||null, vendor_email:vendor.email||null, vendor_pan:vendor.pan||null,
        line_items:cleanLines.map(it=>({...it,qty:parseFloat(it.qty),rate:parseFloat(it.rate),received_qty:it.received_qty||0})),
        gst_rate:parseFloat(gstRate)||0,
        total_amount:totals.grandTotal,
        expected_delivery:earliestRequiredDate(cleanLines), your_reference:yourReference||null,
        payment_terms:paymentTerms||null, terms_of_delivery:termsOfDelivery||null, mode_of_delivery:modeOfDelivery||null,
        remarks:remarks||null,
        updated_at:serverTimestamp(),
      };
      if(isEdit){
        const editPayload={...payload};
        if(isAmendment){
          editPayload.status="pending_approval";
          editPayload.amd_no=(existing.amd_no||0)+1;
          editPayload.amd_date=new Date().toISOString().split("T")[0];
        }else{
          editPayload.status=submitForApproval?"pending_approval":existing.status;
        }
        await updateDoc(doc(db,"purchase_orders",existing.id),editPayload);
        showToast(isAmendment?`${existing.po_number} amended (Amd #${editPayload.amd_no}) — sent for re-approval`:submitForApproval?`${existing.po_number} submitted for approval`:`${existing.po_number} updated`);
      }else{
        const poNumber=await generatePONumber(plant);
        await addDoc(collection(db,"purchase_orders"),{
          ...payload, po_number:poNumber, status:submitForApproval?"pending_approval":"draft",
          created_by:auth.currentUser.uid, created_by_name:profile.name||auth.currentUser.email, created_at:serverTimestamp(),
        });
        showToast(`${poNumber} ${submitForApproval?"submitted for approval":"saved as draft"}`);
      }
      onClose();
    }catch(e){setErrors([`Save failed: ${e.message}`]);}
    finally{setSaving(false);}
  }

  return(
    <div>
      {!isEdit&&<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>New Purchase Order</div>
      </div>}
      {isAmendment&&(
        <div style={{background:"#f5f3ff",border:"1px solid #ddd6fe",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12,color:"#6d28d9"}}>
          Editing an approved PO creates <strong>Amendment #{(existing.amd_no||0)+1}</strong> and sends it back for re-approval.
        </div>
      )}

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Plant *</label>
            <select style={fieldStyle} value={plant} onChange={e=>setPlant(e.target.value)} disabled={isAmendment}>
              {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
            <FuzzyAutocomplete label="Vendor *" value={vendor?.name||""} onChange={()=>{}} onSelect={m=>onSelectVendor(m.id)} options={vendors} displayKey="name" strict placeholder="— Select vendor —"/>
          </div>
          <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
            <SelectOrCustom label="GST rate" required value={gstRate} onChange={setGstRate} options={GST_RATE_OPTIONS} suffix="%" placeholder="— Select GST rate —"/>
          </div>
          <div>
            <label style={labelStyle}>Your reference</label>
            <input style={fieldStyle} value={yourReference} onChange={e=>setYourReference(e.target.value)} placeholder="Buyer's reference no. (optional)" readOnly={isAmendment}/>
          </div>
          <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
            <SelectOrCustom label="Payment terms" value={paymentTerms} onChange={setPaymentTerms} options={PAYMENT_TERMS_OPTIONS} placeholder="— Select payment terms —"/>
          </div>
          <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
            <SelectOrCustom label="Terms of delivery" value={termsOfDelivery} onChange={setTermsOfDelivery} options={DELIVERY_TERMS_OPTIONS} placeholder="— Select delivery terms —"/>
          </div>
          <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
            <SelectOrCustom label="Mode of delivery" value={modeOfDelivery} onChange={setModeOfDelivery} options={DELIVERY_MODE_OPTIONS} placeholder="— Select mode —"/>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:14}}>Line items</div>
        {isAmendment&&(
          <div style={{fontSize:11,color:"#9ca3af",marginBottom:12}}>Only the Required date can be changed during an amendment — all other fields are locked.</div>
        )}
        {lineItems.map((it,i)=>(
          <div key={i} style={{borderTop:i>0?"1px solid #f3f4f6":undefined,paddingTop:i>0?14:0,marginTop:i>0?14:0}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{...S,fontSize:11,color:"#6b7280",fontWeight:600}}>LINE {i+1}</span>
              {lineItems.length>1&&!isAmendment&&<button className="btn-danger" style={{padding:"3px 8px",fontSize:11}} onClick={()=>removeLine(i)}><Icon name="x" size={11}/>Remove</button>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:10}}>
              <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
                <label style={labelStyle}>Material (from catalog, or type a new item)</label>
                <select style={{...fieldStyle,marginBottom:6}} value={it.material_id||"__custom__"} onChange={e=>selectMaterial(i,e.target.value)} disabled={isAmendment}>
                  <option value="__custom__">— Custom / non-catalog item —</option>
                  {materials.map(m=><option key={m.id} value={m.id}>{m.material_name}</option>)}
                </select>
                <input style={fieldStyle} placeholder="Item description" value={it.material_name} onChange={e=>updateLine(i,"material_name",e.target.value)} readOnly={isAmendment}/>
              </div>
              <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
                <label style={labelStyle}>Part code</label>
                <input style={fieldStyle} value={it.part_code||""} onChange={e=>updateLine(i,"part_code",e.target.value)} placeholder="F361" readOnly={isAmendment}/>
              </div>
              <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
                <label style={labelStyle}>HSN code</label>
                <input style={fieldStyle} value={it.hsn_code} onChange={e=>updateLine(i,"hsn_code",e.target.value)} placeholder="82072000" readOnly={isAmendment}/>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:10}}>
              <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
                <label style={labelStyle}>Qty *</label>
                <input type="number" style={fieldStyle} min="0" step="0.01" value={it.qty} onChange={e=>updateLine(i,"qty",e.target.value)} readOnly={isAmendment}/>
              </div>
              <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
                <label style={labelStyle}>UOM</label>
                <select style={fieldStyle} value={it.unit} onChange={e=>updateLine(i,"unit",e.target.value)} disabled={isAmendment}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
              <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
                <label style={labelStyle}>Rate *</label>
                <input type="number" style={fieldStyle} min="0" step="0.01" value={it.rate} onChange={e=>updateLine(i,"rate",e.target.value)} readOnly={isAmendment}/>
              </div>
              <div>
                <label style={labelStyle}>Req. date *</label>
                <input type="date" style={fieldStyle} value={it.required_date||""} onChange={e=>updateLine(i,"required_date",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>Amount</label>
                <div style={{...fieldStyle,...S,background:"#f9fafb",fontWeight:600}}>₹{lineAmount(it).toLocaleString("en-IN")}</div>
              </div>
            </div>
          </div>
        ))}
        {!isAmendment&&<button className="btn-ghost" style={{width:"100%",justifyContent:"center",marginTop:16,borderStyle:"dashed"}} onClick={addLine}><Icon name="plus" size={13}/>Add line item</button>}

        <div style={{marginTop:18,paddingTop:14,borderTop:"1px solid #f3f4f6"}}>
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>Subtotal</span><span style={{...S,width:100,textAlign:"right"}}>₹{totals.subtotal.toLocaleString("en-IN")}</span></div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>{totals.treatment==="IGST"?`IGST ${totals.gstRate}%`:`CGST+SGST ${totals.gstRate}%`}</span><span style={{...S,width:100,textAlign:"right"}}>₹{totals.gstAmount.toLocaleString("en-IN")}</span></div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:14,fontWeight:700}}><span>Total</span><span style={{...S,width:100,textAlign:"right"}}>₹{totals.grandTotal.toLocaleString("en-IN")}</span></div>
        </div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16,background:"#fff"}}>
        <label style={labelStyle}>Remarks</label>
        <textarea style={{...fieldStyle,minHeight:64,resize:"vertical"}} value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Any additional notes for this PO..." readOnly={isAmendment}/>
      </div>

      {errors.length>0&&(
        <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#dc2626"}}>
          <strong>Please fix the following:</strong>
          <ul style={{marginTop:6,paddingLeft:18}}>{errors.map((e,i)=><li key={i}>{e}</li>)}</ul>
        </div>
      )}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        {isAmendment
          ?<button className="btn-primary" disabled={saving} onClick={()=>save(true)}><Icon name="check" size={14}/>{saving?"Saving…":`Save Amendment #${(existing.amd_no||0)+1} & Resubmit`}</button>
          :<>
            <button className="btn-ghost" disabled={saving} onClick={()=>save(false)}>{saving?"Saving…":"Save as Draft"}</button>
            <button className="btn-primary" disabled={saving} onClick={()=>save(true)}><Icon name="check" size={14}/>{saving?"Saving…":"Submit for Approval"}</button>
          </>
        }
      </div>
    </div>
  );
}
