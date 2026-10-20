const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const HOME = process.env.BACKPACK_HOME || path.join(__dirname, "..");
process.on("uncaughtException", (err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: err.message }) + "\n");
  process.exit(1);
});
global.XXH3 = require("./lib/xxh3.js");
const KSD = require("./lib/ksdcore.js");
const FZSTD = require("./lib/fzstd.js");
const PCX = require("./lib/pc.js");
const ADDONLY = require("./lib/addonly.js");

const db = JSON.parse(fs.readFileSync(require("path").join(__dirname, "data", "itemdb2.json"), "utf8"));
const names = new Map();
const maxOf = new Map();
const known = new Set();
for (const [h, r] of Object.entries(db.items)) {
  const id = parseInt(h, 16);
  if (!Number.isInteger(id) || r[3] < 1) continue;
  known.add(id);
  names.set(id, r[0]);
  maxOf.set(id, r[3]);
}
const isItem = (id) => known.has(id >>> 0);

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
  process.exit(1);
}
function gameRunning() {
  const out = execSync('tasklist /FI "IMAGENAME eq enshrouded.exe"', { encoding: "utf8" });
  return /enshrouded.exe/i.test(out);
}
function load(file) {
  const save = KSD.parse(fs.readFileSync(file), (b) => FZSTD.decompress(b));
  const sec = save.sections.find(s => s.name === "player_character");
  if (!sec) fail("That file has no character.");
  const model = PCX.parsePlayer(sec.data, isItem);
  return { save, sec, model };
}
function snapshot(data, model) {
  const rows = [];
  for (const key of ["equipped", "inventory", "extra"]) {
    const c = model.containers.find(x => x.key === key);
    if (!c) continue;
    for (const r of c.records) {
      rows.push({
        key,
        slot: r.slot,
        item: r.item >>> 0,
        count: r.count,
        hex: Buffer.from(data.subarray(r.off, r.end)).toString("hex"),
      });
    }
  }
  return rows;
}
function sameRecords(left, right) {
  if (left.length !== right.length) return false;
  return left.every(old => right.some(r => r.key === old.key && r.slot === old.slot && r.hex === old.hex));
}
function writeBackup(file, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(HOME, "backups", stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, path.basename(file));
  fs.copyFileSync(file, dest);
  fs.writeFileSync(path.join(backupDir, "backup.json"), JSON.stringify({
    source: path.resolve(file),
    reason: reason,
    savedAt: new Date().toISOString(),
    file: dest,
  }, null, 2));
  return dest;
}
function latestBackup(file) {
  const root = path.join(HOME, "backups");
  if (!fs.existsSync(root)) return null;
  const wanted = path.resolve(file).toLowerCase();
  let best = null;
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    const metaPath = path.join(dir, "backup.json");
    if (!fs.existsSync(metaPath) || !fs.statSync(dir).isDirectory()) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); }
    catch (e) { continue; }
    if (!meta || meta.reason !== "before-add" || !meta.file) continue;
    if (path.resolve(meta.source || "").toLowerCase() !== wanted) continue;
    if (!fs.existsSync(meta.file)) continue;
    const when = fs.statSync(meta.file).mtimeMs;
    if (!best || when > best.when) best = { file: meta.file, when, savedAt: meta.savedAt };
  }
  return best;
}
function restoreCharacter(file) {
  const found = latestBackup(file);
  if (!found) fail("No backup has been saved for this character yet. A backup is made just before items are added.");
  const current = load(file);
  const backup = load(found.file);
  const wanted = snapshot(backup.sec.data, backup.model);
  if (sameRecords(snapshot(current.sec.data, current.model), wanted)) {
    return { ok: true, already: true, restoredFrom: found.file, savedAt: found.savedAt };
  }
  writeBackup(file, "before-restore");
  const revision = Math.max(current.save.revision, backup.save.revision) + 1;
  const out = KSD.build(backup.save, { revision, timestamp: Math.floor(Date.now() / 1000) });
  fs.writeFileSync(file, out);
  const now = new Date();
  fs.utimesSync(file, now, now);
  const check = load(file);
  if (!check.save.sections.every(s => s.hashOk)) fail("The restored file did not check out. The newest copy in backups is untouched.");
  if (!sameRecords(wanted, snapshot(check.sec.data, check.model))) fail("The restored backpack does not match the backup. The newest copy in backups is untouched.");
  return { ok: true, already: false, revision: check.save.revision, restoredFrom: found.file, savedAt: found.savedAt };
}
function bagView(file) {
  if (gameRunning()) fail("Close Enshrouded before reading the character. A running game can overwrite the file.");
  const { save, sec, model } = load(file);
  if (!model.canAdd) fail((model.warn && model.warn[0]) || "This backpack layout is not safe to edit.");
  const inv = model.containers.find(c => c.key === "inventory");
  const used = new Set(inv.records.map(r => r.slot));
  const free = [];
  for (let s = 0; s < 40; s++) if (!used.has(s)) free.push(s);
  return {
    ok: true,
    revision: save.revision,
    level: model.level.value,
    free,
    items: inv.records.map(r => ({
      slot: r.slot,
      id: (r.item >>> 0).toString(16).padStart(8, "0"),
      name: names.get(r.item) || "Unknown item",
      count: r.count,
    })),
  };
}

