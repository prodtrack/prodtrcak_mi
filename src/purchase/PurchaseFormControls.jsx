// ─── PurchaseFormControls.jsx ───────────────────────────────────────────────
// Shared form controls for PO creation. Currently just SelectOrCustom — a
// dropdown of standard values with an "Other" escape hatch that reveals a
// free-text field. Used for GST rate, payment terms, and delivery terms/mode
// so those fields stay clean and reportable without boxing anyone in for the
// rare non-standard case.
//
// Add new shared purchase-form controls here, not inline in each form file.

import { useState } from "react";
import { fieldStyle, labelStyle } from "../shared.jsx";

export default function SelectOrCustom({label, value, onChange, options, placeholder="— Select —", otherLabel="Other (specify)", required=false, suffix=""}){
  const isKnown = options.some(o=>String(o)===String(value));
  const [customMode, setCustomMode] = useState(!isKnown && value!==""&&value!=null);

  if(customMode){
    return(
      <div>
        <label style={labelStyle}>{label}{required&&" *"}</label>
        <div style={{display:"flex",gap:6}}>
          <input style={{...fieldStyle,flex:1}} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={`Enter ${label.toLowerCase()}`}/>
          <button type="button" className="btn-ghost" style={{fontSize:11,padding:"0 10px",flexShrink:0}} onClick={()=>{setCustomMode(false);onChange(options[0]??"");}}>
            List
          </button>
        </div>
      </div>
    );
  }

  return(
    <div>
      <label style={labelStyle}>{label}{required&&" *"}</label>
      <select style={fieldStyle} value={isKnown?value:""} onChange={e=>{
        if(e.target.value==="__other__"){setCustomMode(true);onChange("");}
        else onChange(e.target.value);
      }}>
        <option value="" disabled>{placeholder}</option>
        {options.map(o=><option key={o} value={o}>{typeof o==="number"?`${o}${suffix}`:o}</option>)}
        <option value="__other__">{otherLabel}</option>
      </select>
    </div>
  );
}
