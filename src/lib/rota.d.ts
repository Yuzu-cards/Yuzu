export function shiftInfo(code: string): { code: string; kind: "off" | "day" | "evening" | "late" | "night" | "leave" | "duty"; label: string; hours: string; start?: number; end?: number; location?: string; far?: boolean };
export function nameMatches(cell: string, name: string): boolean;
export function rotaFromXlsx(buf: ArrayBuffer | Uint8Array, name: string, today?: string): Promise<{ month: string | null; days: Record<string, string>; name: string; candidates: string[] }>;
export const KINDS: Record<string, { label: string; glyph: string; tone: string }>;
export const PICKS: string[];
