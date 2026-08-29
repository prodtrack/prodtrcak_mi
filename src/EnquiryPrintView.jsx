// ─── EnquiryPrintView.jsx ───────────────────────────────────────────────────
// Renders an Enquiry/Offer as standalone, self-contained HTML — same approach
// as WOPrintView.jsx / POPrintView.jsx / PRPrintView.jsx: opens in a new
// window with its own inline CSS so the print layout is never affected by
// the app's screen styles.
//
// Letterhead header (logo, address, phone/email/website, GSTIN/PAN) is
// intentionally identical to the other print views. Body mirrors the
// reference offer-sheet format: one numbered block per item (Description,
// Size, Covering, Packing, Delivery, Payment, Tolerance, Freight, GST,
// Validity), followed by "The final price is Rs.X / UOM" — fabrication
// rate + copper price shown combined as one figure, never as two separate
// numbers.

import { COMPANY_INFO } from "./purchase/purchaseHelpers";
import { COMPANY_LOGO_DATA_URI } from "./purchase/companyLogo.js";

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
// Collapses any blank/empty lines out of a multi-line field (e.g. a
// remarks textarea saved with paragraph-separating double line breaks),
// so the print shows tight, consecutive lines with no visible gaps —
// while still keeping every genuine line break the person typed.
function tightLines(s){
  return String(s??"").split("\n").map(l=>l.trim()).filter(Boolean).join("\n");
}
function fmtDate(d){
  if(!d)return"-";
  const dt=new Date(d);
  if(isNaN(dt))return"-";
  return dt.toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"}).replace(/\//g,"-");
}
function fmtTime(t){
  if(!t)return"";
  const [h,m]=t.split(":").map(Number);
  if(isNaN(h)||isNaN(m))return"";
  const period=h>=12?"PM":"AM";
  const h12=h%12===0?12:h%12;
  return `${h12}:${String(m).padStart(2,"0")} ${period}`;
}
function finalPrice(it){
  const f=parseFloat(it.fabrication_rate),c=parseFloat(it.copper_price);
  if(isNaN(f)&&isNaN(c))return null;
  return (isNaN(f)?0:f)+(isNaN(c)?0:c);
}
function itemSizeLabel(it){
  if(!it)return"";
  if(it.conductor_type==="wire")return it.diameter?`Ø ${it.diameter} mm`:"";
  if(!it.width&&!it.thickness)return"";
  return `${it.width||"-"} × ${it.thickness||"-"} mm${it.corner_radius?`, CR ${it.corner_radius}`:""}`;
}
const CURRENCY_SYMBOLS={INR:"₹",USD:"$",EUR:"€",GBP:"£"};

