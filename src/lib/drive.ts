// Google Drive as the master copy of the media library. One folder, Yuzu/media, holds every image and sound by its Anki
// file name; an index of it (name → file id and size) is kept here and refreshed through the Drive changes feed, so a
// device with 47,000 files on Drive lists them once and then only reads what changed.
import { gfetch, GoogleError } from "./google";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
export interface DriveIndex { root: string; media: string; files: Record<string, { id: string; s: number }>; changes: string; at: number; complete: boolean; nextPage?: string }

export class DriveMedia {
  constructor(private fetchImpl = gfetch) {}
  private async json(url: string, init?: RequestInit) { const r = await this.fetchImpl(url, init); return r.status === 404 ? null : r.json(); }
  private q(s: string) { return encodeURIComponent(s); }

  private async folder(name: string, parent: string | null): Promise<string> {
    const q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and trashed = false and '${parent ?? "root"}' in parents`;
    const found = await this.json(`${API}/files?q=${this.q(q)}&fields=files(id)&pageSize=1&spaces=drive`);
    if (found?.files?.[0]?.id) return found.files[0].id;
    const made = await this.json(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, parents: parent ? [parent] : undefined }) });
    return made.id;
  }
  /** Yuzu/media on Drive, created when missing. */
  async ensure(prev: DriveIndex | null): Promise<DriveIndex> {
    if (prev?.media) return prev;
    const root = await this.folder("Yuzu", null); const media = await this.folder("media", root);
    const start = await this.json(`${API}/changes/startPageToken`);
    return { root, media, files: {}, changes: start?.startPageToken ?? "", at: 0, complete: false };
  }
  /**
   * Bring the index up to date. A fresh index lists the folder page by page (1,000 files each; `budgetMs` bounds one
   * run and the page cursor is kept, so a huge folder is finished over a few syncs). A complete index then reads the
   * changes feed, which is one small request when nothing changed.
   */
  async refresh(idx: DriveIndex, budgetMs = 20000, progress?: (m: string) => void): Promise<DriveIndex> {
    const t0 = Date.now(); let out: DriveIndex = { ...idx, files: { ...idx.files } };
    if (!out.complete) {
      const q = `'${out.media}' in parents and trashed = false`;
      do {
        const page = await this.json(`${API}/files?q=${this.q(q)}&fields=nextPageToken,files(id,name,size)&pageSize=1000&spaces=drive${out.nextPage ? `&pageToken=${this.q(out.nextPage)}` : ""}`);
        for (const f of page?.files ?? []) out.files[f.name] = { id: f.id, s: Number(f.size) || 0 };
        out.nextPage = page?.nextPageToken || undefined;
        progress?.(`Reading Drive: ${Object.keys(out.files).length.toLocaleString()} files`);
        if (!out.nextPage) { out.complete = true; break; }
      } while (Date.now() - t0 < budgetMs);
      out.at = Date.now(); return out;
    }
    let token = out.changes;
    for (let i = 0; i < 50 && token; i++) {
      const page = await this.json(`${API}/changes?pageToken=${this.q(token)}&fields=nextPageToken,newStartPageToken,changes(removed,file(id,name,size,parents,trashed))&pageSize=1000&spaces=drive`);
      for (const c of page?.changes ?? []) {
        const f = c.file; if (!f) continue;
        const ours = (f.parents ?? []).includes(out.media);
        if (c.removed || f.trashed || !ours) { for (const [n, v] of Object.entries(out.files)) if (v.id === f.id) delete out.files[n]; }
        else out.files[f.name] = { id: f.id, s: Number(f.size) || 0 };
      }
      token = page?.nextPageToken || ""; if (page?.newStartPageToken) out.changes = page.newStartPageToken;
    }
    out.at = Date.now(); return out;
  }
  /** Upload one file into the media folder (multipart, fine up to a few MB). Returns its id. */
  async upload(idx: DriveIndex, name: string, blob: Blob): Promise<string> {
    const meta = JSON.stringify({ name, parents: [idx.media] });
    const boundary = "yuzu" + Math.random().toString(36).slice(2);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`;
    const body = new Blob([head, blob, `\r\n--${boundary}--`]);
    const r = await this.fetchImpl(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    const j = await r.json(); if (!j?.id) throw new GoogleError("Drive did not return a file id."); return j.id;
  }
  async download(id: string): Promise<Blob | null> {
    const r = await this.fetchImpl(`${API}/files/${id}?alt=media`); return r.status === 404 ? null : r.blob();
  }
  async about(): Promise<{ used: number; limit: number } | null> {
    const j = await this.json(`${API}/about?fields=storageQuota`); const q = j?.storageQuota; return q ? { used: Number(q.usage) || 0, limit: Number(q.limit) || 0 } : null;
  }
}
