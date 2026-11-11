import {decode, plain, sourceUrl, validDay, makeEvent, cancellation, today, shift, ZONE} from './events.mjs';

const EVENTS = 'https://events.williams.edu/wp-json/tribe/events/v1/events/';
const DIRECTORY = 'https://hub.williams.edu/wp-json/wms/searchdata.json';
const PRIORITY = ['https://ces.williams.edu/', 'https://sustainability.williams.edu/', 'https://chaplain.williams.edu/', 'https://library.williams.edu/', 'https://campus-life.williams.edu/', 'https://wcma.williams.edu/', 'https://hub.williams.edu/davis-center/', 'https://csci.williams.edu/'];
const SHARD_SIZE = 8;
const fetchPublic = (url, options) => globalThis.fetch(url, options);
const localClock = new Intl.DateTimeFormat('en-GB', {timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const months = 'january february march april may june july august september october november december'.split(' ');
const monthPattern = months.map(m => m.slice(0,3) + '(?:' + m.slice(3) + ')?').join('|');
const datePattern = new RegExp('\\b(' + monthPattern + ')\\.?[ \\t]+(\\d{1,2})(?:st|nd|rd|th)?(?:,?[ \\t]+((?:19|20)\\d{2}))?(?![\\d–-])', 'gi');
const timePattern = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?=\W|$)/i;

async function request(url, fetcher, options = {}) {
  const response = await fetcher(url, {...options, signal: AbortSignal.timeout(6500)});
  if (!response.ok) throw new Error('Source returned ' + response.status);
  return response;
}
async function textFromCampus(url, fetcher) {
  let next = sourceUrl(url);
  for (let hops = 0; next && hops < 4; hops++) {
    const response = await fetcher(next, {redirect: 'manual', signal: AbortSignal.timeout(4500)});
    if (response.status >= 300 && response.status < 400) {
      next = sourceUrl(response.headers.get('location') || 'invalid:', next);
      continue;
    }
    if (!response.ok) throw new Error('Department returned ' + response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty source');
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
      while (true) {
        const {value, done} = await reader.read();
        if (done) return {url: next, text: text + decoder.decode()};
        bytes += value.byteLength;
        if (bytes > 1_800_000) throw new Error('Department page too large');
        text += decoder.decode(value, {stream: true});
      }
    } finally { await reader.cancel().catch(() => {}); }
  }
  throw new Error('Unsupported source redirect');
}
const value = (xml, key) => xml.match(new RegExp('<' + key + '\\b[^>]*>([\\s\\S]*?)<\\/' + key + '>', 'i'))?.[1].replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, '$1') || '';
function localFields(value = '') {
  if (typeof value !== 'string') return {};
  const match = /^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d))?/.exec(value);
  if (!match) return {};
  if (/T.*(?:Z|[+-]\d\d:?\d\d)$/i.test(value) && Number.isFinite(Date.parse(value))) {
    const date = new Date(value);
    return {date: today(date), time: localClock.format(date)};
  }
  return {date: match[1], time: match[2] || ''};
}
function explicitDate(text, reference) {
  const dates = new Set();
  const keep = text.split(/\n|(?<=[.!?])\s+(?=[A-Z])/).filter(line =>
    !/^\s*(?:(?:please\s+)?(?:register|rsvp|sign up)|(?:the )?(?:registration|rsvp|sign-up|application) deadline)\b/i.test(line));
  text = keep.join('\n').replace(/\b(?:(?:please\s+)?(?:register|rsvp|sign up)|(?:registration|application) deadline)\s+(?:by|before|on)[^.!?\n]*/gi, '');
  for (const match of text.matchAll(datePattern)) {
    const [full, name, day, year] = match;
    const after = text.slice(match.index + full.length);
    if (/^\s*(?:[–—-]|to\b|through\b)\s*(?:[a-z]{3,9}\.?\s+)?\d/i.test(after)) return '';
    const month = months.findIndex(m => m.startsWith(name.toLowerCase().slice(0,3))) + 1;
    let candidate = (year || reference.slice(0,4)) + '-' + String(month).padStart(2,'0') + '-' + day.padStart(2,'0');
    if (!year && candidate < shift(reference, -2) && reference.slice(5,7) === '12' && month === 1) candidate = String(Number(reference.slice(0,4))+1) + candidate.slice(4);
    if (validDay(candidate)) dates.add(candidate);
  }
  for (const match of text.matchAll(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(\d{2}|(?:19|20)\d{2}))?(?![\d/])/g)) {
    const year = match[3] ? (match[3].length === 2 ? '20' + match[3] : match[3]) : reference.slice(0,4);
    const candidate = year + '-' + match[1].padStart(2,'0') + '-' + match[2].padStart(2,'0');
    if (validDay(candidate)) dates.add(candidate);
  }
  if (dates.size === 0 && /\btomorrow\s+(?:at|from)\b/i.test(text)) dates.add(shift(reference,1));
  if (dates.size === 0 && /\btoday\s+(?:at|from)\b/i.test(text)) dates.add(reference);
  return dates.size === 1 ? [...dates][0] : '';
}
function clocks(text) {
  text = text.replace(/\b([ap])\s*\.\s*m\.?/gi,'$1m').replace(/\b([ap])\s+m\b/gi,'$1m');
  const range = text.match(/\b(noon|midnight|1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\s*(?:[-–—]|to)\s*(noon|midnight|1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/i);
  const hasMeridiem = match => Boolean(match[3] || match[6] || /noon|midnight/i.test(match[1] + match[4]));
  if (range && hasMeridiem(range)) {
    const hour = (h,suffix) => /^noon$/i.test(h) ? 12 : /^midnight$/i.test(h) ? 0 : Number(h) % 12 + (/^p/i.test(suffix) ? 12 : 0);
    const parse = (h,m,suffix) => String(hour(h,suffix)).padStart(2,'0') + ':' + (m || '00');
    let startSuffix = range[3] || range[6] || (/noon/i.test(range[4]) ? 'am' : 'pm');
    let endSuffix = range[6] || range[3] || (/noon/i.test(range[1]) ? 'pm' : 'am');
    if (!range[3] && range[6] && hour(range[1],startSuffix) > hour(range[4],endSuffix)) startSuffix = /^p/i.test(endSuffix) ? 'am' : 'pm';
    if (!range[6] && range[3] && hour(range[4],endSuffix) < hour(range[1],startSuffix)) endSuffix = /^a/i.test(startSuffix) ? 'pm' : 'am';
    return [parse(range[1],range[2],startSuffix),parse(range[4],range[5],endSuffix)];
  }
  const hours24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (hours24) return [hours24[1].padStart(2,'0')+':'+hours24[2],hours24[3].padStart(2,'0')+':'+hours24[4]];
  if (/\bnoon\b/i.test(text)) return ['12:00'];
  if (/\bmidnight\b/i.test(text)) return ['00:00'];
  const single = timePattern.exec(text);
  if (single) return [String(Number(single[1]) % 12 + (/^p/i.test(single[3]) ? 12 : 0)).padStart(2,'0') + ':' + (single[2] || '00')];
  const explicit24 = text.match(/(?:^\s*(?:times?|start|end|when)\s*:\s*|\bat\s+)([01]?\d|2[0-3]):([0-5]\d)\b/i);
  return explicit24 ? [explicit24[1].padStart(2,'0')+':'+explicit24[2]] : [];
}
const nonEventTime = /\b(?:(?:rsvp|register|registration|sign up|application) (?:by|before|deadline)|deadline|doors open)\b/i;
function eventTimes(date, reference, candidates) {
  const readings = candidates.flatMap(line => String(line || '').split(/(?<=[!?])\s+|(?<=\.)\s+(?=[A-Z])/)).filter(line => {
    if (!line || nonEventTime.test(line)) return false;
    const stated = explicitDate(line,reference);
    return !stated || stated === date;
  }).map(line => ({line,times:clocks(line)})).filter(row => row.times[0]);
  const first = readings.find(row => !/^\s*(?:ends?|end time|until)\b/i.test(row.line));
  if (!first) return [];
  const start = first.times[0];
  const end = readings.find(row => row.times[0] === start && row.times[1] > start)?.times[1] ||
    readings.find(row => /^\s*(?:ends?|end time|until)\b/i.test(row.line) && row.times[0] > start)?.times[0];
  return [start,end];
}
function proseEvent({title, body, url, reference, source, priority, email, detail = '', location = ''}, from, to) {
  const clean = plain(body), headline = plain(title);
  const lines = clean.split('\n').slice(0,35);
  const intro = lines.slice(0,12).join('\n').slice(0,1800);
  const date = explicitDate(detail,reference) || explicitDate(headline,reference) || explicitDate(intro,reference);
  const sameDate = lines.filter(line => explicitDate(line,reference) === date);
  const labeled = lines.filter(line => /^\s*(?:times?|when|starts?|ends?|end time|until)\b/i.test(line) || /^\s*(?:🕒\s*)?\d{1,2}(?::\d\d)?\s*(?:[-–—]|(?:am|pm)\b)/i.test(line));
  const [start,end] = eventTimes(date,reference,[detail,...sameDate,...labeled,headline]);
  const place = location || clean.match(/^(?:location|where|venue)\s*:\s*([^\n]+)/im)?.[1] || '';
  return makeEvent({title, body, date, start, end, location: place, url, source, priority, email}, from, to);
}
export async function calendar(from, to, fetcher = fetchPublic) {
  const pull = async page => {
    const url = new URL(EVENTS);
    url.search = new URLSearchParams({start_date: from, end_date: to, per_page: '50', page: String(page)});
    const data = await (await request(url, fetcher)).json();
    if (!Array.isArray(data.events)) throw new Error('Calendar response missing events');
    return data;
  };
  const first = await pull(1);
  const count = Math.max(1, Number(first.total_pages) || 1);
  const pages = await Promise.allSettled(Array.from({length: Math.min(count, 7) - 1}, (_, i) => pull(i+2)));
  const complete = count <= 7 && pages.every(page => page.status === 'fulfilled');
  const rows = [first, ...pages.flatMap(page => page.status === 'fulfilled' ? [page.value] : [])].flatMap(page => page.events);
  const cancellations = [];
  const events = rows.map(row => {
    if (row.hide_from_listings || (row.status && !['publish','cancelled','canceled','postponed'].includes(row.status))) return null;
    const start = localFields(row.start_date), end = localFields(row.end_date);
    // Calendar entries sometimes use 12:xx AM for a midday prayer. Preserve the
    // event date and source link when the recorded hours are contradictory.
    const suspicious = start.time && end.time && parseInt(end.time) - parseInt(start.time) >= 12;
    const raw = {
      title: row.title, body: row.description, date: start.date,
      start: row.all_day || suspicious ? '' : start.time, end: end.time, endDate: end.date,
      cost: row.cost, location: row.venue?.venue, url: row.url, source: 'Williams calendar', priority: 3,
      canceled: /cancel|postpon/i.test(row.event_status || row.status || '')
    };
    if (!raw.start || !raw.end || raw.start === raw.end) {
      const [statedStart,statedEnd] = eventTimes(start.date,start.date || from,
        plain(row.description).split('\n').slice(0,24).filter(line =>
          explicitDate(line,start.date || from) === start.date || /^\s*(?:when|times?|starts?|ends?)\b/i.test(line)));
      if (!raw.start) raw.start = statedStart || '';
      if (statedEnd && statedStart === raw.start && (!raw.end || raw.end === raw.start)) raw.end = statedEnd;
    }
    const withdrawn = cancellation(raw,from,to);
    if (withdrawn) {cancellations.push(withdrawn); return null;}
    return makeEvent(raw,from,to);
  }).filter(Boolean);
  return {complete, events, cancellations};
}
export async function departmentDirectory(fetcher = fetchPublic) {
  const data = await (await request(DIRECTORY, fetcher)).json();
  if (!Array.isArray(data.flexiform)) throw new Error('Department directory missing entries');
  const roots = data.flexiform.flatMap(entry => {
    const url = sourceUrl(String(entry.u || '').replace(/^http:/i, 'https:'));
    if (!url) return [];
    const parsed = new URL(url);
    const sections = parsed.pathname.split('/').filter(Boolean);
    if (['events.williams.edu', 'network.williams.edu', 'map.williams.edu'].includes(parsed.hostname)) return [];
    if (['www.williams.edu', 'williams.edu'].includes(parsed.hostname)) {
      if (!sections.length || /^(?:people|visit|admission|files|search|wp-)/i.test(sections[0])) return [];
      const section = sections[0] === 'academics' && sections[1] ? sections.slice(0,2).join('/') : sections[0];
      return ['https://www.williams.edu/' + section + '/'];
    }
    if (parsed.hostname === 'hub.williams.edu') {
      if (!sections.length || /^(?:people|logging-in|files|search|wp-)/i.test(sections[0])) return [];
      return ['https://hub.williams.edu/' + sections[0] + '/'];
    }
    return [parsed.origin + '/'];
  });
  const urls = [...new Set([...PRIORITY, ...roots.sort()])];
  return Array.from({length: Math.ceil(urls.length / SHARD_SIZE)}, (_, index) => urls.slice(index * SHARD_SIZE, (index+1) * SHARD_SIZE));
}
const links = html => [...html.matchAll(/<(a|link)\b([^>]*)>/gi)].flatMap(([,tag,attrs]) => {
  const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
  return href ? [{tag, href: decode(href), attrs}] : [];
});
function structured(html, base, from, to) {
  const rows = [];
  function visit(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(visit); return; }
    if ([obj['@type']].flat().some(type => /Event$/.test(type || ''))) {
      const start = localFields(obj.startDate), end = localFields(obj.endDate);
      const costs = [obj.offers].flat().map(offer => Number(offer?.price)).filter(price => price > 0);
      const event = makeEvent({
        title: obj.name, body: obj.description, date: start.date, start: start.time,
        end: end.time, endDate: end.date, location: obj.location?.name || (typeof obj.location === 'string' ? obj.location : ''),
        url: sourceUrl(obj.url || obj['@id'] || base, base), cost: costs.length ? '$' + costs[0] : '',
        canceled: /Event(?:Cancelled|Postponed|Rescheduled)/i.test(obj.eventStatus || ''), source: 'Department website', priority: 2
      }, from, to);
      if (event) rows.push(event);
    }
    Object.values(obj).forEach(visit);
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* A malformed item should not hide other listings. */ }
  }
  return rows;
}
export function parseDepartment(text, url, from, to) {
  const rows = structured(text, url, from, to);
  for (const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const published = new Date(value(item,'pubDate'));
    if (!Number.isFinite(+published) || today(published) < shift(from, -120)) continue;
    const event = proseEvent({
      title: value(item,'title'), body: value(item,'content:encoded') || value(item,'description'),
      url: sourceUrl(value(item,'link').trim(), url), reference: today(published), source: 'Department website', priority: 2
    }, from, to);
    if (event) rows.push(event);
  }
  return rows;
}
async function scanDepartment(url, from, to, fetcher) {
  const first = await textFromCampus(url, fetcher);
  const rows = parseDepartment(first.text, first.url, from, to);
  const base = new URL(first.url);
  const found = links(first.text);
  const valid = entry => {
    const candidate = sourceUrl(entry?.href, first.url);
    if (!candidate || candidate === first.url) return '';
    const target = new URL(candidate);
    return target.host === base.host && (base.pathname === '/' || target.pathname.startsWith(base.pathname)) ? candidate : '';
  };
  const feed = valid(found.find(entry => entry.tag === 'link' && /application\/rss\+xml/i.test(entry.attrs) && valid(entry) && !/comments/i.test(entry.href)));
  const index = valid(found.find(entry => entry.tag === 'a' && /\/(?:events|calendar|news|announcements)\/?(?:[?#].*)?$/i.test(entry.href) && valid(entry)));
  const targets = [...new Set([feed, index].filter(Boolean))];
  const results = await Promise.allSettled(targets.map(target => textFromCampus(target, fetcher)));
  for (const result of results) {
    if (result.status === 'fulfilled') rows.push(...parseDepartment(result.value.text, result.value.url, from, to));
  }
  return {rows, complete: results.every(result => result.status === 'fulfilled')};
}
export async function departments(urls, from, to, fetcher = fetchPublic) {
  const results = await Promise.allSettled(urls.map(url => scanDepartment(url, from, to, fetcher)));
  return {
    checked: results.filter(result => result.status === 'fulfilled').length,
    partial: results.some(result => result.status === 'rejected' || !result.value.complete),
    events: results.flatMap(result => result.status === 'fulfilled' ? result.value.rows : [])
  };
}

// Public WordPress JSON provides a browser-readable path when an origin
// declines requests from the hosting network.
export async function departmentPosts(roots, from, to, fetcher = fetchPublic) {
  const results = await Promise.allSettled(roots.map(async root => {
    const campus = sourceUrl(root);
    if (!campus) throw new Error('Unknown department website');
    const url = new URL('wp-json/wp/v2/posts',campus);
    url.search = new URLSearchParams({per_page:'15',after:shift(from,-45)+'T00:00:00',_fields:'date,link,title,content,excerpt'});
    const posts = await (await request(url,fetcher)).json();
    if (!Array.isArray(posts)) throw new Error('Invalid department feed');
    return posts.flatMap(post => {
      const published = localFields(post.date).date;
      if (!validDay(published)) return [];
      const event = proseEvent({
        title:post.title?.rendered || '', body:post.content?.rendered || post.excerpt?.rendered || '',
        url:sourceUrl(post.link), reference:published, source:'Department website', priority:2
      },from,to);
      return event ? [event] : [];
    });
  }));
  const available = results.filter(result => result.status === 'fulfilled');
  return {events:available.flatMap(result=>result.value), checked:available.length, partial:available.length !== results.length};
}

