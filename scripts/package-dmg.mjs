import {mkdtemp,cp,symlink,mkdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
// GUI-free fallback for environments without Finder automation permission.
// Input is the REAL Tauri bundle. Never package Contents as the volume root.
const app=resolve(process.argv[2]||'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/国运.app');
const {version}=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
const output=resolve(process.argv[3]||`public/downloads/Guoyun-${version}-arm64.dmg`);
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const staging=await mkdtemp(join(tmpdir(),'guoyun-dmg-'));
await cp(app,join(staging,'国运.app'),{recursive:true});
await symlink('/Applications',join(staging,'Applications'));
await mkdir(dirname(output),{recursive:true});
execFileSync('hdiutil',['create','-volname','国运','-srcfolder',staging,'-format','UDZO',output],{stdio:'inherit'});
console.log(`DMG ready: ${output}`);
