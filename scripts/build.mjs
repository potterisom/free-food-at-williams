import {copyFile, mkdir, writeFile} from 'node:fs/promises';
import {LOOKAHEAD_DAYS, mergeEvents, shift, today} from '../src/events.mjs';
import {calendar, departmentDirectory, departmentPosts, departments} from '../src/sources.mjs';

const date = today();
const from = shift(date,-6), to = shift(date,LOOKAHEAD_DAYS);
const retry = async read => {
  try {return await read();}
  catch {
    await new Promise(resolve=>setTimeout(resolve,1500));
    return read();
  }
};
const jobs = await Promise.allSettled([
  retry(()=>calendar(from,to)),
  retry(()=>departmentDirectory())
]);
const main = jobs[0].status === 'fulfilled' ? jobs[0].value : {complete:false,events:[],cancellations:[]};
const groups = jobs[1].status === 'fulfilled' ? jobs[1].value : [];
const supplemental = [];
let group = 0;
async function scan() {
  while (group < groups.length) {
    const urls = groups[group++];
    const results = await Promise.allSettled([departmentPosts(urls,from,to), departments(urls,from,to)]);
    for (const result of results) if (result.status === 'fulfilled') supplemental.push(...result.value.events);
  }
}
await Promise.all(Array.from({length:4},scan));
if (!main.complete) console.warn('Calendar refresh was incomplete. The browser will retry Williams directly.');
if (!groups.length) console.warn('The public department directory was unavailable.');
const events = mergeEvents([...main.events,...supplemental],main.cancellations)
  .filter(event => event.url)
  .map(({title,date,start,end,food,categories,location,eligibility,rsvp,limited,url,source,priority}) =>
    ({title,date,start,end,food,categories,location,eligibility,rsvp,limited,url,source,priority}));
await mkdir('_site',{recursive:true});
for (const file of ['index.html','style.css','app.js','events.mjs','sources.mjs']) await copyFile('src/'+file,'_site/'+file);
await writeFile('_site/.nojekyll','');
await writeFile('_site/events.json',JSON.stringify({events,complete:main.complete,updatedAt:new Date().toISOString()})+'\n');
console.log('Prepared '+events.length+' public listings from the calendar and '+groups.flat().length+' department sites.');
