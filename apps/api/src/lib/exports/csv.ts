/**
 * Écriture CSV pour les exports (Lot 9) : séparateur `;` et BOM UTF-8 pour que
 * Excel français ouvre les accents correctement, guillemets RFC 4180, et
 * neutralisation de l'injection de formule (OWASP « CSV injection ») — un nom
 * de compétiteur comme `=HYPERLINK(...)` ne doit jamais devenir une formule
 * dans le tableur de l'organisateur.
 */
// U+FEFF : sans lui, Excel lit un CSV UTF-8 en ANSI et abîme les accents.
const BOM = String.fromCharCode(0xfeff)
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  // Un nombre reste un nombre : seul du TEXTE commençant par un préfixe de
  // formule est neutralisé.
  if (typeof value === 'string' && FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`
  }
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return `${BOM}${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`
}
