// ─── purchaseHelpers.js ─────────────────────────────────────────────────────
// Constants, document numbering, and status helpers used across every file
// in /purchase. Change PO/GRN behaviour here — nothing outside this folder
// should need to know how a PO or GRN number is generated.

import { doc, runTransaction } from "firebase/firestore";
import { db } from "../firebase";
import { getFY } from "../shared.jsx";

// ─── Plants ─────────────────────────────────────────────────────────────────
// No dedicated `plants` collection yet — this is the single source of truth
// for plant selection across Purchase Orders, GRN, and MRP Queue. Promote to
// a Firestore collection later if plants become dynamic/configurable.
export const PLANTS = ["Bidadi","Bhiwandi"];
export function plantCode(plant){return (plant||"").slice(0,3).toUpperCase();}

// Ship-to / company details per plant, printed on the PO. Bidadi is taken
// directly from your existing PO letterhead. Bhiwandi's GSTIN/PAN/address
// are placeholders — update these in Admin before raising a real Bhiwandi PO,
// since a wrong GSTIN on a live PO is a compliance problem, not just a typo.
export const COMPANY_INFO = {
  Bidadi:{
    name:"Mahendra Industries",
    address:"Plot No 15, Sector 1, Bidadi Industrial Area, Phase II, Ramanagara, Karnataka 562109, India",
    phone:"07829113356", email:"purchase@mahendraindustries.in", website:"www.mahendraindustries.in",
    gstin:"29AAJFM0341F1ZH", pan:"AAJFM0341F", state_code:"29",
  },
  Bhiwandi:{
    name:"Mahendra Industries",
    address:"⚠ Update Bhiwandi plant address in Admin before use",
    phone:"", email:"purchase@mahendraindustries.in", website:"www.mahendraindustries.in",
    gstin:"⚠ SET BHIWANDI GSTIN", pan:"⚠ SET BHIWANDI PAN", state_code:"⚠",
  },
};

// ─── GST ────────────────────────────────────────────────────────────────────
// Simple state-code comparison: same state as the receiving plant → CGST+SGST
// split; different state → IGST. This mirrors standard GST treatment without
// building a full tax engine — override the rate per PO if a line needs it.
export const DEFAULT_GST_RATE = 18;
export function gstTreatment(plant,vendorStateCode){
  const plantState=COMPANY_INFO[plant]?.state_code;
  if(!vendorStateCode||!plantState||plantState==="⚠")return"IGST";
  return vendorStateCode===plantState?"CGST_SGST":"IGST";
}

// ─── Units ──────────────────────────────────────────────────────────────────
export const UNITS = ["kg","pcs","mtr","ltr","rolls","nos"];

// ─── Standard dropdown option lists (PO form) ───────────────────────────────
// Edit these lists to change what's offered in the PO form dropdowns — every
// field also has an "Other" escape hatch in the UI for the rare exception.
export const GST_RATE_OPTIONS = [0, 5, 12, 18, 28];
export const DELIVERY_TERMS_OPTIONS = ["FOR (freight paid by you)","FOB","CIF","Ex-Works","DAP","DDP","CPT","CIP"];
export const DELIVERY_MODE_OPTIONS = ["Road","Rail","Air","Sea","Courier","Hand Delivery"];
export const PAYMENT_TERMS_OPTIONS = [
  "Payment against delivery","100% Advance","30 Days from date of Invoice",
  "45 Days from date of Invoice","60 Days from date of Invoice",
  "50% Advance, 50% on Delivery","Against Bank Guarantee",
];

// ─── PO status lifecycle ────────────────────────────────────────────────────
export const PO_STATUSES = ["draft","pending_approval","approved","partially_received","received","closed","cancelled"];
export const PO_STATUS_LABELS = {
  draft:"Draft", pending_approval:"Pending Approval", approved:"Approved",
  partially_received:"Partially Received", received:"Received", closed:"Closed", cancelled:"Cancelled",
};
export const PO_STATUS_COLORS = {
  draft:{bg:"#f3f4f6",c:"#6b7280"},
  pending_approval:{bg:"#fffbeb",c:"#b45309"},
  approved:{bg:"#eff6ff",c:"#1d4ed8"},
  partially_received:{bg:"#f5f3ff",c:"#7c3aed"},
  received:{bg:"#f0fdf4",c:"#16a34a"},
  closed:{bg:"#f3f4f6",c:"#374151"},
  cancelled:{bg:"#fef2f2",c:"#dc2626"},
};

