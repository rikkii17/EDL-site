import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname,'..');
// ビルド後に配布ファイルをまとめる。実行時設定と秘密情報は含めない。
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{cwd:path.join(root,'EDL-website'),stdio:'inherit',shell:process.platform==='win32'});
const output=path.join(root,'release');
if (path.dirname(output)!==root || path.basename(output)!=='release') throw new Error('Unsafe output path');
// ワークスペース直下と確認済みのreleaseのみ削除し、古いファイルの混入を防ぐ。
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(path.join(output,'public'),{recursive:true});
fs.cpSync(path.join(root,'EDL-website','dist'),path.join(output,'public'),{recursive:true});
for(const folder of ['public','private','bin'])fs.cpSync(path.join(root,'server',folder),path.join(output,folder),{recursive:true});
fs.cpSync(path.join(root,'deploy'),path.join(output,'deploy'),{recursive:true});
console.log('Deployment package: '+output);
