# Playwright and CI Execution — Requirements Review

**Phase status:** Implementation in progress — provider-neutral baseline  
**Feature:** Playwright execution integration  
**Authoring role:** Senior QA / Automation QA  
**Reviewers:** Product, Engineering, Security, Release Approver, QA  

## Purpose

Create a governed path from a feature and its approved test cases to automation execution evidence. A QA user must be able to request smoke, feature, individual test case, end-to-end, or regression scope for Browser, API, or MCP automation, follow the run lifecycle, and inspect results that remain traceable to the originating feature.

## Description

The Automation CLI dashboard is the operational entry point. An authorized QA user selects a repository, run scope, automation type, environment, and the required feature or test case. The system validates the request, creates an auditable run, selects only eligible mapped automation assets, and dispatches the request through a provider-neutral contract.

This phase includes a clearly labelled local demo adapter. It exercises the same queued, running, and completed states using predefined assets, but it does not clone repositories, execute arbitrary code, or claim to be a production CI provider. A production connection must dispatch to an approved CI platform or isolated worker.

## Objectives

- Give QA one controlled place to request and observe automated test runs.
- Keep every automation asset and result connected to a feature and, where available, an approved test case.
- Make duplicate or retried result delivery safe through an idempotency key.
- Preserve requester, scope, environment, commit/branch metadata, timestamps, and result evidence.
- Prevent read-only roles from dispatching runs or changing automation configuration.

## Scope

### Included

- Repository registry and predefined automation assets.
- Asset-to-test-case-to-feature mapping.
- Smoke, feature, individual test case, E2E, and regression run requests.
- Browser, API, MCP, and combined automation type selection.
- Queued, running, passed, failed, and cancelled lifecycle vocabulary.
- Result summary, individual test outcome, duration, retry count, and evidence metadata.
- Authorized dispatch, tenant filtering, CSRF protection, and security audit records.
- Idempotent result ingestion contract.
- Local demo execution adapter for acceptance testing.

### Excluded

- Running untrusted customer repository code in the SaaS web process.
- Storing production CI secrets in browser-visible data.
- Selecting GitHub Actions, GitLab CI, Azure DevOps, or another provider before review.
- Distributed workers, shard orchestration, video/trace object storage, scheduled runs, and cancellation propagation.
- Automatic defect creation and flaky-test quarantine policy.

### Dependencies

- Workspace authentication and role-based access.
- Feature, requirement, and test-case records.
- Approved environment and repository ownership model.
- A production CI provider or isolated worker in a later phase.

## Per-Function Detailed Breakdown

### Run Request

**How it works**

1. The user opens Playwright Runs and chooses a run type.
2. The system asks for repository, automation type, environment, and project; feature scope is mandatory for a feature run and test case is mandatory for an individual run.
3. The system validates permissions and confirms that at least one eligible asset is mapped to the requested scope.
4. A run is created as Queued, with requester and scope recorded.
5. The adapter changes the run to Running and then to a terminal result.

**Validation rules**

- Run scope must be Smoke, Feature, Individual, E2E, or Regression.
- Automation type must be Browser, API, MCP, or All.
- Feature runs require an existing feature in the current workspace.
- Individual runs require an existing mapped test case in the current workspace.
- Repository, environment, and project must be selected from configured values.
- A request with no eligible mapped tests is rejected before dispatch.
- Viewer and Release Approver roles can inspect runs but cannot dispatch them.

**UI behavior**

- A persistent banner identifies the local demo adapter.
- The Run tests action is hidden or disabled for read-only roles.
- Queued and running records refresh without a full page reload.
- Empty, validation-error, loading, and provider-error states use plain language.

### Asset Mapping

Each active automation asset has a stable external test ID, repository path, suite type, automation type, owner, linked test case, and linked feature. Feature and individual runs select assets through the mapping rather than by title or free-text tags. A mapping that crosses workspaces is invalid.

### Result Evidence and Ingestion

