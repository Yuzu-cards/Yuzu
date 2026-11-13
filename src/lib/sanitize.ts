// Card HTML and note-type CSS come from other people's Anki decks, packs and the Drive/GitHub inbox, and they are
// shown inside Yuzu's own origin (a shadow root does not isolate script). Everything is cleaned here, with the
// browser's own parser (an inert <template>), against an allow-list: tags not on it are unwrapped (their text kept),
// dangerous ones are dropped with their contents, attributes not on the list (all on* handlers, srcdoc, formaction…)
// are removed, and URLs are checked after the parser has decoded entities. Text is never touched.

const DROP = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "noembed", "noframes", "template",
  "base", "link", "meta", "xmp", "plaintext", "portal", "param", "math", "foreignobject", "animate", "set",
  "animatemotion", "animatetransform", "discard", "handler", "listener",
]);

const HTML_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "audio", "b", "bdi", "bdo", "big", "blockquote", "br", "button", "caption",
  "center", "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption",
  "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "input", "ins", "kbd",
  "label", "li", "main", "mark", "nav", "nobr", "ol", "p", "picture", "pre", "q", "rp", "rt", "ruby", "s", "samp",
  "section", "small", "source", "span", "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "time", "tr", "track", "tt", "u", "ul", "var", "video", "wbr",
]);

const SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath", "title",
  "desc", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "use", "symbol", "marker",
  "image", "style",
]);

const ATTRS = new Set([
  // html
  "class", "id", "style", "title", "lang", "dir", "align", "valign", "width", "height", "color", "face", "size", "bgcolor",
  "border", "cellpadding", "cellspacing", "colspan", "rowspan", "span", "start", "reversed", "type", "alt", "src", "href",
  "target", "rel", "open", "controls", "loop", "muted", "preload", "poster", "autoplay", "tabindex", "role", "hidden",
  "placeholder", "for", "nowrap", "abbr", "scope", "headers", "summary", "datetime", "value", "checked", "disabled",
  "readonly", "label", "translate", "clear", "noshade", "compact", "loading", "decoding", "background", "kind", "srclang",
  "frame", "rules", "char", "charoff",
  // svg (compared lower-case)
  "xmlns", "xmlns:xlink", "xlink:href", "viewbox", "preserveaspectratio", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
  "r", "rx", "ry", "fx", "fy", "points", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "opacity", "font-size", "font-family", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
  "shape-rendering", "clip-rule", "clip-path", "mask", "offset", "stop-color", "stop-opacity", "gradientunits",
  "gradienttransform", "patternunits", "patterncontentunits", "patterntransform", "markerwidth", "markerheight", "refx",
  "refy", "orient", "markerunits", "dx", "dy", "rotate", "textlength", "lengthadjust", "vector-effect", "visibility",
  "display", "pathlength", "startoffset", "spreadmethod", "clippathunits", "maskunits", "maskcontentunits",
]);

const URL_ATTRS = new Set(["href", "src", "poster", "background", "xlink:href"]);
const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

/** True when a (parser-decoded) URL is safe for this attribute: http(s), blob, relative names, and only for media
 * data:image/… or data:audio/…; links may also be mailto: or #anchors. javascript:, vbscript:, data:text/html… are not. */
export function safeUrl(value: string, attr = "src"): boolean {
  // The URL parser ignores leading/trailing C0 controls and spaces, and tabs/newlines anywhere.
  const v = value.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!m) return true; // a media file name, #anchor or //host (http/https)
  const scheme = m[1].toLowerCase();
  if (scheme === "http" || scheme === "https" || scheme === "blob") return true;
  if (scheme === "mailto") return attr === "href";
  if (scheme === "data") return attr !== "href" && /^data:(image|audio|video)\/[a-z0-9.+-]+[;,]/i.test(v);
  return false;
}

/** Decode CSS escapes (\6a, \000061 , \j) and drop comments, so checks see what the CSS parser will see. */
function cssPlain(s: string): string {
  return s.replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => { const n = parseInt(h, 16); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/\\(.)/g, "$1").toLowerCase();
}
const CSS_BAD = /expression\s*\(|javascript:|vbscript:|-moz-binding|(^|[\s;{])behavior\s*:|@import/;

/** Neutralise url(javascript:…) and similar inside CSS text (escapes decoded before the check). */
function cleanUrls(css: string): string {
  return css.replace(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*))\s*\)/gi, (whole, a, b, c) => {
    const u = cssPlain(a ?? b ?? c ?? "").trim();
    return /^(javascript|vbscript):/.test(u.replace(/[\u0000- ]/g, "")) ? "none" : whole;
  });
}

