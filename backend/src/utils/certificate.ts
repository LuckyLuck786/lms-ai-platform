import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

/**
 * Certificate PDF generation (FR-S8) using pdf-lib — no browser/native deps.
 *
 * Design goals: an artifact a graduate would actually print and frame —
 * restrained ivory/navy/gold palette, serif display typography, an embossed
 * seal, signature blocks, a scannable QR that resolves to the public
 * verification page, and a serial number. Everything is drawn programmatically
 * so the same data always produces the same document (verifiable + idempotent).
 */

export interface CertificateData {
  certificateId: string;
  studentName: string;
  courseTitle: string;
  issuedAt: Date;
  instructorName?: string;
  /** Base URL of the public verification page, e.g. https://app.example.com */
  verifyBaseUrl?: string;
}


// --- Palette ---------------------------------------------------------------
const INK = rgb(0.086, 0.129, 0.227); // #162139 deep navy
const INK_SOFT = rgb(0.28, 0.33, 0.45);
const GOLD = rgb(0.706, 0.549, 0.2); // #B48C33
const GOLD_LIGHT = rgb(0.855, 0.741, 0.451);
const IVORY = rgb(0.992, 0.986, 0.969); // #FDFBF7
const RULE = rgb(0.72, 0.69, 0.62);

const PAGE_W = 842;
const PAGE_H = 595;

// --- Small drawing helpers -------------------------------------------------

function drawCentered(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  color = INK,
  centerX = PAGE_W / 2,
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - w / 2, y, font, size, color });
}

/** Letter-spaced (tracked) caps — the classic engraved-certificate look. */
function drawTracked(
  page: PDFPage,
  text: string,
  y: number,
  font: PDFFont,
  size: number,
  tracking: number,
  color = INK,
  centerX = PAGE_W / 2,
) {
  const chars = [...text];
  const width =
    chars.reduce((sum, c) => sum + font.widthOfTextAtSize(c, size), 0) +
    tracking * Math.max(chars.length - 1, 0);
  let x = centerX - width / 2;
  for (const c of chars) {
    page.drawText(c, { x, y, font, size, color });
    x += font.widthOfTextAtSize(c, size) + tracking;
  }
}

function drawRule(page: PDFPage, x: number, y: number, width: number, thickness: number, color = RULE) {
  page.drawRectangle({ x, y, width, height: thickness, color });
}

/** Centered horizontal rule with a small diamond at its middle. */
function drawOrnamentalRule(page: PDFPage, y: number, width: number, color = GOLD) {
  const gap = 9;
  const half = width / 2;
  drawRule(page, PAGE_W / 2 - half, y, half - gap, 0.8, color);
  drawRule(page, PAGE_W / 2 + gap, y, half - gap, 0.8, color);
  diamond(page, PAGE_W / 2, y + 0.4, 3.4, color);
}

function diamond(page: PDFPage, cx: number, cy: number, r: number, color = GOLD) {
  page.drawLine({ start: { x: cx, y: cy + r }, end: { x: cx + r, y: cy }, thickness: 0.8, color });
  page.drawLine({ start: { x: cx + r, y: cy }, end: { x: cx, y: cy - r }, thickness: 0.8, color });
  page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx - r, y: cy }, thickness: 0.8, color });
  page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx, y: cy + r }, thickness: 0.8, color });
}

/** Five-pointed star used inside the seal. */
function star(page: PDFPage, cx: number, cy: number, outer: number, inner: number, color = GOLD) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  for (let i = 0; i < 10; i += 1) {
    page.drawLine({ start: pts[i], end: pts[(i + 1) % 10], thickness: 0.9, color });
  }
}

