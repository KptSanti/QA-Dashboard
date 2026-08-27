# Phase: Authentication, Access Control, and Privacy Requirements Review

| Field | Value |
|---|---|
| Status | Implementation in progress - Local security baseline complete |
| Phase owner | Senior QA |
| Technical owner | Lead Developer |
| Security reviewer | Engineering Manager or assigned security owner |
| Product reviewer | Product Manager |
| QA owner | QA Engineer assigned to the feature |
| Related capability | Workspace documentation and SaaS tenant security |
| Implementation entry gate | All blocking decisions approved |

## Implementation Decision Record

The first executable security baseline uses these approved implementation defaults:

- Authentication: email and password for the local product slice.
- Password storage: salted `scrypt` password hashes.
- Session transport: HTTP-only, SameSite=Lax cookie; Secure is added in production HTTPS mode.
- Session policy: two-hour idle timeout and twelve-hour absolute lifetime.
- Request protection: per-session CSRF token on every state-changing API request.
- Authorization: deny by default, then role and document access evaluation.
- Personal privacy: only the owner can discover a personal space or page unless a direct Viewer, Commenter, or Editor share exists.
- Shared workspace content: Viewer is read-only; Commenter may comment; document-editing and QA-management roles are explicitly enumerated.
- Page sharing: named active workspace members receive Viewer, Commenter, or Editor access.
- Audit: login, denied login, logout, denied CSRF, and page-sharing changes are stored as security events.
- Initial roles: Senior QA, QA Engineer, Automation/QA Engineer, Release Approver, Contributor, Commenter, Viewer, Workspace Admin, and Organization Admin.

Explicitly deferred from the local baseline:

- Password-reset delivery and account recovery
- Invitations and member-administration UI
- MFA
- SAML SSO and SCIM
- Service-account and API-token administration
- Custom roles
- Formal user-offboarding workflow and ownership-transfer UI
- Audit export and configurable retention UI

These deferrals remain production blockers when required by the first customer's security profile.

## 1. Objective

Define and approve how users authenticate, join organizations and workspaces, receive roles, access personal and shared content, and perform sensitive QA actions.

This phase closes the current MVP gap where privacy and roles are represented in the interface but are not yet enforced through authenticated identities and authorization policies.

## 2. Required Review Flow

The review must follow this sequence:

```text
1. Confirm actors and tenant boundaries
-> 2. Approve authentication and session behavior
-> 3. Approve roles and permission matrix
-> 4. Approve documentation privacy and sharing
-> 5. Approve QA decision authority
-> 6. Approve audit, retention, and offboarding
-> 7. Approve security acceptance tests
-> 8. Requirements sign-off
-> 9. Technical design
-> 10. Implementation
```

Do not begin implementation while a blocking requirement is marked Open, Disputed, or Needs Clarification.

## 3. Requirement Statuses

| Status | Meaning |
|---|---|
| Open | Not reviewed |
| Needs Clarification | More product or technical information is required |
| Disputed | Reviewers disagree and an owner must decide |
| Approved | Requirement is ready for design and implementation |
| Deferred | Explicitly excluded from this phase with an owner and target phase |
| Rejected | Requirement will not be implemented, with a recorded reason |

## 4. Gate A - Actors and Tenant Boundaries

Owner: Product Manager and Engineering Manager

- [ ] **AUTH-REQ-001:** A user has one global identity and may belong to multiple organizations.
- [ ] **AUTH-REQ-002:** Every workspace belongs to exactly one organization.
- [ ] **AUTH-REQ-003:** Every tenant-owned record contains and enforces an organization or workspace boundary.
- [ ] **AUTH-REQ-004:** A user can switch only between organizations and workspaces where they have active membership.
- [ ] **AUTH-REQ-005:** Personal spaces belong to one user within one workspace.
- [ ] **AUTH-REQ-006:** Service accounts and CI integrations are separate identities from human users.
- [ ] **AUTH-REQ-007:** The initial supported user lifecycle is defined: invited, active, suspended, and removed.

Decisions to record:

