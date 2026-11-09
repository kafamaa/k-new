// ---------------------------------------------------------------------------
// Minimal XLSX reader for the reviewed import (final plan 31 and 37).
// Reads the first worksheet of an .xlsx file into rows of text, the same shape
// parseCsv returns, so the import keeps one preview and validation path.
// No dependency: an .xlsx file is a ZIP archive of XML parts, read here with
// the browser's DecompressionStream. Formulas, styles and dates are not
// interpreted; only the stored cell text is used.
// ---------------------------------------------------------------------------

const MAX_PART_BYTES = 8 * 1024 * 1024

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number }

function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break }
  }
  if (end < 0) throw new Error('not_xlsx')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map<string, ZipEntry>()
  const decoder = new TextDecoder()
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('not_xlsx')
    const nameLength = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, { name, method: view.getUint16(at + 10, true), compressedSize: view.getUint32(at + 20, true), offset: view.getUint32(at + 42, true) })
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return entries
}

async function readPart(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const entry = entries.get(name)
  if (!entry) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error('not_xlsx')
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true)
  const data = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return new TextDecoder().decode(data)
  if (entry.method !== 8) throw new Error('unsupported_xlsx')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    // A small file that expands to a huge one is refused rather than read.
    if (total > MAX_PART_BYTES) { await reader.cancel(); throw new Error('xlsx_too_large') }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(joined)
}

export function decodeXml(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    if (decimal) return String.fromCodePoint(parseInt(decimal, 10))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[named!.toLowerCase()]
  })
}

// Text of every <t> run inside one fragment (rich text has several runs).
function runs(fragment: string): string {
  return [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => decodeXml(match[1])).join('')
}

export function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => runs(match[1]))
}

// "B12" -> 1 (zero-based column index).
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? ''
  let index = 0
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}

export function worksheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = []
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = []
    let next = 0
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1]
      const reference = /\br="([A-Z]+\d+)"/i.exec(attributes)?.[1]
      const at = reference ? columnIndex(reference) : next
      const type = /\bt="(\w+)"/.exec(attributes)?.[1] ?? 'n'
      const body = cell[2] ?? ''
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const value = type === 's' ? strings[Number(raw)] ?? ''
        : type === 'inlineStr' ? runs(body)
          : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE')
            : decodeXml(raw ?? '')
      while (cells.length < at) cells.push('')
      cells[at] = value
      next = at + 1
    }
    if (cells.some(value => value.trim() !== '')) rows.push(cells)
  }
  return rows
}

// The first sheet in workbook order, resolved through the workbook relationships.
function firstSheetPath(workbook: string | null, relationships: string | null): string {
  const id = workbook ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1] : null
  if (id && relationships) {
    for (const match of relationships.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (new RegExp(`\\bId="${id}"`).test(match[1])) {
        const target = /\bTarget="([^"]+)"/.exec(match[1])?.[1]
        if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
      }
    }
  }
  return 'xl/worksheets/sheet1.xml'
}

export const XLSX_ERRORS: Record<string, string> = {
  not_xlsx: 'This file is not a readable .xlsx workbook. Save it as .xlsx or CSV and try again.',
  unsupported_xlsx: 'This workbook uses a format the import cannot read. Save it as CSV and try again.',
  xlsx_too_large: 'This workbook is too large to import. Keep it under 300 rows, or save it as CSV.',
}

export async function readXlsxTable(buffer: ArrayBuffer): Promise<{ table: string[][]; error: string | null }> {
  try {
    const bytes = new Uint8Array(buffer)
    const entries = zipEntries(bytes)
    const [workbook, relationships, strings] = await Promise.all([
      readPart(bytes, entries, 'xl/workbook.xml'),
      readPart(bytes, entries, 'xl/_rels/workbook.xml.rels'),
      readPart(bytes, entries, 'xl/sharedStrings.xml'),
    ])
    const sheet = await readPart(bytes, entries, firstSheetPath(workbook, relationships))
    if (!sheet) return { table: [], error: XLSX_ERRORS.not_xlsx }
    return { table: worksheetRows(sheet, strings ? sharedStrings(strings) : []), error: null }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return { table: [], error: XLSX_ERRORS[code] ?? XLSX_ERRORS.not_xlsx }
  }
}
