/**
 * Minimal single-page PDF writer.
 *
 * The demo certificate download returns a real (if plain) PDF so the
 * "Download PDF" button behaves exactly like it does against the real
 * `pdf-lib` backend instead of failing without a server.
 */

interface Line {
  text: string;
  size: number;
  font: 'F1' | 'F2';
  gap: number;
}

const escapeText = (s: string): string =>
  s
    // PDF strings are Latin-1; drop anything outside that range rather than
    // emitting bytes a viewer would render as mojibake.
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

/** Byte offsets are computed on a Latin-1 string, so length === byte length. */
const toBytes = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export function buildCertificatePdf(opts: {
  name: string;
  course: string;
  issuedAt: string;
  certificateId: string;
  issuer?: string;
}): Uint8Array {
  const issued = new Date(opts.issuedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const lines: Line[] = [
    { text: 'VERTEXON LEARNING TECHNOLOGIES', size: 22, font: 'F2', gap: 92 },
    { text: opts.issuer ?? 'Certificate of Completion', size: 15, font: 'F1', gap: 34 },
    { text: 'This is to certify that', size: 11, font: 'F1', gap: 56 },
    { text: opts.name, size: 20, font: 'F2', gap: 40 },
    { text: 'has successfully completed', size: 11, font: 'F1', gap: 52 },
    { text: opts.course, size: 16, font: 'F2', gap: 96 },
    { text: `Issued ${issued}`, size: 10, font: 'F1', gap: 24 },
    { text: `Certificate ID ${opts.certificateId}  ·  Demo mode — issued by the in-browser sample backend`, size: 9, font: 'F1', gap: 0 },
  ];

  // Absolute positioning per line keeps the layout independent of content length.
  let y = 660;
  const ops: string[] = ['0.12 0.35 0.62 rg', '72 726 468 3 re f', '0.12 0.12 0.16 rg'];
  for (const line of lines) {
    y -= line.gap;
    ops.push(`BT /${line.font} ${line.size} Tf 72 ${y} Td (${escapeText(line.text)}) Tj ET`);
    y -= line.size + 8;
  }
  ops.push('0.35 0.35 0.35 rg');
  ops.push('72 120 m 540 120 l S');
  ops.push(`BT /F1 9 Tf 72 104 Td (Vertexon LMS-AI - AI-augmented learning platform) Tj ET`);
  const stream = ops.join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return toBytes(pdf);
}