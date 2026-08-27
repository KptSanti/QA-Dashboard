# Qualispace QA Workspace

A locally runnable MVP of the feature-centered QA SaaS plan. It combines a Confluence-inspired documentation workspace with feature traceability, test management, risk, coverage, release readiness, defects, metrics, automation backlog, and capacity views.

## Run locally

Requirements: Node.js 22.5 or newer. No package installation is required.

```powershell
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

The SQLite database is created automatically at `data/qa-workspace.db` with representative Team 1 data.

### Local accounts

| Account | Role |
|---|---|
| `patrick@qualispace.local` | Senior QA |
| `mira@qualispace.local` | QA Engineer |
| `avery@qualispace.local` | Release Approver |
| `viewer@qualispace.local` | Viewer |

The local demonstration password is `Demo123!`. Set `QA_DEMO_PASSWORD` before first database creation to use a different local seed password. Production deployment must use a managed secret and an approved identity policy.

## Test

```powershell
npm test
```

## Implemented vertical slice

- Persistent organizations, workspaces, spaces, features, and QA records
- Personal and shared documentation spaces
- Nested page tree, rich-text editing, autosave, explicit versions, version restoration, Trash, and restore
- Reusable feature, test-plan, and release-readiness page templates
- Page comments with open and resolved states
- Feature and release linking
- Feature Quality 360 with requirements, tests, risks, defects, automation, and evidence summaries
- Test Case Database, Risk Register, Coverage Matrix, Release Readiness, Defect Log, Metrics, Automation Backlog, and Team Capacity
- Feature-linked QA record creation
- Dedicated Automation CLI dashboard with Smoke, Feature, Individual, E2E, and Regression scopes
- Browser, API, MCP, and combined automation type selection with explicit feature/test-case mappings
- Audited asynchronous run lifecycle, result evidence, and idempotent ingestion
- Safe local demo adapter that never executes arbitrary repository code in the SaaS service
- Workspace search
- Email/password login with salted scrypt hashes and HTTP-only sessions
- CSRF protection, session expiry, logout revocation, and authentication auditing
- Role-based document and QA authorization
- Enforced personal-space privacy and page-level Viewer, Commenter, and Editor sharing
- Tenant-aware schema, filtered search, audit activity, security headers, and CI-safe Playwright integration model
- Responsive, content-first, Confluence-inspired UI without AI-dashboard visual patterns

## Current boundary

This is an executable product slice. The Automation CLI currently uses a clearly labelled local demo adapter. Production CI-provider dispatch, isolated workers, secret management, artifact upload/retention, invitations, password recovery, MFA, SSO/SCIM, real-time co-editing, and AI-assisted test generation remain subsequent implementation phases described in [QA_WORKSPACE_PRODUCT_AND_IMPLEMENTATION_PLAN.md](./QA_WORKSPACE_PRODUCT_AND_IMPLEMENTATION_PLAN.md) and [PHASE_PLAYWRIGHT_CI_REQUIREMENTS_REVIEW.md](./PHASE_PLAYWRIGHT_CI_REQUIREMENTS_REVIEW.md).
