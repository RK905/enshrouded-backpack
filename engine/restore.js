const { fail, gameRunning, restoreCharacter } = require("./common.js");

const file = process.argv[2];
if (!file) fail("No character file was given.");
if (gameRunning()) fail("Close Enshrouded first. The game can overwrite the character while it is open.");
process.stdout.write(JSON.stringify(restoreCharacter(file)) + "\n");
