import assert from 'node:assert/strict';
import { canVisitStep, unlockStep } from '../src/renderer/src/wizard-progress.ts';

assert.equal(canVisitStep(1, false, 1), true);
assert.equal(canVisitStep(3, true, 2), false, '重扫后不得越过步骤 2');

const unlocked = unlockStep(unlockStep(2, 3), 4);
assert.equal(unlocked, 4);
assert.equal(canVisitStep(4, true, unlocked), true);
assert.equal(canVisitStep(2, true, unlocked), true, '回退页面不得重新锁住已完成步骤');
assert.equal(canVisitStep(5, true, unlocked), false);

console.log('✅ wizard progress 全部通过');