- [ ] Can one email address belong to multiple organizations?
- [ ] Can an organization administrator access private personal pages for legal or recovery purposes?
- [ ] What happens to personal pages when a user leaves the organization?
- [ ] Is workspace ownership transferable?

Gate exit:

- [ ] Tenant hierarchy and identity lifecycle are approved.
- [ ] Personal-content ownership during offboarding is approved.

## 5. Gate B - Authentication and Session Security

Owner: Lead Developer and Security Reviewer

- [ ] **AUTH-REQ-010:** Users authenticate before accessing any workspace API or page.
- [ ] **AUTH-REQ-011:** Initial authentication method is approved: email/password, Microsoft, Google, SAML SSO, or a defined combination.
- [ ] **AUTH-REQ-012:** Passwords, if supported, use a modern salted password-hashing algorithm and are never logged.
- [ ] **AUTH-REQ-013:** Sessions use secure, HTTP-only, same-site cookies.
- [ ] **AUTH-REQ-014:** Login, logout, session expiry, password reset, and account recovery behavior are defined.
- [ ] **AUTH-REQ-015:** Session idle timeout and absolute lifetime are approved.
- [ ] **AUTH-REQ-016:** Sensitive actions require recent authentication when required by policy.
- [ ] **AUTH-REQ-017:** Login and recovery endpoints have rate limits and abuse monitoring.
- [ ] **AUTH-REQ-018:** Multi-factor authentication scope is approved or explicitly deferred.
- [ ] **AUTH-REQ-019:** API tokens are scoped, revocable, hashed at rest, and never displayed again after creation.

Decisions to record:

- [ ] Initial identity provider:
- [ ] Session idle timeout:
- [ ] Session absolute lifetime:
- [ ] MFA requirement:
- [ ] Account-lockout or progressive-delay policy:

Gate exit:

- [ ] Authentication method and session policy are approved.
- [ ] Recovery and abuse-prevention behavior are testable.

## 6. Gate C - Roles and Permission Matrix

Owner: Senior QA and Product Manager

Proposed roles:

| Role | Workspace administration | Documents | QA records | Release decision |
|---|---|---|---|---|
| Organization Admin | Full organization access | Policy-defined | Policy-defined | No automatic approval authority |
| Workspace Admin | Members, spaces, settings | Full shared-space management | Configure workflows | No automatic approval authority |
| Senior QA | QA configuration | Create, edit, approve | Full QA operational access | Approve readiness and overrides |
| QA Engineer | No member administration | Create and edit permitted pages | Manage assigned feature QA | Submit recommendation |
| Automation/QA Engineer | Integration administration where granted | Create and edit automation pages | Manage automation and test runs | Submit evidence |
| Release Approver | No administration | View release evidence | View QA records | Approve or reject release decision |
| Contributor | No administration | Create and edit permitted pages | Create permitted records | None |
| Commenter | No administration | View and comment | View permitted records | None |
| Viewer | No administration | View permitted pages | View permitted records | None |

Requirements:

- [ ] **AUTHZ-REQ-001:** Access is denied by default when no rule grants it.
- [ ] **AUTHZ-REQ-002:** Organization, workspace, space, page, feature, and sensitive-action permissions have a documented precedence order.
- [ ] **AUTHZ-REQ-003:** Child pages inherit parent permissions unless explicitly restricted.
- [ ] **AUTHZ-REQ-004:** A page can be shared as Viewer, Commenter, or Editor.
- [ ] **AUTHZ-REQ-005:** Only approved QA roles can approve test cases.
- [ ] **AUTHZ-REQ-006:** Only Senior QA or Release Approver can approve readiness or an override.
- [ ] **AUTHZ-REQ-007:** Workspace administrators cannot silently grant themselves release-approval authority.
- [ ] **AUTHZ-REQ-008:** Permission checks apply to API responses, search, attachments, exports, comments, history, notifications, and background jobs.
- [ ] **AUTHZ-REQ-009:** Removing membership invalidates active sessions and tokens for that workspace.
- [ ] **AUTHZ-REQ-010:** Service accounts receive only explicitly assigned scopes.

