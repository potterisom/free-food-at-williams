import {writeFile} from 'node:fs/promises';
import {LOOKAHEAD_DAYS, shift, today} from '../src/events.mjs';
import {reviewedListings} from './reviewed-listings.mjs';

const configured = process.env.WILLIAMS_FEED_ACCESS;
if (configured) {
  try {
    const {token,key} = JSON.parse(configured);
    if (!token || !key) throw new Error('Incomplete export credentials');
    const endpoint = 'https://free-food-at-williams.leylasalken.chatgpt.site/api/export/reviewed-listings';
    const response = await fetch(endpoint,{
      headers:{'OAI-Sites-Authorization':'Bearer '+token,'X-Williams-Export-Key':key},
      redirect:'error',signal:AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('Export returned HTTP '+response.status);
    const data = await response.json();
    if (!data.updatedAt || !Array.isArray(data.events)) throw new Error('Export returned invalid data');
    const date = today();
    reviewedListings(data.events,shift(date,-6),shift(date,LOOKAHEAD_DAYS));
    await writeFile('data/reviewed-live.json',JSON.stringify(data.events)+'\n');
    console.log('Imported '+data.events.length+' reviewed listings.');
  } catch (error) {
    console.warn('Protected export failed; keeping the last published listings. ' + (error.message?.match(/^Export returned HTTP \d+$/)?.[0] || 'Check export availability.'));
  }
}
