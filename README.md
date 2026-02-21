# axion-main-api

Node/Express API for AXION auth/admin plus a control-plane dashboard for multi-app events and text/config management.

## Run locally

1. Install dependencies:
```bash
npm ci
```
2. Configure env:
```bash
cp .env.example .env
```
3. Start:
```bash
npm run dev
```

Default URL: `http://localhost:3001`

## Main routes

- `GET /` (dashboard UI default)
- `GET /api` (service info and route discovery)
- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /dashboard` (admin dashboard UI, white theme)

Control plane:
- `POST /api/control/ingest/events`
- `GET /api/control/config/:appId`
- `GET /api/admin/control/apps`
- `GET /api/admin/control/registry/apps`
- `GET /api/admin/control/registry/apps/:appId`
- `GET /api/admin/control/registry/health`
- `POST /api/admin/control/registry/proxy`
- `GET /api/admin/control/catalog/original-texts`
- `GET /api/admin/control/catalog/original-texts/:appId`
- `POST /api/admin/control/bootstrap/original-texts`
- `GET /api/admin/control/config/:appId`
- `POST /api/admin/control/config/:appId`
- `POST /api/admin/control/config/:appId/publish`
- `POST /api/admin/control/config/:appId/rollback`
- `GET /api/admin/control/analytics/overview`
- `GET /api/admin/control/analytics/clicks`
- `GET /api/admin/control/analytics/events`
- `GET /api/admin/control/analytics/timeseries`
- `GET /api/admin/control/audit`

## Data storage

Local JSON files under `services/axion-main-api/data/`:

- `users.json`
- `control-configs.json`
- `control-events.json`
- `control-audit.json`

## Notes

- If `CONTROL_INGEST_KEY` is set, ingest requires header `x-axion-ingest-key`.
- Admin endpoints require JWT with `admin` or `superadmin` role.
