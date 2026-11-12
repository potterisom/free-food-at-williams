import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {shift, today} from '../src/events.mjs';

test('inbox sync preserves public events, replaces reviewed events and skips unchanged snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(),'williams-inbox-sync-'));
  try {
    for (const folder of ['data','src','scripts']) {
      await cp(new URL('../'+folder+'/',import.meta.url),join(root,folder),{recursive:true});
    }
    const date = today();
    const publishedAt = new Date().toISOString();
    const previous = {
      date,updatedAt:publishedAt,complete:true,departmentsComplete:true,
      events:[
        {title:'Department Lunch',date,source:'Department website',url:'https://math.williams.edu/lunch/',priority:2},
        {title:'Canceled Tea',date,source:'Campus email',reviewed:true,priority:3}
      ]
    };
    const exportPath = join(root,'data','reviewed-live.json');
    await writeFile(exportPath,JSON.stringify({updatedAt:publishedAt,events:[{
      title:'Newsletter Tea',date,start:'14:00',end:'15:00',food:'Tea',source:'Campus email',repeat:'weekly'
    }]}));
    const output = join(root,'actions-output');
    function build(snapshot) {
      const mock = `globalThis.fetch = async url => {
        if (String(url) !== 'https://potterisom.github.io/free-food-at-williams/events.json') throw new Error('Unexpected source request');
        return Response.json(${JSON.stringify(snapshot)});
      };`;
      return spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(mock),'scripts/build.mjs'],{
        cwd:root,encoding:'utf8',env:{...process.env,WILLIAMS_INBOX_ONLY:'true',GITHUB_OUTPUT:output}
      });
    }
    const first = build(previous);
    assert.equal(first.status,0,first.stderr);
    assert.equal(await readFile(output,'utf8'),'publish=true\n');
    const feed = JSON.parse(await readFile(join(root,'_site','events.json'),'utf8'));
    assert.equal(feed.reviewedUpdatedAt,publishedAt);
    assert.equal(feed.updatedAt,publishedAt);
    assert.equal(feed.departmentsComplete,true);
    assert.ok(feed.events.some(event=>event.title === 'Department Lunch'));
    assert.ok(feed.events.some(event=>event.title === 'Newsletter Tea' && event.date === shift(date,7)));
    assert.ok(!feed.events.some(event=>event.title === 'Canceled Tea'));

    const unchanged = build(feed);
    assert.equal(unchanged.status,0,unchanged.stderr);
    assert.equal(await readFile(output,'utf8'),'publish=true\n');

    const missingFeed = build(null);
    assert.notEqual(missingFeed.status,0);
    assert.equal(await readFile(output,'utf8'),'publish=true\n');
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