Each result records the run, automation asset, feature, optional test case, outcome, duration, retry count, error summary, and evidence metadata. Ingestion requires a unique idempotency key. Replaying the same key returns the original processing result and must not create duplicate test results.

## System Integration and Dependencies

- **Feature Quality 360 ↔ Run Center:** the feature page can show its latest mapped automation evidence.
- **Test Cases ↔ Automation Assets:** approved manual intent remains the source traceability record; executable assets reference it.
- **Release Readiness ↔ Run Results:** release gates can later consume the latest required suite result without rewriting history.
- **CI Provider ↔ Ingestion Contract:** a provider dispatches execution externally and reports structured outcomes back to the workspace.

If the external provider is unavailable, the run must remain in a visible non-terminal or failed-dispatch state with a human-readable reason. It must not be reported as passed.

## Business and System Rules

### Functional rules

- Every execution result is linked to one feature.
- Feature scope selects only assets mapped to that feature.
- Historical runs and results are immutable evidence; corrections arrive as a new event or run.
- Run state can move forward only: Queued → Running → Passed/Failed/Cancelled.
- Production execution occurs outside the main SaaS web service.

### Permission rules

| Role | View runs and evidence | Dispatch run | Manage mapping/provider |
|---|---:|---:|---:|
| Organization / Workspace Admin | Yes | Yes | Yes |
| Senior QA | Yes | Yes | Yes |
| QA Engineer | Yes | Yes | No |
| Automation/QA Engineer | Yes | Yes | Yes |
| Release Approver | Yes | No | No |
| Viewer / Commenter / Contributor | Yes | No | No |

### Environment differences

- **Local demonstration:** uses only predefined assets and simulated lifecycle transitions. No repository code executes.
- **Staging:** must use non-production credentials and isolated execution capacity.
- **Production:** requires approved provider credentials, secret rotation, allowlisted repositories and environments, retention policy, and operational monitoring.

## Review Gates

### Gate A — Ownership and provider

- [ ] Select production CI provider and repository ownership model.
- [ ] Approve allowlisted repositories, branches, environments, and Playwright projects.
- [ ] Define credential owner, storage, rotation, and revocation.

### Gate B — Scope and mappings

- [x] Define Smoke, Feature, Individual, E2E, and Regression request scopes.
- [x] Define Browser, API, MCP, and All automation types.
- [x] Require feature ID for feature runs.
- [x] Require a mapped test case for individual runs.
- [x] Use explicit asset-to-test-case-to-feature mappings.
- [ ] Approve rules for shared tests that cover more than one feature.

### Gate C — Lifecycle and evidence

- [x] Define monotonic run states and terminal outcomes.
- [x] Require idempotency for ingested events.
- [x] Record duration, retries, error summary, and evidence metadata.
- [ ] Approve artifact retention, trace/video privacy, retry, shard, and flaky-test rules.

### Gate D — Security and operations

- [x] Apply authenticated tenant scoping, CSRF protection, role checks, and audit logs.
- [x] Prohibit arbitrary repository execution in the SaaS service.
- [ ] Complete threat model for webhook authentication and artifact URLs.
- [ ] Define provider outage, cancellation, timeout, and support procedures.

### Gate E — QA acceptance

- [x] Authorized roles can dispatch every supported run scope and automation type.
- [x] Read-only roles cannot dispatch.
- [x] Feature runs contain only mapped assets from the selected feature.
- [x] Duplicate ingestion events do not duplicate results.
- [x] Lifecycle and result evidence are visible in the Automation CLI dashboard.
- [x] UI is usable at desktop and narrow viewport widths without console errors.

## Important Notes

- The local adapter is acceptance-test infrastructure, not a substitute for CI.
- Provider selection, secrets, real artifact storage, cancellation, scheduling, and isolated execution are deferred review decisions.
- Until artifact retention is approved, evidence contains metadata references only and no sensitive videos, traces, or screenshots.
- Phase exit requires all Gate E checks plus approved owners and decisions for every unchecked item that blocks production use.
