import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceChoices, evidenceSelectable } from '../src/evidence-source.ts';
test('source choices include only current nonempty values and retain stale confirmations for undo',()=>{
 assert.deepEqual(evidenceChoices({filename:'2.0',api:'',emby:'5.1',mediainfo:'7.1'}),[{source:'filename',value:'2.0'},{source:'mediaServer',value:'5.1'},{source:'mediainfo',value:'7.1'}]);
 assert.equal(evidenceSelectable({filename:'2.0',conflict:false}),false);
 assert.equal(evidenceSelectable({filename:'2.0',confirmed:{source:'mediaServer',value:'5.1',at:1}}),true);
 assert.equal(evidenceSelectable({filename:'2.0',conflict:true}),true);
});
import { evidenceMenuPosition } from '../src/evidence-source.ts';
test('evidence menus fit inside viewport and use full mobile card width',()=>{
 assert.deepEqual(evidenceMenuPosition({left:30,top:500,bottom:530,width:315},{width:220,height:180},{width:375,height:812},8,true),{left:30,top:538,width:315});
 assert.deepEqual(evidenceMenuPosition({left:1400,top:900,bottom:930,width:70},{width:220,height:180},{width:1440,height:1000},8,false),{left:1212,top:712,width:220});
});
