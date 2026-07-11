// ─── MRPQueueTab.jsx ─────────────────────────────────────────────────────────
// v1 MRP: any rm_inventory material at or below its low_stock_threshold shows
// up here. "Generate PO" pre-fills a single-line PO (suggested reorder qty =
// 2x threshold − current stock, same target the Inventory tab's stock bar
// already uses) and submits it straight to pending_approval — skipping draft,
// since a system-generated reorder doesn't need a human draft-editing step,
// just a human approval. Reorder logic can be refined later without touching
// anything outside this file.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, addDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { S, Icon, EmptyState, fieldStyle, labelStyle } from "../shared.jsx";
import { PLANTS, generatePONumber, DELIVERY_TERMS_OPTIONS, DELIVERY_MODE_OPTIONS, PAYMENT_TERMS_OPTIONS } from "./purchaseHelpers";
import SelectOrCustom from "./PurchaseFormControls.jsx";

export default function MRPQueueTab({profile,showToast}){
  const canCreate=profile.role==="admin"||!!profile.can_purchase;
  const [materials,setMaterials]=useState([]);
  const [vendors,setVendors]=useState([]);
  const [openId,setOpenId]=useState(null);

  useEffect(()=>onSnapshot(collection(db,"rm_inventory"),s=>setMaterials(s.docs.map(d=>({id:d.id,...d.data()})))),[]);
  useEffect(()=>onSnapshot(collection(db,"supplier_master"),s=>setVendors(s.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.active!==false))),[]);

  const shortfall=materials.filter(m=>m.low_stock_threshold>0&&m.current_stock<=m.low_stock_threshold);

  return(
    <div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600}}>{shortfall.length} material{shortfall.length!==1?"s":""} at or below reorder point</div>
        <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>Suggested qty tops stock back up to 2× the reorder threshold</div>
      </div>

      {shortfall.length===0
        ?<EmptyState text="Nothing to reorder" sub="All materials are above their reorder threshold"/>
        :shortfall.map(m=>{
          const suggested=Math.max(0,Math.round(((m.low_stock_threshold*2)-(m.current_stock||0))*100)/100);
          const open=openId===m.id;
          return(
            <div key={m.id} className="card animate-in" style={{padding:0,marginBottom:8,overflow:"hidden"}}>
              <div style={{padding:"14px 18px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:180}}>
                  <div style={{fontSize:14,fontWeight:600}}>{m.material_name}</div>
                  <div style={{fontSize:11,color:"#6b7280"}}>{m.category||""}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{...S,fontSize:16,fontWeight:700,color:"#dc2626"}}>{m.current_stock??0} {m.unit}</div>
                  <div style={{fontSize:10,color:"#9ca3af"}}>Reorder at {m.low_stock_threshold} {m.unit}</div>
                </div>
                {canCreate&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px",flexShrink:0}} onClick={()=>setOpenId(open?null:m.id)}><Icon name="plus" size={12}/>Generate PO</button>}
              </div>
              {open&&(
                <div style={{borderTop:"1px solid #f3f4f6",padding:20,background:"#fafbfc"}}>
                  <MRPGenerateForm material={m} suggested={suggested} vendors={vendors} profile={profile} showToast={showToast} onDone={()=>setOpenId(null)}/>
                </div>
              )}
            </div>
          );
        })
      }
    </div>
  );
}

