const fs = require("fs");

const f = "dist/cli.js";
let c = fs.readFileSync(f, "utf8");
if (!c.startsWith("#!")) {
  c = "#!/usr/bin/env node\n" + c;
  fs.writeFileSync(f, c);
}
console.log("Shebang added to dist/cli.js");
