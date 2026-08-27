// ─── GRNPrintView.jsx ───────────────────────────────────────────────────────
// Print layout for a posted GRN (goods_inward) receipt entry, matching the
// reference "Goods Receipt Note" format: same letterhead pattern as GIN/
// QGIN/PO, then a two-column header block cross-referencing GRN/GIN/QGIN/
// PO/Bill/Challan/LR numbers and dates plus vendor/site detail, then a
// detailed item table (Item Code, Description, UOM, PO/Challan/Received/
// Accepted/Rejected Qty, Remarks), then Remarks/Comments and a signature row.
// All fields are read directly off the entry — they're populated once, at
// GRN-posting time (QGINTab.jsx's approveAndPostGRN), so this print never
// needs to look up the source GIN/QGIN/PO documents itself. Entries posted
// before that field set existed will show "-" for the newer fields.

import { COMPANY_INFO } from "./purchaseHelpers";
import { COMPANY_LOGO_DATA_URI } from "./companyLogo.js";
import { formatDate } from "../shared.jsx";

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fd(d){return d?formatDate(d):"-";}

export function printGRN(entry){
  const company=COMPANY_INFO[entry.plant]||{};
  const win=window.open("","_blank","width=950,height=1000");
  if(!win){alert("Please allow pop-ups to print.");return;}

  win.document.write(`
<!DOCTYPE html>
<html>
<head>
<title>${esc(entry.grn_number||"GRN")}</title>
<meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 10mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin:0; }
  .sheet { width:94%; margin:0 auto; }
  .letterhead { position:relative; text-align:center; border:1px solid #000; border-bottom:none; padding:8px 6px 6px; }
  .letterhead .name { font-size:16px; font-weight:700; }
  .logo { max-width:210px; max-height:52px; margin:0 auto; display:block; }
  .letterhead .addr { font-size:10.5px; margin-top:3px; }
  .letterhead .page { position:absolute; top:6px; right:12px; font-size:11px; }
  .contact-row { display:flex; justify-content:space-between; border:1px solid #000; border-top:none; padding:3px 10px; font-size:10.5px; }
  .title-bar { border:1px solid #000; border-top:none; text-align:center; font-weight:700; font-size:13px; padding:4px; }
  table.header-table { width:100%; border-collapse:collapse; }
  .header-table td { border:1px solid #000; border-top:none; padding:4px 10px; vertical-align:top; font-size:11px; }
  .header-table .row { display:flex; }
  .header-table .lbl { width:120px; flex-shrink:0; color:#374151; }
  .header-table .val { flex:1; }
  .items { width:100%; border-collapse:collapse; margin-top:-1px; }
  .items th, .items td { border:1px solid #000; padding:3px 6px; font-size:10.5px; }
  .items th { background:#e5e7eb; text-transform:uppercase; letter-spacing:.02em; font-size:9.5px; }
  .r { text-align:right; } .c { text-align:center; }
  .footer-box { border:1px solid #000; border-top:none; padding:6px; min-height:60px; }
  .footer-box .label { font-size:11px; margin-bottom:3px; }
  .sign-row { display:flex; border:1px solid #000; border-top:none; margin-top:40px; }
  .sign-row div { flex:1; padding:14px 8px 6px; font-size:11px; text-align:center; }
  .sign-row div:not(:last-child) { border-right:1px solid #000; }
  .sign-row .signee { font-size:10px; color:#6b7280; margin-bottom:2px; }
  .print-btn { margin-bottom:14px; }
  @media print { .print-btn { display:none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Print</button>

  <div class="sheet">
  <div class="letterhead">
    <div class="page">Page 1 of 1</div>
    <img class="logo" src="${COMPANY_LOGO_DATA_URI}" alt="Mahendra Industries"/>
    <div class="addr">${esc(company.address||"")}</div>
    <div class="addr">Phone : ${esc(company.phone||"")}, Email : ${esc(company.email||"")}</div>
    <div class="addr">Website : ${esc(company.website||"")}</div>
  </div>
  <div class="contact-row">
    <span>GSTIN&nbsp;:&nbsp;${esc(company.gstin||"")}</span>
    <span>CIN&nbsp;:&nbsp;-</span>
    <span>PAN&nbsp;:&nbsp;${esc(company.pan||"")}</span>
  </div>
  <div class="title-bar">Goods Receipt Note</div>

  <table class="header-table">
    <tr>
      <td style="width:50%">
        <div class="row"><span class="lbl">GRN No</span><span class="val">: ${esc(entry.grn_number||"-")}</span></div>
        <div class="row"><span class="lbl">GIN No</span><span class="val">: ${esc(entry.gin_number||"-")}</span></div>
        <div class="row"><span class="lbl">QGIN No</span><span class="val">: ${esc(entry.qgin_number||"-")}</span></div>
        <div class="row"><span class="lbl">PO No</span><span class="val">: ${esc(entry.po_number||"-")}</span></div>
        <div class="row"><span class="lbl">Bill No</span><span class="val">: ${esc(entry.bill_no||"-")}</span></div>
        <div class="row"><span class="lbl">Challan/Inv No</span><span class="val">: ${esc(entry.challan_no||"-")}</span></div>
        <div class="row"><span class="lbl">LR No</span><span class="val">: ${esc(entry.lr_no||"-")}</span></div>
        <div class="row"><span class="lbl">Received By</span><span class="val">: ${esc(entry.received_by||entry.operator_name||"-")}</span></div>
        <div class="row"><span class="lbl">Vehicle No</span><span class="val">: ${esc(entry.vehicle_no||"-")}</span></div>
        <div class="row"><span class="lbl">GRN Type</span><span class="val">: ${esc(entry.gin_type||"-")}</span></div>
        <div class="row"><span class="lbl">Status</span><span class="val">: Approved</span></div>
        <div class="row"><span class="lbl">Site</span><span class="val">: ${esc(company.name||entry.plant||"-")}</span></div>
      </td>
      <td style="width:50%">
        <div class="row"><span class="lbl">GRN Date.</span><span class="val">: ${fd(entry.date_received)}</span></div>
        <div class="row"><span class="lbl">GIN Date</span><span class="val">: ${fd(entry.gin_date)}</span></div>
        <div class="row"><span class="lbl">QGIN Date</span><span class="val">: ${fd(entry.qgin_date)}</span></div>
        <div class="row"><span class="lbl">PO Date</span><span class="val">: ${fd(entry.po_date)}</span></div>
        <div class="row"><span class="lbl">Bill Date</span><span class="val">: ${fd(entry.bill_date)}</span></div>
        <div class="row"><span class="lbl">Challan Date</span><span class="val">: ${fd(entry.challan_date)}</span></div>
        <div class="row"><span class="lbl">LR Date</span><span class="val">: ${fd(entry.lr_date)}</span></div>
        <div class="row"><span class="lbl">Received By Code</span><span class="val">: ${esc(entry.received_by_code||"-")}</span></div>
        <div class="row"><span class="lbl">Vendor Code</span><span class="val">: ${esc(entry.vendor_code||"-")}</span></div>
        <div class="row"><span class="lbl">Vendor Name</span><span class="val">: ${esc(entry.supplier_name||"-")}</span></div>
        <div class="row"><span class="lbl">Vendor Address</span><span class="val">: ${esc(entry.vendor_address||"-")}</span></div>
      </td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:28px">Sr. No.</th>
        <th style="width:80px">Item Code</th>
        <th>Item Description</th>
        <th style="width:44px">UOM</th>
        <th style="width:64px">PO Qty</th>
        <th style="width:64px">Challan Qty</th>
        <th style="width:64px">Received Qty</th>
        <th style="width:64px">Accepted Qty</th>
        <th style="width:64px">Rejected Qty</th>
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="c">1</td>
        <td>${esc(entry.item_code||"-")}</td>
        <td>${esc(entry.item_description||entry.material_name||"")}</td>
        <td class="c">${esc((entry.unit||"").toUpperCase())}</td>
        <td class="r">${entry.po_qty??"-"}</td>
        <td class="r">${entry.challan_qty??"-"}</td>
        <td class="r">${entry.received_qty??"-"}</td>
        <td class="r">${entry.quantity??0}</td>
        <td class="r">${entry.rejected_qty??0}</td>
        <td>${esc(entry.remarks_line||"")}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer-box"><div class="label">Remarks :</div>${esc(entry.remarks||"")}</div>
  <div class="footer-box"><div class="label">Comments :</div>${esc(entry.comments||"")}</div>
  <div class="sign-row">
    <div><div class="signee">${esc(entry.operator_name||"")}</div>Prepared By</div>
    <div><div class="signee">&nbsp;</div>Checked By</div>
    <div style="flex:2"><b>For ${esc(company.name||"MAHENDRA INDUSTRIES")}</b><br/><br/>Authorised Signatory</div>
  </div>
  </div>

  <script>window.onload = () => window.focus();</script>
</body>
</html>`);
  win.document.close();
}
