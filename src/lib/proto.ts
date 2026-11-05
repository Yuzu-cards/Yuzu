// Tiny protobuf wire-format reader. Returns raw fields; callers know the field numbers.
export interface ProtoField { num: number; wire: number; value: bigint | Uint8Array }

export function decodeProto(buf: Uint8Array): ProtoField[] {
  const out: ProtoField[] = [];
  let p = 0;
  const varint = (): bigint => {
    let v = 0n, shift = 0n;
    for (;;) {
      const b = buf[p++];
      v |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return v;
      shift += 7n;
      if (p > buf.length) throw new Error("Truncated varint");
    }
  };
  while (p < buf.length) {
    const key = Number(varint());
    const num = key >> 3, wire = key & 7;
    switch (wire) {
      case 0: out.push({ num, wire, value: varint() }); break;
      case 1: out.push({ num, wire, value: buf.subarray(p, p + 8) }); p += 8; break;
      case 2: { const len = Number(varint()); out.push({ num, wire, value: buf.subarray(p, p + len) }); p += len; break; }
      case 5: out.push({ num, wire, value: buf.subarray(p, p + 4) }); p += 4; break;
      default: throw new Error("Unsupported protobuf wire type " + wire);
    }
  }
  return out;
}

const dec = new TextDecoder();
export function protoString(fields: ProtoField[], num: number): string | undefined {
  const f = fields.find((x) => x.num === num && x.wire === 2);
  return f ? dec.decode(f.value as Uint8Array) : undefined;
}
export function protoInt(fields: ProtoField[], num: number): number | undefined {
  const f = fields.find((x) => x.num === num && x.wire === 0);
  return f ? Number(f.value as bigint) : undefined;
}
