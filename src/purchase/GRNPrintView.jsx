// ─── GRNPrintView.jsx ───────────────────────────────────────────────────────
// Print layout for a single posted GRN (goods_inward) receipt entry — same
// letterhead pattern as GIN/QGIN/PO (logo, address, Phone/Email/Website,
// GSTIN/CIN/PAN row), a two-column header block, then Remarks and a
// Prepared/Approved signature row.

import { COMPANY_INFO } from "./purchaseHelpers";
import { formatDate } from "../shared.jsx";

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

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
  @page { size: A4; margin: 8mm; }
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin:0; }
  .letterhead { position:relative; text-align:center; border:1px solid #000; border-bottom:none; padding:6px; }
  .letterhead .name { font-size:16px; font-weight:700; }
  .letterhead .addr { font-size:11px; margin-top:3px; }
  .letterhead .page { position:absolute; top:6px; right:12px; font-size:11px; }
  .contact-row { display:flex; justify-content:space-between; border:1px solid #000; border-top:none; padding:3px 10px; font-size:10.5px; }
  .title-bar { border:1px solid #000; border-top:none; text-align:center; font-weight:700; font-size:13px; padding:4px; }
  table.header-table { width:100%; border-collapse:collapse; }
  .header-table td { border:1px solid #000; border-top:none; padding:4px 10px; vertical-align:top; font-size:11.5px; }
  .header-table .label { display:inline-block; width:130px; color:#374151; }
  .footer-box { border:1px solid #000; border-top:none; padding:6px; min-height:26px; }
  .footer-box .label { font-size:11px; margin-bottom:3px; }
  .sign-row { display:flex; border:1px solid #000; border-top:none; }
  .sign-row div { flex:1; padding:12px 8px 6px; font-size:12px; }
  .sign-row div:first-child { border-right:1px solid #000; }
  .print-btn { margin-bottom:14px; }
  @media print { .print-btn { display:none; } }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">Print</button>

  <div class="letterhead">
    <div class="page">Page 1 of 1</div>
    <div class="name">${esc(company.name||"Mahendra Industries")}</div>
    <div class="addr">${esc(company.address||"")}</div>
  </div>
  <div class="contact-row">
    <span>Phone&nbsp;&nbsp;:&nbsp;${esc(company.phone||"")}</span>
    <span>Email&nbsp;&nbsp;:&nbsp;${esc(company.email||"")}</span>
    <span>Website&nbsp;:&nbsp;${esc(company.website||"")}</span>
  </div>
  <div class="contact-row">
    <span>GSTIN&nbsp;:&nbsp;${esc(company.gstin||"")}</span>
    <span>CIN&nbsp;&nbsp;&nbsp;:&nbsp;</span>
    <span>PAN&nbsp;&nbsp;&nbsp;:&nbsp;${esc(company.pan||"")}</span>
  </div>
  <div class="title-bar">Goods Receipt Note</div>

  <table class="header-table">
    <tr>
      <td style="width:50%">
        <div><span class="label">GRN No</span>: ${esc(entry.grn_number||"-")}</div>
        <div><span class="label">Date Received</span>: ${entry.date_received?formatDate(entry.date_received):"-"}</div>
        <div><span class="label">Material</span>: ${esc(entry.material_name||"")}</div>
        <div><span class="label">Quantity</span>: ${entry.quantity??0} ${esc(entry.unit||"")}</div>
      </td>
      <td style="width:50%">
        <div><span class="label">Site</span>: ${esc(company.name||entry.plant||"")}</div>
        <div><span class="label">Supplier</span>: ${esc(entry.supplier_name||"-")}</div>
        <div><span class="label">PO No</span>: ${esc(entry.po_number||"-")}</div>
        <div><span class="label">Received By</span>: ${esc(entry.operator_name||"-")}</div>
      </td>
    </tr>
  </table>

  <div class="footer-box"><div class="label">Remarks</div>${esc(entry.remarks||"")}</div>
  <div class="sign-row">
    <div>Prepared By</div>
    <div>Approved By</div>
  </div>

  <script>window.onload = () => window.focus();</script>
</body>
</html>`);
  win.document.close();
}
