const fs = require("fs");
const { applyAdds, fail, gameRunning } = require("./common.js");

const file = process.argv[2];
const requestPath = process.argv[3];
if (!file || !requestPath) fail("Missing character file or item list.");
if (gameRunning()) fail("Close Enshrouded first. The game can overwrite the character while it is open.");
let request;
try { request = JSON.parse(fs.readFileSync(requestPath, "utf8")); }
catch (e) { fail("Could not read the item list."); }
const result = applyAdds(file, request);
process.stdout.write(JSON.stringify(result) + "\n");
