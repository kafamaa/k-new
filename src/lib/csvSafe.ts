// One CSV cell writer for every export (unified plan section 24: CSV export
// must avoid spreadsheet formula injection).
//
// Text that a spreadsheet would treat as a formula - starting with = + - @,
// a tab or a carriage return - is prefixed with an apostrophe so it opens as
// plain text. Real numbers are written as numbers, so a goal difference of -3
// stays -3 instead of turning into text.
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  const text = String(value ?? '')
  const safe = FORMULA_START.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',')
}
