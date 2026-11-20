import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceChoices, evidenceSelectable } from '../src/evidence-source.ts';
test('source choices include only current nonempty values and retain stale confirmations for undo',()=>{
 assert.deepEqual(evidenceChoices({filename:'2.0',api:'',emby:'5.1',mediainfo:'7.1'}),[{source:'filename',value:'2.0'},{source:'mediaServer',value:'5.1'},{source:'mediainfo',value:'7.1'}]);
 assert.equal(evidenceSelectable({filename:'2.0',conflict:false}),false);
 assert.equal(evidenceSelectable({filename:'2.0',confirmed:{source:'mediaServer',value:'5.1',at:1}}),true);
 assert.equal(evidenceSelectable({filename:'2.0',conflict:true}),true);
});
