import PDFDocument from 'pdfkit';

const date = new Intl.DateTimeFormat('es-PE', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima'});
const percentage = new Intl.NumberFormat('es-PE', {style: 'percent', maximumFractionDigits: 1});

export function resultsPdf(election: {nombre: string; cierre?: string}, rows: {nombre: string; votos: number}[], total: number) {
  const doc = new PDFDocument({size: 'A4', margin: 48, autoFirstPage: false, bufferPages: true,
    info: {Title: 'Resultados - ' + election.nombre, Author: 'C.E. Manuel A. Mesones Muro'}});
  const width = 499;
  const left = 48;
  let y = 0;

  function page() {
    doc.addPage();
    doc.rect(48, 47, width, 4).fill('#F4C525');
    doc.fillColor('#751526').font('Helvetica-Bold').fontSize(11).text('C.E. MANUEL A. MESONES MURO', left, 63);
    doc.fontSize(25).text('Resultados de la votación', left, 84, {width});
    doc.fillColor('#30252A').fontSize(15).text(election.nombre, left, 120, {width});
    doc.font('Helvetica').fontSize(10).text(
      (election.cierre ? 'Cierre: ' + date.format(new Date(election.cierre)) : 'Consulta: ' + date.format(new Date()))
      + '  |  Hora de Lima', left, doc.y + 5, {width});
    doc.font('Helvetica-Bold').fontSize(12).text('Total de votos: ' + total, left, doc.y + 13);
    y = doc.y + 16;
    doc.rect(left, y, width, 25).fill('#751526');
    doc.fillColor('white').fontSize(10).text('Candidato', left + 10, y + 8, {width: 310});
    doc.text('Votos', left + 330, y + 8, {width: 66, align: 'right'});
    doc.text('Porcentaje', left + 400, y + 8, {width: 86, align: 'right'});
    y += 25;
  }

  page();
  for (const [index, row] of rows.entries()) {
    doc.font('Helvetica').fontSize(11);
    const height = Math.max(24, doc.heightOfString(row.nombre, {width: 310}) + 11);
    if (y + height > 755) page();
    if (index % 2 === 0) doc.rect(left, y, width, height).fill('#FAF1F1');
    doc.fillColor('#30252A').font('Helvetica').fontSize(11);
    doc.text(row.nombre, left + 10, y + 7, {width: 310});
    doc.text(String(row.votos), left + 330, y + 7, {width: 66, align: 'right'});
    doc.text(percentage.format(total ? row.votos / total : 0), left + 400, y + 7, {width: 86, align: 'right'});
    y += height;
  }
  if (!rows.length) doc.fillColor('#30252A').text('Sin candidatos registrados.', left + 10, y + 10);
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('#61515A').font('Helvetica').fontSize(9).text('Página ' + (i + 1) + ' de ' + pages.count,
      left, 778, {width, align: 'right', lineBreak: false});
  }
  return doc;
}
