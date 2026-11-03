export function escapeCsvCell(raw) {
  const value = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${value.replaceAll('"', '""')}"`;
}

export function encodeCsv(rows) {
  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`;
}

export function downloadCsv(fileName, rows) {
  const url = URL.createObjectURL(new Blob([encodeCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
