import test from 'node:test';
import assert from 'node:assert/strict';
import {placementCompact,placementSelectable,placementStartable} from '../src/placement.ts';
import {eventMessage} from '../src/event-log.ts';
import {placementMessage} from '../src/placement-messages.ts';

test('empty folders remain compact and cannot start, even on several devices',()=>{
 const item={scanStatus:'empty',jobStatus:'',target:'',disks:{disk1:{bytes:0,files:0,dirs:3},disk2:{bytes:0,files:0,dirs:1}}};
 assert.equal(placementCompact(item),true);
 assert.equal(placementSelectable(item),false);
 assert.equal(placementStartable(item),false);
 assert.equal(placementCompact({...item,scanStatus:'empty_folders'}),false);
});

test('cache-only mover explanation translates the disk placeholder',()=>{
 const key='Files are on the cache. Run the mover first; the empty folder on {disks} stays untouched.';
 assert.equal(placementMessage('Files are on the cache. Run the mover first; the empty folder on disk1, disk3 stays untouched.',(key,p)=>JSON.stringify([key,p])),JSON.stringify([key,{disks:'disk1, disk3'}]));
});

test('settings areas in event arrays translate separately and preserve service names',()=>{
 const words={'Settings saved · {areas}':'Einstellungen gespeichert · {areas}','Services':'Dienste','Display':'Darstellung'};
 const tr=(key,p)=> (words[key]||key).replace(/\{(\w+)\}/g,(_,name)=>String(p[name]));
 assert.equal(eventMessage({message:'Settings saved · {areas}',params:{areas:['Services · Radarr 4K','Display']}},tr),'Einstellungen gespeichert · Dienste · Radarr 4K, Darstellung');
 assert.equal(eventMessage({message:'{count}',params:{count:2}},tr),'2');
});

