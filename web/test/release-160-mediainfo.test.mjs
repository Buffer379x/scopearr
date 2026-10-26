import test from 'node:test';import assert from 'node:assert/strict';
import { mediaInfoVisible,mediaInfoValues } from '../src/mediainfo.ts';
test('MediaInfo stays visible for stored results after disabling and compares normalized values',()=>{
 assert.equal(mediaInfoVisible(false,undefined),false);assert.equal(mediaInfoVisible(true,undefined),true);
 assert.equal(mediaInfoVisible(false,{version:'26.10'}),true);
 assert.deepEqual(mediaInfoValues({video:{resolution:'2160p',codec:'x265',bitDepth:'10'},audio:'TrueHD',audioTracks:[{channels:8,channelLayout:'7.1'}],language:'Deutsch',hdr:'Dolby Vision + HDR10'}),{resolution:'2160p',codec:'x265',bitDepth:'10',audio:'TrueHD',channels:'7.1',language:'Deutsch',hdr:'Dolby Vision + HDR10'});
});
