import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const files = ['index.html','style.css','app.js','events.mjs','sources.mjs'];
export async function writeFrontend(source, output) {
  const contents = await Promise.all(files.map(file=>readFile(join(source,file),'utf8')));
  const version = createHash('sha256').update(JSON.stringify(contents)).digest('hex').slice(0,16);
  const names = Object.fromEntries(files.map(file=>[file,file === 'index.html' ? file : file.replace(/\./,'.'+version+'.')]));
  await Promise.all(files.map((file,index) => {
    const body = contents[index].replace(/\.\/(style\.css|app\.js|events\.mjs|sources\.mjs)(?=["'])/g,
      (_,asset)=>'./'+names[asset]);
    return writeFile(join(output,names[file]),body);
  }));
}
