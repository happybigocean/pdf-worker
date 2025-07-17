import { PDFDocument, degrees } from 'pdf-lib';

const ORI = { PAGE_UP:0, PAGE_RIGHT:90, PAGE_DOWN:180, PAGE_LEFT:270 };

async function applyDocAiRotation(pdfBytes: ArrayBuffer, docJson: any) {
  const pdf = await PDFDocument.load(pdfBytes);

  docJson.pages.forEach((page: any, i: number) => {
    // 1️⃣ try matrix first
    if (page.transforms?.length) {
      const m = page.transforms[0].data;          // Float64Array length 9
      const angle = Math.round(Math.atan2(m[3], m[0]) * 180 / Math.PI);
      if (angle) pdf.getPage(i).setRotation(degrees(-angle));
    } else {
      // 2️⃣ fallback: orientation enum (rarely non-UP)
      const deg = ORI[page.layout.orientation] ?? 0;
      if (deg) pdf.getPage(i).setRotation(degrees(deg));
    }
  });

  return pdf.save({ useObjectStreams: true });
}
