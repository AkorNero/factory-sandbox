# Research: PWA stack and sync options for a single-user offline-first planner

Ticket: [#4](https://github.com/AkorNero/factory-sandbox/issues/4) (child of map [#1](https://github.com/AkorNero/factory-sandbox/issues/1)).
Researched 2026-11-15. This note lists options and does **not** pick one; a later grilling ticket ([#5](https://github.com/AkorNero/factory-sandbox/issues/5)) makes the decision.

Context: one user, phone + desktop, synced data. The model has Tasks, one level of Sub-tasks, Events, and repetition (recurring items, templates, Carry-over). Standing preference: not too complex.

---

## 1. Platform constraints (apply to every stack)

### Storage and eviction
- By default, browser storage is **best-effort**: it can be evicted under storage pressure, least recently used origin first, and the whole origin is deleted at once. **Persistent** storage (`navigator.storage.persist()`) is evicted only if the user clears it. [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- **Safari 7-day rule:** "If an origin has no user interaction, such as click or tap, in the last seven days of browser use, its data created from script will be deleted." This applies when cross-site tracking prevention is on, which is Safari's default. MDN does **not** say that Home Screen web apps are exempt. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- WebKit grants `persist()` "based on heuristics like whether the website is opened as a Home Screen Web App". Installing to the Home Screen therefore improves the odds of persistent storage. Quota: up to about 60% of disk per origin in browser apps. [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- **Implication:** on iOS the local DB is a cache that can be lost. The **server copy is the durable copy**, so every candidate below includes a server-side store. Install to the Home Screen, call `persist()`, and wrap writes in try/catch to handle `QuotaExceededError`.

### Background sync
- The Background Synchronization API (`SyncManager`) is "Limited availability … not Baseline". [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SyncManager) Chrome and Edge support it. **Safari, iOS Safari and Firefox do not.** [caniuse](https://caniuse.com/background-sync)
- **Implication:** do not depend on background sync. Sync while the app is open: on launch, on `online` events, on focus or visibility change, and through a live stream. Every sync engine below already works this way.

### Notifications (for the "not yet specified" item on the map)
- Web Push works on iOS/iPadOS 16.4+ **only for Home Screen web apps**, and permission must be requested in response to a user action. [WebKit: Web Push for Web Apps on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) Reminders need a push server, which only the stacks with a backend can provide easily.

### PWA tooling (stack-neutral)
- `vite-plugin-pwa` generates the manifest, a Workbox-built service worker (`generateSW` / `injectManifest`) and the registration script. It has guides for React, Vue, Svelte, SolidJS, Preact and others. [Vite PWA guide](https://vite-pwa-org.netlify.app/guide/) The UI framework is therefore largely free to choose. The real constraint is the binding the sync library ships (see the table).

---

## 2. Candidate stacks

### A. Dexie.js + Dexie Cloud (managed sync engine, IndexedDB)
- **Local DB:** Dexie over IndexedDB.
- **Sync:** Dexie Cloud. Its consistency model is "server-authoritative, where the server acts as the source of truth". Each transaction syncs atomically. Edits to different properties of the same object don't conflict. For the same property, the later operation wins, using a server-adjusted timestamp. Y.js CRDTs are available for rich text. [Dexie Cloud consistency](https://dexie.org/cloud/docs/consistency)
- **Auth/backend:** email OTP by default, social logins optional. With the zero-config setup "you will not need your own server endpoint", so the app can be a static site. [Dexie Cloud authentication](https://dexie.org/cloud/docs/authentication)
- **Cost (one user):** Free tier €0, with 3 production users, about 100 MB storage and rate limits. The pricing page states some Free limits inconsistently. Pro is €0.12/user/month. Self-hosted Docker is €3,495 one-time. [Dexie Cloud pricing](https://dexie.org/cloud/pricing)
- **UI fit:** Dexie's `liveQuery` works with any framework. React has `useLiveQuery`.
- **Trade-offs:** + Fewest moving parts: no server code, no schema migrations on the server, and conflict semantics fit a single-user planner. - Vendor lock-in to a small vendor, and self-hosting is costly. - Querying is IndexedDB-style, not SQL, so repetition and Upcoming queries are done in JS.

### B. PowerSync + Supabase (Postgres) (managed sync engine, SQLite in the browser)
- **Local DB:** SQLite in a web worker. `vfs: 'auto'` picks storage by browser capability, with an IndexedDB fallback. Shared-worker multi-tab mode is off by default on Safari, iOS and Android. [PowerSync JS Web SDK](https://docs.powersync.com/client-sdk-references/javascript-web)
- **Sync:** PowerSync replicates from your backend DB (Postgres, MongoDB, MySQL and others) down to clients. Writes are queued locally, and **you implement `uploadData`** so that "your backend then applies the changes to the source database". [PowerSync overview](https://docs.powersync.com/intro/powersync-overview), [JS Web SDK](https://docs.powersync.com/client-sdk-references/javascript-web) Supabase is a common pairing: Postgres plus auth plus an API for the upload path.
- **Cost (one user):** PowerSync Cloud Free is $0: 2 GB synced/month, 500 MB hosted, but "projects are deactivated after 1 week of inactivity". A self-hosted Open Edition is free. [PowerSync pricing](https://www.powersync.com/pricing) Supabase Free: 500 MB DB, 2 active projects, and "Free projects are paused after 1 week of inactivity". [Supabase pricing](https://supabase.com/pricing)
- **UI fit:** `@powersync/react` hooks and `@powersync/vue` live queries. [JS Web SDK](https://docs.powersync.com/client-sdk-references/javascript-web)
- **Trade-offs:** + Real SQL locally and on the server, which suits date-range queries for Today and Upcoming and recurrence expansion. + Least lock-in: data sits in plain Postgres. - The most moving parts: two services, a sync-rules config and a write endpoint. - **Both free tiers pause after a week idle.** A holiday breaks sync until the project is resumed, unless you pay or keep a keep-alive running.

### C. Firebase (Cloud Firestore with persistent local cache) (hosted backend with a built-in offline cache)
- **Local DB:** Firestore SDK cache in IndexedDB. It is **off by default** on web and is enabled with `persistentLocalCache`. Use `persistentMultipleTabManager()` for multi-tab. [Firestore: Access data offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- **Sync:** built in. Writes are queued offline. "For multiple changes to the same document, it's last write wins." Offline queries see only cached docs, and a doc that isn't cached returns an error. [Firestore offline](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- **Auth/backend:** Firebase Auth plus security rules. No custom server needed. Hosting is on the same platform.
- **Cost (one user):** Spark (no-cost): 1 GiB stored, 50K reads/day, 20K writes/day, 20K deletes/day. Hosting gets 10 GB storage and 360 MB/day transfer. [Firebase pricing](https://firebase.google.com/pricing) A single user is far inside these limits. Spark has no inactivity pause.
- **UI fit:** any framework, through the plain JS SDK and snapshot listeners.
- **Trade-offs:** + Generous free tier, no idle pausing, and simple. Web Push through FCM helps if reminders are added later. - The local cache is a cache, not a queryable local DB: first-run and cold-cache offline behaviour is weaker than A or B. - Document-level last-write-wins. - NoSQL queries, and Google lock-in.

### D. DIY: Dexie (or RxDB) locally + a small custom sync API (e.g. Cloudflare Workers + D1)
- **Local DB:** Dexie over IndexedDB. Alternatively RxDB, whose core, replication and Dexie-based storage are Apache-2.0. Its OPFS, SQLite and native IndexedDB storages are paid plans from $99/month. [RxDB Premium](https://rxdb.info/premium/)
- **Sync:** you write it. RxDB's HTTP replication protocol is a ready template: **pull** by checkpoint (`updatedAt` + `id`), **push** with `assumedMasterState` so the server returns conflicting master states, and an SSE **stream**, with `RESYNC` on reconnect. [RxDB HTTP replication](https://rxdb.info/replication-http.html) A plain Dexie app can copy the same shape with an `updatedAt` / soft-delete changelog.
- **Hosting/cost:** D1 on the Workers Free plan allows about 5M rows read/day, 100K rows written/day and 5 GB storage. Once the cap is hit, "D1 API will return errors" until reset at 00:00 UTC. [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) Any small server or DB would work instead.
- **Trade-offs:** + No sync vendor, free at this scale, and full control over the data model and repetition logic. - You own sync correctness: conflicts, deletes, clock skew, schema migrations. You also own auth, even if it is just a single-user token. This is the most code to write and the hardest to get right, which pulls against "not too complex".

---

## 3. Side-by-side

| | A. Dexie Cloud | B. PowerSync + Supabase | C. Firestore | D. DIY (Dexie/RxDB + Workers/D1) |
|---|---|---|---|---|
| Local store | IndexedDB (Dexie) | SQLite (worker; IDB/OPFS VFS) | Firestore IDB cache (opt-in) | IndexedDB (Dexie/RxDB) |
| True local-first DB | Yes | Yes | Partial (cache) | Yes |
| Conflict model | Server-authoritative, per-property LWW | Your backend decides on upload | Per-document LWW | Whatever you write |
| Server code to write | None | Upload endpoint + sync rules | Security rules only | Pull/push/stream + auth |
| Free for 1 user | Yes (Free tier) | Yes, but **pauses after 1 week idle** (both services); or self-host | Yes (Spark, no idle pause) | Yes (Workers/D1 free) |
| Lock-in | High (Dexie Cloud) | Low (Postgres) | High (Google) | None |
| Query style | JS over IndexedDB indexes | SQL | NoSQL | JS over IndexedDB |
| Framework bindings | Any; React hook | React, Vue packages | Any | Any; RxDB has adapters |
| Moving parts | 1 | 3 (PowerSync, Supabase, upload path) | 1 | 2 + your sync code |

## 4. Questions for the grilling ticket (#5)
1. How much do you value **no vendor lock-in** compared with **no server code**? This choice separates A/C from B/D.
2. Is a free tier that **pauses after a week idle** acceptable, or must sync work after a holiday without any action? This affects B.
3. Does the MVP need a **real local query engine** (SQL or indexes over Tasks/Events for Today and Upcoming offline), or is a sync cache enough? This affects C.
4. Will **reminders** (Web Push) be needed soon? They require a backend, and FCM (C) or Supabase (B) make that easier than A.
5. Which UI framework do you prefer? All four candidates work with React. B has first-party Vue support too, and the others are framework-agnostic through plain JS subscriptions.
