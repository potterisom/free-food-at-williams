import {LOOKAHEAD_DAYS, today, shift, mergeEvents, googleCalendarLink} from './events.mjs';
import {calendar, departmentDirectory, departmentPosts} from './sources.mjs';

const $ = id => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const current = today();
const lower = shift(current, -6), upper = shift(current, LOOKAHEAD_DAYS);
const noon = day => new Date(day + 'T12:00:00Z');
const monday = day => shift(day, -((noon(day).getUTCDay() + 6) % 7));
const format = (day, options) => new Intl.DateTimeFormat('en-US', {timeZone:'UTC', ...options}).format(noon(day));
const displayDay = day => format(day, {weekday:'long', month:'long', day:'numeric'});
const displayTime = time => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour % 12 || 12) + ':' + String(minute).padStart(2,'0') + (hour < 12 ? ' AM' : ' PM');
};
let week = monday(current), selected = '';
let rows = [], failures = new Set(), ready = false, scan = 0;
const search = $('search'), food = $('food'), eligibility = $('eligibility');
const shown = () => {
  const query = search.value.trim().toLocaleLowerCase();
  return rows.filter(event => (!food.value || event.categories.includes(food.value))
    && (!eligibility.value || event.eligibility === eligibility.value)
    && (!query || [event.title,event.food,event.location,event.eligibility,event.source].join(' ').toLocaleLowerCase().includes(query)));
};
function showStatus() {
  const status = $('source-status');
  status.textContent = failures.has('Williams calendar') ? 'Calendar update unavailable.' : '';
  status.hidden = !status.textContent;
}
function sourceLink(event,label) {
  if (!event.url) return null;
  const link = make('a',label);
  link.href = event.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  return link;
}
function listing(event) {
  const row = make('article', '', 'event');
  const at = make('div', '', 'time');
  at.append(make('span',event.start ? displayTime(event.start) : 'Time TBA'));
  if (event.start) at.append(make('span',event.end ? '– ' + displayTime(event.end) : 'End not listed','time-end'));
  const dot = make('span', '', 'dot');
  dot.setAttribute('aria-hidden','true');
  const card = make('div', '', 'card');
  const title = make('h3');
  const link = sourceLink(event,event.title);
  if (link) title.append(link);
  else title.textContent = event.title;
  const meta = make('div', '', 'meta');
  const badge = make('span', event.food, 'food');
  badge.dataset.kind = event.categories[0] || '';
  meta.append(badge);
  if (event.location) meta.append(make('span', event.location));
  if (event.eligibility !== 'Check listing') meta.append(make('span', event.eligibility));
  if (event.rsvp) meta.append(make('span','RSVP'));
  if (event.limited) meta.append(make('span','While supplies last'));
  const source = sourceLink(event,event.source) || make('span',event.source);
  source.classList.add('event-source');
  const actions = make('div','','card-actions');
  const calendarLink = make('a','Add to Google Calendar');
  calendarLink.href = googleCalendarLink(event);
  calendarLink.target = '_blank';
  calendarLink.rel = 'noreferrer noopener';
  actions.append(source,calendarLink);
  card.append(title,meta,actions);
  row.append(at,dot,card);
  return row;
}
function render() {
  const matches = shown();
  const active = document.activeElement?.dataset?.day;
  const strip = $('days');
  const firstMonth = format(week,{month:'short'}), lastMonth = format(shift(week,6),{month:'short'});
  const startNumber = Number(week.slice(-2)), endNumber = Number(shift(week,6).slice(-2));
  $('date').textContent = selected ? displayDay(selected) : week === monday(current) ? 'Upcoming' :
    firstMonth + ' ' + startNumber + '–' + (firstMonth === lastMonth ? '' : lastMonth + ' ') + endNumber;
  $('clear').hidden = !(search.value || food.value || eligibility.value);
  $('previous').disabled = shift(week,-1) < lower;
  $('next').disabled = shift(week,7) > upper;
  const dayNodes = [];
  for (let i = 0; i < 7; i++) {
    const day = shift(week,i);
    const count = matches.filter(event => event.date === day).length;
    const button = make('button', '', 'day');
    button.type = 'button';
    button.dataset.day = day;
    button.disabled = day < lower || day > upper;
    button.setAttribute('aria-label', displayDay(day) + ', ' + count + (count === 1 ? ' event' : ' events'));
    button.setAttribute('aria-pressed', String(day === selected));
    if (day === current) button.setAttribute('aria-current','date');
    button.append(make('span',format(day,{weekday:'short'}),'day-name'),make('strong',String(Number(day.slice(-2)))));
    if (count) button.append(make('span',String(count),'count'));
    button.addEventListener('click', () => {selected = selected === day ? '' : day; render();});
    dayNodes.push(button);
  }
  strip.replaceChildren(...dayNodes);
  if (active) dayNodes.find(button => button.dataset.day === active)?.focus({preventScroll:true});
  const list = $('events');
  list.setAttribute('aria-busy', String(!ready));
  const visible = matches.filter(event => selected ? event.date === selected :
    week === monday(current) ? event.date >= current : event.date >= week && event.date <= shift(week,6));
  if (!visible.length) {
    const empty = make('p', !ready ? 'Loading events…' : failures.has('Williams calendar') && !rows.length ? 'Events couldn’t load.' :
      search.value || food.value || eligibility.value ? 'No matching events.' : 'No events found.', 'empty');
    if (ready && failures.has('Williams calendar') && !rows.length) {
      const retry = make('button','Retry','link');
      retry.type = 'button';
      retry.addEventListener('click',load);
      empty.append(retry);
    } else if (selected && ready) {
      const upcoming = make('button','See upcoming','link');
      upcoming.type = 'button';
      upcoming.addEventListener('click', () => {selected = ''; week = monday(current); render();});
      empty.append(upcoming);
    }
    list.replaceChildren(empty);
    return;
  }
  const groups = new Map();
  for (const event of visible) {
    if (!groups.has(event.date)) {
      const group = make('section','','day-group');
      if (!selected) group.append(make('h2',displayDay(event.date)));
      groups.set(event.date,group);
    }
    groups.get(event.date).append(listing(event));
  }
  const focus = list.contains(document.activeElement);
  if (!focus) list.replaceChildren(...groups.values());
  else list.onfocusout = () => requestAnimationFrame(() => {
    if (!list.contains(document.activeElement)) {
      list.onfocusout = null;
      render();
    }
  });
}
async function load() {
  const attempt = ++scan;
  ready = false;
  failures = new Set();
  showStatus();
  render();
  let saved;
  let withdrawals = [];
  try {
    const response = await fetch('./events.json', {signal:AbortSignal.timeout(9000)});
    if (!response.ok) throw new Error('Feed unavailable');
    saved = await response.json();
    if (!Array.isArray(saved.events) || !saved.updatedAt) throw new Error('Invalid feed');
    if (attempt !== scan) return;
    rows = saved.events.filter(event => event.date >= lower && event.date <= upper);
  } catch {
    // The browser can still reach the public calendar directly.
  }
  if (attempt !== scan) return;
  ready = true;
  if (rows.length) render();
  const stale = !saved || Date.now() - Date.parse(saved.updatedAt) > 26 * 60 * 60 * 1000;
  const publicRead = (url,options)=>fetch(url,{...options,credentials:'omit'});
  const supplemental = (!saved?.departmentsComplete || stale) && refreshDepartments(attempt,publicRead,()=>withdrawals);
  if (!saved?.complete || stale) {
    try {
      const live = await calendar(lower,upper,publicRead);
      if (attempt !== scan) return;
      const retained = rows.filter(event => event.source !== 'Williams calendar' || !live.complete);
      withdrawals = live.cancellations;
      rows = mergeEvents([...retained,...live.events],withdrawals);
      if (!live.complete) failures.add('Williams calendar');
    } catch {
      if (attempt === scan) failures.add('Williams calendar');
    }
  }
  if (attempt === scan) {showStatus(); render();}
  await supplemental;
}
async function refreshDepartments(attempt,publicRead,getWithdrawals) {
  try {
    const groups = await departmentDirectory(publicRead);
    let group = 0;
    async function scanGroup() {
      while (group < groups.length && attempt === scan) {
        const data = await departmentPosts(groups[group++],lower,upper,publicRead);
        if (attempt === scan && data.events.length) {
          rows = mergeEvents([...rows,...data.events],getWithdrawals());
          render();
        }
      }
    }
    await Promise.all(Array.from({length:3},scanGroup));
  } catch {
    // Keep the last verified department listings if the directory is unavailable.
  }
}
for (const node of [search,food,eligibility]) node.addEventListener('input',render);
$('clear').addEventListener('click', () => {search.value = food.value = eligibility.value = ''; search.focus(); render();});
$('today').addEventListener('click', () => {week = monday(current); selected = current; render();});
for (const [id, offset] of [['previous',-7],['next',7]]) {
  $(id).addEventListener('click', () => {week = shift(week,offset); selected = ''; render();});
}
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.metaKey && !event.ctrlKey && !/INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) {
    event.preventDefault();
    search.focus();
  }
});
load();
