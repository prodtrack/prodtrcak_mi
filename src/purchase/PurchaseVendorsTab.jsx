// ─── PurchaseVendorsTab.jsx ─────────────────────────────────────────────────
// Vendor Master. Extends the existing `supplier_master` collection (already
// used by the GRN direct-receipt supplier picker) rather than creating a
// duplicate — every vendor here is automatically available everywhere else
// in the app that reads supplier_master.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { S, Icon, EmptyState, fieldStyle, labelStyle, FuzzyAutocomplete } from "../shared.jsx";
import { generateVendorCode } from "./purchaseHelpers";

export default function PurchaseVendorsTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canManage=isAdmin||!!profile.can_purchase;
  const [vendors,setVendors]=useState([]);
  const [showForm,setShowForm]=useState(false);
  const [editVendor,setEditVendor]=useState(null);
  const [search,setSearch]=useState("");

  useEffect(()=>onSnapshot(collection(db,"supplier_master"),snap=>setVendors(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  const hasQuery=search.trim().length>0;
  const filtered=hasQuery?vendors.filter(v=>v.name?.toLowerCase().includes(search.toLowerCase())||v.vendor_code?.toLowerCase().includes(search.toLowerCase())):[];

  async function toggleActive(v){
    await updateDoc(doc(db,"supplier_master",v.id),{active:!(v.active!==false)});
    showToast(`${v.name} ${v.active!==false?"deactivated":"activated"}`);
  }

  if(showForm||editVendor){
    return <VendorForm existing={editVendor} showToast={showToast} onClose={()=>{setShowForm(false);setEditVendor(null);}}/>;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div>
          <div style={{fontSize:14,fontWeight:600}}>{vendors.length} vendor{vendors.length!==1?"s":""}</div>
          <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>Shared across all plants</div>
        </div>
        {canManage&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setShowForm(true)}><Icon name="plus" size={12}/>New Vendor</button>}
      </div>

      <input style={{...fieldStyle,marginBottom:16,maxWidth:280}} placeholder="Search vendor name / code…" value={search} onChange={e=>setSearch(e.target.value)}/>

      {!hasQuery
        ?<EmptyState text="Search for a vendor" sub="Start typing a vendor name or code above"/>
        :filtered.length===0
          ?<EmptyState text={`No vendors match "${search.trim()}"`} sub={canManage?"Click 'New Vendor' to add one":undefined}/>
          :filtered.map(v=>{
          const active=v.active!==false;
          return(
            <div key={v.id} className="card animate-in" style={{padding:"14px 18px",marginBottom:8,opacity:active?1:.55}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                <span style={{...S,fontSize:12,fontWeight:700,color:"#1a1f2e"}}>{v.vendor_code||"—"}</span>
                <span style={{fontSize:14,fontWeight:600,color:"#1a1f2e"}}>{v.name}</span>
                {!active&&<span style={{...S,background:"#f3f4f6",color:"#9ca3af",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>INACTIVE</span>}
                <div style={{marginLeft:"auto",display:"flex",gap:6}}>
                  {canManage&&<button className="btn-ghost" style={{padding:"3px 8px",fontSize:11}} onClick={()=>setEditVendor(v)}><Icon name="edit" size={11}/>Edit</button>}
                  {isAdmin&&<button className="btn-ghost" style={{padding:"3px 8px",fontSize:11,color:active?"#dc2626":"#16a34a"}} onClick={()=>toggleActive(v)}>{active?"Deactivate":"Activate"}</button>}
                </div>
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12,color:"#6b7280"}}>
                {v.gstin&&<span><span style={{color:"#9ca3af"}}>GSTIN:</span> {v.gstin}{v.state_code?` (St.${v.state_code})`:""}</span>}
                {v.phone&&<span><span style={{color:"#9ca3af"}}>Phone:</span> {v.phone}</span>}
                {v.email&&<span><span style={{color:"#9ca3af"}}>Email:</span> {v.email}</span>}
                {!v.phone&&!v.email&&v.contact&&<span><span style={{color:"#9ca3af"}}>Contact:</span> {v.contact}</span>}
                {v.payment_terms&&<span><span style={{color:"#9ca3af"}}>Terms:</span> {v.payment_terms}</span>}
                {v.category&&<span><span style={{color:"#9ca3af"}}>Category:</span> {v.category}</span>}
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

function VendorForm({existing,showToast,onClose}){
  const isEdit=!!existing;
  const [name,setName]=useState(existing?.name||"");
  const [gstin,setGstin]=useState(existing?.gstin||"");
  const [stateCode,setStateCode]=useState(existing?.state_code||"");
  const [pan,setPan]=useState(existing?.pan||"");
  const [phone,setPhone]=useState(existing?.phone||existing?.contact||"");
  const [email,setEmail]=useState(existing?.email||"");
  const [address,setAddress]=useState(existing?.address||"");
  const [paymentTerms,setPaymentTerms]=useState(existing?.payment_terms||"");
  const [category,setCategory]=useState(existing?.category||"");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");

  // Vendor Master (from the Party List import) — for fuzzy-suggest auto-fill
  // only, purely a typing convenience. PAN never comes from here (that
  // import has no PAN column), always stays manual.
  const [vendorMaster,setVendorMaster]=useState([]);
  useEffect(()=>onSnapshot(collection(db,"vendor_master"),snap=>setVendorMaster(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  function autoFillFromMaster(m){
    const combinedAddress=[m.address_line1,m.address_line2,m.address_line3,m.city,m.state,m.pincode].filter(Boolean).join(", ");
    if(m.gstin){setGstin(m.gstin);if(/^\d{2}/.test(m.gstin))setStateCode(m.gstin.slice(0,2));}
    if(combinedAddress)setAddress(combinedAddress);
    if(m.phone1)setPhone(m.phone1);
    if(m.email1)setEmail(m.email1);
    if(m.payment_term_description)setPaymentTerms(m.payment_term_description);
    if(m.category)setCategory(m.category);
  }

  async function save(){
    if(!name.trim()){setError("Vendor name is required");return;}
    setError("");setSaving(true);
    try{
      if(isEdit){
        await updateDoc(doc(db,"supplier_master",existing.id),{
          name:name.trim(),gstin:gstin||null,state_code:stateCode||null,pan:pan||null,phone:phone||null,email:email||null,address:address||null,
          payment_terms:paymentTerms||null,category:category||null,updated_at:serverTimestamp(),
        });
        showToast("Vendor updated");
      }else{
        const vendorCode=await generateVendorCode();
        await addDoc(collection(db,"supplier_master"),{
          vendor_code:vendorCode,name:name.trim(),gstin:gstin||null,state_code:stateCode||null,pan:pan||null,phone:phone||null,email:email||null,address:address||null,
          payment_terms:paymentTerms||null,category:category||null,active:true,
          created_by:auth.currentUser.uid,created_at:serverTimestamp(),
        });
        showToast(`Vendor ${vendorCode} created`);
      }
      onClose();
    }catch(e){setError("Save failed: "+e.message);}
    finally{setSaving(false);}
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>{isEdit?`Edit ${existing.vendor_code}`:"New Vendor"}</div>
      </div>

      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{marginBottom:14}}>
          <FuzzyAutocomplete label="Vendor name *" value={name} onChange={setName} onSelect={autoFillFromMaster} options={vendorMaster} displayKey="name" placeholder="e.g. Sundaram Wires Pvt Ltd"/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <div>
            <label style={labelStyle}>GSTIN</label>
            <input style={fieldStyle} value={gstin} onChange={e=>{const v=e.target.value.toUpperCase();setGstin(v);if(/^\d{2}/.test(v))setStateCode(v.slice(0,2));}} placeholder="29ABCDE1234F1Z5" maxLength={15}/>
          </div>
          <div>
            <label style={labelStyle}>State code {gstin&&<span style={{color:"#9ca3af",fontWeight:400}}>(auto from GSTIN — used for CGST/SGST vs IGST)</span>}</label>
            <input style={fieldStyle} value={stateCode} onChange={e=>setStateCode(e.target.value)} placeholder="29" maxLength={2}/>
          </div>
          <div>
            <label style={labelStyle}>PAN</label>
            <input style={fieldStyle} value={pan} onChange={e=>setPan(e.target.value.toUpperCase())} placeholder="AAJFM0341F" maxLength={10}/>
          </div>
          <div>
            <label style={labelStyle}>Phone</label>
            <input style={fieldStyle} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="9880205666"/>
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={fieldStyle} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="vendor@example.com"/>
          </div>
          <div>
            <label style={labelStyle}>Payment terms</label>
            <input style={fieldStyle} value={paymentTerms} onChange={e=>setPaymentTerms(e.target.value)} placeholder="e.g. Payment against delivery"/>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <input style={fieldStyle} value={category} onChange={e=>setCategory(e.target.value)} placeholder="e.g. Copper, Insulation"/>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Address</label>
          <textarea style={{...fieldStyle,minHeight:64,resize:"vertical"}} value={address} onChange={e=>setAddress(e.target.value)}/>
        </div>
      </div>

      {error&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:"#dc2626"}}>{error}</div>}

      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}><Icon name="check" size={14}/>{saving?"Saving…":isEdit?"Update Vendor":"Save Vendor"}</button>
      </div>
    </div>
  );
}
