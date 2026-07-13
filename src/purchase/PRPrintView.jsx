// ─── PRPrintView.jsx ────────────────────────────────────────────────────────
// Standalone print window for a Purchase Requisition, laid out to match the
// reference PR format (Requisition No / Date / Site / Requisition Type /
// Requested By Code header block, Vendor Code / Vendor Name / Job Order on
// the right, then the item table, then Remarks / Comments footer).
// I don't have your POPrintView.jsx source to match its exact CSS, so this
// is built independently from the reference screenshot — flag any styling
// mismatch and I'll align it once I can see POPrintView.jsx.

import { COMPANY_INFO } from "./purchaseHelpers";
import { formatDate } from "../shared.jsx";

export function printPurchaseRequisition(pr){
  const company=COMPANY_INFO[pr.plant]||{};
  const win=window.open("","_blank","width=900,height=1000");
  if(!win){alert("Please allow pop-ups to print.");return;}

  const rows=(pr.line_items||[]).map((it,i)=>`
    <tr>
      <td class="c">${i+1}</td>
      <td>${escapeHtml(it.item_code||"")}</td>
      <td>${escapeHtml(it.material_name||"")}</td>
      <td class="r">${fmtQty(it.inventory_qty)}</td>
      <td class="r">${fmtQty(it.qty)}</td>
      <td class="c">${escapeHtml(it.unit||"")}</td>
      <td class="c">${it.required_date?formatDate(it.required_date):"—"}</td>
      <td class="r">${it.last_po_rate!=null?Number(it.last_po_rate).toLocaleString("en-IN"):""}</td>
      <td>${escapeHtml(it.remarks||"")}</td>
    </tr>`).join("");

  win.document.write(`
<!DOCTYPE html>
<html>
<head>
<title>${escapeHtml(pr.pr_number)}</title>
<meta charset="utf-8"/>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin:0; }
  table { width:100%; border-collapse: collapse; }
  .header-table td { border: 1px solid #000; padding: 5px 8px; vertical-align: top; }
  .label { color:#374151; }
  .value { font-weight: 600; }
  .items { margin-top: -1px; }
  .items th, .items td { border: 1px solid #000; padding: 5px 8px; }
  .items th { background:#e5e7eb; font-size:11px; text-transform:uppercase; letter-spacing:.03em; }
  .r { text-align:right; }
  .c { text-align:center; }
  .footer-box { border: 1px solid #000; border-top:none; padding:8px; min-height: 46px; }
  .footer-box .label{ font-size:11px; margin-bottom:4px; }
  .print-btn { margin-bottom:14px; }
  @media print { .print-btn { display:none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Print</button>

  <table class="header-table">
    <tr>
      <td style="width:50%">
        <div><span class="label">Requisition No: </span><span class="value">${escapeHtml(pr.pr_number)}</span></div>
        <div><span class="label">Site: </span><span class="value">${escapeHtml(company.name||pr.plant)}</span></div>
        <div><span class="label">Requisition Type: </span><span class="value">${escapeHtml(pr.requisition_type||"")}</span></div>
        <div><span class="label">Requested By Code: </span><span class="value">${escapeHtml(pr.requested_by_code||"—")}</span></div>
      </td>
      <td style="width:50%">
        <div><span class="label">Date: </span><span class="value">${formatDate(pr.created_at?.toDate?pr.created_at.toDate():pr.created_at)}</span></div>
        <div><span class="label">Vendor Code: </span><span class="value">${escapeHtml(pr.vendor_code||"—")}</span></div>
        <div><span class="label">Vendor Name: </span><span class="value">${escapeHtml(pr.vendor_name||"—")}</span></div>
        <div><span class="label">Job Order: </span><span class="value">${escapeHtml(pr.job_order||"—")}</span></div>
      </td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:32px">Sr. No</th>
        <th>Item Code</th>
        <th>Item Description</th>
        <th style="width:80px">Inventory Qty</th>
        <th style="width:80px">Required Qty</th>
        <th style="width:56px">UOM</th>
        <th style="width:90px">Required Date</th>
        <th style="width:80px">Last PO Rate</th>
        <th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${rows||`<tr><td colspan="9" class="c" style="padding:16px;color:#9ca3af;">No items</td></tr>`}
    </tbody>
  </table>

  <div class="footer-box"><div class="label">Remarks:</div>${escapeHtml(pr.remarks||"")}</div>
  <div class="footer-box"><div class="label">Comments:</div>${escapeHtml(pr.comments||"")}</div>

  <script>window.onload = () => window.focus();</script>
</body>
</html>`);
  win.document.close();
}

function fmtQty(v){
  const n=parseFloat(v);
  return isNaN(n)?"—":n.toLocaleString("en-IN",{minimumFractionDigits:3,maximumFractionDigits:3});
}
function escapeHtml(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
