import assert from 'node:assert/strict';
import { execFile, spawn, execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { UpdateService } from '../src/main/update-service.ts';

const run = promisify(execFile);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  if (process.platform !== 'darwin') return;
  const source = await realpath(process.argv[2]);
  const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  const root = await mkdtemp('/private/tmp/codesucker-real-upgrade-');
  const target = path.join(root, 'CodeSucker.app');
  const executable = path.join(target, 'Contents/MacOS/CodeSucker');
  const userData = path.join(root, 'user-data');
  const pids = new Set<number>();
  try {
    await cp(source, target, {recursive:true,verbatimSymlinks:true});
    await mkdir(userData);
    await writeFile(path.join(userData, 'retained-project.json'), 'project retained');
    await run('/usr/libexec/PlistBuddy', ['-c','Set :CFBundleShortVersionString 0.5.2',path.join(target,'Contents/Info.plist')]);
    await run('/usr/bin/codesign', ['--force','--sign','-',target]);
    const archive = path.join(path.dirname(path.dirname(source)), `CodeSucker-${version}-mac-${process.arch}.zip`);
    const bytes = await readFile(archive);
    const {privateKey,publicKey} = generateKeyPairSync('ed25519');
    const manifest = Buffer.from(JSON.stringify({schemaVersion:1,version,assets:[{name:path.basename(archive),platform:'darwin',arch:process.arch,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
    const signature = sign(null,manifest,privateKey).toString('base64');
    const old = spawn(executable, [`--user-data-dir=${userData}`], {stdio:'ignore'});
    pids.add(old.pid!);
    const exited = new Promise(resolve => old.once('exit',resolve));
    await wait(4000);
    assert.equal(old.exitCode,null,'旧应用必须正常启动');
    const states: string[] = [];
    const service = new UpdateService({
      currentVersion:'0.5.2',platform:'darwin',arch:process.arch,executable,userData,tempDir:root,resourcesPath:path.join(source,'Contents/Resources'),
      publicKey:publicKey.export({type:'spki',format:'pem'}).toString(),packaged:true,pid:old.pid,
      check:async()=>({status:'available',currentVersion:'0.5.2',latestVersion:version,releaseUrl:`https://github.com/fanbuz/codesucker/releases/tag/v${version}`,publishedAt:null,notes:[],checkedAt:'',fromCache:false}),
      fetcher:async url=>url.endsWith('.json') ? new Response(manifest) : url.endsWith('.sig') ? new Response(signature) : new Response(Readable.toWeb(createReadStream(archive)) as ReadableStream),
      onState:state=>states.push(state.phase),lockPipeline:()=>true,unlockPipeline:()=>{},
      quit:async()=>{old.kill('SIGTERM');await exited;},
    });
    const prepared = await service.download();
    assert.equal(prepared.phase,'ready',JSON.stringify(prepared));
    assert.equal((await service.install()).phase,'installing');
    let finished = false;
    for(let attempt=0;attempt<160;attempt++) {
      await wait(250);
      const pending = (await readdir(root)).some(name=>name.startsWith('.codesucker-update-'));
      if (!pending) {finished=true;break;}
    }
    assert.equal(finished,true,'更新助手必须收到新版窗口就绪确认并完成替换');
    const actual = (await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',path.join(target,'Contents/Info.plist')])).stdout.trim();
    assert.equal(actual,version);
    await run('/usr/bin/codesign',['--verify','--deep','--strict',target]);
    assert.equal((await readFile(path.join(userData,'retained-project.json'))).toString(),'project retained');
    const escaped = executable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const currentPids = execFileSync('/usr/bin/pgrep',['-f','^'+escaped],{encoding:'utf8'}).trim().split(/\s+/).map(Number);
    assert.ok(currentPids.length>0,'更新后应用必须正在运行');
    for(const pid of currentPids) pids.add(pid);
    assert.ok(states.includes('verifying') && states.includes('ready') && states.includes('installing'));
    console.log(`✅ 真实 macOS 应用 0.5.2 → ${version}：签名清单、下载、整包校验、替换、窗口就绪、重启及用户数据保留通过`);
  } finally {
    for(const pid of pids) {try{process.kill(pid,'SIGTERM');}catch{}}
    await wait(1000);
    await rm(root,{recursive:true,force:true});
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
