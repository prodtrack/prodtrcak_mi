// ─── QGINPrintView.jsx ──────────────────────────────────────────────────────
// Print layout matching the reference "Quality - GIN" format: same
// letterhead pattern as GIN/PO (logo, address, Phone/Email/Website, GSTIN/
// CIN/PAN row, "Page 1 of 1"), then a two-column header block (Quality No/
// Date/Item Code/Description/GIN No/Base UOM/Accepted/Rejected/Rework/
// Scrap/Pending Qty on the left, Quality Type/Site/GIN Qty/Testing Qty/
// Accepted & Rejected Location on the right), then the parameter table,
// then Remarks/Reasons/Prepared-Approved By footer.

import { COMPANY_INFO } from "./purchaseHelpers";
import { formatDate } from "../shared.jsx";

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

export function printQualityGIN(qgin){
  const company=COMPANY_INFO[qgin.plant]||{};
  const win=window.open("","_blank","width=950,height=1000");
  if(!win){alert("Please allow pop-ups to print.");return;}

  const paramRows=(qgin.parameters||[]).map((p,i)=>`
    <tr>
      <td class="c">${i+1}</td>
      <td>${esc(p.parameter||"")}</td>
      <td>${esc(p.parameter_description||"")}</td>
      <td class="c">${esc(p.visual||"")}</td>
      <td class="c">${esc(p.uom||"")}</td>
      <td class="r">${esc(p.standard_value||"")}</td>
      <td class="r">${esc(p.actual_value||"")}</td>
    </tr>`).join("");

  win.document.write(`
<!DOCTYPE html>
<html>
<head>
<title>${esc(qgin.qgin_number)}</title>
<meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 10mm; }
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin:0; }
  .sheet { width:94%; margin:0 auto; }
  .letterhead { position:relative; text-align:center; border:1px solid #000; border-bottom:none; padding:8px 6px 6px; }
  .letterhead .name { font-size:16px; font-weight:700; }
  .letterhead .addr { font-size:11px; margin-top:3px; }
  .letterhead .page { position:absolute; top:6px; right:12px; font-size:11px; }
  .contact-row { display:flex; justify-content:space-between; border:1px solid #000; border-top:none; padding:3px 10px; font-size:10.5px; }
  .title-bar { border:1px solid #000; border-top:none; text-align:center; font-weight:700; font-size:13px; padding:4px; }
  table.header-table { width:100%; border-collapse:collapse; }
  .header-table td { border:1px solid #000; border-top:none; padding:4px 10px; vertical-align:top; font-size:11.5px; }
  .header-table .label { display:inline-block; width:130px; color:#374151; }
  .items { width:100%; border-collapse:collapse; margin-top:-1px; }
  .items th, .items td { border:1px solid #000; padding:3px 6px; font-size:11px; }
  .items th { background:#e5e7eb; text-transform:uppercase; letter-spacing:.02em; font-size:10px; }
  .r { text-align:right; } .c { text-align:center; }
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

  <div class="sheet">
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
  <div class="title-bar">Quality - GIN</div>

  <table class="header-table">
    <tr>
      <td style="width:50%">
        <div><span class="label">Quality No</span>: ${esc(qgin.qgin_number)}</div>
        <div><span class="label">Quality Date</span>: ${qgin.quality_date?formatDate(qgin.quality_date):"-"}</div>
        <div><span class="label">Item Code</span>: ${esc(qgin.item_code||"")}</div>
        <div><span class="label">Item Description</span>: ${esc(qgin.material_name||"")}</div>
        <div><span class="label">GIN No</span>: ${esc(qgin.gin_number||"")}</div>
        <div><span class="label">Base UOM</span>: ${esc((qgin.base_uom||"").toUpperCase())}</div>
        <div><span class="label">Accepted Qty</span>: ${qgin.accepted_qty??0}</div>
        <div><span class="label">Rejected Qty</span>: ${qgin.rejected_qty??0}</div>
        <div><span class="label">Rework Qty</span>: ${qgin.rework_qty??0}</div>
        <div><span class="label">Scrap Qty</span>: ${qgin.scrap_qty??0}</div>
        <div><span class="label">Pending Qty</span>: ${qgin.pending_qty??0}</div>
      </td>
      <td style="width:50%">
        <div><span class="label">Quality Type</span>: ${esc(qgin.quality_type||"-")}</div>
        <div><span class="label">Site</span>: ${esc(company.name||qgin.plant)}</div>
        <div><span class="label">GIN Qty</span>: ${qgin.gin_qty??0}</div>
        <div><span class="label">Testing Qty</span>: ${qgin.testing_qty||"-"}</div>
        <div><span class="label">Accepted Location</span>: ${esc(qgin.accepted_location||"-")}</div>
        <div><span class="label">Rejected Location</span>: ${esc(qgin.rejected_location||"-")}</div>
      </td>
    </tr>
  </table>

  <table class="items">
    <thead>
      <tr>
        <th style="width:36px">Sr. No.</th>
        <th style="width:140px">Parameter</th>
        <th>Parameter Description</th>
        <th style="width:80px">Visual</th>
        <th style="width:56px">UOM</th>
        <th style="width:90px">Standard Value</th>
        <th style="width:90px">Actual Value</th>
      </tr>
    </thead>
    <tbody>
      ${paramRows||`<tr><td colspan="7" class="c" style="padding:16px;color:#9ca3af;">No parameters recorded</td></tr>`}
    </tbody>
  </table>

  <div class="footer-box"><div class="label">Remarks</div>${esc(qgin.remarks||"")}</div>
  <div class="footer-box"><div class="label">Reasons</div>${esc(qgin.reasons||"")}</div>
  <div class="sign-row">
    <div>Prepared By</div>
    <div>Approved By</div>
  </div>
  </div>

  <script>window.onload = () => window.focus();</script>
</body>
</html>`);
  win.document.close();
}
