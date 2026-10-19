import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { startUpdateHelper } from '../src/main/update-install.ts';

const run = promisify(execFile);
const wait = (ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function main() {
  if(process.platform!=='win32') return;
  const root = await mkdtemp(path.join(tmpdir(),'codesucker installer update '));
  const target = path.join(root,'Installed CodeSucker');
  const userData = path.join(root,'user-data');
  const work = path.join(root,'update-work');
  try {
    await mkdir(userData);await mkdir(work);
    await writeFile(path.join(userData,'retained-project.json'),'project retained');
    const version = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
    const oldUrl='https://github.com/fanbuz/codesucker/releases/download/v0.5.2/CodeSucker-0.5.2-win-x64.exe';
    const response=await fetch(oldUrl,{signal:AbortSignal.timeout(120000)});
    assert.equal(response.ok,true,'必须获得旧版本安装器用于真实升级');
    const oldInstaller=path.join(root,'old.exe');
    await writeFile(oldInstaller,Buffer.from(await response.arrayBuffer()));
    const script=path.join(root,'initial-install.ps1');
    await writeFile(script,"param([string]$Installer,[string]$Target)\n$p=Start-Process -FilePath $Installer -ArgumentList ('/S /D=' + $Target) -Wait -PassThru\nexit $p.ExitCode\n");
    await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Installer',oldInstaller,'-Target',target],{timeout:120000});
    const executable=path.join(target,'CodeSucker.exe');
    const old=spawn(executable,[`--user-data-dir=${userData}`],{stdio:'ignore'});
    await wait(4000);
    assert.equal(old.exitCode,null);
    const installer=path.resolve(`packages/app/release/CodeSucker-${version}-win-x64.exe`);
    const expectedHash=createHash('sha256').update(await readFile('packages/app/release/win-unpacked/CodeSucker.exe')).digest('hex');
    await startUpdateHelper({platform:'win32',executable,artifact:installer,work,version,userData,resourcesPath:path.resolve('packages/app/resources'),pid:old.pid!});
    old.kill();
    let finished=false;
    for(let attempt=0;attempt<240;attempt++) {
      await wait(500);
      try {
        const hash=createHash('sha256').update(await readFile(executable)).digest('hex');
        const tasks=await run('tasklist',['/FI','IMAGENAME eq CodeSucker.exe','/FO','CSV','/NH']);
        if(hash===expectedHash && tasks.stdout.includes('CodeSucker.exe')) {finished=true;break;}
      } catch { /* Wait while the installer replaces the executable. */ }
    }
    assert.equal(finished,true,'安装助手必须完成安装并重启');
    assert.equal((await readFile(path.join(userData,'retained-project.json'))).toString(),'project retained');
    console.log(`✅ Windows NSIS 0.5.2 → ${version} 安装替换、重启及用户数据保留通过`);
  } finally {
    await run('taskkill',['/IM','CodeSucker.exe','/F','/T']).catch(()=>{});
    await rm(root,{recursive:true,force:true});
  }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
