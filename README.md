# Mishwark

Event-car booking platform: customers book cars for weddings and events, drivers run the trips, and admins manage everything from a web dashboard. The mobile apps (customer and driver) are developed separately and talk to the API in this repo.

## Repository layout

```
mishwark/
├── backend/            REST API: Node.js, Express 5, TypeScript, Prisma, PostgreSQL
│   ├── src/            routes → controllers → services
│   ├── prisma/         schema (models/), migrations, seeds
│   ├── tests/          test suite (npm test)
│   └── api-docs/       OpenAPI spec, Postman collection, app integration guide, QA report
├── frontend/           Admin web dashboard: React 19, Vite, Tailwind, Arabic RTL
├── docs/               Project docs (architecture, data model, middleware, test strategy)
├── docker-compose.yml  Local PostgreSQL (+ pgAdmin)
└── .github/workflows/  Deployment (disabled for now)
```

The API serves the built dashboard at `/dashboard`, so in production both run as one service on one origin.

## Quick start

Requirements: Node.js 20+, and PostgreSQL (or Docker).

```bash
# 1. Database
docker compose up -d                      # Postgres on localhost:5433

# 2. API
cd backend
cp .env.example .env                      # set DATABASE_URL and JWT_SECRET
npm ci
npx prisma generate
npx prisma migrate deploy
npm run seed                              # roles + admin@mishwarak.com / secret123
npm run seed:demo                         # optional: demo data around today
npm run dev                               # http://localhost:5000, docs at /api-docs

# 3. Dashboard (another terminal)
cd frontend
npm ci
npm run dev                               # http://localhost:3000/dashboard
```

The first admin login asks you to set up 2FA with an authenticator app.

## Common commands (from `backend/`)

| Command | What it does |
|---|---|
| `npm run dev` | API with auto-reload |
| `npm test` | Full test suite. It wipes its database, so it only runs against one whose name contains `test`: `DATABASE_URL=postgresql://…/mishwark_test npm test` |
| `npm run verify` | Typecheck, API docs check and tests: run before every push |
| `npm run api-docs` | Rebuild and check the OpenAPI spec after changing routes |
| `npm run dashboard:build` | Build the dashboard into `frontend/dist` |
| `npm run build && npm start` | Production build; serves the dashboard at `/dashboard` |

## Documentation

- [App integration guide](backend/api-docs/FRONTEND_INTEGRATION.md): for the mobile developers
- [QA report](backend/api-docs/QA_REPORT.md): fixes, business rules and open items
- [Dashboard](frontend/README.md): screens and definitions
- [Architecture](docs/PROJECT.md), [middleware](docs/MIDDLEWARE_GUIDE.md), [test strategy](docs/TEST_INFRA.md), [data model](docs/Mishwark-Data-Model.docx)