/** Embossed-looking circular seal: rings, a clean star, micro lettering. */
function drawSeal(page: PDFPage, cx: number, cy: number, radius: number, capFont: PDFFont) {
  // soft halo, then the double ring
  page.drawCircle({ x: cx, y: cy, size: radius + 3, borderColor: GOLD_LIGHT, borderWidth: 0.4, opacity: 0.4 });
  page.drawCircle({ x: cx, y: cy, size: radius, borderColor: GOLD, borderWidth: 1.5 });
  page.drawCircle({ x: cx, y: cy, size: radius - 4, borderColor: GOLD_LIGHT, borderWidth: 0.5 });
  // Dot separators flanking the top legend
  page.drawCircle({ x: cx - radius * 0.62, y: cy + 17.5, size: 0.9, color: GOLD });
  page.drawCircle({ x: cx + radius * 0.62, y: cy + 17.5, size: 0.9, color: GOLD });
  drawTracked(page, 'VERTEXON', cy + 16, capFont, 5.4, 1.0, GOLD, cx);
  star(page, cx, cy + 1, 12.5, 5.2, GOLD);
  drawTracked(page, 'OFFICIAL SEAL', cy - 19, capFont, 5.4, 1.0, GOLD, cx);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 2): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    const last = lines[lines.length - 1];
    if (font.widthOfTextAtSize(last, size) > maxWidth) {
      let trimmed = last;
      while (trimmed.length > 1 && font.widthOfTextAtSize(`${trimmed}…`, size) > maxWidth) {
        trimmed = trimmed.slice(0, -1);
      }
      lines[lines.length - 1] = `${trimmed}…`;
    }
  }
  return lines;
}

/** Serial number that reads like a real credential: VTX-2026-1A2B3C4D. */
export function certificateSerial(certificateId: string, issuedAt: Date): string {
  const year = issuedAt.getUTCFullYear();
  const hex = certificateId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `VTX-${year}-${hex}`;
}

export function verificationUrl(certificateId: string, verifyBaseUrl?: string): string {
  const base = (verifyBaseUrl ?? 'https://lms-ai-frontend.vercel.app').replace(/\/+$/, '');
  return `${base}/verify/${certificateId}`;
}

// --- Document --------------------------------------------------------------

