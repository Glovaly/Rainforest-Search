function exportToCsv(results, competitorName) {
  const header = 'Competitor,Original Title,ASIN,Product URL,Status';
  const rows = results.map((r) => {
    const competitor = escapeCsvField(competitorName || '');
    const title = escapeCsvField(r.original_title || '');
    const asin = r.asin || '';
    const url = r.product_url || '';
    const status = r.status || '';
    return `${competitor},${title},${asin},${url},${status}`;
  });
  return [header, ...rows].join('\n');
}

function escapeCsvField(value) {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

module.exports = { exportToCsv };
