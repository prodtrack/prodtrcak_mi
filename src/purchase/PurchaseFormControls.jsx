// ─── PurchaseFormControls.jsx ───────────────────────────────────────────────
// Shared form controls for PO creation. Currently just SelectOrCustom — a
// dropdown of standard values with an "Other" escape hatch that reveals a
// free-text field. Used for GST rate, payment terms, and delivery terms/mode
// so those fields stay clean and reportable without boxing anyone in for the
// rare non-standard case.
//
// Add new shared purchase-form controls here, not inline in each form file.

import { useState } from "react";
import { fieldStyle, labelStyle, Icon } from "../shared.jsx";
import { UNITS } from "./purchaseHelpers";

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

// ─── UomField ─────────────────────────────────────────────────────────────
// Unit-of-measure select with the same "Other (specify)" escape hatch as
// SelectOrCustom/CurrencyField. Previously each of the 3 forms (PO, PR,
// GRN) had its own copy that derived custom-mode from the value itself
// (`!!value && !UNITS.includes(value)`) — since choosing "Other" set the
// value to "", that check is falsy and the field silently snapped back to
// the dropdown instead of letting you type. Fixed here the same way as
// SelectOrCustom/CurrencyField: custom-mode is its own state flag, not
// inferred from the value. One shared copy now, imported by all 3 forms.
export function UomField({value, onChange, disabled=false}){
  const isKnown = UNITS.includes(value);
  const [customMode, setCustomMode] = useState(!isKnown && value!==""&&value!=null);

  if(customMode){
    return(
      <div style={{display:"flex",gap:4}}>
        <input style={{...fieldStyle,flex:1}} value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled} placeholder="Unit"/>
        {!disabled&&<button type="button" className="btn-ghost" style={{padding:"0 8px",flexShrink:0}} title="Choose from list" onClick={()=>{setCustomMode(false);onChange(UNITS[0]);}}><Icon name="arrow" size={11}/></button>}
      </div>
    );
  }

  return(
    <select style={fieldStyle} value={isKnown?value:""} disabled={disabled} onChange={e=>{
      if(e.target.value==="__other__"){setCustomMode(true);onChange("");}
      else onChange(e.target.value);
    }}>
      {UNITS.map(u=><option key={u}>{u}</option>)}
      <option value="__other__">Other (specify)</option>
    </select>
  );
}
// Repeatable label/value pairs for a single line item. `fields` is an array
// of {label,value}; "+ Add field" appends another pair, same pattern as
// "+ Add line item" at the item level. Reflected in list tables only, not
// print views (by design, for now).
export function CustomFieldsEditor({fields, onChange, disabled=false}){
  const list = fields||[];
  function updateField(i,k,v){ onChange(list.map((f,idx)=>idx===i?{...f,[k]:v}:f)); }
  function addField(){ onChange([...list,{label:"",value:""}]); }
  function removeField(i){ onChange(list.filter((_,idx)=>idx!==i)); }

  return(
    <div style={{marginBottom:10}}>
      {list.map((f,i)=>(
        <div key={i} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-end"}}>
          <div style={{flex:1,...(disabled?{pointerEvents:"none",opacity:.55}:{})}}>
            <label style={labelStyle}>Custom field name</label>
            <input style={fieldStyle} value={f.label||""} onChange={e=>updateField(i,"label",e.target.value)} placeholder="e.g. Batch No" readOnly={disabled}/>
          </div>
          <div style={{flex:1,...(disabled?{pointerEvents:"none",opacity:.55}:{})}}>
            <label style={labelStyle}>Custom field value</label>
            <input style={fieldStyle} value={f.value||""} onChange={e=>updateField(i,"value",e.target.value)} placeholder="Value" readOnly={disabled}/>
          </div>
          {!disabled&&<button type="button" className="btn-danger" style={{padding:"7px 8px",fontSize:11,flexShrink:0}} onClick={()=>removeField(i)}><Icon name="x" size={11}/></button>}
        </div>
      ))}
      {!disabled&&<button type="button" className="btn-ghost" style={{fontSize:11,padding:"4px 10px"}} onClick={addField}><Icon name="plus" size={11}/>Add field</button>}
    </div>
  );
}

// ─── CurrencyField ───────────────────────────────────────────────────────────
// Currency select with the same "Other (specify)" escape hatch as
// SelectOrCustom, but keeping the symbol-labelled options (INR (₹), USD ($),
// etc.) instead of raw codes. Typed custom codes are upper-cased (e.g. AED,
// SGD) since that's how ISO currency codes are written and how the amount
// displays fall back to showing the code itself when it's not one of the
// four with a known symbol (see currencySymbol() in purchaseHelpers.js).
const CURRENCY_OPTIONS = [
  {code:"INR",label:"INR (₹)"}, {code:"USD",label:"USD ($)"},
  {code:"EUR",label:"EUR (€)"}, {code:"GBP",label:"GBP (£)"},
];
export function CurrencyField({value, onChange, disabled=false}){
  const isKnown = CURRENCY_OPTIONS.some(o=>o.code===value);
  const [customMode, setCustomMode] = useState(!isKnown && value!==""&&value!=null);

  if(customMode){
    return(
      <div>
        <label style={labelStyle}>Currency</label>
        <div style={{display:"flex",gap:6}}>
          <input style={{...fieldStyle,flex:1,textTransform:"uppercase"}} value={value||""} onChange={e=>onChange(e.target.value.toUpperCase())} placeholder="e.g. AED" maxLength={6} readOnly={disabled} disabled={disabled}/>
          {!disabled&&<button type="button" className="btn-ghost" style={{fontSize:11,padding:"0 10px",flexShrink:0}} onClick={()=>{setCustomMode(false);onChange("INR");}}>List</button>}
        </div>
      </div>
    );
  }

  return(
    <div>
      <label style={labelStyle}>Currency</label>
      <select style={fieldStyle} value={isKnown?value:""} disabled={disabled} onChange={e=>{
        if(e.target.value==="__other__"){setCustomMode(true);onChange("");}
        else onChange(e.target.value);
      }}>
        <option value="" disabled>— Select currency —</option>
        {CURRENCY_OPTIONS.map(o=><option key={o.code} value={o.code}>{o.label}</option>)}
        <option value="__other__">Other (specify)</option>
      </select>
    </div>
  );
}
