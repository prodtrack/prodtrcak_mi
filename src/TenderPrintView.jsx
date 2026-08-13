// ─── TenderPrintView.jsx ────────────────────────────────────────────────────
// Renders a Tender as standalone, self-contained HTML — same approach as
// EnquiryPrintView.jsx / WOPrintView.jsx / POPrintView.jsx: opens in a new
// window with its own inline CSS so the print layout is never affected by
// the app's screen styles.
//
// Letterhead header (logo, address, phone/email/website, GSTIN/PAN) is
// identical to the other print views. Tender is single-item (not a
// repeatable items array like Enquiry), so the body is one numbered block
// covering the tender's own fields — Tender Date, LOI No., Specification
// No., Company, Size, Covering, Insulation Type, Quantity, Fabrication
// Rate, BME/Copper Price, Bid Due Date.

import { COMPANY_INFO } from "./purchase/purchaseHelpers";
import { COMPANY_LOGO_DATA_URI } from "./purchase/companyLogo.js";

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fmtDate(d){
  if(!d)return"-";
  const dt=new Date(d);
  if(isNaN(dt))return"-";
  return dt.toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"}).replace(/\//g,"-");
}
function itemSizeLabel(t){
  if(!t)return"";
  if(t.conductor_type==="wire")return t.diameter?`Ø ${t.diameter} mm`:"";
  if(!t.width&&!t.thickness)return"";
  return `${t.width||"-"} × ${t.thickness||"-"} mm${t.corner_radius?`, CR ${t.corner_radius}`:""}`;
}

export function printTender(tender){
  const company=COMPANY_INFO.Bidadi||{};
  const size=itemSizeLabel(tender)||tender.size;

  const rows=[
    ["Tender Date",tender.tender_date?fmtDate(tender.tender_date):null],
    ["LOI No.",tender.loi_no],
    ["Specification No.",tender.specification_number],
    ["Company",tender.company],
    ["Size",size],
    ...(tender.conductor_type==="ctc"
      ?[["Covering 1",tender.covering_1?`${tender.covering_1}mm`:null],["Covering 2",tender.covering_2?`${tender.covering_2}mm`:null]]
      :[["Covering",tender.covering?`${tender.covering}mm`:null]]),
    ["Insulation Type",tender.insulation_type],
    ["Quantity",tender.quantity!=null&&tender.quantity!==""?`${tender.quantity}${tender.uom?` ${tender.uom}`:""}`:null],
    ["Fabrication Rate",tender.fabrication_rate?`₹ ${tender.fabrication_rate}${tender.uom?` / ${esc(tender.uom==="kg"?"Kgs":tender.uom)}`:""}`:null],
    ["BME/Copper Price",tender.bme_copper_price?`₹ ${tender.bme_copper_price}${tender.uom?` / ${esc(tender.uom==="kg"?"Kgs":tender.uom)}`:""}`:null],
    ["Bid Due Date",tender.due_date?fmtDate(tender.due_date):null],
  ].filter(([,v])=>v);

  const listRows=rows.map(([k,v],idx)=>`<div class="offer-row"><span class="offer-no">${idx+1}.</span><span class="offer-label">${esc(k)}:</span><span>${esc(v)}</span></div>`);
  const listHtml=listRows.join("");

  const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(tender.tender_number||"Tender")}</title>
<style>
  @page { size: A4; margin: 10mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0;padding:0;}
  .sheet{width:94%;margin:40px auto 0;border:1.5px solid #000;}
  .header{padding:8px 12px 6px;text-align:center;border-bottom:1px solid #000;}
  .logo{max-width:210px;max-height:52px;margin:0 auto;display:block;}
  .addr{font-size:11px;margin-top:6px;}
  .contact-row{display:flex;justify-content:space-between;padding:4px 12px;border-bottom:1px solid #000;font-size:10.5px;}
  .tender-no-line{padding:8px 16px 0;font-size:12px;font-weight:600;}
  .item-block{padding:12px 16px;}
  .offer-row{display:flex;gap:8px;padding:2px 0;font-size:12px;}
  .offer-no{width:20px;flex-shrink:0;color:#555;}
  .offer-label{width:120px;flex-shrink:0;font-weight:600;}
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
    <span>Phone : ${esc(company.phone)}</span>
    <span>Email : ${esc(company.email)}</span>
    <span>Website : ${esc(company.website)}</span>
  </div>
  <div class="contact-row" style="border-bottom:1px solid #000;">
    <span>GSTIN : ${esc(company.gstin)}</span>
    <span>PAN : ${esc(company.pan)}</span>
    <span></span>
  </div>

  <div class="tender-no-line">Tender No : ${esc(tender.tender_number||"-")}</div>

  <div class="item-block">
    ${listHtml}
  </div>

</div>
</body>
</html>`;

  const win=window.open("","_blank","width=900,height=1000");
  if(!win){
    alert("Please allow pop-ups for this site to print the Tender.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
