const { bagView } = require("./common.js");
const file = process.argv[2];
if (!file) {
  process.stdout.write(JSON.stringify({ ok: false, error: "No character file was given." }) + "\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify(bagView(file)) + "\n");
