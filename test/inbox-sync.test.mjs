import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {shift, today} from '../src/events.mjs';

test('refreshes keep omitted and past listings, apply explicit cancellations and skip unchanged revisions', async () => {
  const root = await mkdtemp(join(tmpdir(),'williams-inbox-sync-'));
  try {
    for (const folder of ['data','src','scripts']) {
      await cp(new URL('../'+folder+'/',import.meta.url),join(root,folder),{recursive:true});
    }
    const date = today();
    const old = shift(date,-20);
    const publishedAt = new Date().toISOString();
    const previous = {
      date,updatedAt:publishedAt,complete:true,departmentsComplete:true,
      events:[
        {title:'Department Lunch',date,source:'Department website',url:'https://math.williams.edu/lunch/',priority:2},
        {title:'Old Mixer',date:old,source:'Campus email',reviewed:true,priority:3},
        {title:'Quiet Coffee',date,source:'Williams calendar',url:'https://events.williams.edu/event/quiet-coffee/',priority:3},
        {title:'Canceled Tea',date,source:'Campus email',reviewed:true,priority:3},
        {title:'Newsletter Tea',date:shift(date,7),source:'Campus email',reviewed:true,priority:3}
      ]
    };
    const exportPath = join(root,'data','reviewed-live.json');
    const weekly = {title:'Newsletter Tea',date,start:'14:00',end:'15:00',food:'Tea',source:'Campus email',repeat:'weekly'};
    await writeFile(exportPath,JSON.stringify({updatedAt:publishedAt,cancellations:[{title:'Canceled Tea',date}],
      events:[{...weekly,skipDates:[shift(date,7)]}]}));
    const output = join(root,'actions-output');
    function build(snapshot, inboxOnly = true) {
      const mock = `globalThis.fetch = async url => {
        const target = new URL(url);
        if (target.hostname === 'potterisom.github.io') return Response.json(${JSON.stringify(snapshot)});
        if (${inboxOnly}) throw new Error('Unexpected source request');
        if (target.hostname === 'events.williams.edu') return Response.json({events:[]});
        if (target.pathname.endsWith('searchdata.json')) return Response.json({flexiform:[]});
        if (target.pathname.includes('/wp-json/')) return Response.json([]);
        return new Response('<html></html>');
      };`;
      return spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(mock),'scripts/build.mjs'],{
        cwd:root,encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',WILLIAMS_INBOX_ONLY:String(inboxOnly),GITHUB_OUTPUT:output}
      });
    }
    const first = build(previous,false);
    assert.equal(first.status,0,first.stderr);
    assert.equal(await readFile(output,'utf8'),'publish=true\n');
    const feed = JSON.parse(await readFile(join(root,'_site','events.json'),'utf8'));
    assert.equal(feed.reviewedUpdatedAt,publishedAt);
    assert.equal(feed.departmentsComplete,true);
    assert.equal(feed.complete,true);
    for (const title of ['Department Lunch','Old Mixer','Quiet Coffee']) assert.ok(feed.events.some(event=>event.title === title));
    assert.ok(feed.events.some(event=>event.title === 'Newsletter Tea' && event.date === shift(date,14)));
    assert.ok(!feed.events.some(event=>event.title === 'Newsletter Tea' && event.date === shift(date,7)));
    assert.ok(!feed.events.some(event=>event.title === 'Canceled Tea'));

    const unchanged = build(feed);
    assert.equal(unchanged.status,0,unchanged.stderr);
    assert.equal(await readFile(output,'utf8'),'publish=true\n');

    const missingFeed = build(null,false);
    assert.notEqual(missingFeed.status,0);
    assert.equal(await readFile(output,'utf8'),'publish=true\n');

    await writeFile(exportPath,JSON.stringify({updatedAt:new Date(Date.parse(publishedAt)+1000).toISOString(),events:[
      weekly,{title:'Canceled Tea',date,food:'Tea',source:'Campus email'}
    ]}));
    const later = build(feed);
    assert.equal(later.status,0,later.stderr);
    const laterFeed = JSON.parse(await readFile(join(root,'_site','events.json'),'utf8'));
    assert.deepEqual(laterFeed.events,feed.events);
    assert.deepEqual(laterFeed.cancellations,feed.cancellations);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
