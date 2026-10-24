import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleGroupKeys, pageSelection } from "../src/file-selection.ts";
const src = p => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8');
test('selection is scoped to page and group membership is instance-aware', () => {
 const keys = [
  {service:'sonarr',id:1,mediaId:10,season:1},
  {service:'sonarr',id:2,mediaId:10,season:2},
  {service:'sonarr-b',id:1,mediaId:10,season:1},
 ];
 assert.deepEqual(visibleGroupKeys(keys,'sonarr',10), keys.slice(0,2));
 assert.deepEqual(visibleGroupKeys(keys,'sonarr',10,1), keys.slice(0,1));
 const saved = {scope:'page1', values:{'sonarr:1':keys[0], 'sonarr:99':{service:'sonarr',id:99}}};
 assert.deepEqual(pageSelection(saved,'page2',keys), {});
 assert.deepEqual(Object.keys(pageSelection(saved,'page1',keys)), ['sonarr:1']);
});
test('library has no selection bar or global selection request', () => {
 assert.doesNotMatch(src('components/Library.tsx'), /selection-bar|selectionQuery|results.groups/);
 assert.doesNotMatch(src('hooks/useFileSelection.ts'), /files\/selection|selectionLimit/);
 assert.match(src('components/Library.tsx'), /page.*movieSort|movieSort.*page/s);
});
test('tool activity stays inline and row progress remains available', () => {
 for (const page of ['DiskPlacementPage','FileCheckPage']) {
  const code = src('components/'+page+'.tsx');
  assert.doesNotMatch(code, /tool-progress|placement-overall-progress/);
  assert.match(code, /tool-activity/);
  assert.match(code, /<CompactProgress/);
 }
});
test('one sectioned help replaces separate scan information controls', () => {
 assert.match(src('components/HelpPopover.tsx'), /sections/);
 assert.doesNotMatch(src('components/ToolFilters.tsx'), /info\??:|\{info\}/);
 for (const p of ['DiskPlacementPage','FileCheckPage']) {
  assert.doesNotMatch(src('components/'+p+'.tsx'), /label="Scan information"/);
  assert.match(src('components/'+p+'.tsx'), /heading: "Last scan"/);
 }
 assert.match(src('components/MuxPage.tsx'), /How muxing works/);
});
test('fixed ordered-list hints are inline and title labels are not duplicated', () => {
 const code = src('components/OrderedList.tsx');
 assert.match(code, /<em class="cell-hint">/);
 assert.doesNotMatch(code, /class="cell-sub"/);
 assert.doesNotMatch(src('ui.tsx'), /Title \/ Episode \(always visible\)/);
});
test('settings share heading and move rule guidance into help', () => {
 for (const p of ['SettingsDialog','RecognitionPage','CustomTagsSettings'])
  assert.match(src('components/'+p+'.tsx'), /<SettingsSectionHeading/);
 assert.doesNotMatch(src('components/RecognitionPage.tsx'), /class="recognition-guide"|class="notice recognition-notice"/);
 assert.doesNotMatch(src('components/CustomTagsSettings.tsx'), /Save colors/);
});
