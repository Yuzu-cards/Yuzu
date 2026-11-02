export function readXlsx(buf: ArrayBuffer | Uint8Array): Promise<{ name: string; rows: Map<number, Map<number, string | number>> }[]>;
export function serialToDate(n: number): string;
