# Google setup for the day planner

The planner needs Google Maps for places and travel times. Google Calendar is optional: without it, plans are still made and shown, they just cannot be added to a calendar.

All keys go in `.env` in this folder. They are read by the local server and the planner tools; do not paste them into a chat.

## 1. Places and routes (server key)

In the [Google Cloud Console](https://console.cloud.google.com/), enable **Places API (New)** and **Routes API** for a project with billing, then create an API key restricted to those two APIs.

```dotenv
GOOGLE_MAPS_API_KEY=your-server-key
```

One plan uses a handful of place searches and at most 36 leg calculations; a leg with no public-transport route is retried once on foot. These calls are billed by Google, separately from the model.

## 2. The map on the page (browser key)

Enable **Maps JavaScript API** and create a second key:

- Website restriction: `http://127.0.0.1:4318/*` and `http://localhost:4318/*`
- API restriction: Maps JavaScript API only

```dotenv
GOOGLE_MAPS_BROWSER_KEY=your-browser-key
# GOOGLE_MAPS_MAP_ID=optional; Google's DEMO_MAP_ID is used otherwise
```

This key is visible to the page by design, which is why it must be a different key from the server's. If the two are the same, the server refuses to hand it out and the page shows the timeline without a map.

## 3. Calendar (optional)

Enable **Google Calendar API**, configure the OAuth consent screen, and while the app is in testing add your own Google account as a test user. Create an OAuth client of type **Web application** with this redirect address:

```text
http://127.0.0.1:4318/api/google/callback
```

```dotenv
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:4318/api/google/callback
```

Restart the web server, open the page at `127.0.0.1` (not `localhost`, so the sign-in cookie matches), ask for a plan, and choose **Add to calendar…** under it. The first time, it offers **Connect Google Calendar**.

Daylight asks for the `calendar.events.owned` permission. It reads the chosen day in your primary calendar to find busy times, and creates or updates only its own events, only after you confirm a preview. It sends no invitations and deletes nothing.

Writing several events is not a single transaction at Google. If one fails, confirming the same preview again finishes the rest without duplicating the ones already written. A preview is valid for 15 minutes and survives a server restart.

## Local data

`data/daylight.sqlite` holds the encrypted calendar tokens and pending previews; `data/local.key` is the key. `data/plans/` holds the ten most recent checked plans. None of it is served over HTTP and the folder is ignored by git. Anyone who can read the whole folder can decrypt the tokens, so do not share it.
