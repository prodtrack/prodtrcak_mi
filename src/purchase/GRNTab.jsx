import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle, FuzzyAutocomplete } from "../shared.jsx";
import { PLANTS, UNITS, generateGRNNumber, poReceivedStatus, PO_STATUS_LABELS } from "./purchaseHelpers";
import { printGRN } from "./GRNPrintView.jsx";

export default function GRNTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canReceive=isAdmin||["store"].includes(profile.role)||!!profile.can_purchase;

  const [mode,setMode]=useState(null); // null | "po" | "direct"
  const [pos,setPos]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [suppliers,setSuppliers]=useState([]);
  const [entries,setEntries]=useState([]);
  const [holds,setHolds]=useState([]);
  const [search,setSearch]=useState("");
  const [holdRemark,setHoldRemark]=useState({});
  const [holdSaving,setHoldSaving]=useState({});
  const [sortField,setSortField]=useState("date_received");
  const [sortDir,setSortDir]=useState("desc");
  const [page,setPage]=useState(1);
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [dateOpen,setDateOpen]=useState(false);
  const [selectedId,setSelectedId]=useState(null);
  const [expandedId,setExpandedId]=useState(null);
  const [editingId,setEditingId]=useState(null);
  const PAGE_SIZE=10;

  useEffect(()=>{
    const q=query(collection(db,"purchase_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setPos(s.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),s=>setMaterials(s.docs.map(d=>({id:d.id,...d.data()})))),[]);
  useEffect(()=>onSnapshot(collection(db,"supplier_master"),s=>setSuppliers(s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.active!==false))),[]);
  useEffect(()=>{
    const q=query(collection(db,"goods_inward"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setEntries(s.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);
  useEffect(()=>{
    const q=query(collection(db,"grn_holds"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setHolds(s.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  async function approveHold(hold){
    setHoldSaving(p=>({...p,[hold.id]:true}));
    try{
      const now=serverTimestamp();
      const newRef=await addDoc(collection(db,"rm_inventory"),{
        material_name:hold.material_name,unit:hold.unit||"kg",
        current_stock:hold.quantity,low_stock_threshold:0,
        created_at:now,
      });
      await addDoc(collection(db,"goods_inward"),{
        material_id:newRef.id,material_name:hold.material_name,
        supplier_name:hold.supplier_name||"",quantity:hold.quantity,unit:hold.unit||"kg",
        date_received:hold.date_received,po_ref:hold.po_ref||null,
        remarks:holdRemark[hold.id]||hold.remarks||null,
        operator_uid:hold.operator_uid,operator_name:hold.operator_name,
        created_at:now,
      });
      await updateDoc(doc(db,"grn_holds",hold.id),{status:"approved",approved_at:now,approved_by:profile.name||auth.currentUser.email,admin_remarks:holdRemark[hold.id]||null});
      showToast(`${hold.material_name} approved & added to inventory`);
    }catch(e){showToast("Error: "+e.message,"error");}
    finally{setHoldSaving(p=>({...p,[hold.id]:false}));}
  }
  async function rejectHold(hold){
    await updateDoc(doc(db,"grn_holds",hold.id),{status:"rejected",rejected_at:serverTimestamp(),rejected_by:profile.name||auth.currentUser.email});
    showToast(`Hold rejected for ${hold.material_name}`);
  }

  const pendingHolds=holds.filter(h=>h.status==="pending");
  const filtered=entries.filter(e=>
    (!search||e.material_name?.toLowerCase().includes(search.toLowerCase())||e.supplier_name?.toLowerCase().includes(search.toLowerCase())||e.po_number?.toLowerCase().includes(search.toLowerCase()))&&
    (!dateFrom||(e.date_received&&e.date_received>=dateFrom))&&
    (!dateTo||(e.date_received&&e.date_received<=dateTo))
  );

  function entryField(e,field){
    switch(field){
      case "date_received":return e.date_received?new Date(e.date_received).getTime():0;
      case "material_name":return e.material_name||"";
      case "supplier_name":return e.supplier_name||"";
      case "quantity":return parseFloat(e.quantity)||0;
      case "po_number":return e.po_number||"";
      case "operator_name":return e.operator_name||"";
      default:return "";
    }
  }
  const sorted=[...filtered].sort((a,b)=>{
    const va=entryField(a,sortField),vb=entryField(b,sortField);
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

  function exportExcel(){
    const rows=sorted.map(e=>({
      "Date":e.date_received?formatDate(e.date_received):"","Material":e.material_name||"","Supplier":e.supplier_name||"",
      "Quantity":e.quantity??"","Unit":e.unit||"","PO No.":e.po_number||"","GRN No.":e.grn_number||"","Received by":e.operator_name||"",
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"GRN");
    XLSX.writeFile(wb,`GRN_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("Exported to Excel");
  }

  if(mode==="po")return<ReceiveAgainstPO profile={profile} pos={pos} showToast={showToast} onClose={()=>setMode(null)}/>;
  if(mode==="direct")return<DirectReceipt profile={profile} materials={materials} suppliers={suppliers} showToast={showToast} onClose={()=>setMode(null)}/>;

  if(expandedId){
    const entry=entries.find(e=>e.id===expandedId);
    if(entry){
      return(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={()=>{setExpandedId(null);setEditingId(null);}}><Icon name="arrow" size={14}/>Back</button>
            <div style={{fontSize:14,fontWeight:600}}>{entry.grn_number||"GRN"}</div>
          </div>
          {editingId===entry.id
            ? <GRNEditForm entry={entry} pos={pos} materials={materials} showToast={showToast} onClose={()=>{setExpandedId(null);setEditingId(null);}}/>
            : <GRNDetailPanel entry={entry} canEdit={canReceive} onEdit={()=>setEditingId(entry.id)}/>
          }
        </div>
      );
    }
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:600}}>{entries.length} receipt{entries.length!==1?"s":""} recorded</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {sorted.length>0&&<button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>}
          {canReceive&&(<>
            <button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setMode("po")}><Icon name="clipboard" size={12}/>Receive against PO</button>
            <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setMode("direct")}><Icon name="inbox" size={12}/>Direct Receipt</button>
          </>)}
        </div>
      </div>

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

      <div style={{marginBottom:16}}>
        <input style={{...fieldStyle,width:"100%",maxWidth:420,padding:"8px 14px",fontSize:13}} placeholder="Search material / supplier / PO…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
      </div>

      {entries.length===0
        ?<EmptyState text="No receipts yet"/>
        :filtered.length===0
        ?<EmptyState text="No receipts match"/>
        :<>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,border:"1px solid #9ca3af"}}>
              <thead>
                <tr style={{background:"#fafafa"}}>
                  <th style={{padding:"8px 6px",borderBottom:"1px solid #9ca3af",width:28}}></th>
                  <DateRangeTh label="Date" field="date_received" sortField={sortField} sortDir={sortDir} onSort={onSort} dateFrom={dateFrom} dateTo={dateTo} onApply={(f,t)=>{setDateFrom(f);setDateTo(t);setPage(1);}}/>
                  <SortTh label="Material" field="material_name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Supplier" field="supplier_name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Qty" field="quantity" sortField={sortField} sortDir={sortDir} onSort={onSort} align="right"/>
                  <SortTh label="PO #" field="po_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="GRN No." field="grn_number" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="By" field="operator_name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                </tr>
              </thead>
              <tbody>
                {paginated.map(e=>(
                  <GRNTableRow key={e.id} entry={e} selected={selectedId===e.id} onSelect={()=>{setSelectedId(prev=>prev===e.id?null:e.id);}}/>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={()=>{if(selectedId){setExpandedId(selectedId);setEditingId(null);}}}>View</button>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId&&canReceive?1:.4,cursor:selectedId&&canReceive?"pointer":"default"}} disabled={!selectedId||!canReceive} onClick={()=>{if(selectedId){setExpandedId(selectedId);setEditingId(selectedId);}}}>Edit</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#6b7280"}}>
              <span>{sorted.length} receipt{sorted.length!==1?"s":""}</span>
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

// ─── GRN table row — select circle only; View/Edit buttons open full detail ─
function GRNTableRow({entry,selected,onSelect}){
  const cellStyle={padding:"7px 6px",borderBottom:"1px solid #9ca3af",borderLeft:"1px solid #9ca3af",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160};
  return(
    <tr style={{background:selected?"#f5f7fa":"transparent"}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#fafafa";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <td style={{...cellStyle,textAlign:"center",cursor:"pointer"}} onClick={onSelect}>
        <span style={{display:"inline-block",width:13,height:13,borderRadius:"50%",border:`1.5px solid ${selected?"#1a1f2e":"#d1d5db"}`,background:selected?"#1a1f2e":"transparent"}}/>
      </td>
      <td style={cellStyle}>{formatDate(entry.date_received)}</td>
      <td style={{...cellStyle,fontWeight:500,color:"#1a1f2e"}} title={entry.material_name}>{entry.material_name}</td>
      <td style={cellStyle}>{entry.supplier_name||"—"}</td>
      <td style={{...cellStyle,...S,textAlign:"right"}}>{entry.quantity} {entry.unit}</td>
      <td style={cellStyle}>{entry.po_number||"—"}</td>
      <td style={{...cellStyle,...S}}>{entry.grn_number||"—"}</td>
      <td style={cellStyle}>{entry.operator_name}</td>
    </tr>
  );
}

// ─── GRN detail panel — read-only View, with Edit and Print actions ────────
function GRNDetailPanel({entry,canEdit,onEdit}){
  return(
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={()=>printGRN(entry)}><Icon name="clipboard" size={12}/>Print GRN</button>
        {canEdit&&<button className="btn-ghost" style={{fontSize:12,padding:"6px 12px"}} onClick={onEdit}><Icon name="edit" size={12}/>Edit</button>}
      </div>
      <div className="card" style={{padding:16,marginBottom:14,background:"#fff"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Receipt</div>
            <div style={{fontSize:13,fontWeight:600}}>{entry.material_name}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Qty: {entry.quantity} {entry.unit}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Date: {formatDate(entry.date_received)}</div>
          </div>
          <div>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Source</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Supplier: {entry.supplier_name||"—"}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>PO: {entry.po_number||"—"}</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>GRN No: {entry.grn_number||"—"}</div>
          </div>
        </div>
      </div>
      {entry.remarks&&<div style={{fontSize:12,color:"#6b7280",marginBottom:8}}><span style={{color:"#9ca3af"}}>Remarks:</span> {entry.remarks}</div>}
      <div style={{fontSize:11,color:"#9ca3af"}}>Received by {entry.operator_name}</div>
    </div>
  );
}

// ─── GRN edit form — allows correcting a posted receipt, including quantity,
// adjusting rm_inventory stock (and the linked PO's received_qty, if any) by
// the delta between the old and new quantity ─────────────────────────────
function GRNEditForm({entry,pos,materials,showToast,onClose}){
  const [materialId,setMaterialId]=useState(entry.material_id||"");
  const [materialName,setMaterialName]=useState(entry.material_name||"");
  const [supplierName,setSupplierName]=useState(entry.supplier_name||"");
  const [quantity,setQuantity]=useState(entry.quantity??"");
  const [unit,setUnit]=useState(entry.unit||"kg");
  const [dateReceived,setDateReceived]=useState(entry.date_received||"");
  const [poNumber,setPoNumber]=useState(entry.po_number||"");
  const [remarks,setRemarks]=useState(entry.remarks||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  function selectMaterial(id){
    setMaterialId(id);
    const m=materials.find(m=>m.id===id);
    if(m){setMaterialName(m.material_name);setUnit(m.unit||unit);}
  }

  async function save(){
    const newQty=parseFloat(quantity);
    if(!newQty||newQty<=0){setError("Enter a valid quantity");return;}
    setError("");setSaving(true);
    try{
      const now=serverTimestamp();
      const oldQty=parseFloat(entry.quantity)||0;
      const oldMaterialId=entry.material_id||null;

      // Reverse the old posting's stock effect, then apply the new one —
      // handles both a plain quantity change and a change of material.
      if(oldMaterialId){
        const oldRef=doc(db,"rm_inventory",oldMaterialId);
        const oldSnap=await getDoc(oldRef);
        if(oldSnap.exists())await updateDoc(oldRef,{current_stock:(oldSnap.data().current_stock||0)-oldQty,updated_at:now});
      }
      if(materialId){
        const newRef=doc(db,"rm_inventory",materialId);
        const newSnap=await getDoc(newRef);
        const current=newSnap.exists()?(newSnap.data().current_stock||0):0;
        await updateDoc(newRef,{current_stock:current+newQty,updated_at:now});
      }

      // If this entry is linked to a PO, reflect the same delta on that
      // PO's line item and recalculate its status.
      if(entry.po_id){
        const poSnap=await getDoc(doc(db,"purchase_orders",entry.po_id));
        if(poSnap.exists()){
          const poData=poSnap.data();
          const updatedLines=(poData.line_items||[]).map(pit=>{
            if(oldMaterialId&&pit.material_id===oldMaterialId&&(!materialId||materialId===oldMaterialId)){
              return {...pit,received_qty:Math.max(0,(pit.received_qty||0)-oldQty+newQty)};
            }
            if(materialId&&materialId!==oldMaterialId&&pit.material_id===materialId){
              return {...pit,received_qty:(pit.received_qty||0)+newQty};
            }
            if(oldMaterialId&&materialId&&materialId!==oldMaterialId&&pit.material_id===oldMaterialId){
              return {...pit,received_qty:Math.max(0,(pit.received_qty||0)-oldQty)};
            }
            return pit;
          });
          await updateDoc(doc(db,"purchase_orders",entry.po_id),{line_items:updatedLines,status:poReceivedStatus(updatedLines),updated_at:now});
        }
      }

      await updateDoc(doc(db,"goods_inward",entry.id),{
        material_id:materialId||null,material_name:materialName,
        supplier_name:supplierName||"",quantity:newQty,unit,
        date_received:dateReceived,po_number:poNumber||null,
        remarks:remarks||null,updated_at:now,
      });
      showToast("Receipt updated");
      onClose();
    }catch(e){setError("Error: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div className="card animate-in" style={{padding:20}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div>
          <label style={labelStyle}>Material</label>
          <select style={fieldStyle} value={materialId} onChange={e=>selectMaterial(e.target.value)}>
            <option value="">— {materialName||"Unlinked"} —</option>
            {materials.map(m=><option key={m.id} value={m.id}>{m.material_name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Supplier</label>
          <input style={fieldStyle} value={supplierName} onChange={e=>setSupplierName(e.target.value)}/>
        </div>
        <div>
          <label style={labelStyle}>Quantity *</label>
          <div style={{display:"flex",gap:8}}>
            <input type="number" style={{...fieldStyle,flex:1}} min="0" step="0.01" value={quantity} onChange={e=>setQuantity(e.target.value)}/>
            <select style={{...fieldStyle,width:80,flex:"none"}} value={unit} onChange={e=>setUnit(e.target.value)}>
              {UNITS.map(u=><option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Date Received</label>
          <input type="date" style={fieldStyle} value={dateReceived} onChange={e=>setDateReceived(e.target.value)}/>
        </div>
        <div>
          <label style={labelStyle}>PO No.</label>
          <input style={fieldStyle} value={poNumber} onChange={e=>setPoNumber(e.target.value)}/>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <label style={labelStyle}>Remarks</label>
          <input style={fieldStyle} value={remarks} onChange={e=>setRemarks(e.target.value)}/>
        </div>
      </div>
      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"9px 12px",fontSize:13,color:"#dc2626",marginBottom:14}}>{error}</div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}><Icon name="check" size={13}/>{saving?"Saving…":"Save changes"}</button>
      </div>
    </div>
  );
}

// ─── Receive against PO — the original, immediate-post flow (pre-merge) ─────
// Reconstructed to match its pre-merge behaviour: pick an approved PO, enter
// received qty per line, post straight to goods_inward and bump stock right
// away. No Challan/Vehicle capture and no approval/QGIN gate — that richer
// flow now lives on the separate GIN tab, as it did before the GIN/GRN merge.
function ReceiveAgainstPO({profile,pos,showToast,onClose}){
  const [plant,setPlant]=useState("Bidadi");
  const [poId,setPoId]=useState("");
  const [lineItems,setLineItems]=useState([]);
  const [remarks,setRemarks]=useState("");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  const receivablePOs=pos.filter(p=>p.plant===plant&&["approved","partially_received"].includes(p.status));
  const po=pos.find(p=>p.id===poId);

  function onSelectPO(id){
    setPoId(id);
    const selected=pos.find(p=>p.id===id);
    if(!selected)return;
    setLineItems((selected.line_items||[]).map(it=>{
      const remaining=Math.max(0,(parseFloat(it.qty)||0)-(it.received_qty||0));
      return {material_id:it.material_id||"",material_name:it.material_name,unit:it.unit,remaining,received_qty:remaining||""};
    }));
  }

  function updateLine(i,v){setLineItems(items=>items.map((it,idx)=>idx===i?{...it,received_qty:v}:it));}

  async function submit(){
    if(!po){setError("Select a purchase order");return;}
    const toPost=lineItems.filter(it=>(parseFloat(it.received_qty)||0)>0);
    if(toPost.length===0){setError("Enter a received quantity on at least one line");return;}
    setError("");setSaving(true);
    try{
      const now=serverTimestamp();
      const operatorName=profile.name||auth.currentUser.email;
      const operatorUid=auth.currentUser.uid;
      const grnNumber=await generateGRNNumber(plant);

      for(const it of toPost){
        const qty=parseFloat(it.received_qty)||0;
        await addDoc(collection(db,"goods_inward"),{
          material_id:it.material_id||null,material_name:it.material_name,
          supplier_name:po.vendor_name||"",quantity:qty,unit:it.unit,
          date_received:new Date().toISOString().split("T")[0],
          po_id:po.id,po_number:po.po_number,grn_number:grnNumber,plant,
          remarks:remarks||null,operator_uid:operatorUid,operator_name:operatorName,created_at:now,
        });
        if(it.material_id){
          const matRef=doc(db,"rm_inventory",it.material_id);
          const matSnap=await getDoc(matRef);
          const current=matSnap.exists()?(matSnap.data().current_stock||0):0;
          await updateDoc(matRef,{current_stock:current+qty,updated_at:now});
        }
      }

      const updatedLines=(po.line_items||[]).map(pit=>{
        const match=toPost.find(it=>it.material_id&&it.material_id===pit.material_id);
        return match?{...pit,received_qty:(pit.received_qty||0)+(parseFloat(match.received_qty)||0)}:pit;
      });
      await updateDoc(doc(db,"purchase_orders",po.id),{line_items:updatedLines,status:poReceivedStatus(updatedLines),updated_at:now});

      showToast(`${grnNumber} — received against ${po.po_number}`);
      onClose();
    }catch(e){setError("Error: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Receive against PO</div>
      </div>

      <div className="card animate-in" style={{padding:20,marginBottom:20}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Plant *</label>
            <select style={fieldStyle} value={plant} onChange={e=>{setPlant(e.target.value);setPoId("");setLineItems([]);}}>
              {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Purchase order *</label>
            <select style={fieldStyle} value={poId} onChange={e=>onSelectPO(e.target.value)}>
              <option value="">— Select an approved PO —</option>
              {receivablePOs.map(p=><option key={p.id} value={p.id}>{p.po_number} — {p.vendor_name} ({PO_STATUS_LABELS[p.status]})</option>)}
            </select>
            {receivablePOs.length===0&&<div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>No approved POs awaiting receipt for {plant}.</div>}
          </div>
        </div>

        {lineItems.length>0&&(
          <div style={{marginBottom:14}}>
            <div style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Line items</div>
            {lineItems.map((it,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderTop:i>0?"1px solid #f3f4f6":undefined}}>
                <span style={{flex:1,fontSize:13}}>{it.material_name}</span>
                <span style={{fontSize:11,color:"#9ca3af",width:100,textAlign:"right"}}>Remaining {it.remaining} {it.unit}</span>
                <input type="number" style={{...fieldStyle,width:100}} min="0" step="0.01" value={it.received_qty} onChange={e=>updateLine(i,e.target.value)}/>
              </div>
            ))}
          </div>
        )}

        <div style={{marginBottom:14}}>
          <label style={labelStyle}>Remarks</label>
          <input style={fieldStyle} placeholder="Optional notes" value={remarks} onChange={e=>setRemarks(e.target.value)}/>
        </div>

        {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"9px 12px",fontSize:13,color:"#dc2626",marginBottom:14}}>{error}</div>}

        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving||!po} onClick={submit}><Icon name="check" size={13}/>{saving?"Saving…":"Record Inward"}</button>
        </div>
      </div>
    </div>
  );
}

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
        await addDoc(collection(db,"goods_inward"),{
          material_id:matId,material_name:mat?.material_name||"",
          supplier_id:suppId||null,supplier_name:suppName||suppId||"",
          quantity:qtyNum,unit,date_received:dateRcvd,plant,grn_number:grnNumber,
          remarks:remarks||null,operator_uid:operatorUid,operator_name:operatorName,created_at:now,
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
              <select style={{...fieldStyle,width:80,flex:"none"}} value={unit} onChange={e=>setUnit(e.target.value)}>
                {UNITS.map(u=><option key={u}>{u}</option>)}
              </select>
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
