# Customer Ticket Agent

A customer-success desk for Qualitative AI Studio. Customers ask questions or describe a problem; the assistant answers using product context and creates a ticket when support needs to follow up. Support staff see a prioritized queue, the conversation, a plain-language diagnosis and the next action.

## Features

- Customer chat with durable conversations and source links
- Automatic ticket creation and updates, with an AI-unavailable fallback
- P1–P4 severity based on impact, affected users, urgency, workaround and suspected security/data-loss risk
- Searchable support queue, status changes, assignment, customer replies and private internal notes
- Severity overrides require a reason; changes are recorded in an activity trail
- Customer records scoped by verified identity; staff access checked server-side
- Duplicate request protection and optimistic concurrency checks
- Cloudflare D1 for persistent data; Sites for private hosting and sign-in
- Low-cost OpenAI model configurable through `OPENAI_MODEL` (default `gpt-6-luna`)

The research repository supplies brief project background. Most answers use the current Studio README, settings and support context. `knowledge.json` is the small, editable knowledge base; `sources.json` records provenance. Review product changes there as the Studio grows. No participant data is included.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
cp .env.example .env
# Configure OPENAI_API_KEY securely in the ignored .env file.
npm run build
npm run dev
```

Open http://127.0.0.1:8010. The development server runs only on loopback, supplies a local development identity and persists its D1 simulation under `.local/`. Never expose this development server to the internet.

```sh
npm test
```

Tests use the real Miniflare/D1 runtime for ticket persistence, access isolation, idempotency, severity, staff changes, internal-note privacy and activity history. The tests do not spend OpenAI credits.

## Hosting

`.openai/hosting.json` declares the private Site and `DB` binding. `npm run build` bundles `worker.mjs` into `dist/server/index.js`. Sites provisions the separate D1 database and applies generated migrations from `drizzle/` during publication. Secrets belong in Site runtime settings, not source.

The application trusts identity headers supplied by the Sites authentication gateway. Do not deploy this exact Worker directly to an unprotected endpoint. Customers must authenticate before accessing conversations or tickets.

`BOOTSTRAP_OWNER=true` is only for the initial **owner-private** Site. The first verified visitor is recorded as support staff if the staff table is empty. Once the owner has opened the app, disable this runtime variable. Do not broaden the Site audience until that initialization has been verified. Other users are customers unless explicitly added to the `staff` table by an authorized administrator.

For schema updates, edit `db-schema.ts`, run `npm run db:generate`, review the resulting SQL and commit it. Applied migration files are immutable.

## Severity rules

| Priority | Default interpretation |
| --- | --- |
| P1 · Critical | Suspected security/data-loss risk, or all reported users blocked without a workaround |
| P2 · High | Core work blocked; multiple users degraded without a workaround; or an immediate deadline without a workaround |
| P3 · Normal | Limited impact, or details not yet known |
| P4 · Low | How-to question or minor inconvenience |

These are routing recommendations, not confirmed incident classifications or response-time commitments. New replies can raise an existing ticket's severity; staff lower it with a recorded reason. Tickets are not automatically resolved by the AI. No email, external alert, refund or account change is performed.

## Qual AI website connection

The Studio's shared frontend loads a `Get help` chat panel for signed-in users. Same-origin `/api/support-chat/*` routes validate the existing Studio session and relay customer requests server-side to this service's `/api/bridge/*` endpoints. Customer identity is derived on the Studio server, not accepted from browser input.

Configure the Studio server with `CUSTOMER_AGENT_URL`, `CUSTOMER_AGENT_ACCESS_TOKEN` (private Sites service access), and `CUSTOMER_AGENT_BRIDGE_SECRET`. Configure the same bridge secret as `STUDIO_BRIDGE_SECRET` on the support service. Keep both credentials server-only. The bridge permits only customer conversation/message/ticket reads, never staff queue access or ticket administration. The old support-request form remains available.

The support desk remains privately hosted. Customer chat works inside the existing Studio website through its authenticated backend; customers do not need a second ChatGPT login. Team permissions and any email provider are separate configuration. OpenAI calls have a token limit, a short history window and a timeout. API usage is billed separately from database/hosting allowances.