// ─── Document numbering (Firestore atomic counters, same pattern as WO#) ───────
async function nextNumber(counterKey,prefix,plant){
  const fy=getFY();
  const ref=doc(db,"counters",`${counterKey}-${plant}-${fy}`);
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const next=(snap.exists()?snap.data().last:0)+1;
    tx.set(ref,{last:next});
    return `${prefix}/${plantCode(plant)}/${fy}/${String(next).padStart(3,"0")}`;
  });
}
export function generatePONumber(plant){return nextNumber("PO","PO",plant);}
export function generateGRNNumber(plant){return nextNumber("GRN","GRN",plant);}
// Own counter ("PR"), so PR numbering never collides with or borrows from the
// PO sequence — mirrors the exact same plant/FY-scoped pattern as generatePONumber.
export function generatePRNumber(plant){return nextNumber("PR","PR",plant);}

// Vendor codes are plant-agnostic (shared vendor master) — single global counter.
export async function generateVendorCode(){
  const ref=doc(db,"counters","VENDOR");
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    const next=(snap.exists()?snap.data().last:0)+1;
    tx.set(ref,{last:next});
    return `V${String(next).padStart(3,"0")}`;
  });
}

// ─── Purchase Requisition (PR) ──────────────────────────────────────────────
// PR sits upstream of PO: a store/dept raises a requisition (optionally with
// a preferred vendor already in mind, matching how PRs are actually raised
// here), it goes through one approval step, and once approved a PO is
// generated automatically — pre-filled but left in "draft" so the buyer can
// still review/adjust rates before it goes through the PO's own approval.
export const REQUISITION_TYPES = ["Internal","Import"];

export const PR_STATUSES = ["draft","pending_approval","approved","rejected","cancelled"];
export const PR_STATUS_LABELS = {
  draft:"Draft", pending_approval:"Pending Approval", approved:"Approved",
  rejected:"Rejected", cancelled:"Cancelled",
};
export const PR_STATUS_COLORS = {
  draft:{bg:"#f3f4f6",c:"#6b7280"},
  pending_approval:{bg:"#fffbeb",c:"#b45309"},
  approved:{bg:"#f0fdf4",c:"#16a34a"},
  rejected:{bg:"#fef2f2",c:"#dc2626"},
  cancelled:{bg:"#fef2f2",c:"#dc2626"},
};

export function emptyPRLineItem(){
  return {item_code:"",material_id:"",material_name:"",inventory_qty:0,qty:"",unit:"kg",required_date:"",last_po_rate:null,remarks:""};
}

// Looks up the most recent rate this item was purchased at (from already-
// loaded PO data — no extra Firestore read), matching the "Last PO Rate"
// column on the reference requisition form. Matches by material_id when the
// line came from the catalog, otherwise falls back to matching by name for
// free-text items. Returns null if the item has never appeared on a PO.
export function lastPORateForMaterial(purchaseOrders,materialId,materialName){
  const matches=(purchaseOrders||[]).filter(po=>
    (po.line_items||[]).some(it=>materialId?it.material_id===materialId:it.material_name===materialName)
  );
  if(matches.length===0)return null;
  const sorted=[...matches].sort((a,b)=>{
    const at=a.created_at?.seconds||0, bt=b.created_at?.seconds||0;
    return bt-at;
  });
  const line=(sorted[0].line_items||[]).find(it=>materialId?it.material_id===materialId:it.material_name===materialName);
  return line?.rate??null;
}

