// Add one record into an empty backpack or extra slot.
// There is no remove and no overwrite. Existing record bytes are copied through unchanged.
const ADDONLY = (() => {
  function lists(d, m) {
    const inv = m.containers.find(c => c.key === "inventory");
    const extra = m.containers.find(c => c.key === "extra");
    if (!m.canAdd || !inv || !extra) throw new Error("This save's backpack layout is not safe to edit.");
    const take = c => c.records.map(r => ({ slot: r.slot, bytes: d.slice(r.off, r.end) }));
    return { inventory: take(inv), extra: take(extra) };
  }
  function write(d, m, L) {
    const inv = m.containers.find(c => c.key === "inventory");
    const extra = m.containers.find(c => c.key === "extra");
    if (!L.inventory.length) throw new Error("Refusing to write an empty backpack.");
    for (const key of ["inventory", "extra"]) {
      const arr = L[key];
      if (arr.length > 255) throw new Error("Too many items.");
      arr.sort((a, b) => a.slot - b.slot);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].slot === arr[i - 1].slot) throw new Error("Refusing to write two items into slot " + arr[i].slot + ".");
      }
    }
    const parts = [...L.inventory, ...L.extra].map(c => {
      const b = c.bytes.slice();
      b[0] = c.slot;
      return b;
    });
    const size = parts.reduce((n, b) => n + b.length, 0);
    const start = m.invHeader.start;
    const end = m.tailAt;
    const out = new Uint8Array(start + size + (d.length - end));
    out.set(d.subarray(0, start), 0);
    let p = start;
    for (const b of parts) { out.set(b, p); p += b.length; }
    out.set(d.subarray(end), p);
    out[inv.countOff] = L.inventory.length;
    out[extra.countOff] = L.extra.length;
    return out;
  }
  function add(d, m, slot, recBytes) {
    if (slot < 0 || slot > 39) throw new Error("Backpack slot " + slot + " is not valid.");
    const L = lists(d, m);
    if (L.inventory.some(c => c.slot === slot)) throw new Error("Refusing to overwrite backpack slot " + slot + ".");
    L.inventory.push({ slot, bytes: recBytes });
    return write(d, m, L);
  }
  return { add };
})();
if (typeof module !== "undefined") module.exports = ADDONLY;
