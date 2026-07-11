// ─── GRNTab.jsx ─────────────────────────────────────────────────────────────
// Unified goods receipt. Two entry paths into the same history:
//   1. Against PO   — pick an approved/partially-received PO, enter received
//                      qty per line (partial supported), posts stock + rolls
//                      the PO status forward.
//   2. Direct        — no PO. Known material posts straight to stock; an
//                      unrecognised material raises a `grn_holds` review item
//                      for admin (unchanged from the old Goods Inward tab).
// Both paths extend the existing `goods_inward` collection with optional
// po_id/po_number + a formal grn_number — no new collection, no migration.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, getDoc, onSnapshot, query, orderBy, serverTimestamp } from "firebase/firestore";
import { S, Icon, EmptyState, formatDate, fieldStyle, labelStyle } from "../shared.jsx";
import { PLANTS, UNITS, generateGRNNumber, poReceivedStatus, PO_STATUS_LABELS } from "./purchaseHelpers";

export default function GRNTab({profile,showToast}){
  const canReceive=["admin","store"].includes(profile.role)||!!profile.can_purchase;
  const isAdmin=profile.role==="admin";

  const [materials,setMaterials]=useState([]);
  const [suppliers,setSuppliers]=useState([]);
  const [entries,setEntries]=useState([]);
  const [holds,setHolds]=useState([]);
  const [pos,setPos]=useState([]);

  const [mode,setMode]=useState(null); // null | "po" | "direct"
  const [search,setSearch]=useState("");
  const [holdRemark,setHoldRemark]=useState({});
  const [holdSaving,setHoldSaving]=useState({});

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
  useEffect(()=>{
    const q=query(collection(db,"purchase_orders"),orderBy("created_at","desc"));
    return onSnapshot(q,s=>setPos(s.docs.map(d=>({id:d.id,...d.data()}))));
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
  const filtered=entries.filter(e=>!search||e.material_name?.toLowerCase().includes(search.toLowerCase())||e.supplier_name?.toLowerCase().includes(search.toLowerCase())||e.po_number?.toLowerCase().includes(search.toLowerCase()));

  if(mode==="po")return<ReceiveAgainstPO profile={profile} pos={pos} showToast={showToast} onClose={()=>setMode(null)}/>;
  if(mode==="direct")return<DirectReceipt profile={profile} materials={materials} suppliers={suppliers} showToast={showToast} onClose={()=>setMode(null)}/>;

  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:600}}>{entries.length} receipt{entries.length!==1?"s":""} recorded</div>
        </div>
        {canReceive&&(
          <div style={{display:"flex",gap:8}}>
            <button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setMode("po")}><Icon name="clipboard" size={12}/>Receive against PO</button>
            <button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setMode("direct")}><Icon name="inbox" size={12}/>Direct Receipt</button>
          </div>
        )}
      </div>

      {/* GRN Hold alert — admin only */}
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

      {/* History */}
      <div className="card" style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderBottom:"1px solid #f3f4f6"}}>
          <span style={{...S,fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".07em",flex:1}}>Receipt History</span>
          <input style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:7,padding:"5px 11px",fontSize:12,outline:"none",width:200}} placeholder="Search material / supplier / PO…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {filtered.length>0&&(
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 16px",background:"#fafafa",borderBottom:"1px solid #f3f4f6"}}>
            {[["DATE",80],["MATERIAL","1"],["SUPPLIER",110],["QTY",70],["PO #",90],["BY",90]].map(([l,w])=>(
              <span key={l} style={{...S,fontSize:10,color:"#9ca3af",flexShrink:l==="MATERIAL"?0:undefined,flex:l==="MATERIAL"?1:undefined,width:l!=="MATERIAL"?w:undefined,minWidth:l!=="MATERIAL"?w:undefined}}>{l}</span>
            ))}
          </div>
        )}
        {filtered.length===0
          ?<EmptyState text="No receipts yet"/>
          :filtered.map((e,i)=>(
            <div key={e.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",borderBottom:i<filtered.length-1?"1px solid #f9fafb":undefined}}
              onMouseEnter={ev=>ev.currentTarget.style.background="#f9fafb"}
              onMouseLeave={ev=>ev.currentTarget.style.background="#fff"}>
              <span style={{...S,fontSize:11,color:"#9ca3af",flexShrink:0,width:80}}>{formatDate(e.date_received)}</span>
              <span style={{fontSize:13,fontWeight:500,color:"#1a1f2e",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.material_name}</span>
              <span style={{fontSize:11,color:"#6b7280",flexShrink:0,width:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.supplier_name||"—"}</span>
              <span style={{...S,fontSize:12,fontWeight:600,color:"#1a1f2e",flexShrink:0,width:70}}>{e.quantity} {e.unit}</span>
              <span style={{...S,fontSize:11,color:e.po_number?"#1d4ed8":"#d1d5db",flexShrink:0,width:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.po_number||"—"}</span>
              <span style={{fontSize:11,color:"#9ca3af",flexShrink:0,width:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.operator_name}</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ─── Receive against PO ─────────────────────────────────────────────────────
function ReceiveAgainstPO({profile,pos,showToast,onClose}){
  const [plant,setPlant]=useState("Bidadi");
  const [poId,setPoId]=useState("");
  const [qtyByLine,setQtyByLine]=useState({});
  const [remarks,setRemarks]=useState("");
  const [dateRcvd,setDateRcvd]=useState(new Date().toISOString().split("T")[0]);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  const receivablePOs=pos.filter(p=>p.plant===plant&&["approved","partially_received"].includes(p.status));
  const po=pos.find(p=>p.id===poId);

  function remaining(it){return Math.max(0,(parseFloat(it.qty)||0)-(it.received_qty||0));}

  async function post(){
    if(!po){setError("Select a purchase order");return;}
    const linesToPost=(po.line_items||[]).map((it,idx)=>({idx,it,qty:parseFloat(qtyByLine[idx])||0})).filter(l=>l.qty>0);
    if(linesToPost.length===0){setError("Enter a received quantity for at least one line");return;}
    for(const l of linesToPost){
      if(l.qty>remaining(l.it)){setError(`${l.it.material_name}: received qty exceeds remaining (${remaining(l.it)} ${l.it.unit})`);return;}
    }
    setError("");setSaving(true);
    try{
      const now=serverTimestamp();
      const grnNumber=await generateGRNNumber(plant);
      const operatorName=profile.name||auth.currentUser.email;
      const operatorUid=auth.currentUser.uid;

      for(const l of linesToPost){
        await addDoc(collection(db,"goods_inward"),{
          material_id:l.it.material_id||null,material_name:l.it.material_name,
          supplier_id:po.vendor_id,supplier_name:po.vendor_name,
          quantity:l.qty,unit:l.it.unit,date_received:dateRcvd,
          po_id:po.id,po_number:po.po_number,grn_number:grnNumber,plant,
          remarks:remarks||null,operator_uid:operatorUid,operator_name:operatorName,created_at:now,
        });
        if(l.it.material_id){
          const matRef=doc(db,"rm_inventory",l.it.material_id);
          // Read-modify-write is acceptable here: GRN posting is a deliberate,
          // low-frequency, single-operator action, not a high-contention path.
          const matSnap=await getDoc(matRef);
          const current=matSnap.exists()?(matSnap.data().current_stock||0):0;
          await updateDoc(matRef,{current_stock:current+l.qty,updated_at:now});
        }
      }

      const updatedLines=(po.line_items||[]).map((it,idx)=>{
        const posted=linesToPost.find(l=>l.idx===idx);
        return posted?{...it,received_qty:(it.received_qty||0)+posted.qty}:it;
      });
      await updateDoc(doc(db,"purchase_orders",po.id),{line_items:updatedLines,status:poReceivedStatus(updatedLines),updated_at:now});

      showToast(`${grnNumber} posted against ${po.po_number}`);
      onClose();
    }catch(e){setError("Error: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>Receive Against Purchase Order</div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>Plant</label>
            <select style={fieldStyle} value={plant} onChange={e=>{setPlant(e.target.value);setPoId("");}}>
              {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Purchase order *</label>
            <select style={fieldStyle} value={poId} onChange={e=>{setPoId(e.target.value);setQtyByLine({});}}>
              <option value="">— Select an approved PO —</option>
              {receivablePOs.map(p=><option key={p.id} value={p.id}>{p.po_number} — {p.vendor_name} ({PO_STATUS_LABELS[p.status]})</option>)}
            </select>
            {receivablePOs.length===0&&<div style={{fontSize:11,color:"#9ca3af",marginTop:4}}>No approved POs awaiting receipt for {plant}.</div>}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div>
            <label style={labelStyle}>Date received</label>
            <input type="date" style={fieldStyle} value={dateRcvd} onChange={e=>setDateRcvd(e.target.value)}/>
          </div>
          <div>
            <label style={labelStyle}>Remarks</label>
            <input style={fieldStyle} placeholder="Optional notes" value={remarks} onChange={e=>setRemarks(e.target.value)}/>
          </div>
        </div>
      </div>

      {po&&(
        <div className="card" style={{padding:0,marginBottom:16,overflow:"hidden"}}>
          <div style={{display:"flex",gap:8,padding:"8px 14px",background:"#fafafa",borderBottom:"1px solid #f3f4f6",fontSize:10,color:"#9ca3af",...S,textTransform:"uppercase"}}>
            <span style={{flex:1}}>Item</span><span style={{width:80,textAlign:"right"}}>Ordered</span><span style={{width:80,textAlign:"right"}}>Remaining</span><span style={{width:110,textAlign:"right"}}>Receive now</span>
          </div>
          {(po.line_items||[]).map((it,idx)=>{
            const rem=remaining(it);
            return(
              <div key={idx} style={{display:"flex",gap:8,padding:"10px 14px",borderBottom:idx<po.line_items.length-1?"1px solid #f9fafb":undefined,alignItems:"center",fontSize:12}}>
                <span style={{flex:1,fontWeight:500}}>{it.material_name}</span>
                <span style={{width:80,textAlign:"right",...S}}>{it.qty} {it.unit}</span>
                <span style={{width:80,textAlign:"right",...S,color:rem===0?"#16a34a":"#6b7280"}}>{rem} {it.unit}</span>
                <span style={{width:110}}>
                  <input type="number" min="0" max={rem} step="0.01" disabled={rem===0} style={{...fieldStyle,padding:"5px 9px",fontSize:12,textAlign:"right"}} value={qtyByLine[idx]||""} onChange={e=>setQtyByLine(p=>({...p,[idx]:e.target.value}))} placeholder="0"/>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626"}}>{error}</div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving||!po} onClick={post}><Icon name="check" size={14}/>{saving?"Posting…":"Post GRN"}</button>
      </div>
    </div>
  );
}

// ─── Direct receipt (no PO) ─────────────────────────────────────────────────
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
              ?<select style={fieldStyle} value={suppId} onChange={e=>{setSuppId(e.target.value);setSuppName(suppliers.find(s=>s.id===e.target.value)?.name||"");}}>
                <option value="">— Select supplier —</option>
                {suppliers.map(s=><option key={s.id} value={s.id}>{s.vendor_code} — {s.name}</option>)}
              </select>
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
