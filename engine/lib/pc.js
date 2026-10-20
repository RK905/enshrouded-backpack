// Enshrouded 1.0 character payloads: character_data (name), player_character
// (level, XP, skills, inventory) and player_knowledge (known item/recipe ids).
const PCX = (() => {
  const td = new TextDecoder(), te = new TextEncoder();
  const u32 = (b, o) => (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0;
  const u16 = (b, o) => b[o] | (b[o+1] << 8);
  const w32 = (b, o, v) => { b[o] = v & 255; b[o+1] = (v >>> 8) & 255; b[o+2] = (v >>> 16) & 255; b[o+3] = (v >>> 24) & 255; };
  const w16 = (b, o, v) => { b[o] = v & 255; b[o+1] = (v >>> 8) & 255; };
  const hex8 = v => (v >>> 0).toString(16).padStart(8, '0');

  // ---- character_data: [u8 0][u32 type][u32 len][utf8 name][...rest]
  function parseCharacterData(d) {
    // Byte 0 is a flag (0 or 1); bytes 1-4 are a fixed signature; bytes 5-8 are the name length.
    if (d.length < 9 || d[1] !== 0x93 || d[2] !== 0x7b || d[3] !== 0x40 || d[4] !== 0xb6) throw new Error('Unexpected character_data layout.');
    const len = u32(d, 5);
    if (len > 256 || 9 + len > d.length) throw new Error('Character name length is out of range.');
    return { name: td.decode(d.subarray(9, 9 + len)), nameEnd: 9 + len };
  }
  function setName(d, name) {
    const info = parseCharacterData(d);
    const bytes = te.encode(name);
    const out = new Uint8Array(d.length - (info.nameEnd - 9) + bytes.length);
    out.set(d.subarray(0, 5), 0);
    w32(out, 5, bytes.length);
    out.set(bytes, 9);
    out.set(d.subarray(info.nameEnd), 9 + bytes.length);
    return out;
  }

  // ---- player_knowledge: [u32 version=1][u32 n][n x u32 id][n x u32 flags]
  function parseKnowledge(d) {
    const map = new Map();
    if (!d || d.length < 8) return map;
    const n = u32(d, 4);
    if (8 + 8 * n !== d.length) throw new Error('Unexpected player_knowledge layout.');
    for (let i = 0; i < n; i++) map.set(u32(d, 8 + 4 * i), u32(d, 8 + 4 * n + 4 * i));
    return map;
  }

  // ---- player_character
  // Inventory record: [u8 slot][u32 item][u16 count][u8 fields] then optional fields:
  //   bit0: u8 item level   bit1: u32 durability, u32 max durability
  //   bit4: u8 rarity (1 Common … 5 Legendary), u8 unknown   bit5: 5 bytes (unknown)
  //   bit2: 8 bytes (present on some items in newer saves)
  //   bit3: 4 bytes (an appearance/transmog reference, present on gear in newer saves)
  const FIELD_SIZES = { 0: 1, 1: 8, 2: 8, 3: 4, 4: 2, 5: 5 };
  function readRecord(d, at, isItem) {
    if (at + 8 > d.length) return null;
    const item = u32(d, at + 1);
    if (!isItem(item)) return null;
    const flags = d[at + 7];
    let p = at + 8;
    const rec = { off: at, slot: d[at], item, count: u16(d, at + 5), flags, level: null, durability: null, rarity: null, gem: null };
    for (let bit = 0; bit < 8; bit++) {
      if (!(flags >> bit & 1)) continue;
      const size = FIELD_SIZES[bit];
      if (size === undefined || p + size > d.length) return null;
      if (bit === 0) rec.level = { off: p, value: d[p] };
      if (bit === 1) rec.durability = { off: p, value: u32(d, p), max: u32(d, p + 4) };
      if (bit === 4) rec.rarity = { off: p, value: d[p] };   // 1 Common … 5 Legendary
      // bit5 (5 bytes) is a weapon's gem socket: [u32 gem item id][u8 marker]. Empty = all zero.
      if (bit === 5) rec.gem = { off: p, id: u32(d, p), mark: d[p + 4] };
      p += size;
    }
    if (rec.count === 0 && flags !== 0) return null;
    rec.end = p;
    return rec;
  }
  function readRun(d, at, isItem, limit) {
    const recs = [];
    let p = at, prev = -1;
    while (recs.length < limit) {
      const r = readRecord(d, p, isItem);
      if (!r || r.slot <= prev) break;
      recs.push(r); prev = r.slot; p = r.end;
    }
    return recs;
  }

  // Where the level field sits. Most saves have it at byte 58, after a short header and five
  // stat multipliers (floats). Some saves have a slightly longer or shorter header, so if 58
  // doesn't look right we look for the same pattern nearby: five sane floats, then
  // level, XP, a skill list with valid ranks, and a small status list.
  const f32v = (d, o) => new DataView(d.buffer, d.byteOffset + o, 4).getFloat32(0, true);
  function levelAt(d, o, minFloat) {
    if (o < 20 || o + 16 > d.length) return false;
    const lv = u32(d, o); if (lv < 1 || lv > 200) return false;
    for (let k = 1; k <= 5; k++) { const f = f32v(d, o - 4 * k); if (!(f >= minFloat && f <= 50)) return false; }
    const n = u32(d, o + 8); if (n > 400 || o + 12 + 5 * n + 4 > d.length) return false;
    for (let i = 0; i < n; i++) if (d[o + 16 + 5 * i] > 15) return false;
    return u32(d, o + 12 + 5 * n) <= 64;
  }
  const layoutCache = new WeakMap();
  function levelOffset(d) {
    if (layoutCache.has(d)) return layoutCache.get(d);
    let at = -1;
    // A stat multiplier on this character can be exactly 0. The search nearby stays stricter.
    if (levelAt(d, 58, 0)) at = 58;
    else for (let o = 20; o < Math.min(d.length - 16, 600); o++) if (levelAt(d, o, 0.01)) { at = o; break; }
    if (at < 0) throw new Error('Unexpected player_character layout (header).');
    layoutCache.set(d, at);
    return at;
  }

  function parsePlayer(d, isItem) {
    const warn = [];
    const L = levelOffset(d);
    const level = { off: L, value: u32(d, L) };
    const xp = { off: L + 4, value: u32(d, L + 4) };
    const nSkills = u32(d, L + 8);
    const skills = [];
    let p = L + 12;
    for (let i = 0; i < nSkills; i++, p += 5) skills.push({ id: u32(d, p), rank: d[p + 4] });
    if (p + 4 > d.length) throw new Error('Skill list runs past the end of the data.');
    const nBuffs = u32(d, p);
    if (nBuffs > 64) throw new Error('Status list is out of range.');
    // Status effects (buffs) are usually 27 bytes each, but some carry extra data
    // (e.g. food buffs written by newer game versions), so after the usual spot we
    // also scan forward for where the equipment list actually begins.
    const buffStart = p + 4;
    p = buffStart + 27 * nBuffs;
    if (p > d.length) throw new Error('Status list runs past the end of the data.');
    const invStart = p;

    const result = { level, xp, skills, containers: [], records: [], canAdd: false, warn };
    // Equipped container: a short header, then records with slots 0,1,2…
    let eqAt = -1, eq = [];
    const tryAt = (lo, hi) => {
      for (let s = lo; s <= Math.min(hi, d.length - 8); s++) {
        const run = readRun(d, s, isItem, 64);
        if (run.length && run[0].slot === 0) { eqAt = s; eq = run; return true; }
      }
      return false;
    };
    if (!tryAt(invStart, invStart + 8)) tryAt(buffStart + 22 * nBuffs, buffStart + 64 * nBuffs + 16);
    if (eqAt < 0) { warn.push('No inventory found in this save yet.'); return result; }
    result.containers.push({ key: 'equipped', label: 'Equipped', records: eq });
    // Inventory header ends with [type][n2][type][n3]; then n2 + n3 records.
    let p2 = eq[eq.length - 1].end;
    let found = false;
    for (let s = p2 + 4; s <= Math.min(p2 + 12, d.length - 8); s++) {
      const n2 = d[s - 3], n3 = d[s - 1];
      if (!n2) continue;
      const a = readRun(d, s, isItem, n2);
      if (a.length !== n2) continue;
      const b = n3 ? readRun(d, a[n2 - 1].end, isItem, n3) : [];
      if (b.length !== n3) continue;
      result.containers.push({ key: 'inventory', label: 'Inventory', records: a, countOff: s - 3 });
      result.containers.push({ key: 'extra', label: 'Extra slots', records: b, countOff: s - 1 });
      result.invHeader = { at: p2, start: s };
      result.tailAt = n3 ? b[n3 - 1].end : a[n2 - 1].end;
      found = true; break;
    }
    if (found) result.canAdd = true;
    else {
      warn.push('Inventory layout only partly recognised: in-place edits work, adding items is off.');
      // loose scan for remaining records
      let q = p2;
      while (q < d.length - 8) {
        const run = readRun(d, q, isItem, 64);
        if (run.length) { result.containers.push({ key: 'other', label: 'Other', records: run }); q = run[run.length - 1].end; }
        else q++;
      }
    }
    for (const c of result.containers) for (const r of c.records) { r.container = c.key; result.records.push(r); }
    return result;
  }


  // ---- skills: at offset 66, u32 count then [u32 node id][u8 rank] per learned node.
  function parseSkills(d) {
    const S = levelOffset(d) + 8, n = u32(d, S), list = [];
    for (let i = 0; i < n; i++) list.push({ id: u32(d, S + 4 + 5 * i), rank: d[S + 8 + 5 * i] });
    return { list, end: S + 4 + 5 * n, start: S };
  }
  function setSkills(d, list) {
    const old = parseSkills(d);
    const S = old.start, b = S + 4;
    const out = new Uint8Array(d.length - (old.end - b) + 5 * list.length);
    out.set(d.subarray(0, S), 0);
    w32(out, S, list.length);
    list.forEach((s, i) => { w32(out, b + 5 * i, s.id); out[b + 4 + 5 * i] = s.rank & 255; });
    out.set(d.subarray(old.end), b + 5 * list.length);
    return out;
  }
  // ---- player_knowledge: [u32 header][u32 n][n ids][n values]; rebuilt from an ordered Map.
  function buildKnowledge(orig, map) {
    const n = map.size, out = new Uint8Array(8 + 8 * n);
    w32(out, 0, orig && orig.length >= 4 ? u32(orig, 0) : 1);
    w32(out, 4, n);
    let i = 0;
    for (const [id, v] of map) { w32(out, 8 + 4 * i, id); w32(out, 8 + 4 * n + 4 * i, v); i++; }
    return out;
  }

  // ---- edits (all return a new Uint8Array)
  function patch(d, fn) { const out = d.slice(); fn(out); return out; }
  const setU32 = (d, off, v) => patch(d, b => w32(b, off, v));
  const setU16 = (d, off, v) => patch(d, b => w16(b, off, v));
  const setU8 = (d, off, v) => patch(d, b => { b[off] = v; });

  // fields (optional): { level: u8, durability: [current, max], perks: [b0, b1] }
  function encodeRecord(slot, item, count, fields = {}) {
    let flags = 0, extra = [];
    if (fields.level !== undefined && fields.level !== null) { flags |= 1; extra.push(Uint8Array.of(fields.level & 255)); }
    if (fields.durability) { flags |= 2; const b = new Uint8Array(8); w32(b, 0, fields.durability[0]); w32(b, 4, fields.durability[1]); extra.push(b); }
    if (fields.perks) { flags |= 16; extra.push(Uint8Array.of(fields.perks[0] & 255, fields.perks[1] & 255)); }
    // bit5: weapon gem socket. 0 = empty socket (lets the game show the GEM tab); a gem id fills it.
    if (fields.gem !== undefined && fields.gem !== null) { flags |= 32; const b = new Uint8Array(5); w32(b, 0, fields.gem >>> 0); b[4] = fields.gem ? 0x37 : 0; extra.push(b); }
    const size = 8 + extra.reduce((n, b) => n + b.length, 0);
    const rec = new Uint8Array(size);
    rec[0] = slot; w32(rec, 1, item); w16(rec, 5, count); rec[7] = flags;
    let p = 8; for (const b of extra) { rec.set(b, p); p += b.length; }
    return rec;
  }
  function addRecord(d, model, slot, item, count, fields) {
    const inv = model.containers.find(c => c.key === 'inventory');
    if (!model.canAdd || !inv) throw new Error('Adding items is not available for this save.');
    if (inv.records.some(r => r.slot === slot)) throw new Error(`Slot ${slot} is already used.`);
    if (inv.records.length >= 255) throw new Error('Inventory record list is full.');
    const after = inv.records.filter(r => r.slot < slot);
    const at = after.length ? after[after.length - 1].end : model.invHeader.start;
    const rec = encodeRecord(slot, item, count, fields);
    const out = new Uint8Array(d.length + rec.length);
    out.set(d.subarray(0, at), 0); out.set(rec, at); out.set(d.subarray(at), at + rec.length);
    out[inv.countOff] = inv.records.length + 1;
    return out;
  }

  return { parseCharacterData, setName, parseKnowledge, buildKnowledge, parseSkills, setSkills, parsePlayer, setU32, setU16, setU8, addRecord, encodeRecord, hex8, u32, u16 };
})();
if (typeof module !== 'undefined') module.exports = PCX;
