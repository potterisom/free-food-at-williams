import test from 'node:test';
import assert from 'node:assert/strict';
import {foodEvidence, googleCalendarLink, mergeEvents, sourceUrl, today} from '../src/events.mjs';
import {calendar, departmentDirectory, departmentPosts, parseDepartment} from '../src/sources.mjs';
const from = '2026-11-11', to = '2026-12-22';
const source = 'https://events.williams.edu/event/test/';
test('requires food provision and rejects paid food or paid attendance', () => {
  for (const body of [
    'Free admission, pizza available from local vendors.',
    'Complimentary talks on tea farming.',
    'Join us to share ideas for sustainable food.',
    'Speakers will share their experience with food insecurity.',
    'There will be snacks available to purchase.',
    'Pizza is $5.',
    'Pizza will be served. Admission tickets are $12.',
    'No snacks will be provided.'
  ]) assert.equal(foodEvidence('Event', body), null, body);
  for (const body of [
    'Refreshments to follow.', 'Cookies and coffee available.',
    'Please join us for pizza and conversation.', 'Sandwiches while supplies last.',
    'Pizza will be provided.', 'Please join us while sipping homemade chai.'
  ]) assert.ok(foodEvidence('Event', body), body);
  assert.ok(foodEvidence('Event','Pizza will be served.','$0.00'));
  assert.equal(foodEvidence('Event','Pizza will be served.','10–15'),null);
});
test('normalizes source links and keeps separate sessions', () => {
  assert.equal(sourceUrl(source + '?utm_source=x&utm_medium=y&utm_campaign=z&utm_content=foo'),source);
  assert.equal(sourceUrl('https://events.williams.edu.other.example/'), '');
  const item = {title:'Pizza',date:from,start:'12:00',url:source,priority:3};
  assert.equal(mergeEvents([item,{...item,start:'16:00',priority:1}]).length,2);
  assert.equal(mergeEvents([item,{...item,priority:1}]).length,1);
  assert.equal(mergeEvents([{...item,priority:1}],[item]).length,0);
});
test('reads real date language in posts and rejects stale/canceled listings', () => {
  const rss = body => '<rss><item><title>Open house</title><link>' + source + '</link><pubDate>Sat, 7 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA[' + body + ']]></description></item></rss>';
  for (const phrase of ['Nov. 12, at 4–5 pm', '11/12 at 4:00–5:00 pm']) {
    const [event] = parseDepartment(rss('Join us ' + phrase + '. Free pizza! Register by Nov. 10.'),source,from,to);
    assert.deepEqual([event.date,event.start,event.end],['2026-11-12','16:00','17:00']);
  }
  assert.equal(parseDepartment(rss('Join us Nov. 12, 1999 at 5 pm. Free pizza!'),source,from,to).length,0);
  assert.equal(parseDepartment(rss('Join us Nov. 12, 2026 at 5 pm. Free pizza! Due to snow, the event is cancelled.'),source,from,to).length,0);
  assert.equal(today(new Date('2026-11-12T02:30:00Z')),from);
});
test('calendar handles a failed page and keeps cancellation metadata', async () => {
  const visible = {title:'Public Pizza',description:'Pizza will be provided.',url:source,start_date:'2026-11-11 16:00:00',end_date:'2026-11-11 17:00:00'};
  const data = await calendar(from,to, url => {
    if (url.searchParams.get('page') === '2') return new Response(null,{status:503});
    return Response.json({total_pages:2,events:[visible,{...visible,title:'Hidden',hide_from_listings:true},{...visible,title:'Canceled: Dinner',status:'cancelled'}]});
  });
  assert.equal(data.complete,false);
  assert.deepEqual(data.events.map(event=>event.title),['Public Pizza']);
  assert.equal(data.cancellations[0].title,'Dinner');
});
test('department discovery ignores directory people records and off-domain sites', async () => {
  const groups = await departmentDirectory(() => Response.json({flexiform:[
    {u:'http://biology.williams.edu'},
    {u:'https://www.williams.edu/academics/english/'},
    {u:'https://hub.williams.edu/english/contact/'},
    {u:'https://fake.williams.edu.example/'}
  ],ldap:{person:{u:'https://secret.williams.edu'}}}));
  assert.ok(groups.flat().includes('https://www.williams.edu/academics/english/'));
  assert.ok(groups.flat().includes('https://hub.williams.edu/english/'));
  assert.ok(!groups.flat().some(url=>/secret|fake/.test(url)));
});
test('time validation checks dated body, labeled ranges, and disregards deadlines', async () => {
  const title = 'Faculty Research Lunch for Staff: Professor Ben Snyder on Surveillance (11/13)';
  const sourcePosts = [
    {title:{rendered:title},content:{rendered:'<h4>When: November 13, noon</h4><h4>Where: Faculty House Lounge</h4><p>Free lunch included. This is a 45 minute talk.</p>'}},
    {title:{rendered:'Student Snacks (11/13)'},content:{rendered:'<p>November 13. RSVP by 10 a.m.</p><p>Time: 2:00–3:00 p.m.</p><p>Pizza will be served.</p>'}},
    {title:{rendered:'Club Lunch (11/13)'},content:{rendered:'<p>When: November 13.</p><p>Time: Noon–1 p.m.</p><p>Lunch provided.</p>'}}
  ].map((item,index)=>({...item,date:'2026-11-07T12:00:00',link:'https://hr.williams.edu/announcements/'+index+'/'}));
  const {events} = await departmentPosts(['https://hr.williams.edu/'],from,to,()=>Response.json(sourcePosts));
  assert.deepEqual(events.map(row=>[row.start,row.end]),[['12:00',''],['14:00','15:00'],['12:00','13:00']]);
  assert.equal(events[0].location,'Faculty House Lounge');
  assert.equal(events[0].eligibility,'Specific group');
});
test('Google Calendar drafts preserve local times and include the public listing', () => {
  const base = {title:'Math & Stats Tea',location:'Frank Morgan Library',start:'14:00',end:'15:00',food:'Tea',
    url:'https://events.williams.edu/event/example/'};
  const winter = new URL(googleCalendarLink({...base,date:'2026-11-11'}));
  assert.equal(winter.searchParams.get('dates'),'20261111T190000Z/20261111T200000Z');
  assert.equal(winter.searchParams.get('stz'),'America/New_York');
  assert.match(winter.searchParams.get('details'),/events\.williams\.edu/);
  const summer = new URL(googleCalendarLink({...base,date:'2027-06-02'}));
  assert.equal(summer.searchParams.get('dates'),'20270602T180000Z/20270602T190000Z');
  const partial = new URL(googleCalendarLink({...base,date:'2026-11-11',end:''}));
  assert.match(partial.searchParams.get('details'),/End time was not listed/);
  assert.equal(new URL(googleCalendarLink({...base,date:'2026-11-11',start:'',end:''})).searchParams.get('dates'),'20261111/20261112');
});
