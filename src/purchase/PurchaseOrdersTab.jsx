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
import * as XLSX from "xlsx";
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
    const q=query(collection(db,"purchase_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,snap=>setPos(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>onSnapshot(collection(db,"supplier_master"),s=>setVendors(s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.active!==false))),[]);
  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),s=>setMaterials(s.docs.map(d=>({id:d.id,...d.data()})))),[]);

  const q=search.trim().toLowerCase();
  const filtered=pos.filter(p=>{
    const d=p.created_at?.toDate?p.created_at.toDate():(p.created_at?new Date(p.created_at):null);
    const dISO=d?d.toISOString().slice(0,10):null;
    return (statusFilter==="all"||p.status===statusFilter)&&
    (plantFilter==="all"||p.plant===plantFilter)&&
    (!dateFrom||(dISO&&dISO>=dateFrom))&&
    (!dateTo||(dISO&&dISO<=dateTo))&&
    (!q||
      p.po_number?.toLowerCase().includes(q)||
      p.vendor_name?.toLowerCase().includes(q)||
      p.vendor_code?.toLowerCase().includes(q)||
      p.your_reference?.toLowerCase().includes(q)||
      p.plant?.toLowerCase().includes(q)||
      (p.line_items||[]).some(it=>it.material_name?.toLowerCase().includes(q)||it.part_code?.toLowerCase().includes(q))
    );
  });


  const hasActiveNarrowing=statusFilter!=="all"||plantFilter!=="all"||q.length>0;

  function poField(po,field){
    switch(field){
      case "po_number":return po.po_number||"";
      case "amd_no":return po.amd_no||0;
      case "your_reference":return po.your_reference||"";
      case "vendor_code":return po.vendor_code||"";
      case "vendor_name":return po.vendor_name||"";
      case "plant":return po.plant||"";
      case "created_at":return po.created_at?.toDate?po.created_at.toDate().getTime():(po.created_at?new Date(po.created_at).getTime():0);
      case "status":return po.status||"";
      case "remarks":return po.remarks||"";
      case "po_type":return po.po_type||"";
      case "amount":return poTotals(po.plant,po.vendor_state_code,po.line_items,po.gst_rate||DEFAULT_GST_RATE).grandTotal;
      case "tax":{const t=poTotals(po.plant,po.vendor_state_code,po.line_items,po.gst_rate||DEFAULT_GST_RATE);return t.treatment==="IGST"?t.igst:t.cgst+t.sgst;}
      default:return "";
    }
  }
  const sorted=[...filtered].sort((a,b)=>{
    const va=poField(a,sortField),vb=poField(b,sortField);
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

  function poEditability(po,canCreate){
    const isDraft=po.status==="draft";
    const hasReceipts=(po.line_items||[]).some(it=>(it.received_qty||0)>0);
    const canEdit=(["draft","pending_approval","approved"].includes(po.status))&&canCreate&&!hasReceipts;
    const isAmendment=!isDraft&&po.status!=="pending_approval";
    const canCancel=["draft","pending_approval","approved"].includes(po.status)&&!hasReceipts;
    return {canEdit,isAmendment,canCancel};
  }

  function selectRow(id){setSelectedId(prev=>prev===id?null:id);setExpandedId(null);setEditingId(null);}
  function openView(){if(selectedId){setExpandedId(selectedId);setEditingId(null);}}
  function openEdit(){if(selectedId){setExpandedId(selectedId);setEditingId(selectedId);}}
  function closeDetail(){setExpandedId(null);setEditingId(null);}

  function copyPO(){
    if(!selectedId)return;
    const po=pos.find(p=>p.id===selectedId);
    if(!po)return;
    setCopySeed({
      plant:po.plant, vendor_id:po.vendor_id, vendor_name:po.vendor_name, vendor_code:po.vendor_code,
      vendor_gstin:po.vendor_gstin, vendor_state_code:po.vendor_state_code, vendor_address:po.vendor_address,
      vendor_phone:po.vendor_phone, vendor_email:po.vendor_email, vendor_pan:po.vendor_pan,
      gst_rate:po.gst_rate, payment_terms:po.payment_terms, terms_of_delivery:po.terms_of_delivery,
      mode_of_delivery:po.mode_of_delivery, po_type:po.po_type, remarks:po.remarks,
      line_items:(po.line_items||[]).map(it=>({
        part_code:it.part_code||"", material_id:it.material_id||"", material_name:it.material_name,
        hsn_code:it.hsn_code||"", item_description:it.item_description||"",
        rate:it.rate, unit:it.unit, qty:"", required_date:"", received_qty:0,
      })),
    });
  }

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

  function exportExcel(){
    const rows=[];
    sorted.forEach(po=>{
      const totals=poTotals(po.plant,po.vendor_state_code,po.line_items,po.gst_rate||DEFAULT_GST_RATE);
      (po.line_items||[]).forEach(it=>{
        const qty=parseFloat(it.qty)||0,rate=parseFloat(it.rate)||0;
        const itemAmount=qty*rate;
        const itemTax=itemAmount*(totals.gstRate/100);
        rows.push({
          "PO No.":po.po_number||"","Ver.":po.amd_no||0,"Ref./PR No.":po.your_reference||"",
          "Vendor code":po.vendor_code||"","Vendor name":po.vendor_name||"","Site":po.plant||"",
          "PO date":po.created_at?formatDate(po.created_at?.toDate?po.created_at.toDate():po.created_at):"",
          "Status":PO_STATUS_LABELS[po.status]||po.status||"","PO Type":po.po_type||"",
          "Part code":it.part_code||"","Item Name":it.material_name||"","Item Description":it.item_description||"",
          "HSN code":it.hsn_code||"","Qty":qty,"UOM":it.unit||"","Rate":rate,
          "Item Amount":itemAmount,"Item Tax":itemTax,
          "Req. date":it.required_date?formatDate(it.required_date):"",
          "PO Description":po.remarks||"",
        });
      });
    });
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Purchase Orders");
    XLSX.writeFile(wb,`Purchase_Orders_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("Exported to Excel");
  }

  if(creatingNew||copySeed){
    return <POForm profile={profile} vendors={vendors} materials={materials} existing={copySeed} showToast={showToast} onClose={()=>{setCreatingNew(false);setCopySeed(null);}}/>;
  }

  if(expandedId){
    const po=pos.find(p=>p.id===expandedId);
    if(po){
      const {canEdit,isAmendment,canCancel}=poEditability(po,canCreate);
      return(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={closeDetail}><Icon name="arrow" size={14}/>Back</button>
            <div style={{fontSize:14,fontWeight:600}}>{po.po_number}</div>
          </div>
          {editingId===po.id
            ? <POForm profile={profile} vendors={vendors} materials={materials} existing={po} isAmendment={isAmendment} showToast={showToast} onClose={closeDetail}/>
            : <PODetailPanel po={po} profile={profile} showToast={showToast} canApprove={canApprove} canEdit={canEdit} isAmendment={isAmendment} canCancel={canCancel}
                onEdit={openEdit} onCancel={()=>cancelPO(po)} onDeleteDraft={()=>deleteDraft(po)} onClose={()=>closePO(po)}/>
          }
        </div>
      );
    }
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div style={{fontSize:14,fontWeight:600}}>{hasActiveNarrowing?`${filtered.length} of ${pos.length} purchase order${pos.length!==1?"s":""}`:`${pos.length} purchase order${pos.length!==1?"s":""}`}</div>
        <div style={{display:"flex",gap:8}}>
          {sorted.length>0&&<button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>}
          {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setCreatingNew(true)}><Icon name="plus" size={12}/>New Purchase Order</button>}
        </div>
      </div>

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,alignItems:"center"}}>
        {[["all","All"],...PO_STATUSES.map(s=>[s,PO_STATUS_LABELS[s]])].map(([v,l])=>(
          <button key={v} onClick={()=>{setStatusFilter(v);setPage(1);}} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${statusFilter===v?"#1a1f2e":"#d1d5db"}`,background:statusFilter===v?"#1a1f2e":"#fff",color:statusFilter===v?"#fff":"#6b7280",fontSize:11,cursor:"pointer",fontFamily:"'Roboto',sans-serif"}}>{l}</button>
        ))}
        <select value={plantFilter} onChange={e=>{setPlantFilter(e.target.value);setPage(1);}} style={{...fieldStyle,width:"auto",padding:"5px 10px",fontSize:12}}>
          <option value="all">All plants</option>
          {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search by PO number, vendor name, or vendor code…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
      </div>

      {pos.length===0
        ?<EmptyState text="No purchase orders yet" sub={canCreate?"Click 'New Purchase Order' to create one":undefined}/>
        :filtered.length===0
        ?<EmptyState text="No purchase orders match" sub={canCreate?"Try a different filter, or click 'New Purchase Order' to create one":undefined}/>
        :<>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,border:"1px solid #9ca3af"}}>
              <thead>
                <tr style={{background:"#fafafa"}}>
                  <th style={{padding:"8px 6px",borderBottom:"1px solid #9ca3af",width:28}}></th>
                  <SortTh label="PO No." field="po_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Ver." field="amd_no" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Ref./PR No." field="your_reference" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Vendor code" field="vendor_code" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Vendor name" field="vendor_name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Site" field="plant" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <DateRangeTh label="PO date" field="created_at" sortField={sortField} sortDir={sortDir} onSort={onSort} dateFrom={dateFrom} dateTo={dateTo} onApply={(f,t)=>{setDateFrom(f);setDateTo(t);setPage(1);}}/>
                  <SortTh label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Description" field="remarks" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="PO Type" field="po_type" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Amount" field="amount" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right"/>
                  <SortTh label="Tax" field="tax" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right"/>
                </tr>
              </thead>
              <tbody>
                {paginated.map(po=>(
                  <POTableRow
                    key={po.id}
                    po={po}
                    selected={selectedId===po.id}
                    onSelect={()=>selectRow(po.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={openView}>View</button>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId&&poEditability(pos.find(p=>p.id===selectedId)||{},canCreate).canEdit?1:.4,cursor:selectedId&&poEditability(pos.find(p=>p.id===selectedId)||{},canCreate).canEdit?"pointer":"default"}} disabled={!selectedId||!poEditability(pos.find(p=>p.id===selectedId)||{},canCreate).canEdit} onClick={openEdit}>Edit</button>
              {canCreate&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={copyPO} title="Copy — same vendor & items, new qty/dates"><Icon name="clipboard" size={12}/>Copy</button>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#6b7280"}}>
              <span>{sorted.length} purchase order{sorted.length!==1?"s":""}</span>
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

// ─── PO table row — click the selector circle to expand the existing detail view ─
function POTableRow({po,selected,onSelect}){
  const sc=PO_STATUS_COLORS[po.status]||{bg:"#f3f4f6",c:"#6b7280"};
  const totals=poTotals(po.plant,po.vendor_state_code,po.line_items,po.gst_rate||DEFAULT_GST_RATE);
  const tax=totals.treatment==="IGST"?totals.igst:totals.cgst+totals.sgst;
  const cellStyle={padding:"7px 6px",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160};

  return(
    <tr style={{background:selected?"#f5f7fa":"transparent"}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#fafafa";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <td style={{...cellStyle,textAlign:"center",cursor:"pointer"}} onClick={onSelect}>
        <span style={{display:"inline-block",width:13,height:13,borderRadius:"50%",border:`1.5px solid ${selected?"#1a1f2e":"#d1d5db"}`,background:selected?"#1a1f2e":"transparent"}}/>
      </td>
      <td style={{...cellStyle,...S,fontWeight:700,color:"#1a1f2e"}}>{po.po_number}</td>
      <td style={cellStyle}>{po.amd_no||0}</td>
      <td style={cellStyle} title={po.your_reference}>{po.your_reference||"—"}</td>
      <td style={cellStyle}>{po.vendor_code||"—"}</td>
      <td style={cellStyle} title={po.vendor_name}>{po.vendor_name}</td>
      <td style={cellStyle}>{po.plant}</td>
      <td style={cellStyle}>{formatDate(po.created_at?.toDate?po.created_at.toDate():po.created_at)}</td>
      <td style={cellStyle}><span style={{background:sc.bg,color:sc.c,padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600}}>{PO_STATUS_LABELS[po.status]}</span></td>
      <td style={cellStyle} title={po.remarks}>{po.remarks||"—"}</td>
      <td style={cellStyle}>{po.po_type||"—"}</td>
      <td style={{...cellStyle,textAlign:"right",...S}}>₹{totals.grandTotal.toLocaleString("en-IN")}</td>
      <td style={{...cellStyle,textAlign:"right",...S}}>₹{tax.toLocaleString("en-IN")}</td>
    </tr>
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
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>Subtotal</span><span style={{...S,minWidth:90,textAlign:"right"}}>₹{totals.subtotal.toLocaleString("en-IN")}</span></div>
          {totals.treatment==="IGST"
            ?<div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>IGST {totals.gstRate}%</span><span style={{...S,minWidth:90,textAlign:"right"}}>₹{totals.igst.toLocaleString("en-IN")}</span></div>
            :<>
              <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>CGST {totals.gstRate/2}%</span><span style={{...S,minWidth:90,textAlign:"right"}}>₹{totals.cgst.toLocaleString("en-IN")}</span></div>
              <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>SGST {totals.gstRate/2}%</span><span style={{...S,minWidth:90,textAlign:"right"}}>₹{totals.sgst.toLocaleString("en-IN")}</span></div>
            </>
          }
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:13,fontWeight:700,paddingTop:6,borderTop:"1px solid #9ca3af"}}><span>Total</span><span style={{...S,minWidth:90,textAlign:"right"}}>₹{totals.grandTotal.toLocaleString("en-IN")}</span></div>
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
  const isEdit=!!existing?.id;
  const [plant,setPlant]=useState(existing?.plant||"Bidadi");
  const [vendorId,setVendorId]=useState(existing?.vendor_id||"");
  const [lineItems,setLineItems]=useState(existing?.line_items?.length?existing.line_items:[emptyLineItem()]);
  const [yourReference,setYourReference]=useState(existing?.your_reference||"");
  const [paymentTerms,setPaymentTerms]=useState(existing?.payment_terms||"");
  const [termsOfDelivery,setTermsOfDelivery]=useState(existing?.terms_of_delivery||"FOR (freight paid by you)");
  const [modeOfDelivery,setModeOfDelivery]=useState(existing?.mode_of_delivery||"Road");
  const [poType,setPoType]=useState(existing?.po_type||"Domestic");
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
  function onMaterialNameChange(i,text){
    setLineItems(items=>items.map((it,idx)=>idx===i?{...it,material_name:text,material_id:""}:it));
  }
  function onMaterialSelect(i,m){
    setLineItems(items=>items.map((it,idx)=>idx===i?{...it,material_id:m.id,material_name:m.material_name||it.material_name,unit:m.unit||it.unit}:it));
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
        payment_terms:paymentTerms||null, terms_of_delivery:termsOfDelivery||null, mode_of_delivery:modeOfDelivery||null, po_type:poType||null,
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
          <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
            <SelectOrCustom label="PO Type" value={poType} onChange={setPoType} options={["Domestic","Import"]} placeholder="— Select PO type —"/>
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
                <FuzzyAutocomplete label="Material (from catalog, or type a new item)" value={it.material_name} onChange={v=>onMaterialNameChange(i,v)} onSelect={m=>onMaterialSelect(i,m)} options={materials} displayKey="material_name" placeholder="Start typing item name…"/>
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
            <div style={{marginBottom:10}}>
              <div style={isAmendment?{pointerEvents:"none",opacity:.55}:undefined}>
                <label style={labelStyle}>Item description</label>
                <input style={fieldStyle} value={it.item_description||""} onChange={e=>updateLine(i,"item_description",e.target.value)} placeholder="Optional — free-text description for this line" readOnly={isAmendment}/>
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
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>Subtotal</span><span style={{...S,minWidth:100,textAlign:"right"}}>₹{totals.subtotal.toLocaleString("en-IN")}</span></div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:12,marginBottom:4}}><span style={{color:"#6b7280"}}>{totals.treatment==="IGST"?`IGST ${totals.gstRate}%`:`CGST+SGST ${totals.gstRate}%`}</span><span style={{...S,minWidth:100,textAlign:"right"}}>₹{totals.gstAmount.toLocaleString("en-IN")}</span></div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:24,fontSize:14,fontWeight:700}}><span>Total</span><span style={{...S,minWidth:100,textAlign:"right"}}>₹{totals.grandTotal.toLocaleString("en-IN")}</span></div>
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
