// Numbers typed on an Arabic or Persian keyboard (from Orange's lib/num.js and Dragonfruit): ٠–٩ and ۰–۹ become 0–9,
// the Arabic decimal separator ٫ and the thousands separator ٬ become "." and "".
export function latinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)).replace(/٫/g, ".").replace(/٬/g, "");
}
/** A number from what was typed: Arabic-Indic digits, ٫ or a decimal comma ("2,5"); null when it isn't one. */
export function parseNum(s: string): number | null {
  let t = latinDigits(String(s)).trim().replace(/\s+/g, ""); if (!t) return null;
  // "1,307" (a comma before exactly three digits) is a thousands separator; "2,5" is a decimal comma
  if (/^-?\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, ""); else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  const n = Number(t); return Number.isFinite(n) ? n : null;
}