Decisions to record:

- [ ] Can one user hold multiple roles in one workspace?
- [ ] Are custom roles required for the first production release?
- [ ] Can Workspace Admin view private personal pages?
- [ ] Who can permanently delete approved release evidence?

Gate exit:

- [ ] The permission matrix is approved by Product, Senior QA, and Security.
- [ ] Every sensitive QA action has one accountable role.

## 7. Gate D - Personal Documentation and Sharing

Owner: Product Manager and Senior QA

- [ ] **DOC-PRIV-001:** A personal page is private to its owner by default.
- [ ] **DOC-PRIV-002:** Search results never reveal the title, excerpt, labels, or existence of an unauthorized personal page.
- [ ] **DOC-PRIV-003:** Attachments and exports use the same authorization policy as their page.
- [ ] **DOC-PRIV-004:** The owner can share a personal page with named users as Viewer, Commenter, or Editor.
- [ ] **DOC-PRIV-005:** Publishing to a shared space requires destination-space edit permission.
- [ ] **DOC-PRIV-006:** Moving a page preserves identity, versions, comments, and audit history.
- [ ] **DOC-PRIV-007:** Copying a page creates a new identity and records its source page.
- [ ] **DOC-PRIV-008:** Approved release evidence cannot be made private or deleted without impact review.
- [ ] **DOC-PRIV-009:** Trash and restore permissions follow the page's effective access policy.
- [ ] **DOC-PRIV-010:** Offboarding behavior for private pages is visible and auditable.

Gate exit:

- [ ] Personal-page privacy, sharing, publishing, deletion, and offboarding flows are approved.

## 8. Gate E - QA Workflow Authority

Owner: Senior QA

- [ ] **QA-AUTH-001:** Assigned QA owns the requirements-review decision for a feature.
- [ ] **QA-AUTH-002:** Approved test cases require an authorized QA reviewer.
- [ ] **QA-AUTH-003:** Risk acceptance records owner, rationale, scope, review date, and evidence.
- [ ] **QA-AUTH-004:** Defect closure requires the configured resolution and retest evidence where applicable.
- [ ] **QA-AUTH-005:** Automation/QA Engineer can manage mappings and runs but cannot approve release readiness unless separately assigned that role.
- [ ] **QA-AUTH-006:** Senior QA owns cross-pod capacity decisions.
- [ ] **QA-AUTH-007:** Release overrides require an authorized approver and cannot be anonymous.
- [ ] **QA-AUTH-008:** No user can approve their own restricted action when separation of duties is enabled.

Gate exit:

- [ ] Requirements, test approval, risk acceptance, defect closure, automation, capacity, and release authority are approved.

## 9. Gate F - Audit, Retention, and Offboarding

Owner: Engineering Manager and Security Reviewer

- [ ] **AUDIT-REQ-001:** Login, logout, failed authentication, invitations, membership, role, and permission changes are audited.
- [ ] **AUDIT-REQ-002:** Document publication, approval, deletion, restoration, and permanent deletion are audited.
- [ ] **AUDIT-REQ-003:** Test approval, risk acceptance, defect closure, readiness, and overrides are audited.
- [ ] **AUDIT-REQ-004:** Audit events include actor, tenant, action, target, result, timestamp, and correlation ID.
- [ ] **AUDIT-REQ-005:** Audit records are immutable to normal workspace users.
- [ ] **AUDIT-REQ-006:** Retention periods are defined for sessions, audit events, deleted documents, attachments, and test artifacts.
- [ ] **AUDIT-REQ-007:** Offboarding revokes sessions, tokens, integration access, and workspace permissions immediately.
- [ ] **AUDIT-REQ-008:** Ownership transfer and content preservation are recorded before membership removal completes.

Decisions to record:

- [ ] Audit retention period:
- [ ] Trash retention period:
- [ ] Test artifact retention period:
- [ ] Who can export audit history:
- [ ] Who can perform permanent deletion:

Gate exit:

- [ ] Retention, export, deletion, ownership transfer, and deprovisioning requirements are approved.