// ─── Line item helpers ──────────────────────────────────────────────────────
export function lineAmount(item){
  const qty=parseFloat(item.qty)||0, rate=parseFloat(item.rate)||0;
  return Math.round(qty*rate*100)/100;
}
export function poSubtotal(lineItems){
  return (lineItems||[]).reduce((sum,it)=>sum+lineAmount(it),0);
}
// Returns {subtotal, gstTreatment, gstRate, gstAmount, cgst, sgst, igst, grandTotal}
export function poTotals(plant,vendorStateCode,lineItems,gstRate=DEFAULT_GST_RATE){
  const subtotal=poSubtotal(lineItems);
  const treatment=gstTreatment(plant,vendorStateCode);
  const gstAmount=Math.round(subtotal*(gstRate/100)*100)/100;
  const cgst=treatment==="CGST_SGST"?Math.round(gstAmount/2*100)/100:0;
  const sgst=cgst;
  const igst=treatment==="IGST"?gstAmount:0;
  return {subtotal,treatment,gstRate,gstAmount,cgst,sgst,igst,grandTotal:Math.round((subtotal+gstAmount)*100)/100};
}
export function poReceivedStatus(lineItems){
  const items=lineItems||[];
  if(items.length===0)return"approved";
  const allDone=items.every(it=>(it.received_qty||0)>=(parseFloat(it.qty)||0));
  const anyReceived=items.some(it=>(it.received_qty||0)>0);
  if(allDone)return"received";
  if(anyReceived)return"partially_received";
  return"approved";
}
// Derived, not stored — each line item carries its own Required Date, so the
// "delivery date" shown on a PO is always the soonest of those, computed on
// the fly. This avoids a separate PO-level date field that could drift out
// of sync with the line items.
export function earliestRequiredDate(lineItems){
  const dates=(lineItems||[]).map(it=>it.required_date).filter(Boolean).sort();
  return dates[0]||null;
}
export function emptyLineItem(){
  return {part_code:"",material_id:"",material_name:"",hsn_code:"",qty:"",unit:"kg",rate:"",required_date:"",received_qty:0};
}

// ─── Standard Terms & Conditions (printed on every PO) ─────────────────────
// Edit this list to change what prints on every PO going forward — it's not
// stored per-document, so existing POs pick up wording changes automatically.
export const STANDARD_TERMS = [
  "All goods supplied against this order will be subject to inspection and verification.",
  "Inspection / Test certificates are to be supplied along with supplies by incorporating our PO no and date.",
  "Our Purchase Order Number must appear on all documents & correspondence related to this supply.",
  "ETHICAL CONDUCT: Follow the Company rules. Respect each other. Attached Ethical principles procedure no. EHSP 23 Rev.00 dated 05.12.2022.",
  "MSDS to be provided for the chemicals/hazardous material delivered.",
  "Supplier should follow all the environmental and safety instruction provided during Supplier's visit to factory.",
  "If any hazardous / e-waste are taken back by Supplier's personnel they have to be disposed to the authorized dealers only.",
  "All the vendors of our company who are supplying the material to us have to follow the prescribed guidelines which is attached herewith for your reference and necessary records. Hence forth you are requested to make sure your vehicles, contractor and driver who comes for deliver the material should follow strictly all the listed guideline.",
  "Attached our EHS policy copy.",
];

// ─── Number to words (Indian numbering system) ──────────────────────────────
// "Rupee Four Lakh Eighty One Thousand Four Hundred Forty And Zero" style,
// matching the exact phrasing used on your existing PO letterhead.
const ONES=["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
const TENS=["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
function twoDigits(n){
  if(n<20)return ONES[n];
  return TENS[Math.floor(n/10)]+(n%10?" "+ONES[n%10]:"");
}
function threeDigits(n){
  if(n<100)return twoDigits(n);
  return ONES[Math.floor(n/100)]+" Hundred"+(n%100?" "+twoDigits(n%100):"");
}
export function numberToWordsIndian(num){
  num=Math.floor(Math.abs(num||0));
  if(num===0)return"Zero";
  const crore=Math.floor(num/10000000);num%=10000000;
  const lakh=Math.floor(num/100000);num%=100000;
  const thousand=Math.floor(num/1000);num%=1000;
  const rest=num;
  let parts=[];
  if(crore)parts.push(threeDigits(crore)+" Crore");
  if(lakh)parts.push(threeDigits(lakh)+" Lakh");
  if(thousand)parts.push(threeDigits(thousand)+" Thousand");
  if(rest)parts.push(threeDigits(rest));
  return parts.join(" ");
}
export function amountInWords(amount){
  const rupees=Math.floor(amount||0);
  const paise=Math.round(((amount||0)-rupees)*100);
  const rupeeWords=numberToWordsIndian(rupees);
  return paise>0
    ?`Rupee ${rupeeWords} And Paise ${numberToWordsIndian(paise)}`
    :`Rupee ${rupeeWords} And Zero`;
}
