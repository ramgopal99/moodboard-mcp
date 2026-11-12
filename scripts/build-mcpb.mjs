// Builds dist-mcpb/moodboard-mcp.mcpb: a one-click Claude Desktop extension.
// Usage: npm run build:mcpb
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const stage = path.join(root, "build", "mcpb");
const outDir = path.join(root, "dist-mcpb");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "server"), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: path.join(stage, "server", "index.cjs"),
  legalComments: "external",
  logLevel: "warning",
});

const manifest = JSON.parse(fs.readFileSync(path.join(root, "mcpb", "manifest.json"), "utf8"));
manifest.version = pkg.version;
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
for (const f of ["icon.png"]) fs.copyFileSync(path.join(root, "mcpb", f), path.join(stage, f));
for (const f of ["LICENSE", "README.md"]) fs.copyFileSync(path.join(root, f), path.join(stage, f));

const out = path.join(outDir, `moodboard-mcp.mcpb`);
const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "mcpb.cmd" : "mcpb");
execFileSync(bin, ["validate", path.join(stage, "manifest.json")], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
execFileSync(bin, ["pack", stage, out], { stdio: "inherit", shell: process.platform === "win32" });
console.log(`\nBuilt ${path.relative(root, out)}`);
