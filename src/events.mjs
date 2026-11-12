export const LOOKAHEAD_DAYS = 90;
export const ZONE = 'America/New_York';
const iso = /^\d{4}-\d\d-\d\d$/;
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit'});
export function today(date = new Date()) {
  const parts = Object.fromEntries(fmt.formatToParts(date).map(({type,value})=>[type,value]));
  return [parts.year,parts.month,parts.day].join('-');
}
export function validDay(day) {
  if (!iso.test(day)) return false;
  const date = new Date(day + 'T12:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === day;
}
export function shift(day, delta) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}
const entities = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ', ndash:'–', mdash:'—', rsquo:'’', lsquo:'‘', ldquo:'“', rdquo:'”', hellip:'…', '#038':'&'};
export function decode(value = '') {
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, key) => {
    if (key.startsWith('#')) {
      const point = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return entities[key.toLowerCase()] ?? whole;
  });
}
export function plain(value = '') {
  return decode(String(value)
    .replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(?:p|div|article|h[1-6]|li|ul|br|tr|section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
}
export function sourceUrl(input, base) {
  try {
    const url = new URL(decode(input), base);
    const campus = url.hostname === 'williams.edu' || url.hostname.endsWith('.williams.edu');
    if (!campus || url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_')) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}
const foods = [
  ['Meals', /\b(?:pizza|burritos?|sandwich(?:es)?|tacos?|sushi|bagels?|brunch|breakfast|lunch|dinner|supper|meals?|dumplings?|rice bowls?|burrito bowls?|buffet|entrées?|entrees?)\b/i],
  ['Snacks', /\b(?:snacks?|bites?|charcuterie(?: boards?)?|salad|refreshments?|cookies?|(?:dough|do)nuts?|pastries|desserts?|popcorn|cake|ice cream|brownies|chocolate|cupcakes?|fruits?|appetizers?|food|candy|sweets?|treats?)\b/i],
  ['Drinks', /\b(?:chai|boba|hot chocolate|hot cocoa|tea|coffee|cider|drinks?|beverages|lemonade)\b/i],
];
const names = /\b(?:vegetarian pizza|pizza|burrito bowls?|burritos?|sandwich(?:es)?|tacos?|sushi|bagels?|brunch|breakfast|lunch|dinner|supper|meals?|dumplings?|rice bowls?|buffet|entrées?|entrees?|snacks?|bites?|charcuterie(?: boards?)?|salad|refreshments?|cookies?|(?:dough|do)nuts?|pastries|desserts?|popcorn|cake|ice cream|brownies|hot chocolate|hot cocoa|chocolate|cupcakes?|fruits?|appetizers?|food|candy|sweets?|treats?|chai|boba|tea|coffee|cider|drinks?|beverages|lemonade)\b/gi;
const noFood = /\b(?:no (?:free )?(?:food|lunch|dinner|refreshments|snacks)|(?:food|refreshments|snacks|lunch|dinner) (?:will not|won.t|is not|aren.t|not) be (?:available|provided|served)|food[- ]free)\b/i;
const priced = /\b(?:available (?:only )?for purchase|for purchase|for sale|sold separately|available to (?:buy|purchase)|cash only|meal swipe required|sold at)\b|(?:\$|USD\s*)\s*[1-9]\d*(?:\.\d+)?/i;
const bringMeal = /\b(?:bring|pack) (?:your own|a) (?:food|lunch|dinner|snacks?|meal|drinks?|beverages?)|\b(?:food|lunch|dinner|snacks?|meals?|drinks?) (?:is |are )?(?:bring[- ]your[- ]own|byo)\b/i;
const availability = /\b(?:while supplies last|while they last|first come,? first served|limited (?:quantities|supply))\b/i;
const canceledPrefix = /^\s*(?:update[ :–-]+)?cancel(?:l)?ed(?:\s*[:–—-]\s*|\s+|$)/i;
const canceledSuffix = /(?:\s*[:–—-]\s*|\s*[([]\s*)cancel(?:l)?ed[)\]]?\s*$/i;
const blockedTitle = /\b(?:receipt|order confirmation|order has shipped|delivery order|catering invoice)\b/i;
const tagOf = term => ({bite:'Bites',drink:'Drinks',fruits:'Fruit'})[term.toLowerCase()] || term[0].toUpperCase() + term.slice(1).toLowerCase();
export function foodEvidence(title, body, cost = '') {
  const sentences = body.split(/\n|(?<=[!?;])\s+|(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
  const numericCosts = String(cost).match(/\d+(?:\.\d+)?/g) || [];
  const paidEntry = numericCosts.some(value => Number(value) > 0) || sentences.some(line =>
    /\$\s*[1-9]\d*(?:\.\d+)?/.test(line) && /\b(?:admission|tickets?|registration|entry|per person)\b/i.test(line));
  if (paidEntry) return null;
  const offeredBefore = /\b(?:free|complimentary|there (?:will be|are)|come (?:for|enjoy)|we(?:'|’)ll have|we will have|followed by|sipping|over|(?:please )?join (?:us|them)|enjoy|make|prepare|grab|serve|provide|serving|providing|snack on|(?:place|select|choose) your)\b[^.!?;]{0,58}$/i;
  const offeredAfter = /^(?:[\s,\/]+(?:and\s+)?[\w’'-]+){0,5}\s+(?:will be (?:served|provided|supplied|available|offered|handed out)|(?:is|are) (?:free|on us|provided|served|available)|(?:to|will) follow|while (?:supplies|they) last|available(?:\s*(?:[.!?,]|$))|provided(?:\s*(?:[.!?,]|$))|(?:begins|starts) at)/i;
  const eventFood = /\b(?:dinner|lunch|brunch|breakfast|supper)\s+(?:with|at|and learn|reception|for (?:all|students|faculty|staff))\b|\b(?:student.faculty|shabbat|teaching|community|welcome)\s+(?:dinner|lunch|brunch|breakfast)\b|\b(?:pizza|taco|snack|dessert)\s+(?:night|party|mixer|social|reception)\b/i;
  const menu = /\b(?:menu|includes?|featuring|catered by|food by|order from|order\s*\(|make your own|build your own)\b/i;
  const irrelevant = /\b(?:talks?|speakers?|research|ideas?|experience|learn|lecture|discussion|history|sustainable)\b/i;
  const found = [];
  for (const [index, line] of [title, ...sentences].entries()) {
    if (noFood.test(line) || bringMeal.test(line) || priced.test(line) ||
        /\b(?:food|drinks?|snacks?|refreshments?|lunch|dinner|meal)\b.{0,30}\b(?:costs? extra|must be purchased|payment required)\b/i.test(line)) continue;
    for (const match of line.matchAll(names)) {
      const before = line.slice(0,match.index), after = line.slice(match.index + match[0].length);
      if (/^\s+(?:insecurity|deserts?|systems?|justice|history|research|industry|farming|production|allerg(?:y|ies))\b/i.test(after)) continue;
      const service = before.match(offeredBefore)?.[0] || '';
      const advertised = offeredAfter.test(after) || /^(?:\s+\w+){0,3}\s+at no (?:cost|charge)\b/i.test(after) ||
        (service && !/\b(?:admission|tickets?|entry)\b/i.test(service) && !irrelevant.test(service.replace(/\b(?:join us|enjoy)\b/i,''))) ||
        (menu.test(line) && !irrelevant.test(line)) || (index === 0 && eventFood.test(title));
      if (advertised) found.push(tagOf(match[0]));
    }
  }
  if (found.length && [title,...sentences].some(line => noFood.test(line) || bringMeal.test(line) || priced.test(line))) {
    const exclusions = [title,...sentences].filter(line => noFood.test(line) || bringMeal.test(line) || priced.test(line));
    for (let index = found.length - 1; index >= 0; index--) {
      const name = found[index].toLowerCase();
      if (exclusions.some(line => [...line.matchAll(names)].some(match => match[0].toLowerCase() === name))) found.splice(index,1);
    }
  }
  const tags = [...new Set(found)];
  if (!tags.length) return null;
  const basics = /^(?:food|meals?|treats|refreshments|drinks?|beverages|lunch|dinner)$/i;
  const specifics = tags.filter(tag => !basics.test(tag));
  const items = tags.filter(tag => !basics.test(tag) || !foods.some(([,pattern]) =>
    pattern.test(tag) && specifics.some(specific => pattern.test(specific))));
  return {
    food: items.slice(0, 5).join(', '),
    categories: foods.filter(([, pattern]) => pattern.test(items.join(' '))).map(([name]) => name),
    limited: availability.test(body)
  };
}
export function cancellation(raw, from, to) {
  const title = plain(raw.title).replace(/\s+/g, ' ').slice(0,210);
  const body = plain(raw.body);
  const notice = /(?:^|[.!?,]\s+|\n)(?:the |this )?(?:event|program|session|meeting|reception|lunch|dinner) (?:is|has been|was) cancel(?:l)?ed\b/i;
  if (!(raw.canceled || canceledPrefix.test(title) || canceledSuffix.test(title) || notice.test(body))) return null;
  if (!validDay(raw.date) || raw.date < from || raw.date > to) return null;
  return {
    title: title.replace(canceledPrefix,'').replace(canceledSuffix,'').trim(),
    date:raw.date, start:raw.start || '', url:sourceUrl(raw.url), priority:raw.priority || 0
  };
}
export function makeEvent(raw, from, to) {
  const title = plain(raw.title).replace(/\s+/g, ' ').slice(0, 210);
  const body = plain(raw.body).slice(0, 16000);
  const date = raw.date || '';
  if (!title || blockedTitle.test(title) || !validDay(date) || date < from || date > to) return null;
  if (cancellation(raw, from, to)) return null;
  if (raw.endDate && raw.endDate !== date) return null;
  const food = foodEvidence(title, body, raw.cost || '');
  if (!food) return null;
  const url = sourceUrl(raw.url);
  if (!url && !raw.email) return null;
  const start = time.test(raw.start || '') ? raw.start : '';
  const end = start && time.test(raw.end || '') && raw.end > start ? raw.end : '';
  const access = (title + '\n' + body).replace(/[’‘]/g, "'");
  const eligibility = /\b(?:for staff|only (?:open to )?(?:majors|first-years|seniors|juniors|faculty|staff|members)|(?:majors|first-years|seniors|juniors|faculty|staff|members) only|by invitation only)\b/i.test(access) ? 'Specific group'
    : /\b(?:williams community|students,? faculty,? (?:and|&) staff|williams campus community|campus community)\b/i.test(access) ? 'Williams community'
    : /\b(?:williams students|for students only|students only)\b/i.test(access) ? 'Williams students'
    : /\b(?:open to (?:the (?:general )?public|all)|all are welcome|everyone (?:is welcome|welcome))\b/i.test(access) ? 'Open to all' : 'Check listing';
  const rsvp = /\b(?:rsvp|registration|register(?:ed)?|sign[- ]?up|reserve your (?:seat|spot))\b/i.test(access) && !/\b(?:rsvp|registration|sign[- ]?up) (?:is )?(?:optional|not required|encouraged|appreciated)|no (?:rsvp|registration|sign[- ]?up) (?:is )?(?:needed|required)\b/i.test(access);
  return {
    title, date, start, end, food: food.food, categories: food.categories,
    location: plain(raw.location).replace(/\s+/g, ' ').slice(0, 150),
    eligibility, rsvp, limited: food.limited, url,
    ...(raw.email ? {email: raw.email} : {}),
    source: raw.source, priority: raw.priority || 0
  };
}
export function googleCalendarLink(event) {
  if (!validDay(event.date)) return '';
  const day = event.date.replaceAll('-','');
  const details = [event.food,event.url].filter(Boolean);
  let dates = day + '/' + shift(event.date,1).replaceAll('-','');
  if (time.test(event.start || '')) {
    const start = localInstant(event.date,event.start);
    const validEnd = time.test(event.end || '') && event.end > event.start;
    const end = validEnd ? localInstant(event.date,event.end) : new Date(+start + 3600000);
    const stamp = date => date.toISOString().replace(/[-:]|\.\d{3}/g,'');
    dates = stamp(start) + '/' + stamp(end);
    if (!validEnd) details.unshift('End time was not listed. Confirm or adjust this draft before saving.');
  } else {
    details.unshift('Time was not listed. Set the event time before saving.');
  }
  const url = new URL('https://calendar.google.com/calendar/r/eventedit');
  url.search = new URLSearchParams({action:'TEMPLATE',text:event.title,dates,stz:ZONE,etz:ZONE,
    location:event.location || '',details:details.join('\n')});
  return url.href;
}
const campusOffset = new Intl.DateTimeFormat('en-US',{timeZone:ZONE,timeZoneName:'shortOffset'});
function localInstant(day, clock) {
  const local = Date.parse(day + 'T' + clock + ':00Z');
  let utc = local;
  for (let attempt=0; attempt<3; attempt++) {
    const zone = campusOffset.formatToParts(new Date(utc)).find(part=>part.type === 'timeZoneName')?.value || '';
    const offset = zone.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!offset) break;
    const minutes = (Number(offset[2])*60 + Number(offset[3] || 0)) * (offset[1] === '-' ? -1 : 1);
    const next = local - minutes*60000;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}
const titleKey = title => title.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function sameEvent(a, b) {
  if (a.date !== b.date || (a.start && b.start && a.start !== b.start)) return false;
  if (a.url && a.url === b.url && /\/event\//.test(a.url)) return true;
  return titleKey(a.title) === titleKey(b.title) &&
    (!a.location || !b.location || titleKey(a.location) === titleKey(b.location) || Boolean(a.start && a.start === b.start));
}
export function mergeCancellations(notices) {
  const unique = new Map();
  for (const notice of notices) {
    const key = JSON.stringify([notice.date,titleKey(notice.title),notice.start || '',notice.url || '']);
    if (!unique.has(key)) unique.set(key,notice);
  }
  return [...unique.values()];
}
function sameCanceledEvent(notice, event) {
  if (notice.start && event.start && notice.start !== event.start) return false;
  return (notice.title && titleKey(notice.title) === titleKey(event.title)) ||
    (notice.url && notice.url === event.url && /\/event\//.test(notice.url));
}
export function mergeEvents(events, cancellations = []) {
  const byDay = new Map(), canceledByDay = new Map();
  for (const notice of cancellations) {
    if (!canceledByDay.has(notice.date)) canceledByDay.set(notice.date,[]);
    canceledByDay.get(notice.date).push(notice);
  }
  for (const event of [...events].sort((a,b) => b.priority - a.priority)) {
    if (canceledByDay.get(event.date)?.some(item => sameCanceledEvent(item,event))) continue;
    if (!byDay.has(event.date)) byDay.set(event.date,[]);
    const day = byDay.get(event.date);
    const duplicate = day.find(old => sameEvent(old,event));
    if (!duplicate) { day.push({...event}); continue; }
    for (const field of ['start', 'end', 'location', 'url', 'email']) {
      if (!duplicate[field] && event[field] && (field !== 'end' || duplicate.start === event.start)) duplicate[field] = event[field];
    }
    duplicate.rsvp ||= event.rsvp;
    duplicate.limited ||= event.limited;
    duplicate.repeat ||= event.repeat;
    if (duplicate.eligibility === 'Check listing') duplicate.eligibility = event.eligibility;
  }
  return [...byDay.values()].flat().sort((a,b) => a.date.localeCompare(b.date) || (a.start || '99:99').localeCompare(b.start || '99:99') || a.title.localeCompare(b.title));
}
