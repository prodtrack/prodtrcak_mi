// ─── POPrintView.jsx ─────────────────────────────────────────────────────────
// Renders a Purchase Order as standalone, self-contained HTML — deliberately
// NOT a React component mounted in the app tree. It opens in a new window
// with its own inline CSS so the print layout can never be affected by (or
// bleed into) the app's screen styles, and prints/saves-as-PDF exactly as
// designed regardless of what else is happening in the app.
//
// Change the letterhead layout ONLY here — nothing else in the app renders
// a PO for print.

import { COMPANY_INFO, poTotals, lineAmount, amountInWords, STANDARD_TERMS } from "./purchaseHelpers";
import { COMPANY_LOGO_DATA_URI } from "./companyLogo.js";

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fmtDate(d){
  if(!d)return"-";
  const dt=new Date(d);
  if(isNaN(dt))return"-";
  return dt.toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"}).replace(/\//g,"-");
}

export function printPurchaseOrder(po){
  const company=COMPANY_INFO[po.plant]||{};
  const totals=poTotals(po.plant,po.vendor_state_code,po.line_items,po.gst_rate??0);
  const items=po.line_items||[];

  const rows=items.map((it,i)=>{
    const desc=(it.item_description||"").trim();
    const name=(it.material_name||"").trim();
    const isDuplicateDesc=desc&&name&&desc.toLowerCase()===name.toLowerCase();
    return `
    <tr>
      <td class="c">${i+1}</td>
      <td>
        <div class="partcode">${esc(it.part_code||"")}</div>
        <div>${esc(it.material_name)}</div>
        ${(desc&&!isDuplicateDesc)?`<div class="itemsub">${esc(it.item_description)}</div>`:""}
        ${it.item_remarks?`<div class="itemsub">${esc(it.item_remarks)}</div>`:""}
      </td>
      <td class="c">${esc(it.hsn_code||"")}</td>
      <td class="c">${fmtDate(it.required_date)}</td>
      <td class="r">${Number(it.qty).toFixed(2)}</td>
      <td class="c">${esc((it.unit||"").toUpperCase())}</td>
      <td class="r">${Number(it.rate).toFixed(2)}</td>
      <td class="r">${lineAmount(it).toFixed(2)}</td>
    </tr>`;
  }).join("");

  const gstRows=totals.treatment==="IGST"
    ? `<tr><td colspan="7" class="r label">Purchase IGST-${totals.gstRate}%</td><td class="r">${totals.igst.toFixed(2)}</td></tr>`
    : `<tr><td colspan="7" class="r label">Purchase SGST-${totals.gstRate/2}%</td><td class="r">${totals.sgst.toFixed(2)}</td></tr>
       <tr><td colspan="7" class="r label">Purchase CGST-${totals.gstRate/2}%</td><td class="r">${totals.cgst.toFixed(2)}</td></tr>`;

  const termsHtml=STANDARD_TERMS.map((t,i)=>`<tr><td class="c tno">${i+1}</td><td>${esc(t)}</td></tr>`).join("");

  const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(po.po_number)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0;padding:0;}
  .sheet{width:94%;margin:40px auto 0;border:1.5px solid #000;}
  .center{text-align:center;}
  .r{text-align:right;}
  .c{text-align:center;}
  table{width:100%;border-collapse:collapse;}
  td,th{padding:3px 6px;vertical-align:top;}
  .header{padding:8px 12px 6px;text-align:center;border-bottom:1px solid #000;}
  .logo{max-width:210px;max-height:52px;margin:0 auto;display:block;}
  .addr{font-size:11px;margin-top:6px;}
  .contact-row{display:flex;justify-content:space-between;padding:4px 12px;border-bottom:1px solid #000;font-size:10.5px;}
  .title{text-align:center;font-size:15px;font-weight:700;padding:6px 0;border-bottom:1px solid #000;}
  .ponum-row{display:flex;justify-content:space-between;padding:4px 12px;border-bottom:1px solid #000;font-size:11px;}
  .ponum-row b{font-weight:700;}
  .section-head{background:#dcdcdc;font-weight:700;padding:3px 8px;border-bottom:1px solid #000;font-size:11px;}
  .two-col{display:flex;border-bottom:1px solid #000;}
  .two-col>div{flex:1;padding:6px 8px;font-size:11px;line-height:1.4;}
  .two-col>div:first-child{border-right:1px solid #000;}
  .two-col .vname{font-weight:700;}
  .terms-strip{border-bottom:1px solid #000;padding:4px 8px;font-size:10.5px;line-height:1.45;}
  .items-table th{background:#dcdcdc;border-bottom:1px solid #000;border-top:1px solid #000;font-size:10px;text-transform:uppercase;}
  .items-table td{border-bottom:1px solid #000;font-size:11px;}
  .items-table .partcode{font-weight:700;font-size:10.5px;}
  .items-table .itemsub{font-size:9.5px;color:#4b5563;margin-top:1px;white-space:pre-line;}
  .items-table th,.items-table td{border-left:1px solid #000;}
  .items-table th:first-child,.items-table td:first-child{border-left:none;}
  .items-table thead{display:table-header-group;}
  .items-table tr{break-inside:avoid;page-break-inside:avoid;}
  .label{font-weight:600;}
  .totalrow td{border-top:1px solid #000;font-weight:700;background:#f5f5f5;}
  .words-row{border-top:1px solid #000;border-bottom:1px solid #000;padding:4px 8px;font-size:11px;}
  .words-row b{font-weight:700;}
  .tc-head{font-weight:700;padding:4px 8px;border-bottom:1px solid #000;font-size:11px;}
  .tc-table td{font-size:10px;border:none;padding:1px 8px;line-height:1.4;}
  .tc-table .tno{width:20px;vertical-align:top;}
  .remarks-row{display:flex;border-top:1px solid #000;border-bottom:1px solid #000;min-height:40px;}
  .remarks-row>div{flex:1;padding:4px 8px;font-size:11px;}
  .remarks-row>div:first-child{border-right:1px solid #000;}
  .sign-row{display:flex;}
  .sign-row>div{flex:1;padding:18px 8px 6px;text-align:center;font-size:11px;border-right:1px solid #000;}
  .sign-row>div:last-child{border-right:none;}
  .sign-row .for-company{font-weight:700;margin-bottom:26px;}
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

  <div class="title">Purchase Order</div>

  <div class="ponum-row">
    <span>PO No : <b>${esc(po.po_number)}</b></span>
    <span>PO Date : <b>${fmtDate(po.created_at?.toDate?po.created_at.toDate():po.created_at)}</b></span>
  </div>
  <div class="ponum-row" style="border-bottom:1px solid #000;">
    <span>Amd No : ${po.amd_no>0?po.amd_no:"-"}</span>
    <span>Amd Date : ${po.amd_no>0?fmtDate(po.amd_date):"-"}</span>
  </div>

  <div style="display:flex;border-bottom:1px solid #000;">
    <div style="flex:1;border-right:1px solid #000;"><div class="section-head">Vendor / Supplier Details</div></div>
    <div style="flex:1;"><div class="section-head">Ship to Address</div></div>
  </div>
  <div class="two-col">
    <div>
      <div class="vname">${esc(po.vendor_name)}</div>
      <div>${esc(po.vendor_address||"")}</div>
      <div>Vendor Code : ${esc(po.vendor_code||"-")}</div>
      <div>Phone : ${esc(po.vendor_phone||"")}</div>
      <div>Email : ${esc(po.vendor_email||"")}</div>
      <div>State Code : ${esc(po.vendor_state_code||"")}</div>
      <div>GSTIN : ${esc(po.vendor_gstin||"")}</div>
      <div>PAN No : ${esc(po.vendor_pan||"")}</div>
      <div>Your Reference : ${esc(po.your_reference||"")}</div>
    </div>
    <div>
      <div class="vname">MAHENDRA INDUSTRIES</div>
      <div>${esc(company.address)}</div>
      <div>State Code : ${esc(company.state_code)}</div>
      <div>GSTIN : ${esc(company.gstin)}</div>
    </div>
  </div>
  <div class="terms-strip">
    Payment Terms : ${esc(po.payment_terms||"-")}<br/>
    Terms of delivery : ${esc(po.terms_of_delivery||"-")}<br/>
    Mode of Delivery : ${esc(po.mode_of_delivery||"-")}
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th style="width:28px;">Sr.<br/>No.</th>
        <th>Part Code<br/>Description of Goods</th>
        <th style="width:70px;">HSN Code</th>
        <th style="width:64px;">Req. Date</th>
        <th style="width:50px;">Qty</th>
        <th style="width:44px;">UOM</th>
        <th style="width:60px;">Rate</th>
        <th style="width:80px;">Net Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="totalrow"><td colspan="7" class="r">TOTAL</td><td class="r">${totals.subtotal.toFixed(2)}</td></tr>
      ${gstRows}
      <tr class="totalrow"><td colspan="7" class="r">Total Amount (In Figure)</td><td class="r">${totals.grandTotal.toFixed(2)}</td></tr>
    </tbody>
  </table>

  <div class="words-row">Total Amount (In Words) <b>${esc(amountInWords(totals.grandTotal))}</b></div>

  <div class="tc-head">General Terms &amp; Conditions of Purchase:</div>
  <table class="tc-table"><tbody>${termsHtml}</tbody></table>

  <div class="remarks-row">
    <div><b>Remarks:</b><br/>${esc(po.remarks||"")}</div>
    <div><b>Comments:</b></div>
  </div>

  <div class="sign-row">
    <div><br/><br/><br/>Prepared By</div>
    <div><br/><br/><br/>Checked By</div>
    <div><div class="for-company">For MAHENDRA INDUSTRIES</div>Authorised Signatory</div>
  </div>

</div>
</body>
</html>`;

  const win=window.open("","_blank","width=900,height=1000");
  if(!win){
    alert("Please allow pop-ups for this site to print the PO.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
