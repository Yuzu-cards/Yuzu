// An in-memory Google for tests: the sign-in script, Drive v3 (files, changes, upload, download) and Calendar v3.
export function fakeGoogle() {
  const files = new Map<string, { id: string; name: string; parents: string[]; mime: string; bytes: Uint8Array; trashed?: boolean; t?: number }>();
  const changes: { id: string; removed: boolean }[] = []; let seq = 0; let nextId = 1;
  const events: any[] = [];
  const mkId = () => "f" + nextId++;
  const add = (name: string, parents: string[], mime: string, bytes: Uint8Array) => { const id = mkId(); files.set(id, { id, name, parents, mime, bytes, t: Date.now() }); changes.push({ id, removed: false }); return id; };
  const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  const parseQ = (q: string) => { const name = /name = '([^']*)'/.exec(q)?.[1]; const parent = /'([^']*)' in parents/.exec(q)?.[1]; const folder = /mimeType = 'application\/vnd.google-apps.folder'/.test(q); return { name, parent, folder }; };
  return {
    files, events, calendars: [{ id: "primary", summary: "Amro", primary: true }, { id: "rota@group", summary: "ER rota" }],
    seedEvent(summary: string, startIso: string, endIso: string, allDay = false) { events.push({ id: "e" + events.length, summary, start: allDay ? { date: startIso } : { dateTime: startIso }, end: allDay ? { date: endIso } : { dateTime: endIso } }); },
    /** Put a file at a Drive path like ["My Apps", "Yuzu", "media"], creating folders as the apps would. */
    seedFile(name: string, path: string[], bytes: Uint8Array, mime = "image/png") { let parent = "root"; for (const seg of path) { let f = [...files.values()].find((x) => x.name === seg && x.mime.endsWith("folder") && x.parents.includes(parent) && !x.trashed); if (!f) f = files.get(add(seg, [parent], "application/vnd.google-apps.folder", new Uint8Array()))!; parent = f.id; } return add(name, [parent], mime, bytes); },
    at(path: string[]): Map<string, string> { let parent = "root"; for (const seg of path) { const f = [...files.values()].find((x) => x.name === seg && x.mime.endsWith("folder") && x.parents.includes(parent) && !x.trashed); if (!f) return new Map(); parent = f.id; } const m = new Map<string, string>(); for (const f of files.values()) if (f.parents.includes(parent) && !f.trashed && !f.mime.endsWith("folder")) m.set(f.name, new TextDecoder().decode(f.bytes)); return m; },
    async fetchImpl(url: string, init: RequestInit = {}): Promise<Response> {
      const u = new URL(url); const m = init.method ?? "GET";
      const bodyText = async () => (typeof init.body === "string" ? init.body : init.body ? await new Response(init.body as any).text() : ""); const hs = (init.headers as any) ?? {}; const auth = hs.Authorization ?? hs.authorization ?? "";
      if (!/^Bearer tok/.test(auth)) return json({ error: { message: "Invalid Credentials" } }, 401);
      if (u.pathname === "/oauth2/v3/userinfo") return json({ email: "amro@example.com" });
      if (u.pathname === "/drive/v3/about") return json({ storageQuota: { usage: 1e9, limit: 15e9 } });
      if (u.pathname === "/drive/v3/changes/startPageToken") return json({ startPageToken: String(changes.length) });
      if (u.pathname === "/drive/v3/changes") { const from = Number(u.searchParams.get("pageToken") ?? 0); const out = changes.slice(from).map((c) => ({ removed: c.removed, file: files.get(c.id) ? { id: c.id, name: files.get(c.id)!.name, size: String(files.get(c.id)!.bytes.length), parents: files.get(c.id)!.parents, trashed: !!files.get(c.id)!.trashed } : undefined })); return json({ changes: out, newStartPageToken: String(changes.length) }); }
      if (u.pathname === "/drive/v3/files" && m === "GET") {
        const { name, parent, folder } = parseQ(u.searchParams.get("q") ?? ""); const size = Number(u.searchParams.get("pageSize") ?? 100); const page = Number(u.searchParams.get("pageToken") ?? 0);
        const all = [...files.values()].filter((f) => !f.trashed && (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!folder || f.mime.endsWith("folder")));
        const slice = all.slice(page, page + size); return json({ files: slice.map((f) => ({ id: f.id, name: f.name, size: String(f.bytes.length), mimeType: f.mime, modifiedTime: new Date(f.t ?? 0).toISOString() })), nextPageToken: page + size < all.length ? String(page + size) : undefined });
      }
      if (u.pathname === "/drive/v3/files" && m === "POST") { const b = JSON.parse(await bodyText()); return json({ id: add(b.name, b.parents ?? ["root"], b.mimeType ?? "application/octet-stream", new Uint8Array()) }); }
      if (u.pathname === "/upload/drive/v3/files" && m === "POST") {
        const buf = new Uint8Array(await (init.body as Blob).arrayBuffer()); const find = (pat: string, from = 0) => { const p = new TextEncoder().encode(pat); outer: for (let i = from; i <= buf.length - p.length; i++) { for (let j = 0; j < p.length; j++) if (buf[i + j] !== p[j]) continue outer; return i; } return -1; };
        const h1 = find("\r\n\r\n"), h1e = find("\r\n--", h1); const meta = JSON.parse(new TextDecoder().decode(buf.slice(h1 + 4, h1e)));
        const h2 = find("\r\n\r\n", h1e + 4) + 4; let end = buf.length; for (let i = buf.length - 4; i > h2; i--) if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 45 && buf[i + 3] === 45) { end = i; break; }
        return json({ id: add(meta.name, meta.parents, "image/png", buf.slice(h2, end)) });
      }
      const dl = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
      if (dl && u.searchParams.get("alt") === "media") { const f = files.get(dl[1]); return f && !f.trashed ? new Response(f.bytes as BlobPart, { status: 200 }) : json({ error: { message: "not found" } }, 404); }
      if (dl && m === "GET") { const f = files.get(dl[1]); return f ? json({ id: f.id, name: f.name, trashed: !!f.trashed, mimeType: f.mime, parents: f.parents }) : json({ error: { message: "not found" } }, 404); }
      if (dl && m === "DELETE") { const f = files.get(dl[1]); if (f) { f.trashed = true; changes.push({ id: f.id, removed: true }); } return new Response(null, { status: 204 }); }
      const up = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
      if (up && m === "PATCH") { const f = files.get(up[1]); if (!f) return json({ error: { message: "not found" } }, 404); f.bytes = new Uint8Array(await new Response(init.body as any).arrayBuffer()); changes.push({ id: f.id, removed: false }); return json({ id: f.id }); }
      if (u.pathname === "/calendar/v3/users/me/calendarList") return json({ items: this.calendars });
      const ev = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(u.pathname);
      if (ev && m === "GET") { const min = u.searchParams.get("timeMin")!, max = u.searchParams.get("timeMax")!; return json({ items: events.filter((e) => { const s = e.start.dateTime ?? e.start.date + "T00:00:00"; return s >= min.slice(0, 10) && s <= max; }) }); }
      if (ev && m === "POST") { const b = JSON.parse(await bodyText()); events.push({ id: "e" + events.length, ...b }); return json({ id: "e" + (events.length - 1) }); }
      return json({ error: { message: "no such endpoint " + u.pathname } }, 404);
    },
    /** The stub for https://accounts.google.com/gsi/client: hands out a token at once. */
    gisScript: `window.google = { accounts: { oauth2: { initTokenClient(o) { return { requestAccessToken() { setTimeout(() => o.callback({ access_token: "tok" + Date.now(), expires_in: 3600, scope: o.scope }), 20); } }; } } } };`,
  };
}