export function printEnquiry(enquiry){
  const company=COMPANY_INFO.Bidadi||{};
  const validity=enquiry.validity_date?`${fmtDate(enquiry.validity_date)}${enquiry.validity_time?` ${fmtTime(enquiry.validity_time)}`:""}`:"-";
  const items=enquiry.items||[];

  const itemBlocks=items.map((it,i)=>{
    const fp=finalPrice(it);
    const rows=[
      ["Description",it.description],
      ["Size",itemSizeLabel(it)],
      ...(it.conductor_type==="ctc"
        ?[["Covering 1",it.covering_1?`${it.covering_1}mm`:null],["Covering 2",it.covering_2?`${it.covering_2}mm`:null],
          ["No. of Paper",it.no_of_paper],["No. of Conductors/Strands",it.no_of_conductors],
          ["Type of Insulation Paper",it.interleaving_paper_type],
          ["Thick. of Insulation Paper",it.interleaving_paper_thickness?`${it.interleaving_paper_thickness}mm`:null],
          ["Paper Type",it.paper_type]]
        :[["Covering",it.covering?`${it.covering}mm`:null]]),
      ["Total Quantity",it.quantity!=null&&it.quantity!==""?`${it.quantity}${it.uom?` ${esc(it.uom==="kg"?"Kgs":it.uom)}`:""}`:null],
      ["Packing",it.packing],
      ["Delivery",enquiry.delivery_terms],
      ["Payment",enquiry.payment_terms],
      ["Tolerance",enquiry.tolerance],
      ["Freight",enquiry.freight],
      ["GST",enquiry.gst],
      ["Validity",validity],
      ...(it.show_breakdown?[
        ["Fabrication Rate",it.fabrication_rate?`${CURRENCY_SYMBOLS[it.currency||"INR"]} ${it.fabrication_rate}${it.uom?` / ${esc(it.uom==="kg"?"Kgs":it.uom)}`:""}`:null],
        ["Copper Price",it.copper_price?`${CURRENCY_SYMBOLS[it.currency||"INR"]} ${it.copper_price}${it.uom?` / ${esc(it.uom==="kg"?"Kgs":it.uom)}`:""}`:null],
      ]:[]),
    ].filter(([,v])=>v);
    const listRows=rows.map(([k,v],idx)=>`<div class="offer-row"><span class="offer-no">${idx+1}.</span><span class="offer-label">${esc(k)}:</span><span>${esc(v)}</span></div>`);
    const listHtml=listRows.join("");
    return `
    <div class="item-block">
      <div class="item-no-heading">Item ${i+1}</div>
      ${listHtml}
      ${it.remarks&&it.remarks.trim()?`<div class="item-remarks"><b>Remarks:</b> ${esc(tightLines(it.remarks))}</div>`:""}
      ${fp!=null?`<div class="final-price">The final price is ${CURRENCY_SYMBOLS[it.currency||"INR"]} ${fp}${it.uom?` / ${esc(it.uom==="kg"?"Kgs":it.uom)}`:""}</div>`:""}
    </div>`;
  }).join("");

  const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(enquiry.enq_number||"Enquiry")}</title>
<style>
  @page { size: A4; margin: 10mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0;padding:0;}
  .sheet{width:94%;margin:40px auto 0;border:1.5px solid #000;}
  .header{padding:8px 12px 6px;text-align:center;border-bottom:1px solid #000;}
  .logo{max-width:210px;max-height:52px;margin:0 auto;display:block;}
  .addr{font-size:11px;margin-top:6px;}
  .contact-row{display:flex;justify-content:space-between;padding:4px 12px;border-bottom:1px solid #000;font-size:10.5px;}
  .item-block{padding:12px 16px;border-bottom:1px solid #6b7280;break-inside:avoid;page-break-inside:avoid;}
  .item-no-heading{font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;}
  .offer-row{display:flex;gap:8px;padding:2px 0;font-size:12px;}
  .offer-no{width:20px;flex-shrink:0;color:#555;}
  .offer-label{width:90px;flex-shrink:0;font-weight:600;}
  .final-price{padding:8px 0 3px 16px;font-size:13px;font-weight:700;}
  .item-remarks{padding:6px 0 0 16px;font-size:12px;white-space:pre-line;}
  .enq-no-line{padding:8px 16px 0;font-size:12px;font-weight:600;}
  .offer-intro{padding:6px 16px 3px;font-size:13px;font-weight:600;}
  @media print{
    .print-btn{display:none;}
    body{padding:0;}
  }
  .print-btn{position:fixed;top:10px;right:10px;padding:8px 16px;background:#1a1f2e;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<div class="sheet">

  <div class="header">
    <img class="logo" src="${COMPANY_LOGO_DATA_URI}" alt="Mahendra Industries"/>
    <div class="addr">${esc(company.address)}</div>
  </div>
  <div class="contact-row">
    <span>Email : marketing@mahendraindustries.in</span>
    <span>Website : ${esc(company.website)}</span>
  </div>
  <div class="contact-row" style="border-bottom:1px solid #000;">
    <span>GSTIN : ${esc(company.gstin)}</span>
    <span></span>
  </div>

  <div class="enq-no-line" style="display:flex;justify-content:space-between;">
    <span>Enquiry No : ${esc(enquiry.enq_number||"-")}</span>
    <span>Enq Date : ${fmtDate(enquiry.enq_date)}</span>
  </div>
  <div class="offer-intro">Please find our offer as follows</div>

  ${itemBlocks||`<div class="item-block">No items on this enquiry yet.</div>`}

</div>
</body>
</html>`;

  const win=window.open("","_blank","width=900,height=1000");
  if(!win){
    alert("Please allow pop-ups for this site to print the Enquiry.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
