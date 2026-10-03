import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

/**
 * Certificate PDF generation (FR-S8) using pdf-lib — no browser/native deps.
 * Returns the absolute path of the written file.
 */

export interface CertificateData {
  certificateId: string;
  studentName: string;
  courseTitle: string;
  issuedAt: Date;
}

const OUT_DIR = path.join(process.cwd(), 'uploads', 'certificates');

function centerText(page: PDFPage, text: string, y: number, font: PDFFont, size: number, width: number) {
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (width - textWidth) / 2, y, font, size });
}

export async function generateCertificatePdf(data: CertificateData): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]); // A4 landscape
  const { width, height } = page.getSize();

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  // Border
  page.drawRectangle({
    x: 24,
    y: 24,
    width: width - 48,
    height: height - 48,
    borderColor: rgb(0.31, 0.43, 0.91),
    borderWidth: 3,
  });
  page.drawRectangle({
    x: 32,
    y: 32,
    width: width - 64,
    height: height - 64,
    borderColor: rgb(0.75, 0.8, 0.98),
    borderWidth: 1,
  });

  centerText(page, 'CERTIFICATE OF COMPLETION', height - 120, bold, 30, width);
  centerText(page, 'Vertexon Learning Technologies', height - 150, regular, 14, width);

  centerText(page, 'This is to certify that', height - 220, regular, 14, width);
  centerText(page, data.studentName, height - 265, bold, 28, width);
  centerText(page, 'has successfully completed the course', height - 310, regular, 14, width);

  const course = data.courseTitle.length > 60 ? `${data.courseTitle.slice(0, 57)}...` : data.courseTitle;
  centerText(page, course, height - 350, bold, 22, width);

  const issued = data.issuedAt.toISOString().slice(0, 10);
  centerText(page, `Issued on ${issued}`, height - 420, regular, 12, width);
  centerText(page, `Certificate ID: ${data.certificateId}`, height - 445, regular, 10, width);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `${data.certificateId}.pdf`);
  const bytes = await doc.save();
  await fs.writeFile(filePath, bytes);
  return filePath;
}
