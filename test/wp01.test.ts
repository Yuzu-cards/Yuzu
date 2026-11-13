// WP01: card HTML/CSS security (10-2, 10-3, 10-5, 10-13).
// The sanitiser relies on the browser's own HTML and CSS parsers, so its corpus runs in real Chromium (Playwright):
// every payload is cleaned, mounted in a shadow root as the app does, links and buttons are clicked, and nothing may run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as esbuild from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import { renderCard, rewriteMedia } from "../src/lib/render.ts";
import { parsePack, describePack, packMediaName, PACK_MEDIA_MAX } from "../src/import/pack.ts";
import type { Notetype } from "../src/lib/model.ts";

const P = "top.__pwn=(top.__pwn||0)+1";
const XSS: string[] = [
  `<script>${P}</script>`,
  `<SCRIPT SRC=data:text/javascript,${P}></SCRIPT>`,
  `<img src=x onerror="${P}">`,
  `<img src="http://127.0.0.1:1/x.png"onerror="${P}">`,
  `<img src="http://127.0.0.1:1/x.png"/onerror="${P}">`,
  `<img src=x ONERROR=${P}>`,
  `<img src=x onerror&#x3d;"${P}">`,
  `<svg onload="${P}"></svg>`,
  `<svg><script>${P}</script></svg>`,
  `<svg><animate onbegin="${P}" attributeName="x" dur="1s"/></svg>`,
  `<svg><a><animate attributeName="href" values="javascript:${P}"/><text x="20" y="20">tap</text></a></svg>`,
  `<svg><set attributeName="onmouseover" to="${P}"/></svg>`,
  `<svg><foreignObject><img src=x onerror="${P}"></foreignObject></svg>`,
  `<svg><use href="data:image/svg+xml,<svg id='x' xmlns='http://www.w3.org/2000/svg'><image href='x' onerror='${P}'/></svg>#x"/></svg>`,
  `<math><mtext><table><mglyph><style><img src=x onerror="${P}">`,
  `<iframe srcdoc="&lt;script&gt;parent.__pwn=1&lt;/script&gt;"></iframe>`,
  `<iframe src="javascript:${P}"></iframe>`,
  `<object data="javascript:${P}"></object>`,
  `<embed src="javascript:${P}">`,
  `<a href="javascript:${P}">tap</a>`,
  `<a href="jav&#x61;script:${P}">tap</a>`,
  `<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;${P}">tap</a>`,
  `<a href=" \tjava\nscript:${P}">tap</a>`,
  `<a href="JaVaScRiPt:${P}">tap</a>`,
  `<a href="vbscript:msgbox(1)">tap</a>`,
  `<a href="data:text/html,<script>${P}</script>">tap</a>`,
  `<form><button formaction="javascript:${P}">tap</button></form>`,
  `<button formaction="javascript:${P}">tap</button>`,
  `<input onfocus="${P}" autofocus>`,
  `<input type="image" src=x onerror="${P}">`,
  `<details open ontoggle="${P}"><summary>x</summary></details>`,
  `<video><source onerror="${P}"></video>`,
  `<audio src=x onerror="${P}"></audio>`,
  `<body onload="${P}">`,
  `<marquee onstart="${P}">x</marquee>`,
  `<div style="background:url(javascript:${P})">x</div>`,
  `<div style="width:expression(${P})">x</div>`,
  `<style>@import "javascript:${P}";</style>`,
  `<style>@\\69mport url(http://127.0.0.1:1/evil.css);</style>`,
  `<style></style><img src=x onerror="${P}"><style></style>`,
  `<noscript><p title="</noscript><img src=x onerror=${P}>">`,
  `<template><img src=x onerror="${P}"></template>`,
  `<meta http-equiv="refresh" content="0;url=javascript:${P}">`,
  `<base href="javascript:${P}//">`,
  `<link rel="import" href="data:text/html,<script>${P}</script>">`,
  `<!--<img src=x onerror="${P}">-->`,
  `<img src="x" srcset="javascript:${P}">`,
  `<p id="x"><img src=x onerror=${P}//</p>`,
  `<xmp><img src=x onerror="${P}"></xmp>`,
  `<textarea><img src=x onerror="${P}"></textarea>`,
  `<select><option><img src=x onerror="${P}"></option></select>`,
  `<title><img src=x onerror="${P}"></title>`,
  `<custom-el onclick="${P}">tap</custom-el>`,
  `<div onclick="${P}">tap</div>`,
  `<span class="cloze" onmouseover="${P}" onclick="${P}">tap</span>`,
];

