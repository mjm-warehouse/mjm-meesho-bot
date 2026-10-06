const assert = require('assert');
const { buildSeen, nextPacketNumber, partitionRecords } = require('../lib/dispatchGuard');
const existing = [
  ['Packet ID', 'Forward AWB', 'Sub Order ID'],
  ['TP2CMEU02000737', '134096109559653', '325645280949165824_1'],
  ['134096108616536', 'TP2CMEU02000736', '325655084396568192_1'],   // old swapped row
  ['PKT-01337', '50200019289881', ''],
];
const recs = [
  { subOrderId: '111111111111111111_1', forwardAwb: 'AWB1' },     // fresh
  { subOrderId: '111111111111111111_1', forwardAwb: 'AWB1' },     // dup in same file
  { subOrderId: '222222222222222222_1', forwardAwb: '' },         // fresh, blank AWB
  { subOrderId: '222222222222222222_1', forwardAwb: '' },         // dup via Sub Order ID
  { subOrderId: '', forwardAwb: '134096109559653' },              // known AWB
  { subOrderId: '', forwardAwb: ' tp2cmeu02000736 ' },            // AWB in swapped column, messy case/space
  { subOrderId: '', forwardAwb: 'NEWAWB' },                       // fresh + flagged
  { subOrderId: '325645280949165824_1', forwardAwb: '' },         // existing Sub Order ID
  { subOrderId: '', forwardAwb: '' },                             // exception
];
const r = partitionRecords(recs, buildSeen(existing));
assert.deepStrictEqual([r.fresh.length, r.duplicates, r.flagged.length, r.exceptions.length], [3, 5, 1, 1]);
assert.strictEqual(nextPacketNumber(existing), 1338);
console.log('OK', { fresh: r.fresh.length, dup: r.duplicates, flagged: r.flagged.length, exc: r.exceptions.length });