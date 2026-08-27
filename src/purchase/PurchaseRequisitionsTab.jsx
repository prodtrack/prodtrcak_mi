// ─── PurchaseRequisitionsTab.jsx ────────────────────────────────────────────
// Purchase Requisition (PR): draft → pending_approval → approved (auto-
// generates a matching PO in "draft" status) / rejected, with cancel
// available up to approval. Sits upstream of PurchaseOrdersTab — a PR does
// not touch stock or vendors' hands directly, it only ever produces a PO.

import { useState } from "react";
import { useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle, FuzzyAutocomplete } from "../shared.jsx";
import {
  PLANTS, UNITS, REQUISITION_TYPES, PR_STATUSES, PR_STATUS_LABELS, PR_STATUS_COLORS,
  generatePRNumber, generatePONumber, emptyPRLineItem, lastPORateForMaterial, DEFAULT_GST_RATE,
  resolveOrCreateMaterialId,
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
  const [selectedId,setSelectedId]=useState(null);
  const [creatingNew,setCreatingNew]=useState(false);
  const [copySeed,setCopySeed]=useState(null);
  const [sortField,setSortField]=useState("created_at");
  const [sortDir,setSortDir]=useState("desc");
  const [page,setPage]=useState(1);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const PAGE_SIZE=10;

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
  const filtered=prs.filter(p=>{
    const d=p.created_at?.toDate?p.created_at.toDate():(p.created_at?new Date(p.created_at):null);
    const dISO=d?d.toISOString().slice(0,10):null;
    return (statusFilter==="all"||p.status===statusFilter)&&
    (plantFilter==="all"||p.plant===plantFilter)&&
    (!dateFrom||(dISO&&dISO>=dateFrom))&&
    (!dateTo||(dISO&&dISO<=dateTo))&&
    (!q||
      p.pr_number?.toLowerCase().includes(q)||
      p.vendor_name?.toLowerCase().includes(q)||
      p.vendor_code?.toLowerCase().includes(q)||
      p.plant?.toLowerCase().includes(q)||
      (p.line_items||[]).some(it=>it.material_name?.toLowerCase().includes(q)||it.item_code?.toLowerCase().includes(q))
    );
  });

  const hasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||q.length>0;

  function prField(pr,field){
    switch(field){
      case "pr_number":return pr.pr_number||"";
      case "requisition_type":return pr.requisition_type||"";
      case "vendor_code":return pr.vendor_code||"";
      case "vendor_name":return pr.vendor_name||"";
      case "plant":return pr.plant||"";
      case "created_at":return pr.created_at?.toDate?pr.created_at.toDate().getTime():(pr.created_at?new Date(pr.created_at).getTime():0);
      case "status":return pr.status||"";
      case "converted_po_number":return pr.converted_po_number||"";
      case "items":return (pr.line_items||[]).length;
      default:return "";
    }
  }
  const sorted=[...filtered].sort((a,b)=>{
    const va=prField(a,sortField),vb=prField(b,sortField);
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

  function prEditability(pr,canCreate){
    const canEdit=["draft","pending_approval","approved"].includes(pr.status)&&canCreate;
    const canCancel=["draft","pending_approval"].includes(pr.status);
    return {canEdit,canCancel};
  }

  function selectRow(id){setSelectedId(prev=>prev===id?null:id);setExpandedId(null);setEditingId(null);}
  function openView(){if(selectedId){setExpandedId(selectedId);setEditingId(null);}}
  function openEdit(){if(selectedId){setExpandedId(selectedId);setEditingId(selectedId);}}
  function closeDetail(){setExpandedId(null);setEditingId(null);}

  function copyPR(){
    if(!selectedId)return;
    const pr=prs.find(p=>p.id===selectedId);
    if(!pr)return;
    setCopySeed({
      plant:pr.plant, requisition_type:pr.requisition_type,
      vendor_id:pr.vendor_id, vendor_name:pr.vendor_name, vendor_code:pr.vendor_code, remarks:pr.remarks,
      line_items:(pr.line_items||[]).map(it=>({
        item_code:it.item_code||"", material_id:it.material_id||"", material_name:it.material_name,
        item_description:it.item_description||"", last_po_rate:it.last_po_rate,
        inventory_qty:"", qty:"", unit:it.unit, required_date:"", remarks:"",
      })),
    });
  }

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

  function exportExcel(){
    const rows=sorted.map(pr=>({
      "PR No.":pr.pr_number||"","Type":pr.requisition_type||"","Vendor code":pr.vendor_code||"","Vendor name":pr.vendor_name||"",
      "Site":pr.plant||"","PR date":pr.created_at?formatDate(pr.created_at?.toDate?pr.created_at.toDate():pr.created_at):"",
      "Status":PR_STATUS_LABELS[pr.status]||pr.status||"","Converted PO":pr.converted_po_number||"","Items":(pr.line_items||[]).length,
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Requisitions");
    XLSX.writeFile(wb,`Purchase_Requisitions_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("Exported to Excel");
  }

  if(creatingNew||copySeed){
    return <PRForm profile={profile} vendors={vendors} materials={materials} purchaseOrders={purchaseOrders} existing={copySeed} showToast={showToast} onClose={()=>{setCreatingNew(false);setCopySeed(null);}}/>;
  }

  if(expandedId){
    const pr=prs.find(p=>p.id===expandedId);
    if(pr){
      const {canEdit,canCancel}=prEditability(pr,canCreate);
      return(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={closeDetail}><Icon name="arrow" size={14}/>Back</button>
            <div style={{fontSize:14,fontWeight:600}}>{pr.pr_number}</div>
          </div>
          {editingId===pr.id
            ? <PRForm profile={profile} vendors={vendors} materials={materials} purchaseOrders={purchaseOrders} existing={pr} showToast={showToast} onClose={closeDetail}/>
            : <PRDetailPanel pr={pr} profile={profile} vendors={vendors} showToast={showToast} canApprove={canApprove} canEdit={canEdit} canCancel={canCancel}
                onEdit={openEdit} onCancel={()=>cancelPR(pr)} onDeleteDraft={()=>deleteDraft(pr)}/>
          }
        </div>
      );
    }
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>{hasActiveNarrowing?`${filtered.length} of ${prs.length} requisition${prs.length!==1?"s":""}`:`${prs.length} requisition${prs.length!==1?"s":""}`}</div>
        <div style={{display:"flex",gap:8}}>
          {sorted.length>0&&<button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>}
          {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New Requisition</button>}
        </div>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All"],...PR_STATUSES.map(s=>[s,PR_STATUS_LABELS[s]])].map(([v,l])=>(
          <button key={v} onClick={()=>{setStatusFilter(v);setPage(1);}} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
        <select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setPage(1);}} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
          <option value="all">All plants</option>
          {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by PR number, vendor name, or item…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
      </div>

      {prs.length===0
        ?<EmptyState text="No requisitions yet" sub={canCreate?"Click 'New Requisition' to create one":undefined}/>
        :filtered.length===0
        ?<EmptyState text="No requisitions match" sub={canCreate?"Try a different filter, or click 'New Requisition' to create one":undefined}/>
        :<>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,border:"1px solid #9ca3af"}}>
              <thead>
                <tr style={{background:"#fafafa"}}>
                  <th style={{padding:"8px 6px",borderBottom:"1px solid #9ca3af",width:28}}></th>
                  <SortTh label="PR No." field="pr_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Type" field="requisition_type" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Vendor code" field="vendor_code" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Vendor name" field="vendor_name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Site" field="plant" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <DateRangeTh label="PR date" field="created_at" sortField={sortField} sortDir={sortDir} onSort={onSort} dateFrom={dateFrom} dateTo={dateTo} onApply={(f,t)=>{setDateFrom(f);setDateTo(t);setPage(1);}}/>
                  <SortTh label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Converted PO" field="converted_po_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Items" field="items" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right"/>
                </tr>
              </thead>
              <tbody>
                {paginated.map(pr=>(
                  <PRTableRow key={pr.id} pr={pr} selected={selectedId===pr.id} onSelect={()=>selectRow(pr.id)}/>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={openView}>View</button>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId&&prEditability(prs.find(p=>p.id===selectedId)||{},canCreate).canEdit?1:.4,cursor:selectedId&&prEditability(prs.find(p=>p.id===selectedId)||{},canCreate).canEdit?"pointer":"default"}} disabled={!selectedId||!prEditability(prs.find(p=>p.id===selectedId)||{},canCreate).canEdit} onClick={openEdit}>Edit</button>
              {canCreate&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={copyPR} title="Copy — same vendor & items, new qty/dates"><Icon name="clipboard" size={12}/>Copy</button>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#6b7280"}}>
              <span>{sorted.length} requisition{sorted.length!==1?"s":""}</span>
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
    <th onClick={()=>onSort(field)} style={{padding:"8px 6px",textAlign:align||"left",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",cursor:"pointer",userSelect:"none",fontSize:11,color:"#6b7280",whiteSpace:"nowrap",...S}}>
      {label}{active&&<span style={{marginLeft:4}}>{sortDir==="asc"?"▲":"▼"}</span>}
    </th>
  );
}

// ─── Sortable date column header with a From/To range-filter popover ───────
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

// ─── PR table row — select circle only; View/Edit buttons open full detail ──
function PRTableRow({pr,selected,onSelect}){
  const sc=PR_STATUS_COLORS[pr.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const cellStyle={padding:"7px 6px",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160};

  return(
    <tr style={{background:selected?"#f5f7fa":"transparent"}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#fafafa";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <td style={{...cellStyle,textAlign:"center",cursor:"pointer"}} onClick={onSelect}>
        <span style={{display:"inline-block",width:13,height:13,borderRadius:"50%",border:`1.5px solid ${selected?"#1a1f2e":"#d1d5db"}`,background:selected?"#1a1f2e":"transparent"}}/>
      </td>
      <td style={{...cellStyle,...S,fontWeight:700,color:"#1a1f2e"}}>{pr.pr_number}</td>
      <td style={cellStyle}>{pr.requisition_type||"—"}</td>
      <td style={cellStyle}>{pr.vendor_code||"—"}</td>
      <td style={cellStyle} title={pr.vendor_name}>{pr.vendor_name||"— no vendor —"}</td>
      <td style={cellStyle}>{pr.plant}</td>
      <td style={cellStyle}>{formatDate(pr.created_at?.toDate?pr.created_at.toDate():pr.created_at)}</td>
      <td style={cellStyle}><span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600}}>{PR_STATUS_LABELS[pr.status]}</span></td>
      <td style={cellStyle}>{pr.converted_po_number||"—"}</td>
      <td style={{...cellStyle,textAlign:"right"}}>{(pr.line_items||[]).length}</td>
    </tr>
  );
}

function PRDetailPanel({pr,profile,vendors,showToast,canApprove,canEdit,canCancel,onEdit,onCancel,onDeleteDraft}){
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
        item_description:it.item_description||"", item_remarks:it.remarks||"",
        hsn_code:"", qty:parseFloat(it.qty)||0, unit:it.unit, rate:it.last_po_rate||0,
        required_date:it.required_date||"", received_qty:0,
      }));
      const vendorMaster=vendors.find(v=>v.id===pr.vendor_id);
      await addDoc(collection(db,"purchase_orders"),{
        plant:pr.plant, vendor_id:pr.vendor_id||null, vendor_name:pr.vendor_name||null, vendor_code:pr.vendor_code||null,
        vendor_gstin:pr.vendor_gstin||null, vendor_state_code:pr.vendor_state_code||null,
        vendor_address:pr.vendor_address||null, vendor_phone:pr.vendor_phone||null, vendor_email:pr.vendor_email||null, vendor_pan:pr.vendor_pan||null,
        line_items:poLineItems, gst_rate:DEFAULT_GST_RATE, total_amount:0,
        expected_delivery:(poLineItems.map(l=>l.required_date).filter(Boolean).sort()[0])||null,
        your_reference:pr.pr_number, payment_terms:vendorMaster?.payment_terms||null,
        terms_of_delivery:"FOR (freight paid by you)", mode_of_delivery:"Road",
        po_type:pr.requisition_type==="Import"?"Import":"Domestic",
        inco_terms:pr.requisition_type==="Import"?(pr.inco_terms||null):null,
        remarks:pr.remarks||null,
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
  const isEdit=!!existing?.id;
  const [plant,setPlant]=useState(existing?.plant||"Bidadi");
  const [requisitionType,setRequisitionType]=useState(existing?.requisition_type||"Internal");
  const [incoTerms,setIncoTerms]=useState(existing?.inco_terms||"");
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
  function onItemNameChange(i,text){
    setLineItems(items=>items.map((it,idx)=>idx===i?{...it,material_name:text,material_id:""}:it));
  }
  function onItemSelect(i,m){
    const lastRate=m.standard_rate??lastPORateForMaterial(purchaseOrders,m.id,m.material_name);
    setLineItems(items=>items.map((it,idx)=>idx===i?{
      // Inventory Qty stays manual-only again — the live system figure is
      // shown separately (read-only "Current Stock") so it's visible as a
      // reference, but never auto-fills or overwrites what's typed here.
      // Last PO rate is auto-filled from the material's Standard Rate if
      // one's been set (i.e. a rate was typed on some PR/PO for this item
      // before), falling back to the PO-history-derived rate otherwise.
      // The field itself stays editable so the user can override it.
      ...it, material_id:m.id, material_name:m.material_name||it.material_name,
      unit:m.unit||it.unit, current_stock:m.current_stock??0, last_po_rate:lastRate,
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
      // Any line item typed freeform (no material_id, since it wasn't
      // picked from the catalog) gets a brand-new rm_inventory entry
      // created on the spot, so it becomes part of the item master going
      // forward — matched by name first, in case two lines in this same
      // PR happen to introduce the same new item.
      const materialCache=new Map();
      const resolvedLines=[];
      for(const it of cleanLines){
        const materialId=it.material_id||await resolveOrCreateMaterialId(it.material_name,it.unit,materials,materialCache);
        resolvedLines.push({...it,material_id:materialId});
      }
      const payload={
        plant, requisition_type:requisitionType,
        inco_terms:requisitionType==="Import"?(incoTerms.trim()||null):null,
        vendor_id:vendor?.id||null, vendor_name:vendor?.name||null, vendor_code:vendor?.vendor_code||null,
        vendor_gstin:vendor?.gstin||null, vendor_state_code:vendor?.state_code||null,
        vendor_address:vendor?.address||null, vendor_phone:vendor?.phone||null, vendor_email:vendor?.email||null, vendor_pan:vendor?.pan||null,
        requested_by_code:requestedByCode||null, job_order:jobOrder||null,
        line_items:resolvedLines.map(it=>({...it,qty:parseFloat(it.qty),inventory_qty:materials.find(m=>m.id===it.material_id)?.current_stock??0})),
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
      // Whatever rate was typed on each line becomes that material's new
      // Standard Rate — the next PR or PO for the same item will auto-fill
      // with this value first, ahead of any PO-history-derived rate.
      for(const it of resolvedLines){
        const rate=parseFloat(it.last_po_rate);
        if(it.material_id&&!isNaN(rate)){
          updateDoc(doc(db,"rm_inventory",it.material_id),{standard_rate:rate}).catch(()=>{});
        }
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
          {requisitionType==="Import"&&(
            <div>
              <label style={labelStyle}>Inco Terms</label>
              <input style={fieldStyle} value={incoTerms} onChange={e=>setIncoTerms(e.target.value)} placeholder="e.g. FOB, CIF, EXW"/>
            </div>
          )}
          <div>
            <FuzzyAutocomplete label="Vendor" value={vendor?.name||""} onChange={()=>{}} onSelect={m=>setVendorId(m.id)} options={vendors} displayKey="name" strict placeholder="— Select vendor —"/>
            {!vendor&&<div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>Optional — can be set later on the PO</div>}
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
                <FuzzyAutocomplete label="Item (from catalog, or type a new item)" value={it.material_name} onChange={v=>onItemNameChange(i,v)} onSelect={m=>onItemSelect(i,m)} options={materials} displayKey="material_name" placeholder="Start typing item name…"/>
              </div>
              <div>
                <label style={labelStyle}>Item code</label>
                <input style={fieldStyle} value={it.item_code||""} onChange={e=>updateLine(i,"item_code",e.target.value)} placeholder="e.g. F361"/>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <label style={labelStyle}>Item description</label>
              <textarea style={{...fieldStyle,minHeight:44,resize:"vertical"}} value={it.item_description||""} onChange={e=>updateLine(i,"item_description",e.target.value)} placeholder="Optional — free-text description for this line"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:10}}>
              <div>
                <label style={labelStyle}>Inventory qty</label>
                <div style={{...fieldStyle,...S,background:"#f9fafb",color:"#6b7280"}}>
                  {it.material_id?`${materials.find(m=>m.id===it.material_id)?.current_stock??0} ${it.unit}`:"—"}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Required qty *</label>
                <input type="number" style={fieldStyle} min="0" step="0.01" value={it.qty} onChange={e=>updateLine(i,"qty",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>UOM</label>
                <UomField value={it.unit} onChange={v=>updateLine(i,"unit",v)}/>
              </div>
              <div>
                <label style={labelStyle}>Required date</label>
                <input type="date" style={fieldStyle} value={it.required_date||""} onChange={e=>updateLine(i,"required_date",e.target.value)}/>
              </div>
              <div>
                <label style={labelStyle}>Last PO rate</label>
                <input type="number" style={fieldStyle} min="0" step="0.01" value={it.last_po_rate??""} onChange={e=>updateLine(i,"last_po_rate",e.target.value===""?null:e.target.value)} placeholder="—"/>
              </div>
            </div>
            <div style={{marginTop:10}}>
              <label style={labelStyle}>Item remarks</label>
              <textarea style={{...fieldStyle,minHeight:44,resize:"vertical"}} value={it.remarks||""} onChange={e=>updateLine(i,"remarks",e.target.value)} placeholder="Optional"/>
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
