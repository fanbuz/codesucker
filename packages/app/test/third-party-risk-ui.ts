import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const step2Source = readFileSync(new URL('../src/renderer/src/screens/Step2Files.tsx', import.meta.url), 'utf8');
const step3Source = readFileSync(new URL('../src/renderer/src/screens/Step3Clean.tsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../src/renderer/src/components/ThirdPartyRiskPanel.tsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../src/renderer/src/components/ModalDialog.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8');
const themeCss = readFileSync(new URL('../src/renderer/src/theme.css', import.meta.url), 'utf8');

const orderPanel = step2Source.slice(
  step2Source.indexOf('<div className="step2-order-panel">'),
  step2Source.indexOf('{/* 统计 */}'),
);
const statsPanel = step2Source.slice(
  step2Source.indexOf('<aside className="step2-stats-panel">'),
  step2Source.indexOf('{s.thirdPartyRiskReport && (\n        <ThirdPartyRiskDialog'),
);
assert.doesNotMatch(orderPanel, /ThirdPartyRisk/, '第三方线索详情不得挤占文件排序区');
assert.ok(
  statsPanel.indexOf('<ScanIssueReport') < statsPanel.indexOf('<ThirdPartyClueSummaryButton'),
  '第三方线索数量入口必须位于扫描统计之后',
);
assert.match(statsPanel, /step2-stats-scroll[\s\S]*step2-stats-footer/, '统计内容可滚动且底部动作保持独立');

assert.match(panelSource, /<ModalDialog[^>]*id="third-party-clue-dialog"/, '详情必须使用统一模态交互');
assert.ok(
  panelSource.indexOf('filterThirdPartyFindings(') < panelSource.indexOf('thirdPartyFindingPage(filteredFindings'),
  '第三方线索必须先筛选再分页',
);
assert.match(panelSource, /analysis incomplete|分析不完整/, '分析不完整状态必须明确展示');
assert.match(modalSource, /role="dialog" aria-modal="true"/, '详情面板必须暴露无障碍模态语义');
assert.match(modalSource, /event\.key === 'Escape'/, '模态面板必须支持 Esc 关闭');
assert.match(modalSource, /event\.key !== 'Tab'/, '模态面板必须约束 Tab 焦点');
assert.match(modalSource, /previouslyFocused\?\.focus\(\)/, '关闭面板后必须恢复入口焦点');

assert.match(themeCss, /\.step2-stats-scroll\{[^}]*overflow-y:auto/, '小屏统计区必须独立纵向滚动');
assert.match(themeCss, /\.modal-dialog-backdrop\{[^}]*z-index:100/, '模态遮罩层级必须固定');
assert.match(themeCss, /@media\(max-width:680px\)[\s\S]*\.third-party-risk-dialog\{/, '详情面板必须提供窄屏布局');
assert.match(themeCss, /@media\(max-height:640px\)[\s\S]*\.third-party-risk-dialog\{/, '详情面板必须提供矮屏布局');
assert.match(appSource, /zIndex: 120/, '操作反馈必须显示在模态面板之上');

assert.match(step3Source, /attributionSummary\.evidenceCount/, '清洗阶段必须承接署名证据数量');
assert.match(step3Source, /填写著作权人后才能核验一致性/, '未填写著作权人时必须提示核验边界');
assert.match(step3Source, /await runProcess\(\)/, '进入分页预览前必须按当前著作权人重新校验');

console.log('✅ third-party-risk-ui 全部通过');
