# Customer Ticket Agent

A customer-success desk for Qualitative AI Studio. Customers use the **Get help** panel inside the Studio to ask questions or describe a problem. The assistant offers grounded guidance and creates a ticket when support needs to follow up. Support staff see a prioritized queue, the conversation, a diagnosis and the next action.

## Features

- Customer chat with durable conversations and product-source links
- Automatic ticket creation and updates, with guided intake if the AI is unavailable
- P1–P4 severity based on impact, affected users, urgency, workarounds and suspected security/data-loss risk
- Searchable support queue, status changes, assignment, customer replies and private internal notes
- Severity overrides require a reason and appear in the activity trail
- Customer records scoped by verified identity; staff access checked server-side
- Duplicate-request protection and optimistic concurrency checks
- Cloudflare Workers for the application and D1 for ticket storage
- Configurable low-cost OpenAI model (`gpt-6-luna` by default)

Research supplies brief project background. Most answers use Studio product documentation, settings and support context. `knowledge.json` is the editable knowledge base; `sources.json` records provenance. No participant research data is included.

## Local development

Requires Node.js 22 or newer.

```sh
npm ci
cp .env.example .env
# Configure OPENAI_API_KEY securely in the ignored .env file.
npm run build
npm run dev
```

Open http://127.0.0.1:8010. The development server runs only on loopback, supplies a test-only identity and persists its D1 simulation under `.local/`. Do not expose this development server to the internet.

```sh
npm test
```

Tests run in Miniflare/D1 and cover authentication, cookie security, rejection of spoofed identity headers, customer isolation, idempotency, severity, staff changes, internal-note privacy and activity history. Tests do not spend OpenAI credits.

## Cloudflare deployment

`cloudflare-deployment.json` records the account, script, D1 database and non-secret configuration. `npm run build` creates the bundled ES module at `dist/server/index.js`. Upload it using the connected Cloudflare API with `main_module: worker.js` and the declared bindings. Runtime secrets are `OPENAI_API_KEY` and `STUDIO_BRIDGE_SECRET`; keep them out of source, build output and browser code. Keep preview URLs disabled.

The support dashboard has an independent Cloudflare Access staff identity. Approved staff receive an email code through the support login gateway at `/staff-login`. The Worker verifies the token's signature, issuer, audience, expiry and approved staff email. Its HttpOnly `__Host-qual_support_staff` cookie is separate from researcher cookies. Qual AI researcher sessions and browser-supplied role or identity headers do not grant dashboard access. Signing out of support does not sign out the research app.

`support-access-plan.json` contains the exact proposed Access configuration. Provision the free-only Access organization and login-route application, then set `SUPPORT_AUTH_DOMAIN` and `SUPPORT_ACCESS_AUD` to their returned values before deploying this revision. Do not configure an account-wide deny policy. The existing customer bridge is outside the staff-login route and retains its server-secret protection.

For schema updates, edit `db-schema.ts`, run `npm run db:generate`, review the new SQL and apply only unapplied migrations to the configured D1 database. Applied migration files are immutable. The initial migration is `drizzle/0000_giant_midnight.sql`.

## Qual AI website connection

The Studio's shared frontend loads a **Get help** panel for signed-in users. Same-origin `/api/support-chat/*` routes validate the Studio session and relay customer requests to `/api/bridge/*` here. Identity is derived on the Studio server, not accepted from browser input.

The Studio server needs `CUSTOMER_AGENT_URL` and `CUSTOMER_AGENT_BRIDGE_SECRET`. The same bridge secret is stored as `STUDIO_BRIDGE_SECRET` on the Worker. The legacy `CUSTOMER_AGENT_ACCESS_TOKEN` is not needed on Cloudflare. The bridge permits only customer conversation/message/ticket operations; it never permits staff-queue access or ticket administration. The old support-request form remains available.

## Severity

| Priority | Default interpretation |
| --- | --- |
| P1 · Critical | Suspected security/data-loss risk, or all reported users blocked with no workaround |
| P2 · High | Core work blocked; multiple users degraded without a workaround; immediate deadline without a workaround |
| P3 · Normal | Limited reported impact, or details not yet known |
| P4 · Low | How-to question or minor inconvenience |

These are routing recommendations, not confirmed incident classifications or response-time commitments. New replies can raise severity; staff lower it with a recorded reason. The AI does not automatically resolve tickets. No email, external alert, refund or account change is performed.

## Migration from Sites

Existing conversations, tickets, messages, activity, idempotency records and legacy staff records are copied to the user-owned Cloudflare D1 database and verified before the Studio connection changes. Legacy staff rows are retained for history; current staff authorization uses the verified Studio email allowlist. Migration does not delete the source database.

OpenAI calls use a bounded history window, token limit and timeout. OpenAI API usage is billed separately from hosting and database allowances.
