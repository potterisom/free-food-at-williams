import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {LOOKAHEAD_DAYS, mergeEvents, shift, today} from '../src/events.mjs';
import {calendar, departmentDirectory, departmentPosts, departments} from '../src/sources.mjs';

const date = today();
const from = shift(date,-6), to = shift(date,LOOKAHEAD_DAYS);
const seed = JSON.parse(await readFile('data/public-seed.json','utf8'));
const publicFetch = (url, options) => fetch(url, {...options,headers:{
  ...options.headers, 'User-Agent':'Williams campus food calendar (+https://github.com/potterisom/free-food-at-williams)',
  Accept:'application/json, text/html, application/rss+xml;q=0.9, */*;q=0.5'
}});
const retry = async read => {
  try {return await read();}
  catch {
    await new Promise(resolve=>setTimeout(resolve,1500));
    return read();
  }
};
const jobs = await Promise.allSettled([
  retry(()=>calendar(from,to,publicFetch)),
  retry(()=>departmentDirectory(publicFetch))
]);
const main = jobs[0].status === 'fulfilled' ? jobs[0].value : {complete:false,events:[],cancellations:[]};
const groups = jobs[1].status === 'fulfilled' ? jobs[1].value : [];
const supplemental = [];
let departmentResponses = 0;
let group = 0;
async function scan() {
  while (group < groups.length) {
    const urls = groups[group++];
    const results = await Promise.allSettled([departmentPosts(urls,from,to,publicFetch), departments(urls,from,to,publicFetch)]);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        supplemental.push(...result.value.events);
        departmentResponses += result.value.checked;
      }
    }
  }
}
await Promise.all(Array.from({length:4},scan));
if (!main.complete) console.warn('Calendar refresh was incomplete:', jobs[0].reason?.message || 'one or more calendar pages failed');
if (jobs[1].status === 'rejected') console.warn('Department directory refresh failed:',jobs[1].reason?.message);
if (!groups.length) console.warn('The public department directory was unavailable.');
const retained = seed.events.filter(event => event.date >= from && event.date <= to &&
  (event.source === 'Williams calendar' ? !main.complete : departmentResponses === 0));
const events = mergeEvents([...main.events,...supplemental,...retained],main.cancellations)
  .filter(event => event.url)
  .map(({title,date,start,end,food,categories,location,eligibility,rsvp,limited,url,source,priority}) =>
    ({title,date,start,end,food,categories,location,eligibility,rsvp,limited,url,source,priority}));
await mkdir('_site',{recursive:true});
for (const file of ['index.html','style.css','app.js','events.mjs','sources.mjs']) await copyFile('src/'+file,'_site/'+file);
await writeFile('_site/.nojekyll','');
await writeFile('_site/events.json',JSON.stringify({events,complete:main.complete,departmentsComplete:departmentResponses > 0,updatedAt:main.complete ? new Date().toISOString() : seed.updatedAt})+'\n');
console.log('Prepared '+events.length+' public listings from the calendar and '+groups.flat().length+' department sites.');
