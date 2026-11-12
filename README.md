# Free Food at Williams

A calendar for food and drinks offered at Williams College events. It uses the public Williams Events and Announcements calendar and public department websites. Advertised food is treated as included unless a listing says it costs money or attendees must bring their own. Cards link to the original listing and open a Google Calendar draft.

The private Site's calendar link opens this published calendar. GitHub Actions checks for new reviewed inbox listings every 15 minutes and refreshes the Williams sources daily. If a Williams source refresh is incomplete, the page keeps a verified public snapshot and also tries the Williams calendar and department feeds directly. Set the repository's **Settings → Pages → Build and deployment → Source** to **GitHub Actions** for the initial deployment.

Run `npm test` and `npm run build` with Node 24. The static site is written to `_site/`. The public build also includes the reviewed event details in `data/reviewed-listings.json`, with source and eligibility labels. The file accepts basic event fields and official Williams URLs. It must never contain Gmail URLs, message IDs, raw email content, or contact information. Weekly entries are expanded over the calendar’s rolling date window.

The Actions secret `WILLIAMS_FEED_ACCESS` enables a read-only import of the private site's public projection. Keep the values in Actions secrets and the private site runtime. If the export fails, the workflow fails and GitHub continues serving the last successful deployment.