function MRPGenerateForm({material,suggested,vendors,profile,showToast,onDone}){
  const [plant,setPlant]=useState("Bidadi");
  const [vendorId,setVendorId]=useState("");
  const [partCode,setPartCode]=useState("");
  const [qty,setQty]=useState(suggested||1);
  const [rate,setRate]=useState("");
  const [requiredDate,setRequiredDate]=useState("");
  const [paymentTerms,setPaymentTerms]=useState("");
  const [termsOfDelivery,setTermsOfDelivery]=useState("FOR (freight paid by you)");
  const [modeOfDelivery,setModeOfDelivery]=useState("Road");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  function onSelectVendor(id){
    setVendorId(id);
    const v=vendors.find(v=>v.id===id);
    if(v?.payment_terms&&!paymentTerms)setPaymentTerms(v.payment_terms);
  }

  async function generate(){
    const vendor=vendors.find(v=>v.id===vendorId);
    if(!vendor){setError("Select a vendor");return;}
    if(!qty||parseFloat(qty)<=0){setError("Enter a valid quantity");return;}
    if(!requiredDate){setError("Set a required date");return;}
    setError("");setSaving(true);
    try{
      const poNumber=await generatePONumber(plant);
      const rateNum=parseFloat(rate)||0;
      await addDoc(collection(db,"purchase_orders"),{
        plant, vendor_id:vendor.id, vendor_name:vendor.name, vendor_code:vendor.vendor_code||null,
        vendor_gstin:vendor.gstin||null, vendor_state_code:vendor.state_code||null,
        vendor_address:vendor.address||null, vendor_phone:vendor.phone||null, vendor_email:vendor.email||null, vendor_pan:vendor.pan||null,
        line_items:[{part_code:partCode||"",material_id:material.id,material_name:material.material_name,hsn_code:"",qty:parseFloat(qty),unit:material.unit||"kg",rate:rateNum,required_date:requiredDate,received_qty:0}],
        gst_rate:18, total_amount:Math.round(parseFloat(qty)*rateNum*100)/100,
        expected_delivery:requiredDate,
        payment_terms:paymentTerms||null, terms_of_delivery:termsOfDelivery||null, mode_of_delivery:modeOfDelivery||null, your_reference:null,
        remarks:"Auto-generated from MRP Queue (reorder shortfall)",
        status:"pending_approval", source:"mrp",
        po_number:poNumber, created_by:auth.currentUser.uid, created_by_name:profile.name||auth.currentUser.email, created_at:serverTimestamp(),
      });
      showToast(`${poNumber} generated for approval`);
      onDone();
    }catch(e){setError("Failed: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div>
          <label style={labelStyle}>Plant</label>
          <select style={fieldStyle} value={plant} onChange={e=>setPlant(e.target.value)}>
            {PLANTS.map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Vendor *</label>
          <select style={fieldStyle} value={vendorId} onChange={e=>onSelectVendor(e.target.value)}>
            <option value="">— Select vendor —</option>
            {vendors.map(v=><option key={v.id} value={v.id}>{v.vendor_code} — {v.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Part code</label>
          <input style={fieldStyle} value={partCode} onChange={e=>setPartCode(e.target.value)} placeholder="Optional"/>
        </div>
        <div>
          <label style={labelStyle}>Order qty ({material.unit})</label>
          <input type="number" style={fieldStyle} min="0" step="0.01" value={qty} onChange={e=>setQty(e.target.value)}/>
        </div>
        <div>
          <label style={labelStyle}>Rate (₹/{material.unit})</label>
          <input type="number" style={fieldStyle} min="0" step="0.01" value={rate} onChange={e=>setRate(e.target.value)} placeholder="Last purchase rate if known"/>
        </div>
        <div>
          <label style={labelStyle}>Required date *</label>
          <input type="date" style={fieldStyle} value={requiredDate} onChange={e=>setRequiredDate(e.target.value)}/>
        </div>
        <div>
          <SelectOrCustom label="Payment terms" value={paymentTerms} onChange={setPaymentTerms} options={PAYMENT_TERMS_OPTIONS} placeholder="— Select payment terms —"/>
        </div>
        <div>
          <SelectOrCustom label="Terms of delivery" value={termsOfDelivery} onChange={setTermsOfDelivery} options={DELIVERY_TERMS_OPTIONS} placeholder="— Select delivery terms —"/>
        </div>
        <div style={{gridColumn:"1/-1"}}>
          <SelectOrCustom label="Mode of delivery" value={modeOfDelivery} onChange={setModeOfDelivery} options={DELIVERY_MODE_OPTIONS} placeholder="— Select mode —"/>
        </div>
      </div>
      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"9px 12px",fontSize:13,color:"#dc2626",marginBottom:14}}>{error}</div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={generate}><Icon name="check" size={13}/>{saving?"Generating…":"Generate PO for Approval"}</button>
      </div>
    </div>
  );
}
