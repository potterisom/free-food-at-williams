import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeFrontend} from '../scripts/frontend.mjs';

test('a deployment versions the page’s entire script and style graph together', async () => {
  const root = await mkdtemp(join(tmpdir(),'williams-frontend-'));
  try {
    const source = join(root,'src'), first = join(root,'first'), second = join(root,'second');
    await cp(new URL('../src/',import.meta.url),source,{recursive:true});
    await mkdir(first);
    await mkdir(second);
    await writeFrontend(source,first);
    const page = await readFile(join(first,'index.html'),'utf8');
    const [,version] = page.match(/\.\/app\.([a-f0-9]{16})\.js/);
    assert.ok(page.includes('./style.'+version+'.css'));
    const app = await readFile(join(first,'app.'+version+'.js'),'utf8');
    assert.ok(app.includes('./events.'+version+'.mjs'));
    const sources = await readFile(join(first,'sources.'+version+'.mjs'),'utf8');
    assert.ok(sources.includes('./events.'+version+'.mjs'));
    const eventPath = join(source,'events.mjs');
    await writeFile(eventPath,await readFile(eventPath,'utf8')+'\n// next release\n');
    await writeFrontend(source,second);
    assert.ok(!(await readFile(join(second,'index.html'),'utf8')).includes(version));
  } finally {await rm(root,{recursive:true,force:true});}
});
