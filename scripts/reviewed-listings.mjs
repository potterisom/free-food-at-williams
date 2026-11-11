import {foodEvidence, mergeEvents, shift, sourceUrl, validDay} from '../src/events.mjs';

const fields = new Set(['title','date','start','end','food','location','source','eligibility','rsvp','limited','url','repeat','skipDates']);
const eligibility = new Set(['Open to all','Williams community','Williams students','Specific group','Check invitation','Check listing']);
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const contact = /https?:\/\/|[a-z\d._%+-]+@[a-z\d.-]+\.[a-z]{2,}|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/i;
const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();
export function reviewedListings(records, from, to) {
  if (!Array.isArray(records) || records.length > 100) throw new Error('Invalid reviewed listings');
  return mergeEvents(records.flatMap((entry,index) => {
    const invalid = () => new Error('Invalid reviewed listing ' + (index+1));
    if (!entry || !Object.keys(entry).every(key=>fields.has(key)) || !validDay(entry.date)) throw invalid();
    for (const field of ['title','food','source','location']) {
      const value = entry[field];
      if (value === undefined && field === 'location') continue;
      if (typeof value !== 'string' || !value.trim() || value.length > 210 || contact.test(value) || /[\r\n<>]/.test(value)) throw invalid();
    }
    if (entry.url && !sourceUrl(entry.url)) throw invalid();
    if ((entry.start && !clock.test(entry.start)) ||
      (entry.end && (!clock.test(entry.end) || !entry.start || entry.end <= entry.start))) throw invalid();
    if (entry.repeat !== undefined && entry.repeat !== 'weekly') throw invalid();
    if (entry.skipDates !== undefined && (entry.repeat !== 'weekly' || !Array.isArray(entry.skipDates) || !entry.skipDates.every(validDay))) throw invalid();
    const {title,date,start='',end='',food,location='',source} = entry;
    const categories = foodEvidence('', 'Complimentary ' + food + ' will be served.')?.categories || [];
    const event = {
      title,date,start,end,food,location,source,categories,
      url:sourceUrl(entry.url), priority:3,
      eligibility:eligibility.has(entry.eligibility) ? entry.eligibility : 'Check invitation',
      rsvp:entry.rsvp === true, limited:entry.limited === true, reviewed:true
    };
    if (!entry.repeat) return date >= from && date <= to ? [event] : [];
    const first = date >= from ? date : shift(from,(weekday(date)-weekday(from)+7)%7);
    const occurrences = [];
    for (let day=first; day<=to; day=shift(day,7)) {
      if (!entry.skipDates?.includes(day)) occurrences.push({...event,date:day});
    }
    return occurrences;
  }));
}
