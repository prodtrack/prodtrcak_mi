// ─── GINPrintView.jsx ───────────────────────────────────────────────────────
// Print layout matching the reference "DUPLICATE : Goods Inward Note" format:
// company letterhead, Site/GIN No/GIN Type/Received By on the left, Status/
// Date/PO No/PO Ver/Challan/Bill/Vehicle/Delivery Mode on the right, then the
// item table, then Remarks/Comments/Prepared-Approved By footer.

import { COMPANY_INFO } from "./purchaseHelpers";
import { formatDate } from "../shared.jsx";

export function printGoodsInwardNote(gin){
  const company=COMPANY_INFO[gin.plant]||{};
  const win=window.open("","_blank","width=950,height=1000");
  if(!win){alert("Please allow pop-ups to print.");return;}

  const rows=(gin.line_items||[]).map((it,i)=>`
    <tr>
      <td class="c">${i+1}</td>
      <td>${escapeHtml(it.item_code||"")}</td>
      <td>${escapeHtml(it.material_name||"")}</td>
      <td class="c">${escapeHtml(it.unit||"")}</td>
      <td class="r">${fmtQty(it.challan_qty)}</td>
      <td class="r">${fmtQty(it.accepted_qty)}</td>
      <td class="r">${fmtQty(it.rejected_qty)}</td>
      <td class="r">${fmtQty(it.actual_challan_qty)}</td>
      <td>${escapeHtml(it.remarks||"")}</td>
    </tr>`).join("");

  win.document.write(`
<!DOCTYPE html>
<html>
<head>
<title>${escapeHtml(gin.gin_number)}</title>
<meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin:0; }
  .letterhead { text-align:center; border:1px solid #000; border-bottom:none; padding:10px; }
  .letterhead .name { font-size:18px; font-weight:700; }
  .letterhead .addr { font-size:12px; margin-top:4px; }
  .letterhead .contact { display:flex; justify-content:center; gap:40px; margin-top:8px; font-size:11px; }
  .title-bar { border:1px solid #000; border-top:none; text-align:center; font-weight:700; font-size:14px; padding:6px; }
  table.header-table { width:100%; border-collapse:collapse; }
  .header-table td { border:1px solid #000; border-top:none; padding:4px 8px; vertical-align:top; font-size:12px; }
  .header-table .label { display:inline-block; width:120px; color:#374151; }
  .items { width:100%; border-collapse:collapse; margin-top:-1px; }
  .items th, .items td { border:1px solid #000; padding:5px 7px; font-size:11px; }
  .items th { background:#e5e7eb; text-transform:uppercase; letter-spacing:.02em; font-size:10px; }
  .r { text-align:right; } .c { text-align:center; }
  .footer-box { border:1px solid #000; border-top:none; padding:8px; min-height:34px; }
  .footer-box .label { font-size:11px; margin-bottom:4px; }
  .sign-row { display:flex; border:1px solid #000; border-top:none; }
  .sign-row div { flex:1; padding:20px 8px 8px; font-size:12px; }
  .sign-row div:first-child { border-right:1px solid #000; }
  .print-btn { margin-bottom:14px; }
  @media print { .print-btn { display:none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Print</button>

  <div class="letterhead">
    <div class="name">${escapeHtml(company.name||"Mahendra Industries")}</div>
    <div class="addr">${escapeHtml(company.address||"")}</div>
    <div class="contact">
      <span>Phone&nbsp;&nbsp;${escapeHtml(company.phone||"")}</span>
      <span>Email&nbsp;&nbsp;${escapeHtml(company.email||"")}</span>
    </div>
  </div>
  <div class="title-bar">Goods Inward Note</div>

  <table class="header-table">
    <tr>
      <td style="width:50%">
        <div><span class="label">Site</span>${escapeHtml(company.name||gin.plant)}</div>
        <div><span class="label">GIN No</span>${escapeHtml(gin.gin_number)}</div>
        <div><span class="label">GIN Type</span>${escapeHtml(gin.gin_type||"")}</div>
        <div><span class="label">Received By Code</span>${escapeHtml(gin.received_by_code||"-")}</div>
        <div><span class="label">Received By</span>${escapeHtml(gin.received_by||"-")}</div>
        <div><span class="label">Vendor Code</span>${escapeHtml(gin.vendor_code||"")}</div>
        <div><span class="label">Vendor Name</span>${escapeHtml(gin.vendor_name||"")}</div>
        <div><span class="label">LR No</span>${escapeHtml(gin.lr_no||"")}</div>
        <div><span class="label">LR Date</span>${gin.lr_date?formatDate(gin.lr_date):""}</div>
      </td>
      <td style="width:50%">
        <div><span class="label">Status</span>${escapeHtml((gin.status||"").replace("_"," "))}</div>
        <div><span class="label">Date</span>${formatDate(gin.created_at?.toDate?gin.created_at.toDate():gin.created_at)}</div>
        <div><span class="label">PO No</span>${escapeHtml(gin.po_number||"")}</div>
        <div><span class="label">PO Ver</span>${gin.po_ver||"-"}</div>
        <div><span class="label">Challan No</span>${escapeHtml(gin.challan_no||"")}</div>
        <div><span class="label">Challan Date</span>${gin.challan_date?formatDate(gin.challan_date):""}</div>
        <div><span class="label">Bill No</span>${escapeHtml(gin.bill_no||"")}</div>
        <div><span class="label">Bill Date</span>${gin.bill_date?formatDate(gin.bill_date):""}</div>
        <div><span class="label">Vehicle No</span>${escapeHtml(gin.vehicle_no||"")}</div>
        <div><span class="label">Delivery Mode</span>${escapeHtml(gin.delivery_mode||"")}</div>
      </td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:28px">S No</th>
        <th>Item Code</th>
        <th>Item Description</th>
        <th style="width:44px">UOM</th>
        <th style="width:70px">Challan Qty</th>
        <th style="width:70px">Accepted Qty</th>
        <th style="width:70px">Rejected Qty</th>
        <th style="width:80px">Actual Challan Qty</th>
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${rows||`<tr><td colspan="9" class="c" style="padding:16px;color:#9ca3af;">No items</td></tr>`}
    </tbody>
  </table>

  <div class="footer-box"><div class="label">Remarks</div>${escapeHtml(gin.remarks||"")}</div>
  <div class="footer-box"><div class="label">Comments</div>${escapeHtml(gin.comments||"")}</div>
  <div class="sign-row"><div>Prepared By</div><div>Approved By</div></div>

  <script>window.onload = () => window.focus();</script>
</body>
</html>`);
  win.document.close();
}

function fmtQty(v){
  const n=parseFloat(v);
  return isNaN(n)?"—":n.toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