export async function buildCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate of Completion — ${data.courseTitle}`);
  doc.setAuthor('Vertexon Learning Technologies');
  doc.setSubject(`Certificate ${certificateSerial(data.certificateId, data.issuedAt)}`);
  doc.setProducer('Vertexon LMS-AI');

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const { width, height } = page.getSize();

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const caps = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);

  // Paper
  page.drawRectangle({ x: 0, y: 0, width, height, color: IVORY });

  // Frames: navy outer, gold inner, navy hairline
  page.drawRectangle({ x: 22, y: 22, width: width - 44, height: height - 44, borderColor: INK, borderWidth: 1.3 });
  page.drawRectangle({ x: 30, y: 30, width: width - 60, height: height - 60, borderColor: GOLD, borderWidth: 0.9 });
  page.drawRectangle({ x: 34.5, y: 34.5, width: width - 69, height: height - 69, borderColor: RULE, borderWidth: 0.35 });

  // Corner diamonds on the gold frame
  const c = 30;
  diamond(page, c, c, 4, GOLD);
  diamond(page, width - c, c, 4, GOLD);
  diamond(page, c, height - c, 4, GOLD);
  diamond(page, width - c, height - c, 4, GOLD);

  // ---- Header -------------------------------------------------------------
  drawOrnamentalRule(page, height - 74, 210);
  drawTracked(page, 'VERTEXON LEARNING TECHNOLOGIES', height - 106, caps, 12.5, 2.6, INK);
  drawTracked(page, 'CERTIFICATION BODY  ·  EST. 2024', height - 124, sans, 7.2, 1.9, INK_SOFT);

  // ---- Title --------------------------------------------------------------
  drawCentered(page, 'Certificate of Completion', height - 178, serifBold, 35);
  drawOrnamentalRule(page, height - 196, 168);

  // ---- Body ---------------------------------------------------------------
  drawCentered(page, 'This is to certify that', height - 236, serifItalic, 13.5, INK_SOFT);

  const nameSize = data.studentName.length > 34 ? 25 : data.studentName.length > 26 ? 28 : 32;
  drawCentered(page, data.studentName, height - 282, serifBold, nameSize);
  drawRule(page, PAGE_W / 2 - 170, height - 294, 340, 0.8, GOLD_LIGHT);

  drawCentered(page, 'has successfully completed the course', height - 320, serifItalic, 13, INK_SOFT);

  const titleLines = wrap(data.courseTitle, serifBold, 21, width - 260, 2);
  titleLines.forEach((line, i) => {
    drawCentered(page, `“${line}${i === titleLines.length - 1 ? '”' : ''}`, height - 352 - i * 25, serifBold, 21);
  });
  const afterTitle = height - 352 - (titleLines.length - 1) * 25;

  // ---- Meta row: issued / seal / serial -----------------------------------
  const metaY = afterTitle - 52;
  // Issued date — left column
  drawTracked(page, 'ISSUED', metaY + 26, caps, 7.4, 1.5, GOLD, PAGE_W / 2 - 262);
  drawCentered(
    page,
    data.issuedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    metaY + 6,
    serif,
    12.5,
    INK,
    PAGE_W / 2 - 262,
  );
  // Serial — right column
  drawTracked(page, 'CREDENTIAL ID', metaY + 26, caps, 7.4, 1.5, GOLD, PAGE_W / 2 + 262);
  drawCentered(page, certificateSerial(data.certificateId, data.issuedAt), metaY + 6, sans, 11, INK, PAGE_W / 2 + 262);

  // Seal center
  drawSeal(page, PAGE_W / 2, metaY + 16, 34, caps);

  // ---- Signature blocks ---------------------------------------------------
  const sigY = 118;
  const sigRuleHalf = 82;
  const leftX = PAGE_W / 2 - 205;
  const rightX = PAGE_W / 2 + 205;

  const sign = (cx: number, name: string, role: string) => {
    // handwriting-style signature then the rule
    drawCentered(page, name, sigY + 16, serifItalic, 17, INK, cx);
    drawRule(page, cx - sigRuleHalf, sigY, sigRuleHalf * 2, 0.7, INK_SOFT);
    drawTracked(page, role.toUpperCase(), sigY - 14, sans, 7.4, 1.6, INK_SOFT, cx);
  };
  sign(leftX, data.instructorName ?? 'Course Instructor', 'Course Instructor');

  const directorName = 'Meera Admin';
  sign(rightX, directorName, 'Director of Education');

  // ---- Footer: QR + verification ------------------------------------------
  const verify = verificationUrl(data.certificateId, data.verifyBaseUrl);
  const qrPng = await QRCode.toBuffer(verify, {
    type: 'png',
    width: 220,
    margin: 0,
    color: { dark: '#162139', light: '#FDFBF7' },
    errorCorrectionLevel: 'M',
  });
  const qrImage = await doc.embedPng(qrPng);
  const qrSize = 46;
  page.drawImage(qrImage, { x: 56, y: 46, width: qrSize, height: qrSize });
  page.drawText('Scan to verify', {
    x: 56,
    y: 38,
    font: sans,
    size: 6.4,
    color: INK_SOFT,
  });

  page.drawText('This certificate can be authenticated at', {
    x: 116,
    y: 66,
    font: serifItalic,
    size: 9,
    color: INK_SOFT,
  });
  page.drawText(verify, { x: 116, y: 54, font: sans, size: 8.6, color: INK });

  const issuedLine = `Issued ${data.issuedAt.toISOString().slice(0, 10)}  ·  ${certificateSerial(
    data.certificateId,
    data.issuedAt,
  )}`;
  const issuedWidth = sans.widthOfTextAtSize(issuedLine, 8);
  page.drawText(issuedLine, {
    x: width - 56 - issuedWidth,
    y: 54,
    font: sans,
    size: 8,
    color: INK_SOFT,
  });
  page.drawText('Tampering invalidates this credential.', {
    x: width - 56 - sans.widthOfTextAtSize('Tampering invalidates this credential.', 7),
    y: 66,
    font: serifItalic,
    size: 7,
    color: INK_SOFT,
  });

  return doc.save();
}
