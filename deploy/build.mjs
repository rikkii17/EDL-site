import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
// ビルド後に配布ファイルをまとめる。実行時設定と秘密情報は含めない。
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  {
    cwd: path.join(root, "EDL-website"),
    stdio: "inherit",
    shell: process.platform === "win32",
  },
);
const output = path.join(root, "release");
if (path.dirname(output) !== root || path.basename(output) !== "release")
  throw new Error("Unsafe output path");
// ワークスペース直下と確認済みのreleaseのみ削除し、古いファイルの混入を防ぐ。
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, "public"), { recursive: true });
fs.cpSync(path.join(root, "EDL-website", "dist"), path.join(output, "public"), {
  recursive: true,
});
for (const folder of ["public", "private", "bin"])
  fs.cpSync(path.join(root, "server", folder), path.join(output, folder), {
    recursive: true,
  });
fs.cpSync(path.join(root, "deploy"), path.join(output, "deploy"), {
  recursive: true,
});
fs.copyFileSync(path.join(root, "README.md"), path.join(output, "README.md"));
// Windowsで編集してもcron等をUbuntuで実行できるよう改行をLFに統一する。
function normalizeText(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) normalizeText(file);
    else
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, "utf8")
          .replace(/^\uFEFF/, "")
          .replace(/\r\n/g, "\n"),
      );
  }
}
for (const directory of ["private", "bin", "deploy", "public/api"])
  normalizeText(path.join(output, directory));
console.log("Deployment package: " + output);
