// Builds a landscape A4 PDF of one stocktake, laid out like the paper sheet.
// Needs jsPDF and jspdf-autotable loaded first.
window.stocktakePdf = function (sheet, st, opts = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const green = [47, 107, 58], grey = [235, 238, 233];
  const fmtDay = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };
  const fmtLong = iso => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtTime = t => { if (!t) return '—'; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  const key = (g, p, s, b) => `${g}|${p}|${s}|${b}`;
  const lines = {};
  const unavailable = new Set();
  (st.lines || []).forEach(l => {
    if (l.unavailable) unavailable.add(`${l.section}|${l.product}`);
    else lines[key(l.section, l.product, l.size, l.batch)] = l;
  });

  // Title block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...green);
  doc.text(sheet.title || 'Daily Stock Take Sheet', 12, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
  doc.text(sheet.subtitle || '', 12, 19);
  doc.setTextColor(30, 30, 30); doc.setFontSize(10);
  doc.text(fmtLong(st.stocktakeDate), pageW - 12, 14, { align: 'right' });
  const done = [st.countedBy1, st.countedBy2].filter(Boolean).join(' & ');
  doc.setFontSize(9);
  doc.text(`Done by: ${done}   ·   Start ${fmtTime(st.startTime)}   ·   Finish ${fmtTime(st.finishTime)}`, pageW - 12, 19, { align: 'right' });
  if (opts.label) { doc.setTextColor(138, 90, 0); doc.text(opts.label, pageW - 12, 24, { align: 'right' }); doc.setTextColor(30, 30, 30); }

  const tableFor = (group, startY, margin) => {
    const head1 = [{ content: group.title, rowSpan: 2, styles: { halign: 'left', valign: 'middle' } }];
    const head2 = [];
    group.columns.forEach(c => {
      head1.push({ content: c.size, colSpan: c.batches * 2, styles: { halign: 'center' } });
      for (let b = 1; b <= c.batches; b++) head2.push('Qty', 'Use by');
    });
    head1.push({ content: 'Total', rowSpan: 2, styles: { halign: 'right', valign: 'middle' } });
    const body = group.products.map(p => {
      const row = [{ content: p.name, styles: p.highlight ? { fillColor: [214, 240, 219] } : {} }];
      let total = 0;
      if (unavailable.has(`${group.id}|${p.name}`)) {
        const span = group.columns.reduce((s, c) => s + c.batches * 2, 0);
        row.push({ content: 'N/A', colSpan: span, styles: { halign: 'center', textColor: [150, 150, 150], fontStyle: 'italic' } });
        row.push('');
        return row;
      }
      group.columns.forEach(c => {
        for (let b = 1; b <= c.batches; b++) {
          if (!p.sizes.includes(c.size)) { row.push({ content: '', colSpan: 2, styles: { fillColor: grey } }); continue; }
          const l = lines[key(group.id, p.name, c.size, b)];
          if (l && l.qty != null) total += l.qty;
          row.push({ content: l && l.qty != null ? String(l.qty) : '', styles: { halign: 'right' } });
          row.push({ content: l ? fmtDay(l.useBy) : '', styles: { halign: 'center' } });
        }
      });
      row.push({ content: total ? String(total) : '', styles: { halign: 'right', fontStyle: 'bold' } });
      return row;
    });
    doc.autoTable({
      startY, margin, head: [head1, head2], body, theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.2, lineColor: [200, 205, 198], lineWidth: 0.2, textColor: [30, 30, 30] },
      headStyles: { fillColor: [244, 246, 242], textColor: [40, 40, 40], fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { cellWidth: margin.right > 100 ? 42 : 50 } }
    });
    return doc.lastAutoTable.finalY;
  };

  const groups = sheet.groups || [];
  let y = tableFor(groups[0], 28, { left: 12, right: 12 });
  const rest = groups.slice(1);
  if (rest.length) {
    let nextY = y + 6;
    if (nextY > 170) { doc.addPage(); nextY = 14; }
    const half = (pageW - 24 - 8) / 2;
    const ends = [];
    rest.forEach((g, i) => {
      const left = 12 + (i % 2) * (half + 8);
      const top = i < 2 ? nextY : ends[i - 2] + 6;
      ends.push(tableFor(g, top, { left, right: pageW - left - half }));
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7); doc.setTextColor(130, 130, 130);
    doc.text(`Stocktake #${st.id || ''} · generated ${new Date().toLocaleString()}`, 12, 204);
    if (pages > 1) doc.text(`Page ${i} of ${pages}`, pageW - 12, 204, { align: 'right' });
  }
  const who = (st.countedBy1 || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  doc.save(`stocktake-${st.stocktakeDate}${who ? '-' + who : ''}${opts.suffix || ''}.pdf`);
};
