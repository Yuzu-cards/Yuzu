// A small .xlsx reader: just enough to read a work schedule in the browser, offline.
// An .xlsx file is a zip of XML files. We read the zip directory, inflate the parts we need
// (DecompressionStream "deflate-raw", built into Chrome, Safari 16.4+, Firefox and Node 18+),
// and pull cell values out of the sheet XML. No formulas, styles or charts.

const td = new TextDecoder();

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open .xlsx files. Update it, or set the days by hand.");
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Map of file name → async () => Uint8Array, for every file in the zip. */
export function readZip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // End of central directory: signature 0x06054b50, searched from the end (a comment may follow it).
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This isn't an Excel (.xlsx) file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files[name] = async () => {
      const lnl = dv.getUint16(local + 26, true);
      const lel = dv.getUint16(local + 28, true);
      const start = local + 30 + lnl + lel;
      const data = u8.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error("Unsupported compression in this file.");
    };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const unescape = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

/** "AB" → 28 (1-based column number). */
export function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseShared(xml) {
  const out = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    // Rich text has several <t> runs; phonetic hints (<rPh>) are not part of the text.
    const body = si[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "");
    out.push(unescape([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
  }
  return out;
}

/**
 * One worksheet as { cells: Map("row:col" → value), rows: Map(row → Map(col → value)), merges: [{r1,c1,r2,c2}] }.
 * Values are strings, or numbers for numeric cells (dates stay Excel serial numbers).
 */
function parseSheet(xml, shared) {
  const rows = new Map();
  const put = (r, c, v) => {
    if (!rows.has(r)) rows.set(r, new Map());
    rows.get(r).set(c, v);
  };
  for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, col, row, attrs, inner = ""] = m;
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
    let v = null;
    if (t === "s") {
      const i = /<v>(\d+)<\/v>/.exec(inner)?.[1];
      v = i != null ? shared[+i] ?? "" : null;
    } else if (t === "inlineStr") {
      v = unescape([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(""));
    } else {
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (raw != null) v = t === "str" || t === "e" ? unescape(raw) : Number.isFinite(+raw) ? +raw : unescape(raw);
    }
    if (v !== null && v !== "") put(+row, colNum(col), v);
  }
  const merges = [];
  for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
    merges.push({ c1: colNum(m[1]), r1: +m[2], c2: colNum(m[3]), r2: +m[4] });
  }
  // A merged block shows its top-left value in every cell it covers ("Annual Leave" across 20 days).
  for (const g of merges) {
    const v = rows.get(g.r1)?.get(g.c1);
    if (v == null) continue;
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (!(r === g.r1 && c === g.c1)) put(r, c, v);
  }
  return { rows, merges };
}

/** Every worksheet in an .xlsx file, in workbook order. */
export async function readXlsx(buf) {
  const zip = readZip(buf);
  const text = async (name) => (zip[name] ? td.decode(await zip[name]()) : "");
  const shared = parseShared(await text("xl/sharedStrings.xml"));
  const names = Object.keys(zip)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/\d+/.exec(a.slice(14))[0]) - Number(/\d+/.exec(b.slice(14))[0]));
  if (!names.length) throw new Error("No sheets found in this file.");
  const sheets = [];
  for (const n of names) sheets.push(parseSheet(await text(n), shared));
  return sheets;
}

/** Excel's date serial (days since 1899-12-30) → "YYYY-MM-DD". */
export function serialToDate(n) {
  const d = new Date(Math.round((Number(n) - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
