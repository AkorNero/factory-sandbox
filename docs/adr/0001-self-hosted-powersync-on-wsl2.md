# Self-hosted PowerSync + Postgres on WSL2, private over Tailscale

Day Planner syncs through PowerSync, using SQLite in the browser on each device and Postgres as the source of truth. The server runs on the user's own Windows PC under WSL2, as one `docker compose` project started by systemd: Postgres (logical replication, with a separate database for PowerSync bucket storage), PowerSync Open Edition, and a small Node API. The Node API holds the `uploadData` endpoint, issues a long-lived JWT per device, serves the JWKS, and serves the static PWA. Tailscale inside WSL exposes everything through `tailscale serve` on one `https://<host>.ts.net` hostname. It is reachable only on the tailnet, with Funnel off, and there is no login screen. Writes apply per column, and the last write to arrive wins. We chose this because it gives a true local database, real SQL and no vendor lock-in, and owning the sync code was judged acceptable. Self-hosting avoids the 1-week idle pause on both the PowerSync Cloud and Supabase free tiers, and it drops Supabase entirely.

## Considered Options

- **Dexie + Dexie Cloud:** no server code, but vendor lock-in.
- **Firestore:** the local store is only a cache, and it locks in to Google.
- **DIY sync (Dexie/RxDB + Workers/D1):** you write the whole sync protocol yourself.
- **PowerSync Cloud + Supabase:** both free tiers pause after a week of inactivity.

## Consequences

- Sync only happens while the PC is on and WSL is kept running. Offline edits queue on each device until then.
- **No backups (accepted risk).** The Postgres volume on one disk is the only durable copy. iOS may evict the phone's local data, so a disk failure could lose everything not still cached in a browser.
- Security rests on tailnet membership. Enabling Funnel or any public exposure requires adding real auth first.
- Reminders (Web Push) are out of the MVP and played no part in this choice.
