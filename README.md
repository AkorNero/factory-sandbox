# factory-sandbox

Day Planner: a single-user, offline-first planner PWA.

- Domain language: [GLOSSARY.md](GLOSSARY.md)
- Decisions: [docs/adr](docs/adr)
- Host setup (WSL2, Docker, Tailscale): [docs/host-setup.md](docs/host-setup.md)

## Layout

- `packages/core`: the planner core (pure TypeScript, the main test seam)
- `apps/web`: the React + Vite PWA (store adapter, clock, UI)
- `apps/api`: the Node API (upload endpoint, device token, JWKS, PowerSync proxy, serves the PWA)
- `infra`: compose project, Postgres DDL (`infra/postgres/init/02-schema.sql`), PowerSync config

## Run the server

```
cp infra/.env.example infra/.env     # then change the passwords (applied on first volume creation)
docker compose -f infra/compose.yaml up -d --build
curl -i http://127.0.0.1:8080/healthz
```

The app is then at `http://127.0.0.1:8080` (and on the tailnet through `tailscale serve`).

## Tests

```
npm ci
npm run test:core      # planner core, no Docker needed
npm run test:api       # upload endpoint + auth against a real Postgres (testcontainers; needs Docker)
npx -w apps/web playwright install chromium
npm run test:e2e       # Playwright smoke tests at a fixed clock; builds the app, no server needed
npm run test:e2e:sync  # two-device sync tests; needs the compose project above running
```