## 10. Gate G - Security and QA Acceptance Coverage

Owner: QA Engineer and Security Reviewer

Required automated coverage:

- [ ] **SEC-TEST-001:** Unauthenticated requests cannot access protected APIs.
- [ ] **SEC-TEST-002:** Tenant A cannot read, search, update, delete, export, or infer Tenant B data.
- [ ] **SEC-TEST-003:** User A cannot access User B's private personal pages.
- [ ] **SEC-TEST-004:** Viewer cannot create, edit, delete, approve, or change permissions.
- [ ] **SEC-TEST-005:** Commenter can comment but cannot edit page content.
- [ ] **SEC-TEST-006:** Editor cannot perform restricted approvals without the required QA role.
- [ ] **SEC-TEST-007:** Revoked membership loses access immediately.
- [ ] **SEC-TEST-008:** Search and attachment URLs do not bypass page authorization.
- [ ] **SEC-TEST-009:** Session fixation, expiry, logout, and token revocation behave as designed.
- [ ] **SEC-TEST-010:** Permission inheritance and explicit restrictions produce the approved effective access.
- [ ] **SEC-TEST-011:** Audit history captures successful and denied sensitive actions.
- [ ] **SEC-TEST-012:** Personal-page publish, move, copy, Trash, restore, and offboarding flows preserve the correct permissions.

Manual review coverage:

- [ ] Login, invitation, recovery, and error messages are understandable.
- [ ] Permission controls clearly explain who can access a page.
- [ ] Users receive a warning before reducing access or exposing private content.
- [ ] Keyboard and screen-reader users can complete authentication and sharing flows.
- [ ] Administrative screens do not expose secrets or password data.

Gate exit:

- [ ] The security test plan is approved and mapped to requirements.
- [ ] Critical authorization cases are marked for smoke and regression automation.

## 11. Requirements Review Meeting

Required participants:

- Product Manager
- Engineering Manager
- Lead Developer
- Senior QA
- Assigned QA Engineer
- Automation/QA Engineer
- Security or compliance reviewer when applicable

Meeting flow:

1. Review objectives, exclusions, and tenant model.
2. Review all requirements marked Needs Clarification or Disputed.
3. Approve or defer authentication decisions.
4. Review the role and permission matrix row by row.
5. Walk through personal-page privacy and offboarding scenarios.
6. Confirm QA approval authority and separation of duties.
7. Approve audit and retention decisions.
8. Approve security acceptance coverage.
9. Assign owners and dates to deferred items.
10. Record sign-off or return the phase for revision.

## 12. Phase Exit Checklist

Implementation may begin only when:

- [ ] All blocking requirements are Approved.
- [ ] Deferred requirements have an owner, reason, risk, and target phase.
- [ ] Authentication and session decisions are recorded.
- [ ] Tenant model and offboarding behavior are approved.
- [ ] Role and permission matrix is approved.
- [ ] Personal documentation privacy rules are approved.
- [ ] QA decision authority is approved.
- [ ] Audit and retention requirements are approved.
- [ ] Security acceptance cases are linked to planned test cases.
- [ ] Technical design and data migration work can proceed without unresolved product assumptions.
- [ ] Senior QA, Product Manager, Lead Developer, and Security Reviewer record sign-off.

## 13. Deliverables After Approval

1. Authentication and session technical design.
2. Authorization policy and effective-permission algorithm.
3. Database migration for users, memberships, roles, permissions, sessions, invitations, and service accounts.
4. API authorization middleware.
5. Login, account, member administration, and page-sharing interfaces.
6. Personal-space privacy enforcement.
7. Audit event expansion.
8. Automated security and role-matrix tests.
9. Rollout, migration, and rollback plan.

## 14. Explicitly Deferred Unless Approved

- SAML SSO
- SCIM provisioning
- Custom roles
- Organization-wide legal access to private pages
- External guest accounts
- Public documentation links
- IP allowlists
- Multiple regional data residencies
- Advanced separation-of-duties policies

Deferral does not imply rejection. Each required item must be scheduled before onboarding a customer that depends on it.
