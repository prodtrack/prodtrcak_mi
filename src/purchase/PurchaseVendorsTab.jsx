// ─── PurchaseVendorsTab.jsx ─────────────────────────────────────────────────
// Vendor Master. Extends the existing `supplier_master` collection (already
// used by the GRN direct-receipt supplier picker) rather than creating a
// duplicate — every vendor here is automatically available everywhere else
// in the app that reads supplier_master.

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import * as XLSX from "xlsx";
import { S, Icon, EmptyState, fieldStyle, labelStyle, FuzzyAutocomplete } from "../shared.jsx";
import { generateVendorCode } from "./purchaseHelpers";

export default function PurchaseVendorsTab({profile,showToast}){
  const isAdmin=profile.role==="admin";
  const canManage=isAdmin||!!profile.can_purchase;
  const [vendors,setVendors]=useState([]);
  const [showForm,setShowForm]=useState(false);
  const [editVendor,setEditVendor]=useState(null);
  const [viewVendor,setViewVendor]=useState(null);
  const [selectedId,setSelectedId]=useState(null);
  const [search,setSearch]=useState("");
  const [sortField,setSortField]=useState("name");
  const [sortDir,setSortDir]=useState("asc");
  const [page,setPage]=useState(1);
  const PAGE_SIZE=10;

  useEffect(()=>onSnapshot(collection(db,"supplier_master"),snap=>setVendors(snap.docs.map(d=>({id:d.id,...d.data()})))),[]);

  const q=search.trim().toLowerCase();
  const filtered=vendors.filter(v=>!q||v.name?.toLowerCase().includes(q)||v.vendor_code?.toLowerCase().includes(q));

  function vendorField(v,field){
    switch(field){
      case "vendor_code":return v.vendor_code||"";
      case "name":return v.name||"";
      case "gstin":return v.gstin||"";
      case "state_code":return v.state_code||"";
      case "phone":return v.phone||v.contact||"";
      case "email":return v.email||"";
      case "payment_terms":return v.payment_terms||"";
      case "category":return v.category||"";
      case "active":return v.active!==false?1:0;
      default:return "";
    }
  }
  const sorted=[...filtered].sort((a,b)=>{
    const va=vendorField(a,sortField),vb=vendorField(b,sortField);
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

  function selectRow(id){setSelectedId(prev=>prev===id?null:id);setViewVendor(null);}

  async function toggleActive(v){
    await updateDoc(doc(db,"supplier_master",v.id),{active:!(v.active!==false)});
    showToast(`${v.name} ${v.active!==false?"deactivated":"activated"}`);
  }

  function exportExcel(){
    const rows=sorted.map(v=>({
      "Code":v.vendor_code||"","Name":v.name||"","GSTIN":v.gstin||"","State code":v.state_code||"","PAN":v.pan||"",
      "Phone":v.phone||v.contact||"","Email":v.email||"","Payment terms":v.payment_terms||"","Category":v.category||"",
      "Status":v.active!==false?"Active":"Inactive",
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Vendors");
    XLSX.writeFile(wb,`Vendors_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("Exported to Excel");
  }

  if(showForm||editVendor){
    return <VendorForm existing={editVendor} showToast={showToast} onClose={()=>{setShowForm(false);setEditVendor(null);}}/>;
  }

  if(viewVendor){
    return <VendorDetailPanel vendor={viewVendor} isAdmin={isAdmin} canManage={canManage} onEdit={()=>{setEditVendor(viewVendor);setViewVendor(null);}} onToggleActive={()=>toggleActive(viewVendor)} onClose={()=>setViewVendor(null)}/>;
  }

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div>
          <div style={{fontSize:14,fontWeight:600}}>{vendors.length} vendor{vendors.length!==1?"s":""}</div>
          <div style={{fontSize:12,color:"#9ca3af",marginTop:2}}>Shared across all plants</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          {sorted.length>0&&<button className="btn-ghost" style={{fontSize:12,padding:"7px 14px"}} onClick={exportExcel}><Icon name="clipboard" size={12}/>Export Excel</button>}
          {canManage&&<button className="btn-primary" style={{fontSize:12,padding:"7px 14px"}} onClick={()=>setShowForm(true)}><Icon name="plus" size={12}/>New Vendor</button>}
        </div>
      </div>

      <input style={{...fieldStyle,marginBottom:16,maxWidth:280}} placeholder="Search vendor name / code…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>

      {vendors.length===0
        ?<EmptyState text="No vendors yet" sub={canManage?"Click 'New Vendor' to add one":undefined}/>
        :filtered.length===0
        ?<EmptyState text={`No vendors match "${search.trim()}"`} sub={canManage?"Try a different search, or click 'New Vendor' to add one":undefined}/>
        :<>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:"#fafafa"}}>
                  <th style={{padding:"8px 6px",borderBottom:"1px solid #e5e7eb",width:28}}></th>
                  <SortTh label="Code" field="vendor_code" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Name" field="name" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="GSTIN" field="gstin" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Phone" field="phone" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Payment terms" field="payment_terms" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Category" field="category" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                  <SortTh label="Status" field="active" sortField={sortField} sortDir={sortDir} onSort={onSort}/>
                </tr>
              </thead>
              <tbody>
                {paginated.map(v=>(
                  <VendorTableRow key={v.id} vendor={v} selected={selectedId===v.id} onSelect={()=>selectRow(v.id)}/>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId?1:.4,cursor:selectedId?"pointer":"default"}} disabled={!selectedId} onClick={()=>setViewVendor(vendors.find(v=>v.id===selectedId))}>View</button>
              <button className="btn-ghost" style={{fontSize:12,padding:"6px 14px",opacity:selectedId&&canManage?1:.4,cursor:selectedId&&canManage?"pointer":"default"}} disabled={!selectedId||!canManage} onClick={()=>setEditVendor(vendors.find(v=>v.id===selectedId))}>Edit</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,fontSize:12,color:"#6b7280"}}>
              <span>{sorted.length} vendor{sorted.length!==1?"s":""}</span>
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

function SortTh({label,field,sortField,sortDir,onSort}){
  const active=sortField===field;
  return(
    <th onClick={()=>onSort(field)} style={{padding:"8px 6px",textAlign:"left",borderBottom:"1px solid #e5e7eb",cursor:"pointer",userSelect:"none",fontSize:11,color:"#6b7280",whiteSpace:"nowrap",...S}}>
      {label}{active&&<span style={{marginLeft:4}}>{sortDir==="asc"?"▲":"▼"}</span>}
    </th>
  );
}

// ─── Vendor table row — select circle only; View/Edit buttons open detail ──
function VendorTableRow({vendor,selected,onSelect}){
  const active=vendor.active!==false;
  const cellStyle={padding:"7px 6px",borderBottom:"1px solid #f3f4f6",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:160,opacity:active?1:.55};

  return(
    <tr style={{background:selected?"#f5f7fa":"transparent"}}
      onMouseEnter={e=>{if(!selected)e.currentTarget.style.background="#fafafa";}}
      onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
      <td style={{...cellStyle,textAlign:"center",opacity:1,cursor:"pointer"}} onClick={onSelect}>
        <span style={{display:"inline-block",width:13,height:13,borderRadius:"50%",border:`1.5px solid ${selected?"#1a1f2e":"#d1d5db"}`,background:selected?"#1a1f2e":"transparent"}}/>
      </td>
      <td style={{...cellStyle,...S,fontWeight:700,color:"#1a1f2e"}}>{vendor.vendor_code||"—"}</td>
      <td style={cellStyle} title={vendor.name}>{vendor.name}</td>
      <td style={cellStyle}>{vendor.gstin||"—"}</td>
      <td style={cellStyle}>{vendor.phone||vendor.contact||"—"}</td>
      <td style={cellStyle}>{vendor.payment_terms||"—"}</td>
      <td style={cellStyle}>{vendor.category||"—"}</td>
      <td style={{...cellStyle,opacity:1}}>{active?<span style={{background:"#f0fdf4",color:"#16a34a",padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600}}>Active</span>:<span style={{background:"#f3f4f6",color:"#9ca3af",padding:"1px 8px",borderRadius:20,fontSize:11,fontWeight:600}}>Inactive</span>}</td>
    </tr>
  );
}

// ─── Vendor detail panel — read-only View, reached via the View button ─────
function VendorDetailPanel({vendor,isAdmin,canManage,onEdit,onToggleActive,onClose}){
  const active=vendor.active!==false;
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button className="btn-ghost" style={{padding:"7px 12px"}} onClick={onClose}><Icon name="arrow" size={14}/>Back</button>
        <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e"}}>{vendor.vendor_code} — {vendor.name}</div>
        {!active&&<span style={{...S,background:"#f3f4f6",color:"#9ca3af",padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:600}}>INACTIVE</span>}
      </div>
      <div className="card" style={{padding:20,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,fontSize:13}}>
          <div><span style={{color:"#9ca3af"}}>GSTIN:</span> {vendor.gstin||"—"}{vendor.state_code?` (St.${vendor.state_code})`:""}</div>
          <div><span style={{color:"#9ca3af"}}>PAN:</span> {vendor.pan||"—"}</div>
          <div><span style={{color:"#9ca3af"}}>Phone:</span> {vendor.phone||vendor.contact||"—"}</div>
          <div><span style={{color:"#9ca3af"}}>Email:</span> {vendor.email||"—"}</div>
          <div><span style={{color:"#9ca3af"}}>Payment terms:</span> {vendor.payment_terms||"—"}</div>
          <div><span style={{color:"#9ca3af"}}>Category:</span> {vendor.category||"—"}</div>
        </div>
        {vendor.address&&<div style={{marginTop:14,fontSize:13}}><span style={{color:"#9ca3af"}}>Address:</span> {vendor.address}</div>}
      </div>
      <div style={{display:"flex",gap:10}}>
        {canManage&&<button className="btn-ghost" onClick={onEdit}><Icon name="edit" size={12}/>Edit</button>}
        {isAdmin&&<button className="btn-ghost" style={{color:active?"#dc2626":"#16a34a"}} onClick={onToggleActive}>{active?"Deactivate":"Activate"}</button>}
      </div>
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
