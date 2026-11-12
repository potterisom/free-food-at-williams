import {writeFile} from 'node:fs/promises';
import {LOOKAHEAD_DAYS, shift, today} from '../src/events.mjs';
import {reviewedListings} from './reviewed-listings.mjs';

const endpoint = 'https://free-food-at-williams.leylasalken.chatgpt.site/api/export/reviewed-listings';

async function pull(token, key) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(endpoint, {
      headers:{'OAI-Sites-Authorization':'Bearer '+token,'X-Williams-Export-Key':key},
      redirect:'error',signal:AbortSignal.timeout(20000)
    }).catch(() => null);
    if (response?.ok) return response.json();
    if (response && response.status < 500 && response.status !== 429) {
      throw new Error('Export returned HTTP ' + response.status);
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Export did not respond successfully after three attempts');
}

try {
  const {token,key} = JSON.parse(process.env.WILLIAMS_FEED_ACCESS || '{}');
  if (typeof token !== 'string' || !token || typeof key !== 'string' || !key) throw new Error('Missing export credentials');
  const {events,updatedAt} = await pull(token,key);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Invalid export revision');
  const date = today();
  reviewedListings(events,shift(date,-6),shift(date,LOOKAHEAD_DAYS));
  await writeFile('data/reviewed-live.json',JSON.stringify({events,updatedAt})+'\n');
  console.log('Imported '+events.length+' reviewed listings.');
} catch (error) {
  const status = error.message?.match(/^Export returned HTTP \d+$/)?.[0];
  console.error('Reviewed listings could not be imported. The last successful deployment is still live.' + (status ? ' ' + status + '.' : ''));
  process.exitCode = 1;
}
