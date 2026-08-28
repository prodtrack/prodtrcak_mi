// ─── PRPrintView.jsx ────────────────────────────────────────────────────────
// Renders a Purchase Requisition as standalone, self-contained HTML — same
// approach as POPrintView.jsx (new window, inline CSS, print-only render).
// Letterhead/logo/GSTIN block and CSS classes are deliberately copied from
// POPrintView.jsx so both documents look like they belong to the same
// company stationery — change the shared look in both places if it changes.
// Deliberately simple/self-contained layout: two-column header block, one
// item table, Remarks/Comments footer. No Vendor/Supplier Details block, no
// Terms & Conditions, no signature row — those belong to POPrintView.jsx.

import { COMPANY_INFO } from "./purchaseHelpers";
import { COMPANY_LOGO_DATA_URI } from "./companyLogo.js";

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

export function printPurchaseRequisition(pr){
  const company=COMPANY_INFO[pr.plant]||{};
  const items=pr.line_items||[];

  const rows=items.map((it,i)=>{
    const desc=(it.item_description||"").trim();
    const name=(it.material_name||"").trim();
    const isDuplicateDesc=desc&&name&&desc.toLowerCase()===name.toLowerCase();
    return `
    <tr>
      <td class="c">${i+1}</td>
      <td>${esc(it.item_code||"")}</td>
      <td>
        <div>${esc(it.material_name)}</div>
        ${(desc&&!isDuplicateDesc)?`<div class="itemsub">${esc(tightLines(it.item_description))}</div>`:""}
      </td>
      <td class="r">${Number(it.inventory_qty||0).toFixed(3)}</td>
      <td class="r">${Number(it.qty||0).toFixed(3)}</td>
      <td class="c">${esc((it.unit||"").toUpperCase())}</td>
      <td class="c">${fmtDate(it.required_date)}</td>
      <td class="r">${it.last_po_rate!=null?Number(it.last_po_rate).toFixed(2):""}</td>
      <td style="white-space:pre-line;">${esc(tightLines(it.remarks))}</td>
    </tr>`;
  }).join("");

  const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(pr.pr_number)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0;padding:0;}
  .sheet{width:94%;margin:40px auto 0;border:1.5px solid #000;}
  .r{text-align:right;}
  .c{text-align:center;}
  table{width:100%;border-collapse:collapse;}
  td,th{padding:3px 6px;vertical-align:top;overflow-wrap:break-word;word-wrap:break-word;}
  .header{padding:8px 12px 6px;text-align:center;border-bottom:1px solid #000;}
  .logo{max-width:210px;max-height:52px;margin:0 auto;display:block;}
  .addr{font-size:11px;margin-top:6px;}
  .contact-row{display:flex;justify-content:space-between;padding:4px 12px;border-bottom:1px solid #000;font-size:10.5px;}
  .title{text-align:center;font-size:15px;font-weight:700;padding:6px 0;border-bottom:1px solid #000;}
  .two-col{display:flex;border-bottom:1px solid #000;}
  .two-col>div{flex:1;padding:6px 8px;font-size:11px;line-height:1.45;}
  .two-col>div:first-child{border-right:1px solid #000;}
  .two-col b{font-weight:700;}
  .items-table{table-layout:fixed;}
  .items-table th{background:#dcdcdc;border-bottom:1px solid #000;border-top:1px solid #000;font-size:10px;text-transform:uppercase;}
  .items-table td{border-bottom:1px solid #000;font-size:11px;}
  .items-table .itemsub{font-size:9.5px;color:#4b5563;margin-top:1px;white-space:pre-line;}
  .items-table th,.items-table td{border-left:1px solid #000;}
  .items-table th:first-child,.items-table td:first-child{border-left:none;}
  .items-table thead{display:table-header-group;}
  .items-table tr{break-inside:avoid;page-break-inside:avoid;}
  .remarks-row{border-top:1px solid #000;min-height:28px;padding:4px 8px;font-size:11px;break-inside:avoid;page-break-inside:avoid;}
  .remarks-row:last-child{border-bottom:1px solid #000;}
  .remarks-row b{font-weight:700;}
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

  <div class="title">Purchase Requisition</div>

  <div class="two-col">
    <div>
      <div>Requisition No: <b>${esc(pr.pr_number)}</b></div>
      <div>Site: <b>${esc(company.name||pr.plant)}</b></div>
      <div>Requisition Type: <b>${esc(pr.requisition_type||"")}</b></div>
      ${pr.requisition_type==="Import"?`<div>Inco Terms: <b>${esc(pr.inco_terms||"-")}</b></div>`:""}
      ${pr.requisition_type==="Import"?`<div>Currency: <b>${esc(pr.currency||"INR")}</b></div>`:""}
      <div>Requested By Code: <b>${esc(pr.requested_by_code||"—")}</b></div>
    </div>
    <div>
      <div>Date: <b>${fmtDate(pr.created_at?.toDate?pr.created_at.toDate():pr.created_at)}</b></div>
      <div>Vendor Code: <b>${esc(pr.vendor_code||"—")}</b></div>
      <div>Vendor Name: <b>${esc(pr.vendor_name||"—")}</b></div>
      <div>Job Order: <b>${esc(pr.job_order||"—")}</b></div>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th style="width:4%;">Sr.<br/>No</th>
        <th style="width:9%;">Item Code</th>
        <th style="width:20%;">Item Description</th>
        <th style="width:8%;">Inventory<br/>Qty</th>
        <th style="width:8%;">Required<br/>Qty</th>
        <th style="width:5%;">UOM</th>
        <th style="width:8%;">Required<br/>Date</th>
        <th style="width:7%;">Last PO<br/>Rate</th>
        <th style="width:31%;">Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${rows||`<tr><td colspan="9" class="c" style="padding:16px;color:#999;">No items</td></tr>`}
    </tbody>
  </table>

  <div class="remarks-row"><b>Remarks:</b><br/>${esc(tightLines(pr.remarks))}</div>
  <div class="remarks-row"><b>Comments:</b><br/>${esc(tightLines(pr.comments))}</div>

</div>
</body>
</html>`;

  const win=window.open("","_blank","width=900,height=1000");
  if(!win){
    alert("Please allow pop-ups for this site to print the PR.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