function applyAdds(file, request) {
  if (!Array.isArray(request) || !request.length) fail("Nothing to add.");
  const cur = load(file);
  let model = cur.model;
  if (!model.canAdd) fail((model.warn && model.warn[0]) || "This backpack layout is not safe to edit.");
  const inv0 = model.containers.find(c => c.key === "inventory");
  const used = new Set(inv0.records.map(r => r.slot));
  const free = [];
  for (let s = 0; s < 40; s++) if (!used.has(s)) free.push(s);

  const planned = [];
  for (const row of request) {
    const id = parseInt(row.id, 16);
    const count = row.count;
    if (!known.has(id)) fail("That item is not in the catalog.");
    if (!Number.isInteger(count) || count < 1) fail("Quantity has to be a whole number of at least 1.");
    const max = maxOf.get(id);
    if (count > max) fail(names.get(id) + " stacks to " + max + ". Lower the quantity.");
    if (!free.length) fail("No empty backpack slot is left. Nothing was changed.");
    const slot = free.shift();
    if (used.has(slot)) fail("Refusing to overwrite backpack slot " + slot + ".");
    used.add(slot);
    planned.push({ id, count, slot, name: names.get(id) });
  }

  const before = snapshot(cur.sec.data, model);
  let data = cur.sec.data;
  for (const p of planned) {
    data = ADDONLY.add(data, model, p.slot, PCX.encodeRecord(p.slot, p.id, p.count));
    model = PCX.parsePlayer(data, isItem);
    if (!model.canAdd) fail("Stopped before writing. The backpack layout was no longer safe.");
    const got = model.containers.find(c => c.key === "inventory").records.find(r => r.slot === p.slot);
    if (!got || (got.item >>> 0) !== p.id || got.count !== p.count) fail("Stopped before writing. " + p.name + " did not land in an empty slot.");
  }

  const after = snapshot(data, model);
  for (const old of before) {
    const found = after.find(r => r.key === old.key && r.slot === old.slot);
    if (!found) fail("Stopped before writing. An existing item would have been removed.");
    if (found.hex !== old.hex) fail("Stopped before writing. An existing slot would have been changed.");
  }
  for (const s of cur.save.sections) {
    if (s.name === "player_character") continue;
    if (!KSD.sameBytes(s.data, s.original)) fail("Stopped before writing. Another part of the character would have changed.");
  }

  const backupFile = writeBackup(file, "before-add");
  cur.sec.data = data;
  const out = KSD.build(cur.save, { revision: cur.save.revision + 1, timestamp: Math.floor(Date.now() / 1000) });
  fs.writeFileSync(file, out);
  const now = new Date();
  fs.utimesSync(file, now, now);

  const check = load(file);
  const checkSnap = snapshot(check.sec.data, check.model);
  const kept = before.every(old => checkSnap.some(r => r.key === old.key && r.slot === old.slot && r.hex === old.hex));
  const intact = check.save.sections.every(s => s.hashOk) && kept;
  if (!intact) {
    restoreCharacter(file);
    fail("The edit did not check out, so the character was put back to the backup.");
  }
  return {
    ok: true,
    revision: check.save.revision,
    backup: backupFile,
    placed: planned.map(p => ({ slot: p.slot, name: p.name, count: p.count })),
  };
}

module.exports = { fs, KSD, FZSTD, PCX, ADDONLY, names, maxOf, known, isItem, fail, gameRunning, load, snapshot, bagView, applyAdds, writeBackup, latestBackup, restoreCharacter };
