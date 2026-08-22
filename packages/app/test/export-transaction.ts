import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  commitStagedExportFiles, createExportStagingDirectory, discardExportStagingDirectory,
} from '../src/main/export-transaction.ts';

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-export-transaction-'));
  const outDir = path.join(sandbox, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const names = ['源程序_测试.docx', '源程序_测试.txt', '第三方代码风险摘要_测试.json'];
  for (const name of names) fs.writeFileSync(path.join(outDir, name), `old:${name}`, 'utf8');

  const rejectedStage = await createExportStagingDirectory(outDir);
  for (const name of names) fs.writeFileSync(path.join(rejectedStage, name), `new:${name}`, 'utf8');
  await assert.rejects(async () => {
    throw new Error('final validation failed');
  }, /final validation failed/);
  await discardExportStagingDirectory(rejectedStage);
  for (const name of names) {
    assert.equal(fs.readFileSync(path.join(outDir, name), 'utf8'), `old:${name}`,
      '最终复核失败前只写暂存目录，不能改变既有三类产物');
  }

  const createStage = async () => {
    const stage = await createExportStagingDirectory(outDir);
    const files = names.map((name) => {
      const file = path.join(stage, name);
      fs.writeFileSync(file, `new:${name}`, 'utf8');
      return file;
    });
    return { stage, files };
  };
  const assertOldFiles = () => {
    for (const name of names) {
      assert.equal(fs.readFileSync(path.join(outDir, name), 'utf8'), `old:${name}`);
    }
  };
  const exportWorkDirectories = () => fs.readdirSync(outDir)
    .filter((name) => name.startsWith('.codesucker-export-'));

  const failedPublish = await createStage();
  await assert.rejects(
    commitStagedExportFiles(failedPublish.stage, outDir, failedPublish.files, {
      beforeMutation: (phase, file) => {
        if (phase === 'publish' && path.basename(file) === names[1]) throw new Error('publish failed');
      },
    }),
    /publish failed/,
  );
  assertOldFiles();
  assert.equal(exportWorkDirectories().some((name) => name.includes('backup')), false,
    '发布中途失败且回滚成功后不能遗留备份目录');
  await discardExportStagingDirectory(failedPublish.stage);

  const failedRestore = await createStage();
  await assert.rejects(
    commitStagedExportFiles(failedRestore.stage, outDir, failedRestore.files, {
      beforeMutation: (phase, file) => {
        if (phase === 'publish' && path.basename(file) === names[1]) throw new Error('publish failed');
        if (phase === 'restore' && path.basename(file) === names[0]) throw new Error('restore failed');
      },
    }),
    /备份保留在/,
  );
  const backupDirs = exportWorkDirectories().filter((name) => name.includes('backup'));
  assert.equal(backupDirs.length, 1, '恢复不完整时必须保留唯一的备份目录');
  const retainedBackup = path.join(outDir, backupDirs[0]);
  assert.equal(fs.readFileSync(path.join(retainedBackup, names[0]), 'utf8'), `old:${names[0]}`,
    '未恢复的旧产物必须仍可从备份目录取回');
  await fs.promises.rename(path.join(retainedBackup, names[0]), path.join(outDir, names[0]));
  await fs.promises.rm(retainedBackup, { recursive: true, force: true });
  await discardExportStagingDirectory(failedRestore.stage);
  assertOldFiles();

  const cancelledPublish = await createStage();
  const controller = new AbortController();
  await assert.rejects(
    commitStagedExportFiles(cancelledPublish.stage, outDir, cancelledPublish.files, {
      signal: controller.signal,
      afterMutation: (phase, file) => {
        if (phase === 'publish' && path.basename(file) === names[0]) controller.abort();
      },
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assertOldFiles();
  assert.equal(exportWorkDirectories().some((name) => name.includes('backup')), false,
    '取消发布完成回滚后不能遗留备份目录');
  await discardExportStagingDirectory(cancelledPublish.stage);

  const staleEvidence = await createStage();
  let asyncEvidenceChecked = false;
  await assert.rejects(
    commitStagedExportFiles(staleEvidence.stage, outDir, staleEvidence.files, {
      beforeCommit: async () => {
        await Promise.resolve();
        asyncEvidenceChecked = true;
        throw new Error('source or manifest changed');
      },
    }),
    /source or manifest changed/,
  );
  assert.equal(asyncEvidenceChecked, true, '成组发布必须等待异步源码与清单身份复核');
  assertOldFiles();
  await discardExportStagingDirectory(staleEvidence.stage);

  const directoryRaceStage = await createExportStagingDirectory(outDir);
  const directoryRaceName = '目录竞态.txt';
  const directoryRaceStaged = path.join(directoryRaceStage, directoryRaceName);
  const directoryRaceFinal = path.join(outDir, directoryRaceName);
  fs.writeFileSync(directoryRaceStaged, 'new:directory-race', 'utf8');
  await assert.rejects(
    commitStagedExportFiles(directoryRaceStage, outDir, [directoryRaceStaged], {
      beforeCommit: async () => {
        await Promise.resolve();
        fs.mkdirSync(directoryRaceFinal);
        fs.writeFileSync(path.join(directoryRaceFinal, 'keep.txt'), 'must survive', 'utf8');
      },
    }),
    /无法覆盖非普通文件/,
  );
  assert.equal(fs.readFileSync(path.join(directoryRaceFinal, 'keep.txt'), 'utf8'), 'must survive',
    '证据复核期间出现的同名目录及其内容不能被备份后删除');
  assert.equal(exportWorkDirectories().some((name) => name.includes('backup')), false,
    '拒绝竞态目录后不能遗留空备份目录');
  await fs.promises.rm(directoryRaceFinal, { recursive: true });
  await discardExportStagingDirectory(directoryRaceStage);

  const newOccupantStage = await createExportStagingDirectory(outDir);
  const newOccupantName = '发布边界新占用.txt';
  const newOccupantStaged = path.join(newOccupantStage, newOccupantName);
  const newOccupantFinal = path.join(outDir, newOccupantName);
  fs.writeFileSync(newOccupantStaged, 'new:must-not-overwrite', 'utf8');
  await assert.rejects(
    commitStagedExportFiles(newOccupantStage, outDir, [newOccupantStaged], {
      beforeMutation: (phase) => {
        if (phase === 'publish') fs.writeFileSync(newOccupantFinal, 'concurrent occupant', 'utf8');
      },
    }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EEXIST',
  );
  assert.equal(fs.readFileSync(newOccupantFinal, 'utf8'), 'concurrent occupant',
    '发布边界新出现的同名文件不能被暂存产物覆盖');
  assert.equal(fs.readFileSync(newOccupantStaged, 'utf8'), 'new:must-not-overwrite',
    '原子发布被拒绝后暂存产物必须保留');
  await fs.promises.unlink(newOccupantFinal);
  await discardExportStagingDirectory(newOccupantStage);

  const backedUpOccupantStage = await createExportStagingDirectory(outDir);
  const backedUpOccupantName = '备份后新占用.txt';
  const backedUpOccupantStaged = path.join(backedUpOccupantStage, backedUpOccupantName);
  const backedUpOccupantFinal = path.join(outDir, backedUpOccupantName);
  fs.writeFileSync(backedUpOccupantStaged, 'new:backed-up-target', 'utf8');
  fs.writeFileSync(backedUpOccupantFinal, 'old:backed-up-target', 'utf8');
  await assert.rejects(
    commitStagedExportFiles(backedUpOccupantStage, outDir, [backedUpOccupantStaged], {
      beforeMutation: (phase) => {
        if (phase === 'publish') fs.writeFileSync(backedUpOccupantFinal, 'concurrent after backup', 'utf8');
      },
    }),
    /备份保留在/,
  );
  assert.equal(fs.readFileSync(backedUpOccupantFinal, 'utf8'), 'concurrent after backup',
    '旧产物备份后新出现的同名文件不能被发布或恢复操作覆盖');
  const occupiedBackupDirs = exportWorkDirectories().filter((name) => name.includes('backup'));
  assert.equal(occupiedBackupDirs.length, 1, '目标被并发占用时旧产物备份必须保留');
  const occupiedBackup = path.join(outDir, occupiedBackupDirs[0], backedUpOccupantName);
  assert.equal(fs.readFileSync(occupiedBackup, 'utf8'), 'old:backed-up-target');
  await fs.promises.unlink(backedUpOccupantFinal);
  await fs.promises.rename(occupiedBackup, backedUpOccupantFinal);
  await fs.promises.rm(path.dirname(occupiedBackup), { recursive: true, force: true });
  await discardExportStagingDirectory(backedUpOccupantStage);
  await fs.promises.unlink(backedUpOccupantFinal);

  const committedStage = await createStage();
  const committed = await commitStagedExportFiles(committedStage.stage, outDir, committedStage.files);
  assert.deepEqual(committed.map((item) => path.basename(item)), names);
  for (const name of names) assert.equal(fs.readFileSync(path.join(outDir, name), 'utf8'), `new:${name}`);
  assert.equal(fs.readdirSync(outDir).some((name) => name.startsWith('.codesucker-export-')), false,
    '成功或失败后不能残留暂存与备份目录');

  console.log('✅ export transaction 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