/** A style="" attribute: drop only the declarations that try something (the rest of the look stays). */
export function sanitizeStyleAttr(style: string): string {
  if (!CSS_BAD.test(cssPlain(style)) && !/url\(/i.test(style)) return style;
  return cleanUrls(style).split(";").filter((d) => !CSS_BAD.test(cssPlain(d))).join(";");
}

const cssCache = new Map<string, string>();
/** A note type's CSS (or a <style> in a template): @import rules removed, url(javascript:), expression(),
 * behavior and -moz-binding neutralised, and "<" escaped so it can never close a <style>. */
export function sanitizeCss(css: string): string {
  if (!css) return "";
  const hit = cssCache.get(css); if (hit !== undefined) return hit;
  let out = css;
  const Sheet = (globalThis as any).CSSStyleSheet;
  let parsed = false;
  if (Sheet && CSS_BAD.test(cssPlain(css))) {
    // Let the browser parse it: replaceSync() ignores @import, and the rules come back with escapes normalised.
    try { const sh = new Sheet(); sh.replaceSync(css.replace(/@import[^;]*;?/gi, "")); out = [...sh.cssRules].map((r: CSSRule) => r.cssText).join("\n"); parsed = true; } catch { /* fall through */ }
  }
  if (!parsed) out = out.replace(/\/\*[\s\S]*?\*\//g, (c) => (/@import/i.test(c) ? "" : c)).replace(/@import[^;]*;?/gi, "");
  out = cleanUrls(out)
    .replace(/expression\s*\(/gi, "x(").replace(/-moz-binding\s*:/gi, "-x-binding:").replace(/(^|[\s;{])behavior\s*:/gi, "$1x-behavior:")
    .replace(/</g, "\\3c ");
  if (cssCache.size > 64) cssCache.clear();
  cssCache.set(css, out);
  return out;
}

function cleanElement(el: Element): void {
  const tag = el.localName.toLowerCase();
  for (const a of [...el.attributes]) {
    const name = a.name.toLowerCase();
    if (name.startsWith("on") || !(ATTRS.has(name) || /^data-[\w.-]+$/.test(name) || /^aria-[a-z]+$/.test(name))) { el.removeAttribute(a.name); continue; }
    if (URL_ATTRS.has(name)) {
      const ok = tag === "use" ? a.value.trim().startsWith("#") : safeUrl(a.value, name === "href" || name === "xlink:href" ? (tag === "image" ? "src" : "href") : "src");
      if (!ok) el.removeAttribute(a.name);
    } else if (name === "style") {
      const s = sanitizeStyleAttr(a.value); if (s !== a.value) el.setAttribute("style", s);
    } else if (name === "type" && tag === "input" && !/^(text|search)$/i.test(a.value.trim())) el.removeAttribute(a.name);
  }
  if (tag === "a" && /^https?:/i.test((el.getAttribute("href") ?? "").trim())) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
}

function walk(parent: Node): void {
  for (const node of [...parent.childNodes]) {
    if (node.nodeType === 3) continue; // text: kept exactly
    if (node.nodeType !== 1) { node.parentNode!.removeChild(node); continue; } // comments, processing instructions
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    const ns = el.namespaceURI;
    if (DROP.has(tag) || (ns !== HTML_NS && ns !== SVG_NS)) { el.remove(); continue; }
    if (tag === "style") { const css = sanitizeCss(el.textContent ?? ""); for (const a of [...el.attributes]) el.removeAttribute(a.name); el.textContent = css; continue; }
    const allowed = ns === SVG_NS ? SVG_TAGS.has(tag) : HTML_TAGS.has(tag);
    walk(el);
    if (!allowed) { el.replaceWith(...el.childNodes); continue; } // unknown wrapper (form, custom tags…): keep what is inside
    cleanElement(el);
  }
}

/** Parse card HTML inertly and return a cleaned fragment, ready to append (no re-parsing, so no mutation tricks). */
export function sanitizeFragment(html: string, doc: Document = document): DocumentFragment {
  const t = doc.createElement("template");
  t.innerHTML = html;
  walk(t.content);
  return t.content;
}

/** The same, as a string (tests, previews). */
export function sanitizeHtml(html: string, doc: Document = document): string {
  const t = doc.createElement("template");
  t.content.append(sanitizeFragment(html, doc));
  return t.innerHTML;
}
