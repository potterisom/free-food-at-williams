import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewedListings} from '../scripts/reviewed-listings.mjs';

const from = '2026-11-11', to = '2027-02-09';
const sample = {
  title:'Math & Stats Tea',date:from,start:'14:00',end:'15:00',
  food:'Tea and snacks',location:'Frank Morgan Library',source:'SMAB Weekly',repeat:'weekly'
};
test('retains newsletter events without a public URL and rolls weekly dates forward', () => {
  const rows = reviewedListings([sample],'2026-11-12','2026-11-26');
  assert.deepEqual(rows.map(row=>row.date),['2026-11-18','2026-11-25']);
  assert.ok(rows.every(row=>row.eligibility === 'Check invitation' && row.source === 'SMAB Weekly'));
  assert.ok(rows.every(row=>row.url === '' && row.reviewed && row.categories.includes('Drinks')));
});
test('rejects raw email fields, private links and contact information', () => {
  for (const extra of [
    {messageId:'example'}, {email:'person@example.org'}, {source:'person@example.org'},
    {url:'https://mail.google.com/mail/u/0/#all/private'}, {location:'Contact 413-555-0100'}
  ]) assert.throws(()=>reviewedListings([{...sample,...extra}],from,to),/Invalid reviewed listing/);
});
test('the reviewed export keeps all dates from the initial reconciliation', async () => {
  const records = JSON.parse(await readFile(new URL('../data/reviewed-listings.json',import.meta.url),'utf8'));
  const rows = reviewedListings(records,from,to);
  for (const {title,date,repeat} of records) {
    if (date >= from && date <= to && !repeat) assert.ok(rows.some(row=>row.title === title && row.date === date));
  }
});
