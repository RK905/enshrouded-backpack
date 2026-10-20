// Enshrouded 1.0 ".ksd" save container (SV2C) — parse / rebuild.
// Depends on: XXH3 (xxh3.js), fzstd-style `zstdDecompress(Uint8Array) -> Uint8Array`.
const KSD = (() => {
  const td = new TextDecoder(), te = new TextEncoder();
  const u32 = (b, o) => (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0;
  const u16 = (b, o) => b[o] | (b[o+1] << 8);
  const put32 = (b, o, v) => { b[o] = v & 255; b[o+1] = (v >>> 8) & 255; b[o+2] = (v >>> 16) & 255; b[o+3] = (v >>> 24) & 255; };
  const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  const HEADER = 48, ENTRY = 20, BLOCK_HDR = 14;

  function fail(msg) { throw new Error(msg); }

  // Wrap bytes in a valid zstd frame made of raw (stored) blocks.
  function zstdStore(data) {
    const MAXB = 128 * 1024;
    const nBlocks = Math.max(1, Math.ceil(data.length / MAXB));
    const out = new Uint8Array(4 + 1 + 4 + nBlocks * 3 + data.length);
    out.set([0x28, 0xb5, 0x2f, 0xfd], 0);
    out[4] = 0xA0;                       // FCS 4 bytes, single segment, no checksum
    put32(out, 5, data.length);
    let o = 9;
    for (let i = 0; i < nBlocks; i++) {
      const chunk = data.subarray(i * MAXB, Math.min(data.length, (i + 1) * MAXB));
      const last = i === nBlocks - 1 ? 1 : 0;
      // A chunk of one repeated byte becomes a zstd RLE block (1 byte instead of up to 128 KB),
      // which keeps large uniform sections such as a fully revealed fog-of-war map small.
      let same = chunk.length > 8;
      for (let j = 1; same && j < chunk.length; j++) if (chunk[j] !== chunk[0]) same = false;
      const h = last | ((same ? 1 : 0) << 1) | (chunk.length << 3);
      out[o] = h & 255; out[o+1] = (h >>> 8) & 255; out[o+2] = (h >>> 16) & 255; o += 3;
      if (same) out[o++] = chunk[0]; else { out.set(chunk, o); o += chunk.length; }
    }
    return out.subarray(0, o);
  }

  function parse(file, zstdDecompress) {
    const b = file instanceof Uint8Array ? file : new Uint8Array(file);
    if (b.length < HEADER) fail('File is too small to be an Enshrouded save.');
    if (td.decode(b.subarray(0, 4)) !== 'SV2C') fail('Not an Enshrouded 1.0 save (missing SV2C header).');
    const version = u16(b, 4), headerSize = u16(b, 6), fileSize = u32(b, 8);
    if (headerSize !== HEADER) fail(`Unsupported header size ${headerSize}.`);
    if (fileSize !== b.length) fail(`Header says ${fileSize} bytes but the file has ${b.length}. It may be truncated.`);
    const guid = b.slice(12, 28);
    const revision = u32(b, 28);
    const timestamp = u32(b, 32) + u32(b, 36) * 4294967296;
    const tableAt = 0x28 + u32(b, 0x28), count = u32(b, 0x2c);
    if (tableAt + count * ENTRY > b.length || count > 4096) fail('Section table is out of range.');
    const sections = [];
    for (let i = 0; i < count; i++) {
      const at = tableAt + ENTRY * i;
      const nameAt = at + u32(b, at), nameLen = u32(b, at + 4);
      const off = u32(b, at + 8), size = u32(b, at + 12), hash = u32(b, at + 16);
      if (nameAt + nameLen > b.length || off + size > b.length) fail(`Section ${i} is out of range.`);
      const name = td.decode(b.subarray(nameAt, nameAt + nameLen));
      const block = b.slice(off, off + size);
      if (td.decode(block.subarray(0, 4)) !== 'S2BH') fail(`Section ${name} has no S2BH block header.`);
      const blockVersion = u32(block, 4), typeId = block[8], compressed = block[9], dataVersion = u32(block, 10);
      const body = block.subarray(BLOCK_HDR);
      let data;
      if (compressed === 1) data = zstdDecompress(body);
      else if (compressed === 0) data = body.slice();
      else fail(`Section ${name} uses unknown compression ${compressed}.`);
      const hashOk = XXH3.low32(block) === hash;
      sections.push({ name, offset: off, block, hash, hashOk, blockVersion, typeId, compressed, dataVersion,
                      original: data.slice(), data });
    }
    return { version, guid, revision, timestamp, sections, original: b };
  }

  function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function build(save, opts = {}) {
    const blocks = save.sections.map(s => {
      if (sameBytes(s.data, s.original)) return { s, block: s.block, hash: s.hash };
      const body = s.compressed === 1 ? zstdStore(s.data) : s.data;
      const block = new Uint8Array(BLOCK_HDR + body.length);
      block.set(s.block.subarray(0, BLOCK_HDR), 0);
      block.set(body, BLOCK_HDR);
      return { s, block, hash: XXH3.low32(block) };
    });
    const names = save.sections.map(s => te.encode(s.name));
    let pos = HEADER;
    const offsets = blocks.map(x => { const o = pos; pos += x.block.length; return o; });
    const tableAt = (pos + 15) & ~15;
    const namesAt = tableAt + ENTRY * blocks.length;
    const total = namesAt + names.reduce((n, x) => n + x.length, 0);
    const out = new Uint8Array(total);
    out.set(save.original.subarray(0, HEADER), 0);
    put32(out, 8, total);
    if (opts.timestamp) { put32(out, 32, opts.timestamp % 4294967296); put32(out, 36, Math.floor(opts.timestamp / 4294967296)); }
    if (opts.revision) put32(out, 28, opts.revision);
    put32(out, 0x28, tableAt - 0x28);
    put32(out, 0x2c, blocks.length);
    blocks.forEach((x, i) => out.set(x.block, offsets[i]));
    let nameAt = namesAt;
    blocks.forEach((x, i) => {
      const at = tableAt + ENTRY * i;
      put32(out, at, nameAt - at); put32(out, at + 4, names[i].length);
      put32(out, at + 8, offsets[i]); put32(out, at + 12, x.block.length); put32(out, at + 16, x.hash);
      out.set(names[i], nameAt); nameAt += names[i].length;
    });
    return out;
  }

  return { parse, build, zstdStore, u32, u16, put32, hex, sameBytes };
})();
if (typeof module !== 'undefined') module.exports = KSD;
