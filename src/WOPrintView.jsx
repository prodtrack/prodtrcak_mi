// ─── WOPrintView.jsx ────────────────────────────────────────────────────────
// Renders a Work Order as standalone, self-contained HTML — same approach as
// POPrintView.jsx / PRPrintView.jsx in /purchase: opens in a new window with
// its own inline CSS so the print layout is never affected by the app's
// screen styles. Change the WO letterhead layout ONLY here.

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

export function printWorkOrder(order){
  const company=COMPANY_INFO.Bidadi||{};
  const dims=order.conductor_type==="conductor"
    ? `${order.dimensions?.width||"-"} × ${order.dimensions?.thickness||"-"} mm (Rect. strip)`
    : `Ø ${order.dimensions?.diameter||"-"} mm (Round wire)`;
  const specNo=(order.insulation||[]).map(ins=>ins.spec).filter(Boolean).join(", ")||"-";
  const poDate=order.po_date||order.receipt_date;

  const insRows=(order.insulation||[]).map((ins,i)=>`
    <tr>
      <td class="c">${i+1}</td>
      <td>${esc(ins.scheme||"-")}</td>
      <td>${esc(ins.thermal||"-")}</td>
      <td class="c">${esc(ins.tempIndex||"-")}</td>
      <td class="c">${ins.covering?Number(ins.covering).toFixed(3):"-"}</td>
      <td>${esc(ins.spec||"-")}</td>
    </tr>`).join("")||`<tr><td colspan="6" class="c">No insulation layers specified</td></tr>`;

  const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(order.wo_number)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0;padding:0;}
  .sheet{width:94%;margin:40px auto 0;border:1.5px solid #000;}
  .c{text-align:center;}
  .r{text-align:right;}
  table{width:100%;border-collapse:collapse;}
  td,th{padding:3px 6px;vertical-align:top;}
  .header{padding:8px 12px 6px;text-align:center;border-bottom:1px solid #000;}
  .logo{max-width:210px;max-height:52px;margin:0 auto;display:block;}
  .addr{font-size:11px;margin-top:6px;}
  .contact-row{display:flex;justify-content:space-between;padding:4px 12px;border-bottom:1px solid #000;font-size:10.5px;}
  .title{text-align:center;font-size:15px;font-weight:700;padding:6px 0;border-bottom:1px solid #000;}
  .wonum-row{display:flex;justify-content:space-between;padding:4px 12px;border-bottom:1px solid #000;font-size:11px;}
  .wonum-row b{font-weight:700;}
  .section-head{background:#dcdcdc;font-weight:700;padding:3px 8px;border-bottom:1px solid #000;font-size:11px;}
  .grid{display:flex;flex-wrap:wrap;border-bottom:1px solid #000;}
  .grid>div{width:50%;padding:6px 8px;font-size:11px;line-height:1.45;border-right:1px solid #000;}
  .grid>div:nth-child(2n){border-right:none;}
  .grid .k{color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.03em;}
  .grid .v{font-weight:600;}
  .ins-table th{background:#dcdcdc;border-bottom:1px solid #000;border-top:1px solid #000;font-size:10px;text-transform:uppercase;}
  .ins-table th,.ins-table td{border-left:1px solid #000;border-bottom:1px solid #000;font-size:11px;}
  .ins-table th:first-child,.ins-table td:first-child{border-left:none;}
  .remarks-row{border-top:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;font-size:11px;min-height:36px;white-space:pre-line;}
  .sign-row{display:flex;}
  .sign-row>div{flex:1;padding:18px 8px 6px;text-align:center;font-size:11px;border-right:1px solid #000;}
  .sign-row>div:last-child{border-right:none;}
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
    <span>Email : marketing@mahendraindustries.in</span>
    <span>Website : ${esc(company.website)}</span>
  </div>

  <div class="title">Work Order</div>

  <div class="wonum-row">
    <span>WO No : <b>${esc(order.wo_number)}</b></span>
    <span>PO No : <b>${esc(order.po_number||"-")}</b></span>
  </div>
  <div class="wonum-row" style="border-bottom:1px solid #000;">
    <span>PO Date : ${fmtDate(poDate)}</span>
    <span>Delivery Date : ${fmtDate(order.delivery_date)}</span>
  </div>

  <div class="section-head">Order Details</div>
  <div class="grid">
    <div><div class="k">Customer</div><div class="v">${esc(order.customer_name||"-")}</div></div>
    <div><div class="k">Material</div><div class="v">${esc(order.material||"-")}</div></div>
    <div><div class="k">Dimensions</div><div class="v">${dims}</div></div>
    <div><div class="k">Specification No.</div><div class="v">${esc(specNo)}</div></div>
    <div><div class="k">Quantity</div><div class="v">${order.quantity??"-"} ${esc(order.quantity_unit||"")}</div></div>
    <div><div class="k">Packing Qty</div><div class="v">${order.packing_qty??"-"} ${esc(order.quantity_unit||"")}</div></div>
    <div><div class="k">Spool Type</div><div class="v">${esc(order.spool_type||"-")}</div></div>
    <div><div class="k">Product Type</div><div class="v">${esc(order.product_type||"-")}</div></div>
  </div>

  <div class="section-head">Insulation Layers</div>
  <table class="ins-table">
    <thead>
      <tr>
        <th style="width:28px;">#</th>
        <th>Scheme</th>
        <th>Thermal Class</th>
        <th style="width:70px;">Temp Index</th>
        <th style="width:80px;">Covering (mm)</th>
        <th>Specification Ref.</th>
      </tr>
    </thead>
    <tbody>${insRows}</tbody>
  </table>

  <div class="remarks-row"><b>Remarks:</b><br/>${esc(order.remarks||"")}</div>

  <div class="sign-row">
    <div><br/><br/><br/>Prepared By</div>
    <div><br/><br/><br/>Production In-charge</div>
    <div><br/><br/><br/>Authorised Signatory</div>
  </div>

</div>
</body>
</html>`;

  const win=window.open("","_blank","width=900,height=1000");
  if(!win){
    alert("Please allow pop-ups for this site to print the Work Order.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
