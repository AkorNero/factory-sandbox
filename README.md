# factory-sandbox

Day Planner: a single-user, offline-first planner PWA.

- Domain language: [GLOSSARY.md](GLOSSARY.md)
- Decisions: [docs/adr](docs/adr)
- Host setup (WSL2, Docker, Tailscale): [docs/host-setup.md](docs/host-setup.md)

## Layout

- `packages/core`: the planner core (pure TypeScript, the main test seam)
- `apps/web`: the React + Vite PWA (store adapter, clock, UI)
- `apps/api`: the Node API (upload endpoint, device token, JWKS, PowerSync proxy, serves the PWA) and the schema migrations (`apps/api/migrations`)
- `infra`: compose project, Postgres roles (`infra/postgres/init`), PowerSync config

## Run the server

```
cp infra/.env.example infra/.env     # then change the passwords (applied on first volume creation)
docker compose -f infra/compose.yaml up -d --build
curl -i http://127.0.0.1:8080/healthz
```

The app is then at `http://127.0.0.1:8080` (and on the tailnet through `tailscale serve`).

### Schema changes

The tables are made by numbered SQL files in `apps/api/migrations`, applied in order by the compose project's `migrate`
service on every `up` and recorded in `schema_migrations`. Postgres's own init scripts only run on an empty volume, so
they only make the roles and the publication. To change the schema, add the next numbered file; write it to be re-runnable
(`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) and keep `packages/core/src/schema.ts` (the client's columns) in
step: an API test compares the two. To pick up a schema change on a running server:

```
docker compose -f infra/compose.yaml up -d --build    # migrate runs first, then the api restarts
docker compose -f infra/compose.yaml restart powersync  # so it reads the new columns
```

## Tests

```
npm ci
npm run test:core      # planner core, no Docker needed
npm run test:api       # upload endpoint + auth against a real Postgres (testcontainers; needs Docker)
npx -w apps/web playwright install chromium
npm run test:e2e       # Playwright smoke tests at a fixed clock; builds the app, no server needed
npm run test:e2e:sync  # two-device sync tests; needs the compose project above running
```