let browser: Browser; let page: Page;
before(async () => {
  const js = (await esbuild.build({ entryPoints: ["src/lib/sanitize.ts"], bundle: true, format: "iife", globalName: "S", write: false })).outputFiles[0].text;
  browser = await chromium.launch(); page = await browser.newPage();
  await page.setContent("<!doctype html><html><body><div id=host></div></body></html>");
  await page.addScriptTag({ content: js });
});
after(async () => { await browser?.close(); });

/** Clean in the page, mount in a shadow root like CardView, tap everything; returns what is left. */
async function mount(html: string, css = "", tap = true) {
  return page.evaluate(async ({ html, css, tap }) => {
    const S = (window as any).S; (window as any).__pwn = 0;
    const host = document.getElementById("host")!; host.replaceWith(host.cloneNode(false)); const h = document.getElementById("host")!;
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<style></style><div class="card"></div>`; root.querySelector("style")!.textContent = S.sanitizeCss(css);
    root.querySelector(".card")!.append(S.sanitizeFragment(html));
    if (tap) for (const el of root.querySelectorAll<HTMLElement>("a,button,div,span,summary,custom-el")) { try { el.click(); el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); } catch { /* fine */ } }
    await new Promise((r) => setTimeout(r, 120));
    const card = root.querySelector(".card")!;
    const attrs = [...card.querySelectorAll("*")].flatMap((e) => [...e.attributes].map((a) => a.name + "=" + a.value));
    return { pwn: (window as any).__pwn as number, out: card.innerHTML, attrs, sheet: root.querySelector("style")!.textContent ?? "", text: (card as HTMLElement).innerText, location: location.href };
  }, { html, css, tap });
}

test("10-2: XSS corpus — nothing runs, no handlers, no script URLs, no dangerous elements left", async () => {
  // Control: the harness does see a handler run when nothing cleans the HTML.
  const raw = await page.evaluate(async (P) => { (window as any).__pwn = 0; const d = document.createElement("div"); d.innerHTML = `<img src=x onerror="${P}">`; document.body.append(d); await new Promise((r) => setTimeout(r, 150)); d.remove(); return (window as any).__pwn; }, P);
  assert.equal(raw, 1, "harness control");
  for (const x of XSS) {
    const r = await mount(x);
    assert.equal(r.pwn, 0, `ran: ${x}`);
    assert.ok(!r.attrs.some((a) => /^on/i.test(a)), `handler left: ${x} → ${r.out}`);
    assert.ok(!r.attrs.some((a) => /^(href|src|xlink:href|formaction|action|srcdoc|srcset|data)=/.test(a) && /^\s*(javascript|vbscript|data:text)/i.test(a.split("=").slice(1).join("="))), `script URL left: ${x} → ${r.out}`);
    assert.ok(!/<(script|iframe|object|embed|form|meta|base|link|math|foreignobject|animate|set|template|noscript)\b/i.test(r.out), `element left: ${x} → ${r.out}`);
    assert.ok(!/@import/i.test(r.out), `@import left: ${x} → ${r.out}`);
    assert.ok(/^about:blank/.test(r.location), "no navigation");
  }
});

test("10-3: note-type CSS cannot break out of <style> or import or run anything", async () => {
  const css = `.card{color:red}</style><img src='http://127.0.0.1:1/x' onerror="${P}"><style>`;
  const r = await mount("<div>Front</div>", css);
  assert.equal(r.pwn, 0); assert.equal(r.out, "<div>Front</div>");
  assert.ok(!r.sheet.includes("<"), r.sheet);
  const r2 = await mount("x", `@import url("http://127.0.0.1:1/a.css"); @\\69mport 'b.css'; .a{background:url(javascript:${P})} .b{background:url("j\\61vascript:x")} .c{width:expression(alert(1))} .d{-moz-binding:url(x)} .e{behavior:url(x.htc)}`);
  assert.equal(r2.pwn, 0);
  assert.ok(!/@import|javascript|expression\(|-moz-binding|[\s;{]behavior\s*:/i.test(r2.sheet.replace(/\\[0-9a-f]+ ?/gi, "")), r2.sheet);
  // Ordinary deck CSS comes through unchanged (fonts, night mode, nth-child, content strings).
  const deck = `.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }\n.nightMode .card { color: #eee }\n@font-face { font-family: X; src: url("blob:http://x/1"); }\ntable tr:nth-child(2n) td { background: #f5f5f5 }\n.cloze { font-weight: bold; color: blue; }\n#extra::before { content: "Extra"; }\n@media (max-width: 600px) { .card { font-size: 18px } }`;
  const r3 = await mount("x", deck); assert.equal(r3.sheet, deck);
});

const MEDICAL = [
  "Symptom onset = 2 weeks before admission; dose given once = daily",
  "K<sup>+</sup> &gt; 6.5 mmol/L → give IV calcium gluconate 10%, 10&ndash;30 mL",
  "pH < 7.35 and HCO<sub>3</sub><sup>−</sup> < 22 mEq/L means metabolic acidosis",
  "ondansetron = 4 mg IV; onions=fine; oncology referral; 'on call' = registrar",
  "Javascript: not a drug. Data: n=120, p<0.05",
  "Tachycardia (HR > 100) <b>and</b> <i>hypotension</i> <u>=</u> shock until proven otherwise",
];

test("10-5: ordinary medical text is never changed", async () => {
  for (const t of MEDICAL) {
    const r = await mount(t);
    const expect = await page.evaluate((t) => { const d = document.createElement("div"); d.innerHTML = t; return d.innerHTML; }, t);
    assert.equal(r.out, expect, t);
  }
  // …and the renderer no longer edits text before it gets there (the old regex ate " onset = 2" and the answer line).
  const nt: Notetype = { id: "b", name: "Basic", kind: "normal", fields: ["Front", "Back"], templates: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" }], css: "" } as any;
  const r = renderCard({ note: { id: "n", ntid: "b", guid: "n", fields: [MEDICAL[0], "A"], tags: [], created: 0, modified: 0 } as any, notetype: nt, ord: 0 });
  assert.equal(r.back, `${MEDICAL[0]}<hr id=answer>A`);
  assert.equal(rewriteMedia(MEDICAL[3]), MEDICAL[3]);
});

test("Anki card features survive cleaning: cloze, images, sounds, tables, lists, sub/sup, font colours, IO boxes, hints, links", async () => {
  const html = [
    `<span class="cloze" data-cloze="1">[...]</span> <span class="cloze-inactive">x</span>`,
    `<img src="blob:http://127.0.0.1/abc" alt="ECG" width="200"> <img src="data:image/png;base64,iVBORw0KGgo=" style="max-width:50%">`,
    `<img data-missing="a b.png" alt="" class="missing-media" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3C/svg%3E">`,
    `<button type="button" class="yz-sound" data-src="blob:http://127.0.0.1/s1" aria-label="Play sound"><svg viewBox="0 0 12 12" width="18" height="18" shape-rendering="crispEdges" fill="currentColor"><path d="M2 1h2v1h2"></path></svg></button>`,
    `<button type="button" class="yz-sound tts" data-src="tts:de-DE:der%20Hund" aria-label="Say it"></button>`,
    `<audio controls="" src="data:audio/mpeg;base64,AAAA"></audio>`,
    `<table border="1" style="border-collapse:collapse"><thead><tr><th colspan="2">Drug</th></tr></thead><tbody><tr><td rowspan="1" bgcolor="#eee">Adenosine</td><td>6 mg</td></tr></tbody></table>`,
    `<ul><li>one</li></ul><ol start="3" type="a"><li>two</li></ol>`,
    `H<sub>2</sub>O, x<sup>2</sup>, <font color="#ff0000" face="Arial" size="4">red</font>, <span style="color: rgb(0, 0, 255); background-color: yellow;">blue</span>`,
    `<div class="io"><img src="blob:http://127.0.0.1/io"><div class="io-box io-hide" style="left:10%;top:20%;width:30%;height:5%"></div></div>`,
    `<details class="yz-hint"><summary>Sketchy</summary><div class="hints">hint</div></details>`,
    `<div id="extra" class="extra">Extra</div><hr id="answer"><input class="typeans" placeholder="Type the answer">`,
    `<a href="https://www.ncbi.nlm.nih.gov/books/NBK1/">StatPearls</a> <a href="#ref1">[1]</a>`,
    `<ruby>漢<rt>kan</rt></ruby> <code>QTc</code> <pre>a  b</pre> <blockquote>q</blockquote> <center>c</center> <s>old</s>`,
  ];
  for (const h of html) {
    const r = await mount(h, "", false);
    const want = await page.evaluate((t) => { const d = document.createElement("div"); d.innerHTML = t; for (const a of d.querySelectorAll("a[href^=http]")) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener noreferrer"); } return d.innerHTML; }, h);
    assert.equal(r.out, want, h);
  }
  // Unknown wrappers (forms, custom tags from add-ons) are unwrapped: their text stays.
  assert.equal((await mount(`<anki-mathjax>x^2</anki-mathjax> <form><b>kept</b></form>`)).out, `x^2 <b>kept</b>`);
});

test("10-13: pack media names come from a known type, are short, and oversized or unknown media is reported", () => {
  const png = "data:image/png;base64," + "A".repeat(100);
  assert.match(packMediaName(png, "image")!, /^pack-[0-9a-f]{16}\.png$/);
  assert.match(packMediaName("data:image/png," + "A".repeat(120), "image")!, /^pack-[0-9a-f]{16}\.png$/);
  assert.match(packMediaName("data:image/svg+xml;base64,PHN2Zz4=", "image")!, /\.svg$/);
  assert.match(packMediaName("data:image/jpeg;base64,AAAA", "image")!, /\.jpeg$/);
  assert.match(packMediaName("data:audio/mpeg;base64,AAAA", "audio")!, /\.mp3$/);
  assert.match(packMediaName("data:audio/webm;codecs=opus;base64,AAAA", "audio")!, /\.webm$/);
  assert.equal(packMediaName("data:text/html;base64,PHNjcmlwdD4=", "image"), null);
  assert.equal(packMediaName("data:image/x-evil;base64,AAAA", "image"), null);
  assert.equal(packMediaName("data:audio/mpeg;base64,AAAA", "image"), null);
  assert.equal(packMediaName("data:image/png;base64," + "A".repeat(Math.ceil(PACK_MEDIA_MAX / 0.75) + 8), "image"), null);
  const r = parsePack({ yuzu_pack: 1, cards: [
    { front: "Q1", back: "A", image: png },
    { front: "Q2", back: "A", image: "data:text/html;base64,PHNjcmlwdD4=" },
    { type: "vocab", word: "Hund", meaning: "dog", audio: "data:application/x-evil;base64,AAAA" },
  ] }, []);
  assert.equal(r.media.length, 1); assert.equal(r.notes.length, 3); assert.equal(r.mediaRejected, 2);
  assert.ok(r.notes[0].fields[2].startsWith(`<img src="pack-`) && r.notes[0].fields[2].length < 40);
  assert.match(describePack(r), /2 pictures or sounds left out/);
});
