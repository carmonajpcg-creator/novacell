/**
 * Celda CSV segura. Una celda de texto que empiece con = + - @ (o tabulador/retorno) la interpretaría Excel u otra
 * hoja de cálculo como una FÓRMULA (inyección CSV): se neutraliza anteponiendo una comilla. Los números no se tocan.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const BOM = String.fromCharCode(0xfeff)

/** CSV con BOM UTF-8 (para que Excel respete los acentos) y saltos de línea CRLF. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','))
  return `${BOM}${lines.join('\r\n')}\r\n`
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
