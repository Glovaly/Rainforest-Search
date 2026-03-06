const { parse } = require('csv-parse/sync');

function parseCsv(buffer) {
  // Strip UTF-8 BOM if present (common with Excel exports)
  let content = buffer.toString('utf-8');
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  // Try comma first, then semicolon (common in Latin American CSVs)
  let records;
  try {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch {
    records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: ';',
      relax_column_count: true,
    });
  }

  if (!records || records.length === 0) {
    throw new Error('CSV file is empty or could not be parsed');
  }

  // Find the title column
  const columns = Object.keys(records[0]);
  const titleAliases = ['title', 'titulo', 'título', 'product_title', 'product', 'nombre', 'name'];
  let titleColumn = columns.find((col) =>
    titleAliases.includes(col.toLowerCase())
  );

  // Fall back to the first column
  if (!titleColumn) {
    titleColumn = columns[0];
  }

  // Extract non-empty titles
  const titles = records
    .map((row) => (row[titleColumn] || '').trim())
    .filter((t) => t.length > 0);

  if (titles.length === 0) {
    throw new Error(`No titles found in column "${titleColumn}"`);
  }

  return { titles, columnName: titleColumn, totalRows: records.length };
}

module.exports = { parseCsv };
