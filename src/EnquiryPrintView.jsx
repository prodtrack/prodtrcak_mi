// ─── EnquiryPrintView.jsx ───────────────────────────────────────────────────
// Renders an Enquiry/Offer as standalone, self-contained HTML — same approach
// as WOPrintView.jsx / POPrintView.jsx / PRPrintView.jsx: opens in a new
// window with its own inline CSS so the print layout is never affected by
// the app's screen styles.
//
// Letterhead header (logo, address, phone/email/website, GSTIN/PAN) is
// intentionally identical to the other print views for a consistent look.
// Body content is a placeholder for now — what exactly gets shown
// (Description, Size, Covering, GST, Validity, Final price/UOM, etc.) is
// still being decided; change ONLY the body section below once that's
// finalized, leave the header as-is.

import { COMPANY_INFO } from "./purchase/purchaseHelpers";
import { COMPANY_LOGO_DATA_URI } from "./purchase/companyLogo.js";

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

export function printEnquiry(enquiry){
  const company=COMPANY_INFO.Bidadi||{};

  const html=`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${esc(enquiry.enq_number||"Enquiry")}</title>
<style>
  @page { size: A4; margin: 12mm; }
  *{box-sizing:border-box;}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0;padding:0;}
  .sheet{border:1.5px solid #000;}
  .c{text-align:center;}
  .r{text-align:right;}
  table{width:100%;border-collapse:collapse;}
  td,th{padding:4px 8px;vertical-align:top;}
  .header{padding:12px 16px;text-align:center;border-bottom:1px solid #000;}
  .logo{max-width:340px;max-height:90px;margin:0 auto;display:block;}
  .addr{font-size:11px;margin-top:8px;}
  .contact-row{display:flex;justify-content:space-between;padding:6px 16px;border-bottom:1px solid #000;font-size:10.5px;}
  .body-placeholder{padding:40px 20px;text-align:center;color:#9ca3af;font-size:12px;}
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

  <!-- Body content to be finalized — placeholder for now -->
  <div class="body-placeholder">Enquiry ${esc(enquiry.enq_number||"")} — offer content to be added</div>

</div>
</body>
</html>`;

  const win=window.open("","_blank","width=900,height=1000");
  if(!win){
    alert("Please allow pop-ups for this site to print the Enquiry.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
