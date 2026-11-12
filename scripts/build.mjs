import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {LOOKAHEAD_DAYS, mergeCancellations, mergeEvents, shift, today} from '../src/events.mjs';
import {calendar, departmentDirectory, departmentPosts, departments} from '../src/sources.mjs';
import {writeFrontend} from './frontend.mjs';
import {reviewedCancellations, reviewedListings} from './reviewed-listings.mjs';

const date = today();
const from = shift(date,-6), to = shift(date,LOOKAHEAD_DAYS);
const inboxOnly = process.env.WILLIAMS_INBOX_ONLY === 'true';
const seed = JSON.parse(await readFile('data/public-seed.json','utf8'));
const savedReview = JSON.parse(await readFile('data/reviewed-listings.json','utf8'));
const liveReview = await readFile('data/reviewed-live.json','utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
const sourceNames = new Map(savedReview.map(row=>[row.title,row.source]));
const reviewed = reviewedListings(liveReview?.events.map(row=>({...row,source:sourceNames.get(row.title) || row.source})) || savedReview,from,to);
const previous = await fetch('https://potterisom.github.io/free-food-at-williams/events.json?refresh='+Date.now(), {cache:'no-store',signal:AbortSignal.timeout(8000)})
  .then(response=>response.ok ? response.json() : null).catch(()=>null);
if ((process.env.GITHUB_ACTIONS === 'true' || inboxOnly) && !Array.isArray(previous?.events)) {
  throw new Error('The last published feed is unavailable. Keeping the current deployment.');
}
if (inboxOnly) {
  if (!liveReview) throw new Error('An inbox sync needs the protected export');
  if (Array.isArray(previous.cancellations) && previous.date === date && previous.reviewedUpdatedAt === liveReview.updatedAt) {
    console.log('The current inbox revision is already published.');
    process.exit(0);
  }
}
// Earlier builds could drop seed events as soon as a source omitted them.
const restored = Array.isArray(previous?.cancellations) ? [] : [
  ...seed.events, ...reviewedListings(savedReview.filter(row=>!row.repeat),'0001-01-01',to)
];
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
const emptyCalendar = {complete:false,events:[],cancellations:[]};
async function refreshPublicSources() {
  const [calendarResult,directoryResult] = await Promise.allSettled([
    retry(()=>calendar(from,to,publicFetch)),
    retry(()=>departmentDirectory(publicFetch))
  ]);
  const main = calendarResult.status === 'fulfilled' ? calendarResult.value : emptyCalendar;
  const groups = directoryResult.status === 'fulfilled' ? directoryResult.value : [];
  const supplemental = [];
  const departmentCancellations = [];
  let departmentsComplete = groups.length > 0;
  let group = 0;
  async function scan() {
    while (group < groups.length) {
      const urls = groups[group++];
      const results = await Promise.allSettled([departmentPosts(urls,from,to,publicFetch), departments(urls,from,to,publicFetch)]);
      const successful = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      for (const result of successful) {
        supplemental.push(...result.events);
        departmentCancellations.push(...result.cancellations);
      }
      if (!successful.some(result => !result.partial)) departmentsComplete = false;
    }
  }
  await Promise.all(Array.from({length:4},scan));
  if (!main.complete) console.warn('Calendar refresh was incomplete:', calendarResult.reason?.message || 'one or more calendar pages failed');
  if (!groups.length) console.warn('The public department directory was unavailable.', directoryResult.reason?.message || '');
  return {main,supplemental,departmentsComplete,departmentCancellations};
}
const {main,supplemental,departmentsComplete,departmentCancellations} = inboxOnly
  ? {main:emptyCalendar,supplemental:[],departmentsComplete:false,departmentCancellations:[]}
  : await refreshPublicSources();
const cancellations = mergeCancellations([
  ...(previous?.cancellations || []), ...reviewedCancellations(liveReview), ...main.cancellations, ...departmentCancellations
]);
const events = mergeEvents([...reviewed,...main.events,...supplemental,...(previous?.events || []),...restored],cancellations)
  .filter(event => event.url || event.reviewed)
  .map(({title,date,start,end,food,categories,location,eligibility,rsvp,limited,url,source,priority,reviewed}) =>
    ({title,date,start,end,food,categories,location,eligibility,rsvp,limited,url,source,priority,reviewed}));
await mkdir('_site',{recursive:true});
await writeFrontend('src','_site');
await writeFile('_site/.nojekyll','');
await writeFile('_site/events.json',JSON.stringify({
  events,cancellations,date,complete:inboxOnly ? previous.complete : main.complete,
  departmentsComplete:inboxOnly ? previous.departmentsComplete : departmentsComplete,
  reviewedImported:liveReview !== null,reviewedUpdatedAt:liveReview?.updatedAt || previous?.reviewedUpdatedAt,
  updatedAt:main.complete ? new Date().toISOString() : previous?.updatedAt || seed.updatedAt
})+'\n');
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,'publish=true\n');
console.log('Prepared '+events.length+' listings, including '+reviewed.length+' reviewed dates.');
