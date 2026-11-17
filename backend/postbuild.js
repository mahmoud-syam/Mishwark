const fs = require("fs");
const path = require("path");

const root = process.cwd();
const distRoot = path.join(root, "dist");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Prisma client is generated OUTSIDE src. The compiled JS references it via
// relative paths (../../../generated/prisma). Copy it into dist/generated so
// the production build resolves correctly.
copyDir(path.join(root, "generated"), path.join(distRoot, "generated"));

console.log("Copied Prisma client to dist/generated");
