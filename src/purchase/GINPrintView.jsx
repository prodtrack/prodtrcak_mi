// ─── GINPrintView.jsx ───────────────────────────────────────────────────────
// Print layout for a GIN/GRN record, matching the reference "Goods Receipt
// Note" format exactly: company letterhead, then a two-column header block
// (GRN/GIN/QGIN/PO/Bill/Challan/LR numbers and dates, Received By, Vehicle,
// GRN Type, Status, Site on the left; the matching dates plus Vendor Code/
// Name/Address on the right), then the item table (Sr.No/Item Code/
// Description/UOM/PO Qty/Challan Qty/Received Qty/Accepted Qty/Rejected
// Qty/Remarks), then Remarks/Comments and a signature row.
// GIN and GRN are the same record now — both numbers exist from creation,
// so this print never needs a separate "GIN" vs "GRN" version. QGIN No./
// Date are per line item (qgin_number/qgin_date, stamped when GIN approval
// sends that line to QC) — shown as one value in the header when every
// line shares the same QGIN, or joined with a comma when they differ.
// PO Qty and PO Date are resolved by the caller (GRNTab.jsx) before this
// function is invoked, since they require looking up the linked PO — this
// file only ever reads off the record it's handed, no external lookups.

import { COMPANY_INFO } from "./purchaseHelpers";
import { COMPANY_LOGO_DATA_URI } from "./companyLogo.js";
import { formatDate } from "../shared.jsx";

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
function fd(d){return d?formatDate(d):"-";}
function fmtQty(v){
  const n=parseFloat(v);
  return isNaN(n)?"":n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function joinUnique(values){
  const uniq=[...new Set(values.filter(Boolean))];
  return uniq.length?uniq.join(", "):null;
}

export function printGoodsInwardNote(gin){
  const company=COMPANY_INFO[gin.plant]||{};
  const win=window.open("","_blank","width=950,height=1000");
  if(!win){alert("Please allow pop-ups to print.");return;}

  const lines=gin.line_items||[];
  const qginNo=joinUnique(lines.map(it=>it.qgin_number));
  const qginDate=joinUnique(lines.map(it=>it.qgin_date));
  const statusLabel=({draft:"Draft",pending_approval:"Pending Approval",approved:"Approved",completed:"Completed",rejected:"Rejected",cancelled:"Cancelled"})[gin.status]||gin.status||"-";

  const rows=lines.map((it,i)=>`
    <tr>
      <td class="c">${i+1}</td>
      <td>${esc(it.item_code||"-")}</td>
      <td>${esc(it.item_description||it.material_name||"")}</td>
      <td class="c">${esc((it.unit||"").toUpperCase())}</td>
      <td class="r">${fmtQty(it.po_qty)||"-"}</td>
      <td class="r">${fmtQty(it.challan_qty)}</td>
      <td class="r">${fmtQty(it.actual_challan_qty)}</td>
      <td class="r">${fmtQty(it.accepted_qty)}</td>
      <td class="r">${fmtQty(it.rejected_qty)}</td>
      <td style="white-space:pre-line;">${esc(tightLines(it.remarks))}</td>
    </tr>`).join("");

  win.document.write(`
<!DOCTYPE html>
<html>
<head>
<title>${esc(gin.grn_number||gin.gin_number||"GRN")}</title>
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
  .items { width:100%; border-collapse:collapse; margin-top:-1px; table-layout:fixed; }
  .items th, .items td { border:1px solid #000; padding:3px 6px; font-size:10.5px; overflow-wrap:break-word; word-wrap:break-word; }
  .items th { background:#e5e7eb; text-transform:uppercase; letter-spacing:.02em; font-size:9.5px; }
  .r { text-align:right; } .c { text-align:center; }
  .footer-box { border:1px solid #000; border-top:none; padding:6px; min-height:60px; white-space:pre-line; break-inside:avoid; page-break-inside:avoid; }
  .footer-box .label { font-size:11px; margin-bottom:3px; }
  .sign-row { display:flex; border:1px solid #000; border-top:none; break-inside:avoid; page-break-inside:avoid; }
  .sign-row div { flex:1; padding:14px 8px 6px; font-size:11px; text-align:center; }
  .sign-row div:not(:last-child) { border-right:1px solid #000; }
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
        <div class="row"><span class="lbl">GRN No</span><span class="val">: ${esc(gin.grn_number||"-")}</span></div>
        <div class="row"><span class="lbl">GIN No</span><span class="val">: ${esc(gin.gin_number||"-")}</span></div>
        <div class="row"><span class="lbl">QGIN No</span><span class="val">: ${esc(qginNo||"-")}</span></div>
        <div class="row"><span class="lbl">PO No</span><span class="val">: ${esc(gin.po_number||"-")}</span></div>
        <div class="row"><span class="lbl">Bill No</span><span class="val">: ${esc(gin.bill_no||"-")}</span></div>
        <div class="row"><span class="lbl">Challan/Inv No</span><span class="val">: ${esc(gin.challan_no||"-")}</span></div>
        <div class="row"><span class="lbl">LR No</span><span class="val">: ${esc(gin.lr_no||"-")}</span></div>
        <div class="row"><span class="lbl">Received By</span><span class="val">: ${esc(gin.received_by||"-")}</span></div>
        <div class="row"><span class="lbl">Vehicle No</span><span class="val">: ${esc(gin.vehicle_no||"-")}</span></div>
        <div class="row"><span class="lbl">GRN Type</span><span class="val">: ${esc(gin.gin_type||"-")}</span></div>
        <div class="row"><span class="lbl">Status</span><span class="val">: ${esc(statusLabel)}</span></div>
        <div class="row"><span class="lbl">Site</span><span class="val">: ${esc(company.name||gin.plant||"-")}</span></div>
      </td>
      <td style="width:50%">
        <div class="row"><span class="lbl">GRN Date.</span><span class="val">: ${fd(gin.created_at?.toDate?gin.created_at.toDate():gin.created_at)}</span></div>
        <div class="row"><span class="lbl">GIN Date</span><span class="val">: ${fd(gin.created_at?.toDate?gin.created_at.toDate():gin.created_at)}</span></div>
        <div class="row"><span class="lbl">QGIN Date</span><span class="val">: ${qginDate?fd(qginDate):"-"}</span></div>
        <div class="row"><span class="lbl">PO Date</span><span class="val">: ${fd(gin.po_date)}</span></div>
        <div class="row"><span class="lbl">Bill Date</span><span class="val">: ${fd(gin.bill_date)}</span></div>
        <div class="row"><span class="lbl">Challan Date</span><span class="val">: ${fd(gin.challan_date)}</span></div>
        <div class="row"><span class="lbl">LR Date</span><span class="val">: ${fd(gin.lr_date)}</span></div>
        <div class="row"><span class="lbl">Received By Code</span><span class="val">: ${esc(gin.received_by_code||"-")}</span></div>
        <div class="row"><span class="lbl">Vendor Code</span><span class="val">: ${esc(gin.vendor_code||"-")}</span></div>
        <div class="row"><span class="lbl">Vendor Name</span><span class="val">: ${esc(gin.vendor_name||"-")}</span></div>
        <div class="row"><span class="lbl">Vendor Address</span><span class="val">: ${esc(gin.vendor_address||"-")}</span></div>
      </td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:4%">Sr. No.</th>
        <th style="width:9%">Item Code</th>
        <th style="width:20%">Item Description</th>
        <th style="width:5%">UOM</th>
        <th style="width:8%">PO Qty</th>
        <th style="width:8%">Challan Qty</th>
        <th style="width:8%">Received Qty</th>
        <th style="width:8%">Accepted Qty</th>
        <th style="width:8%">Rejected Qty</th>
        <th style="width:22%">Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${rows||`<tr><td colspan="10" class="c" style="padding:16px;color:#9ca3af;">No items</td></tr>`}
    </tbody>
  </table>

  <div class="footer-box"><div class="label">Remarks :</div>${esc(tightLines(gin.remarks))}</div>
  <div class="footer-box"><div class="label">Comments :</div>${esc(tightLines(gin.comments))}</div>
  <div class="sign-row">
    <div>Prepared By</div>
    <div>Checked By</div>
    <div style="flex:2"><b>For ${esc(company.name||"MAHENDRA INDUSTRIES")}</b><br/><br/>Authorised Signatory</div>
  </div>
  </div>

  <script>window.onload = () => window.focus();</script>
</body>
</html>`);
  win.document.close();
}
