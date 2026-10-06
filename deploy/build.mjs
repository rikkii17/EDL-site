import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname,'..');
// Build first. The package deliberately excludes runtime configuration and secrets.
execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{cwd:path.join(root,'EDL-website'),stdio:'inherit',shell:process.platform==='win32'});
const output=path.join(root,'release');
if (path.dirname(output)!==root || path.basename(output)!=='release') throw new Error('Unsafe output path');
// Remove only the verified workspace release directory; stale files must never ship.
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(path.join(output,'public'),{recursive:true});
fs.cpSync(path.join(root,'EDL-website','dist'),path.join(output,'public'),{recursive:true});
for(const folder of ['public','private','bin'])fs.cpSync(path.join(root,'server',folder),path.join(output,folder),{recursive:true});
fs.cpSync(path.join(root,'deploy'),path.join(output,'deploy'),{recursive:true});
console.log('Deployment package: '+output);
