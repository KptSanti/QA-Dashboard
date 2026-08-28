const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'qa-workspace.db');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DOCUMENT_STATUSES = new Set(['Draft', 'In Review', 'Approved', 'Published', 'Archived']);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, encoded) {
  const [salt, expectedHex] = String(encoded || '').split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function openDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_organizations (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
      organization_id TEXT NOT NULL REFERENCES organizations(id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      initials TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','suspended','removed')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('invited','active','suspended','removed')),
      created_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('personal','shared','product','release')),
      owner_name TEXT,
      visibility TEXT NOT NULL DEFAULT 'workspace',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      title TEXT NOT NULL,
      release_name TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      qa_owner TEXT NOT NULL,
      readiness TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id),
      parent_id TEXT REFERENCES documents(id),
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      owner_name TEXT NOT NULL,
      linked_feature_id TEXT REFERENCES features(id),
      is_trashed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS document_folders (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id),
      parent_folder_id TEXT REFERENCES document_folders(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      version_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      author_name TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(document_id, version_number)
    );
    CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Resolved')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS document_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE TABLE IF NOT EXISTS space_owners (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id),
      user_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS document_permissions (
      document_id TEXT NOT NULL REFERENCES documents(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      access_level TEXT NOT NULL CHECK(access_level IN ('Viewer','Commenter','Editor')),
      granted_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY(document_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS security_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      workspace_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      result TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      criticality TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      requirement_id TEXT REFERENCES requirements(id),
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      automation_status TEXT NOT NULL,
      latest_result TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS risks (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      title TEXT NOT NULL,
      likelihood INTEGER NOT NULL,
      impact INTEGER NOT NULL,
      residual_score INTEGER NOT NULL,
      treatment TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      status TEXT NOT NULL,
      due_date TEXT
    );
    CREATE TABLE IF NOT EXISTS defects (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      test_case_id TEXT REFERENCES test_cases(id),
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      environment TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_backlog (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      test_case_id TEXT REFERENCES test_cases(id),
      title TEXT NOT NULL,
      value_score INTEGER NOT NULL,
      effort_score INTEGER NOT NULL,
      status TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      repository TEXT NOT NULL DEFAULT '',
      target_milestone TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS automation_repositories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_url TEXT NOT NULL DEFAULT '',
      default_branch TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_assets (
      id TEXT PRIMARY KEY,
      repository_id TEXT NOT NULL REFERENCES automation_repositories(id),
      external_test_id TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      suite_type TEXT NOT NULL,
      automation_type TEXT NOT NULL DEFAULT 'Browser',
      owner_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      UNIQUE(repository_id, external_test_id)
    );
    CREATE TABLE IF NOT EXISTS automation_mappings (
      asset_id TEXT NOT NULL REFERENCES automation_assets(id),
      test_case_id TEXT NOT NULL REFERENCES test_cases(id),
      feature_id TEXT NOT NULL REFERENCES features(id),
      PRIMARY KEY(asset_id, test_case_id, feature_id)
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      repository_id TEXT NOT NULL REFERENCES automation_repositories(id),
      run_type TEXT NOT NULL,
      automation_type TEXT NOT NULL DEFAULT 'All',
      feature_id TEXT REFERENCES features(id),
      test_case_id TEXT REFERENCES test_cases(id),
      environment TEXT NOT NULL,
      project_name TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by TEXT NOT NULL REFERENCES users(id),
      provider_run_id TEXT NOT NULL,
      commit_sha TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT 'main',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS automation_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES automation_runs(id),
      asset_id TEXT NOT NULL REFERENCES automation_assets(id),
      test_case_id TEXT REFERENCES test_cases(id),
      feature_id TEXT NOT NULL REFERENCES features(id),
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_summary TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, asset_id)
    );
    CREATE TABLE IF NOT EXISTS automation_ingestion_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      received_at TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      result_json TEXT NOT NULL,
      UNIQUE(workspace_id, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS capacity_allocations (
      id TEXT PRIMARY KEY,
      feature_id TEXT NOT NULL REFERENCES features(id),
      member_name TEXT NOT NULL,
      role_name TEXT NOT NULL,
      sprint_name TEXT NOT NULL,
      available_hours INTEGER NOT NULL,
      allocated_hours INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS release_gates (
      id TEXT PRIMARY KEY,
      release_name TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence TEXT NOT NULL,
      owner_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  migrateAutomationSchema(db);
  migrateDocumentationSchema(db);
  seed(db);
  seedDocumentFolders(db);
  seedDocumentationReferenceData(db);
  seedSecurityReferenceData(db);
  seedAutomationReferenceData(db);
  return db;
}

function migrateDocumentationSchema(db) {
  const documentColumns = new Set(db.prepare(`PRAGMA table_info(documents)`).all().map(column => column.name));
  if (!documentColumns.has('folder_id')) db.exec(`ALTER TABLE documents ADD COLUMN folder_id TEXT REFERENCES document_folders(id)`);
  if (!documentColumns.has('published_version_id')) db.exec(`ALTER TABLE documents ADD COLUMN published_version_id TEXT REFERENCES document_versions(id)`);
  if (!documentColumns.has('published_at')) db.exec(`ALTER TABLE documents ADD COLUMN published_at TEXT`);
  if (!documentColumns.has('published_by')) db.exec(`ALTER TABLE documents ADD COLUMN published_by TEXT`);
  if (!documentColumns.has('deleted_at')) db.exec(`ALTER TABLE documents ADD COLUMN deleted_at TEXT`);
  if (!documentColumns.has('deleted_by')) db.exec(`ALTER TABLE documents ADD COLUMN deleted_by TEXT`);
  const folderColumns = new Set(db.prepare(`PRAGMA table_info(document_folders)`).all().map(column => column.name));
  if (!folderColumns.has('updated_at')) db.exec(`ALTER TABLE document_folders ADD COLUMN updated_at TEXT`);
  if (!folderColumns.has('created_by')) db.exec(`ALTER TABLE document_folders ADD COLUMN created_by TEXT`);
  db.prepare(`UPDATE document_folders SET updated_at = COALESCE(updated_at, created_at)`).run();
  db.exec(`UPDATE documents
    SET published_version_id = (SELECT v.id FROM document_versions v WHERE v.document_id = documents.id ORDER BY v.version_number DESC LIMIT 1),
        published_at = COALESCE(published_at, (SELECT v.created_at FROM document_versions v WHERE v.document_id = documents.id ORDER BY v.version_number DESC LIMIT 1)),
        published_by = COALESCE(published_by, (SELECT v.author_name FROM document_versions v WHERE v.document_id = documents.id ORDER BY v.version_number DESC LIMIT 1))
    WHERE status = 'Published' AND published_version_id IS NULL`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS document_title_per_space ON documents(space_id, title COLLATE NOCASE) WHERE is_trashed = 0`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS folder_name_per_parent ON document_folders(space_id, COALESCE(parent_folder_id, ''), name COLLATE NOCASE)`);
  db.exec(`CREATE INDEX IF NOT EXISTS documents_folder_updated ON documents(space_id, folder_id, is_trashed, updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS documents_status_updated ON documents(space_id, status, is_trashed, updated_at DESC)`);
}

function seedDocumentFolders(db) {
  const timestamp = now();
  db.prepare(`UPDATE workspaces SET name = 'Team 1 QA Space' WHERE id = 'ws-team-1' AND name = 'Team 1 QA Workspace'`).run();
  db.prepare(`UPDATE organizations SET name = 'QA Space Demo' WHERE id = 'org-qualispace' AND name = 'Qualispace Demo'`).run();
  const insert = db.prepare(`INSERT OR IGNORE INTO document_folders (id, space_id, parent_folder_id, name, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insert.run('FOLDER-QA-GUIDES', 'space-qa', null, 'Team playbooks', timestamp, timestamp, 'System');
  insert.run('FOLDER-PRODUCT-SPECS', 'space-product', null, 'Product specifications', timestamp, timestamp, 'System');
  insert.run('FOLDER-PRODUCT-RESEARCH', 'space-product', null, 'Research notes', timestamp, timestamp, 'System');
  insert.run('FOLDER-RELEASE-EVIDENCE', 'space-release', null, 'Release evidence', timestamp, timestamp, 'System');
  db.prepare(`UPDATE documents SET folder_id = 'FOLDER-QA-GUIDES' WHERE id = 'DOC-001' AND folder_id IS NULL`).run();
  db.prepare(`UPDATE documents SET folder_id = 'FOLDER-PRODUCT-SPECS' WHERE id IN ('DOC-002', 'DOC-003') AND folder_id IS NULL`).run();
  db.prepare(`UPDATE documents SET folder_id = 'FOLDER-RELEASE-EVIDENCE' WHERE id = 'DOC-005' AND folder_id IS NULL`).run();
  db.exec(`UPDATE documents
    SET published_version_id = (SELECT v.id FROM document_versions v WHERE v.document_id = documents.id ORDER BY v.version_number DESC LIMIT 1),
        published_at = COALESCE(published_at, (SELECT v.created_at FROM document_versions v WHERE v.document_id = documents.id ORDER BY v.version_number DESC LIMIT 1)),
        published_by = COALESCE(published_by, (SELECT v.author_name FROM document_versions v WHERE v.document_id = documents.id ORDER BY v.version_number DESC LIMIT 1))
    WHERE status = 'Published' AND published_version_id IS NULL`);
}

function migrateAutomationSchema(db) {
  const assetColumns = new Set(db.prepare(`PRAGMA table_info(automation_assets)`).all().map(column => column.name));
  if (!assetColumns.has('automation_type')) db.exec(`ALTER TABLE automation_assets ADD COLUMN automation_type TEXT NOT NULL DEFAULT 'Browser'`);
  const runColumns = new Set(db.prepare(`PRAGMA table_info(automation_runs)`).all().map(column => column.name));
  if (!runColumns.has('automation_type')) db.exec(`ALTER TABLE automation_runs ADD COLUMN automation_type TEXT NOT NULL DEFAULT 'All'`);
  if (!runColumns.has('test_case_id')) db.exec(`ALTER TABLE automation_runs ADD COLUMN test_case_id TEXT REFERENCES test_cases(id)`);
}

function seedAutomationReferenceData(db) {
  const timestamp = now();
  db.prepare('INSERT OR IGNORE INTO automation_repositories VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('REPO-QA-E2E', 'ws-team-1', 'qa-e2e', 'Local demo adapter', '', 'main', 'Active', timestamp);
  const insertAsset = db.prepare(`INSERT OR IGNORE INTO automation_assets
    (id, repository_id, external_test_id, title, file_path, suite_type, automation_type, owner_name, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertAsset.run('ASSET-101', 'REPO-QA-E2E', 'PW-DOC-001', 'Create nested documentation page', 'tests/docs/editor.spec.ts', 'Smoke', 'Browser', 'Mira Chen', 'Active');
  insertAsset.run('ASSET-102', 'REPO-QA-E2E', 'PW-AUTH-001', 'Personal page access isolation', 'tests/security/personal-pages.spec.ts', 'E2E', 'Browser', 'Mira Chen', 'Active');
  insertAsset.run('ASSET-201', 'REPO-QA-E2E', 'PW-TRACE-001', 'Trace risk and defect to feature', 'tests/api/traceability.spec.ts', 'E2E', 'API', 'Jon Bell', 'Active');
  insertAsset.run('ASSET-301', 'REPO-QA-E2E', 'PW-RUN-001', 'Dispatch feature-filtered run', 'tests/mcp/run-center.spec.ts', 'Smoke', 'MCP', 'Sam Rivera', 'Active');
  db.prepare(`UPDATE automation_assets SET automation_type = 'API', file_path = 'tests/api/traceability.spec.ts' WHERE id = 'ASSET-201'`).run();
  db.prepare(`UPDATE automation_assets SET automation_type = 'MCP', file_path = 'tests/mcp/run-center.spec.ts' WHERE id = 'ASSET-301'`).run();
  const insertMapping = db.prepare('INSERT OR IGNORE INTO automation_mappings VALUES (?, ?, ?)');
  insertMapping.run('ASSET-101', 'TC-101', 'FEAT-101');
  insertMapping.run('ASSET-102', 'TC-102', 'FEAT-101');
  insertMapping.run('ASSET-201', 'TC-201', 'FEAT-102');
  insertMapping.run('ASSET-301', 'TC-301', 'FEAT-103');
}

function seedSecurityReferenceData(db) {
  const timestamp = now();
  if (db.prepare('SELECT COUNT(*) AS count FROM organizations').get().count === 0) {
    db.prepare('INSERT INTO organizations VALUES (?, ?, ?, ?)').run('org-qualispace', 'QA Space Demo', 'qualispace-demo', timestamp);
  }
  db.prepare('INSERT OR IGNORE INTO workspace_organizations VALUES (?, ?)').run('ws-team-1', 'org-qualispace');

  const demoPassword = process.env.QA_DEMO_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'Demo123!');
  if (!demoPassword) throw new Error('QA_DEMO_PASSWORD is required when NODE_ENV=production');
  const insertUser = db.prepare('INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertUser.run('user-patrick', 'patrick@qualispace.local', 'Patrick', 'PN', hashPassword(demoPassword), 'active', timestamp);
  insertUser.run('user-mira', 'mira@qualispace.local', 'Mira Chen', 'MC', hashPassword(demoPassword), 'active', timestamp);
  insertUser.run('user-avery', 'avery@qualispace.local', 'Avery Stone', 'AS', hashPassword(demoPassword), 'active', timestamp);
  insertUser.run('user-viewer', 'viewer@qualispace.local', 'Workspace Viewer', 'WV', hashPassword(demoPassword), 'active', timestamp);

  const insertMembership = db.prepare('INSERT OR IGNORE INTO workspace_memberships VALUES (?, ?, ?, ?, ?)');
  insertMembership.run('ws-team-1', 'user-patrick', 'Senior QA', 'active', timestamp);
  insertMembership.run('ws-team-1', 'user-mira', 'QA Engineer', 'active', timestamp);
  insertMembership.run('ws-team-1', 'user-avery', 'Release Approver', 'active', timestamp);
  insertMembership.run('ws-team-1', 'user-viewer', 'Viewer', 'active', timestamp);
  db.prepare('INSERT OR IGNORE INTO space_owners VALUES (?, ?)').run('space-personal', 'user-patrick');
}

function seedDocumentationReferenceData(db) {
  if (db.prepare('SELECT COUNT(*) AS count FROM document_templates').get().count === 0) {
    const insert = db.prepare('INSERT INTO document_templates VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('TPL-BLANK', 'ws-team-1', 'Blank page', 'Start with an empty page.', '<p>Start writing...</p>', 'workspace');
    insert.run('TPL-FEATURE', 'ws-team-1', 'Feature specification', 'Define scope, acceptance criteria, dependencies, and quality requirements.', '<h2>Outcome</h2><p>Describe the user and business outcome.</p><h2>Scope</h2><p>Define what is included and excluded.</p><h2>Acceptance criteria</h2><ul><li>Add a testable acceptance criterion.</li></ul><h2>Dependencies and risks</h2><p>Record dependencies, assumptions, and initial risks.</p>', 'workspace');
    insert.run('TPL-TEST-PLAN', 'ws-team-1', 'QA test plan', 'Plan feature coverage, data, environments, risks, and exit criteria.', '<h2>Test objective</h2><p>Describe the quality objective and feature scope.</p><h2>Coverage</h2><ul><li>Functional</li><li>Integration</li><li>Security and accessibility where applicable</li></ul><h2>Test data and environments</h2><p>List required data, roles, tenants, browsers, and environments.</p><h2>Risks and exit criteria</h2><p>Link risks and define measurable completion criteria.</p>', 'workspace');
    insert.run('TPL-RELEASE', 'ws-team-1', 'Release readiness decision', 'Capture release gates, evidence, risks, and the go/no-go decision.', '<h2>Decision</h2><p>Ready, conditionally ready, at risk, or not ready.</p><h2>Gate evidence</h2><ul><li>Requirements and coverage</li><li>Defects and residual risks</li><li>Smoke and regression results</li></ul><h2>Overrides</h2><p>Record approver, reason, scope, and expiration.</p>', 'workspace');
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM document_comments').get().count === 0 && db.prepare('SELECT id FROM documents WHERE id = ?').get('DOC-002')) {
    db.prepare('INSERT INTO document_comments VALUES (?, ?, ?, ?, ?, ?, ?)').run('COM-001', 'DOC-002', 'Avery Stone', 'Can we make the retention period configurable per workspace?', 'Open', now(), null);
  }
}

function seed(db) {
  if (db.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count > 0) return;
  const timestamp = now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?)').run('ws-team-1', 'Team 1 QA Space', 'team-1-qa', timestamp);
    const insertSpace = db.prepare('INSERT INTO spaces VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertSpace.run('space-personal', 'ws-team-1', 'Patrick\'s space', 'personal', 'Patrick', 'private', timestamp);
    insertSpace.run('space-qa', 'ws-team-1', 'QA Operations', 'shared', 'Senior QA', 'workspace', timestamp);
    insertSpace.run('space-product', 'ws-team-1', 'Product Documentation', 'product', 'Product Team', 'workspace', timestamp);
    insertSpace.run('space-release', 'ws-team-1', 'Release 2026.09', 'release', 'Senior QA', 'workspace', timestamp);

    const insertFeature = db.prepare('INSERT INTO features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertFeature.run('FEAT-101', 'ws-team-1', 'Workspace documentation editor', '2026.09', 'In QA', 'Critical', 'Mira Chen', 'At Risk', 'Personal and shared documentation with publishing, history, and feature traceability.', timestamp);
    insertFeature.run('FEAT-102', 'ws-team-1', 'Feature-linked QA tracker', '2026.09', 'In Development', 'High', 'Jon Bell', 'On Track', 'Risk, coverage, defects, automation, and capacity connected through feature records.', timestamp);
    insertFeature.run('FEAT-103', 'ws-team-1', 'Playwright execution integration', '2026.10', 'Requirements Review', 'High', 'Sam Rivera', 'Needs Evidence', 'CI-dispatched smoke, feature, E2E, and regression execution with evidence ingestion.', timestamp);

    const insertDoc = db.prepare(`INSERT INTO documents
      (id, space_id, parent_id, title, content, status, owner_name, linked_feature_id, is_trashed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const docs = [
      ['DOC-001', 'space-qa', null, 'QA Development Flow and Structure', '<h2>Purpose</h2><p>This page defines how QA engages across the lifecycle of a feature and the standards, reports, and artifacts QA owns.</p><h2>Core principle</h2><p><strong>QA aligns across pods, not within them.</strong> Requirements review is a hard gate, and test authoring runs alongside implementation.</p>', 'Published', 'Senior QA', null],
      ['DOC-002', 'space-product', null, 'Workspace documentation editor', '<h2>Outcome</h2><p>Give every user a private personal space and teams a shared documentation tree with reviewable, versioned pages.</p><h2>Acceptance criteria</h2><ul><li>Personal pages are private by default.</li><li>Published evidence links to a feature.</li><li>Deleted pages remain recoverable during retention.</li></ul>', 'Approved', 'Mira Chen', 'FEAT-101'],
      ['DOC-003', 'space-product', 'DOC-002', 'Editor interaction notes', '<p>The editor uses a content-first layout with breadcrumbs, a compact toolbar, a readable canvas, and a contextual properties panel.</p>', 'In Review', 'Patrick', 'FEAT-101'],
      ['DOC-004', 'space-personal', null, 'My QA planning notes', '<h2>Today</h2><ul><li>Review documentation workflow.</li><li>Confirm feature coverage.</li><li>Prepare smoke scope.</li></ul>', 'Draft', 'Patrick', null],
      ['DOC-005', 'space-release', null, 'Release 2026.09 readiness', '<h2>Current decision</h2><p>The release is at risk while the editor recovery defect and critical-path automation remain open.</p>', 'In Review', 'Senior QA', 'FEAT-101']
    ];
    for (const doc of docs) {
      insertDoc.run(...doc, 0, timestamp, timestamp);
      db.prepare('INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('ver'), doc[0], 1, doc[3], doc[4], doc[5], doc[6], 'Initial version', timestamp);
    }

    const insertReq = db.prepare('INSERT INTO requirements VALUES (?, ?, ?, ?, ?)');
    insertReq.run('REQ-101', 'FEAT-101', 'Users can create multiple nested pages', 'Covered', 'Critical');
    insertReq.run('REQ-102', 'FEAT-101', 'Personal pages are private by default', 'Covered', 'Critical');
    insertReq.run('REQ-103', 'FEAT-101', 'Deleted pages can be restored', 'Gap', 'High');
    insertReq.run('REQ-201', 'FEAT-102', 'QA records are traceable to features', 'Covered', 'Critical');
    insertReq.run('REQ-301', 'FEAT-103', 'Feature runs select mapped Playwright tests', 'Draft', 'Critical');

    const insertTest = db.prepare('INSERT INTO test_cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertTest.run('TC-101', 'FEAT-101', 'REQ-101', 'Create and reorder nested documentation pages', 'E2E', 'Critical', 'Approved', 'Automated', 'Passed', 'Mira Chen', timestamp);
    insertTest.run('TC-102', 'FEAT-101', 'REQ-102', 'Verify personal page access isolation', 'Security', 'Critical', 'Approved', 'Planned', 'Passed', 'Mira Chen', timestamp);
    insertTest.run('TC-103', 'FEAT-101', 'REQ-103', 'Restore a deleted page tree', 'Functional', 'High', 'Draft', 'Deferred', 'Not Run', 'Mira Chen', timestamp);
    insertTest.run('TC-201', 'FEAT-102', 'REQ-201', 'Trace risk and defect to feature', 'Integration', 'High', 'Approved', 'Automated', 'Passed', 'Jon Bell', timestamp);
    insertTest.run('TC-301', 'FEAT-103', 'REQ-301', 'Dispatch feature-filtered CI run', 'Integration', 'Critical', 'Draft', 'Planned', 'Not Run', 'Sam Rivera', timestamp);

    const insertRisk = db.prepare('INSERT INTO risks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertRisk.run('RISK-01', 'FEAT-101', 'Permission inheritance may expose private pages', 3, 5, 10, 'Enforce authorization in API, search, and attachments', 'Mira Chen', 'Mitigating', '2026-09-04');
    insertRisk.run('RISK-02', 'FEAT-103', 'CI webhook events arrive out of order', 4, 4, 8, 'Use idempotency keys and monotonic run state', 'Sam Rivera', 'Open', '2026-09-10');

    const insertDefect = db.prepare('INSERT INTO defects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertDefect.run('BUG-31', 'FEAT-101', 'TC-103', 'Restoring a parent does not restore all children', 'Critical', 'In Progress', 'Dev Pod A', 'Staging', timestamp);
    insertDefect.run('BUG-28', 'FEAT-102', 'TC-201', 'Coverage count is stale after retest', 'Medium', 'Ready for Retest', 'Dev Pod B', 'QA', timestamp);

    const insertAutomation = db.prepare('INSERT INTO automation_backlog VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertAutomation.run('AUTO-11', 'FEAT-101', 'TC-102', 'Automate cross-user permission isolation', 10, 5, 'Ready', 'Automation QA', 'qa-e2e', 'Sprint 19');
    insertAutomation.run('AUTO-12', 'FEAT-101', 'TC-103', 'Automate page-tree restore workflow', 9, 3, 'Planned', 'Automation QA', 'qa-e2e', 'Sprint 19');
    insertAutomation.run('AUTO-13', 'FEAT-103', 'TC-301', 'Create feature manifest reporter contract', 10, 8, 'Discovery', 'Automation QA', 'playwright-infra', 'Sprint 20');

    const insertCapacity = db.prepare('INSERT INTO capacity_allocations VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertCapacity.run('CAP-1', 'FEAT-101', 'Mira Chen', 'QA Engineer', 'Sprint 19', 30, 28);
    insertCapacity.run('CAP-2', 'FEAT-102', 'Jon Bell', 'QA Engineer', 'Sprint 19', 30, 24);
    insertCapacity.run('CAP-3', 'FEAT-103', 'Sam Rivera', 'Automation/QA Engineer', 'Sprint 19', 28, 32);
    insertCapacity.run('CAP-4', 'FEAT-101', 'Avery Stone', 'Senior QA', 'Sprint 19', 20, 12);

    const insertGate = db.prepare('INSERT INTO release_gates VALUES (?, ?, ?, ?, ?, ?)');
    insertGate.run('GATE-1', '2026.09', 'Requirements reviewed', 'Passed', 'All critical release features cleared requirements review', 'Senior QA');
    insertGate.run('GATE-2', '2026.09', 'Critical coverage complete', 'At Risk', 'REQ-103 has no approved executed test', 'Mira Chen');
    insertGate.run('GATE-3', '2026.09', 'No critical defects open', 'Failed', 'BUG-31 remains in progress', 'Senior QA');
    insertGate.run('GATE-4', '2026.09', 'Latest smoke suite passed', 'Passed', '18 of 18 critical smoke tests passed', 'Automation QA');
    insertGate.run('GATE-5', '2026.09', 'Documentation approved', 'At Risk', 'Release readiness page remains in review', 'Senior QA');

    db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('act'), 'ws-team-1', 'Mira Chen', 'updated coverage for', 'feature', 'FEAT-101', timestamp);
    db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('act'), 'ws-team-1', 'Sam Rivera', 'planned automation for', 'feature', 'FEAT-103', timestamp);
    db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('act'), 'ws-team-1', 'Senior QA', 'reviewed release gate', 'release', '2026.09', timestamp);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function rows(db, table, order = 'rowid DESC') {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
}

const EDIT_DOCUMENT_ROLES = new Set(['Organization Admin', 'Workspace Admin', 'Senior QA', 'QA Engineer', 'Automation/QA Engineer', 'Contributor']);
const MANAGE_QA_ROLES = new Set(['Organization Admin', 'Workspace Admin', 'Senior QA', 'QA Engineer', 'Automation/QA Engineer']);
const SHARE_DOCUMENT_ROLES = new Set(['Organization Admin', 'Workspace Admin', 'Senior QA', 'QA Engineer', 'Automation/QA Engineer', 'Contributor']);

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
  }));
}

function auditSecurity(db, context, action, targetType, targetId, result, detail = '') {
  db.prepare('INSERT INTO security_audit VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id('sec'), context?.user?.id || null, context?.workspace?.id || null, action, targetType, targetId || null, result, String(detail), now()
  );
}

function getAuthContext(db, request) {
  const token = parseCookies(request).qa_session;
  if (!token) return null;
  const session = db.prepare(`SELECT s.*, u.email, u.display_name, u.initials, u.status AS user_status
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL`).get(sha256(token));
  if (!session || session.user_status !== 'active') return null;
  const currentTime = Date.now();
  if (new Date(session.expires_at).getTime() <= currentTime || currentTime - new Date(session.last_seen_at).getTime() > 2 * 60 * 60 * 1000) {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(now(), session.id);
    return null;
  }
  const membership = db.prepare(`SELECT m.*, w.name AS workspace_name, w.slug AS workspace_slug, wo.organization_id, o.name AS organization_name
    FROM workspace_memberships m
    JOIN workspaces w ON w.id = m.workspace_id
    JOIN workspace_organizations wo ON wo.workspace_id = w.id
    JOIN organizations o ON o.id = wo.organization_id
    WHERE m.user_id = ? AND m.status = 'active' ORDER BY m.created_at LIMIT 1`).get(session.user_id);
  if (!membership) return null;
  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(now(), session.id);
  return {
    session: { id: session.id, csrfToken: session.csrf_token, expiresAt: session.expires_at },
    user: { id: session.user_id, email: session.email, name: session.display_name, initials: session.initials },
    membership: { role: membership.role, status: membership.status },
    workspace: { id: membership.workspace_id, name: membership.workspace_name, slug: membership.workspace_slug },
    organization: { id: membership.organization_id, name: membership.organization_name }
  };
}

function createSession(db, user, request) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const timestamp = now();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO auth_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id('session'), user.id, sha256(rawToken), csrfToken, timestamp, timestamp, expiresAt, null);
  auditSecurity(db, { user }, 'auth.login', 'user', user.id, 'success', request.socket.remoteAddress || 'local');
  return { rawToken, csrfToken, expiresAt };
}

function authenticate(db, email, password, request) {
  const user = db.prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`).get(String(email || '').trim());
  if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
    auditSecurity(db, user ? { user } : null, 'auth.login', 'user', user?.id || String(email || ''), 'denied', request.socket.remoteAddress || 'local');
    return null;
  }
  const membership = db.prepare(`SELECT 1 FROM workspace_memberships WHERE user_id = ? AND status = 'active' LIMIT 1`).get(user.id);
  if (!membership) return null;
  return { user, session: createSession(db, user, request) };
}

function sessionCookie(token, request) {
  const secure = request.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  return `qa_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? '; Secure' : ''}`;
}

function clearSessionCookie() {
  return 'qa_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function documentAccessLevel(db, context, documentId) {
  const document = db.prepare(`SELECT d.*, s.type AS space_type, so.user_id AS space_owner_id
    FROM documents d JOIN spaces s ON s.id = d.space_id
    LEFT JOIN space_owners so ON so.space_id = s.id
    WHERE d.id = ? AND s.workspace_id = ?`).get(documentId, context.workspace.id);
  if (!document) return null;
  if (document.space_type !== 'personal') return EDIT_DOCUMENT_ROLES.has(context.membership.role) ? 'Editor' : context.membership.role === 'Commenter' ? 'Commenter' : 'Viewer';
  if (document.space_owner_id === context.user.id) return 'Owner';
  let currentId = document.id;
  while (currentId) {
    const permission = db.prepare('SELECT access_level FROM document_permissions WHERE document_id = ? AND user_id = ?').get(currentId, context.user.id);
    if (permission) return permission.access_level;
    currentId = db.prepare('SELECT parent_id FROM documents WHERE id = ?').get(currentId)?.parent_id || null;
  }
  return null;
}

function canReadDocument(db, context, documentId) {
  return Boolean(documentAccessLevel(db, context, documentId));
}

function canEditDocument(db, context, documentId) {
  return ['Owner', 'Editor'].includes(documentAccessLevel(db, context, documentId));
}

function canCommentDocument(db, context, documentId) {
  return ['Owner', 'Editor', 'Commenter'].includes(documentAccessLevel(db, context, documentId));
}

function canCreateInSpace(db, context, spaceId) {
  const space = db.prepare(`SELECT s.*, so.user_id AS space_owner_id FROM spaces s LEFT JOIN space_owners so ON so.space_id = s.id WHERE s.id = ? AND s.workspace_id = ?`).get(spaceId, context.workspace.id);
  if (!space) return false;
  if (space.type === 'personal') return space.space_owner_id === context.user.id;
  return EDIT_DOCUMENT_ROLES.has(context.membership.role);
}

function spaceInWorkspace(db, context, spaceId) {
  return db.prepare(`SELECT s.*, so.user_id AS space_owner_id FROM spaces s LEFT JOIN space_owners so ON so.space_id = s.id WHERE s.id = ? AND s.workspace_id = ?`).get(spaceId, context.workspace.id) || null;
}

function documentTree(db, documentId) {
  return db.prepare(`WITH RECURSIVE tree(id, depth) AS (
    SELECT id, 0 FROM documents WHERE id = ?
    UNION ALL
    SELECT d.id, tree.depth + 1 FROM documents d JOIN tree ON d.parent_id = tree.id
  ) SELECT d.*, tree.depth FROM documents d JOIN tree ON tree.id = d.id ORDER BY tree.depth, d.created_at`).all(documentId);
}

function validateDocumentPlacement(db, documentId, spaceId, folderId, parentId) {
  if (folderId && !db.prepare(`SELECT id FROM document_folders WHERE id = ? AND space_id = ?`).get(folderId, spaceId)) {
    throw new HttpError(400, 'The selected folder is not in this space');
  }
  if (!parentId) return;
  if (parentId === documentId) throw new HttpError(400, 'A document cannot be its own parent');
  const parent = db.prepare(`SELECT id, space_id FROM documents WHERE id = ? AND is_trashed = 0`).get(parentId);
  if (!parent || parent.space_id !== spaceId) throw new HttpError(400, 'The selected parent document is not in this space');
  if (documentId) {
    const descendants = new Set(documentTree(db, documentId).map(document => document.id));
    if (descendants.has(parentId)) throw new HttpError(400, 'A document cannot be moved beneath one of its descendants');
  }
}

function visibleDocumentFolders(db, context, documents) {
  const spaces = db.prepare(`SELECT s.*, so.user_id AS space_owner_id FROM spaces s LEFT JOIN space_owners so ON so.space_id = s.id WHERE s.workspace_id = ?`).all(context.workspace.id);
  const readableSpaceIds = new Set(spaces.filter(space => space.type !== 'personal' || space.space_owner_id === context.user.id).map(space => space.id));
  const visibleFolderIds = new Set();
  const folders = db.prepare(`SELECT f.* FROM document_folders f JOIN spaces s ON s.id = f.space_id WHERE s.workspace_id = ? ORDER BY f.name`).all(context.workspace.id);
  for (const folder of folders) if (readableSpaceIds.has(folder.space_id)) visibleFolderIds.add(folder.id);
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  for (const document of documents) {
    let folderId = document.folder_id;
    while (folderId && !visibleFolderIds.has(folderId)) {
      visibleFolderIds.add(folderId);
      folderId = byId.get(folderId)?.parent_folder_id || null;
    }
  }
  return folders.filter(folder => visibleFolderIds.has(folder.id));
}

function visibleDocuments(db, context) {
  return db.prepare(`SELECT d.* FROM documents d JOIN spaces s ON s.id = d.space_id WHERE s.workspace_id = ? ORDER BY d.updated_at DESC`).all(context.workspace.id)
    .filter(document => canReadDocument(db, context, document.id));
}

function bootstrap(db, context) {
  const documents = visibleDocuments(db, context);
  const documentFolders = visibleDocumentFolders(db, context, documents);
  const accessibleSpaceIds = new Set(documents.map(document => document.space_id));
  const ownedPersonalSpaces = db.prepare(`SELECT s.id FROM spaces s JOIN space_owners so ON so.space_id = s.id WHERE s.workspace_id = ? AND so.user_id = ?`).all(context.workspace.id, context.user.id).map(row => row.id);
  for (const spaceId of ownedPersonalSpaces) accessibleSpaceIds.add(spaceId);
  return {
    currentUser: { ...context.user, role: context.membership.role },
    organization: context.organization,
    workspace: context.workspace,
    spaces: db.prepare(`SELECT * FROM spaces WHERE workspace_id = ? ORDER BY CASE type WHEN 'personal' THEN 0 WHEN 'shared' THEN 1 WHEN 'product' THEN 2 ELSE 3 END, name`).all(context.workspace.id).filter(space => space.type !== 'personal' || accessibleSpaceIds.has(space.id)),
    documentFolders,
    documents,
    documentAccess: Object.fromEntries(documents.map(document => [document.id, documentAccessLevel(db, context, document.id)])),
    features: db.prepare(`SELECT * FROM features WHERE workspace_id = ? ORDER BY CASE priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 ELSE 2 END, updated_at DESC`).all(context.workspace.id),
    requirements: db.prepare(`SELECT r.* FROM requirements r JOIN features f ON f.id = r.feature_id WHERE f.workspace_id = ? ORDER BY r.id`).all(context.workspace.id),
    testCases: db.prepare(`SELECT t.* FROM test_cases t JOIN features f ON f.id = t.feature_id WHERE f.workspace_id = ? ORDER BY t.id`).all(context.workspace.id),
    risks: db.prepare(`SELECT r.* FROM risks r JOIN features f ON f.id = r.feature_id WHERE f.workspace_id = ? ORDER BY r.residual_score DESC`).all(context.workspace.id),
    defects: db.prepare(`SELECT d.* FROM defects d JOIN features f ON f.id = d.feature_id WHERE f.workspace_id = ? ORDER BY CASE d.severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, d.updated_at DESC`).all(context.workspace.id),
    automation: db.prepare(`SELECT a.* FROM automation_backlog a JOIN features f ON f.id = a.feature_id WHERE f.workspace_id = ? ORDER BY (a.value_score * 1.0 / MAX(a.effort_score, 1)) DESC`).all(context.workspace.id),
    automationRepositories: db.prepare(`SELECT * FROM automation_repositories WHERE workspace_id = ? AND status = 'Active' ORDER BY name`).all(context.workspace.id),
    automationAssets: db.prepare(`SELECT a.*, m.test_case_id, m.feature_id
      FROM automation_assets a
      JOIN automation_repositories r ON r.id = a.repository_id
      JOIN automation_mappings m ON m.asset_id = a.id
      WHERE r.workspace_id = ? ORDER BY a.external_test_id`).all(context.workspace.id),
    automationRuns: db.prepare(`SELECT ar.*, u.display_name AS requested_by_name, r.name AS repository_name
      FROM automation_runs ar
      JOIN users u ON u.id = ar.requested_by
      JOIN automation_repositories r ON r.id = ar.repository_id
      WHERE ar.workspace_id = ? ORDER BY ar.created_at DESC LIMIT 50`).all(context.workspace.id).map(run => ({ ...run, summary: JSON.parse(run.summary_json || '{}') })),
    capacity: db.prepare(`SELECT c.* FROM capacity_allocations c JOIN features f ON f.id = c.feature_id WHERE f.workspace_id = ? ORDER BY c.member_name`).all(context.workspace.id),
    releaseGates: db.prepare(`SELECT * FROM release_gates ORDER BY rowid`).all(),
    documentTemplates: rows(db, 'document_templates', 'name'),
    activity: db.prepare(`SELECT * FROM activity WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20`).all(context.workspace.id),
    members: db.prepare(`SELECT u.id, u.display_name, u.initials, m.role, m.status FROM workspace_memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.status = 'active' ORDER BY u.display_name`).all(context.workspace.id)
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) request.destroy(new Error('Request body too large'));
    });
    request.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(data));
}

function logActivity(db, action, entityType, entityId, actor = 'Patrick') {
  db.prepare('INSERT INTO activity VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('act'), 'ws-team-1', actor, action, entityType, entityId, now());
}

function documentDetail(db, documentId) {
  const document = db.prepare(`SELECT d.*, s.name AS space_name, s.type AS space_type, f.name AS folder_name
    FROM documents d
    JOIN spaces s ON s.id = d.space_id
    LEFT JOIN document_folders f ON f.id = d.folder_id
    WHERE d.id = ?`).get(documentId);
  if (!document) return null;
  const publishedVersion = document.published_version_id
    ? db.prepare(`SELECT * FROM document_versions WHERE id = ? AND document_id = ?`).get(document.published_version_id, documentId) || null
    : null;
  return { ...document, published_version: publishedVersion };
}

function listDocuments(db, context, options = {}) {
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(options.limit, 10) || 30));
  const includeTrashed = String(options.include_trashed || '').toLowerCase() === 'true';
  const visible = visibleDocuments(db, context).filter(document => {
    if (!includeTrashed && document.is_trashed) return false;
    if (options.space_id && document.space_id !== options.space_id) return false;
    if (options.folder_id === 'root' && document.folder_id) return false;
    if (options.folder_id && options.folder_id !== 'root' && document.folder_id !== options.folder_id) return false;
    if (options.status && document.status !== options.status) return false;
    const query = String(options.q || '').trim().toLowerCase();
    return !query || document.title.toLowerCase().includes(query) || String(document.content || '').toLowerCase().includes(query);
  });
  const start = (page - 1) * limit;
  return { documents: visible.slice(start, start + limit).map(document => documentDetail(db, document.id)), total: visible.length, page, limit };
}

function createDocument(db, body, context) {
  if (!body.space_id || !String(body.title || '').trim()) throw new Error('Space and title are required');
  const documentId = id('DOC');
  const timestamp = now();
  const title = String(body.title).trim();
  const duplicate = db.prepare(`SELECT id FROM documents WHERE space_id = ? AND title = ? COLLATE NOCASE AND is_trashed = 0`).get(body.space_id, title);
  if (duplicate) throw new HttpError(409, 'A document with this title already exists in the selected space. Choose a unique title.');
  validateDocumentPlacement(db, null, body.space_id, body.folder_id || null, body.parent_id || null);
  const template = body.template_id ? db.prepare('SELECT content FROM document_templates WHERE id = ?').get(body.template_id) : null;
  const content = String(body.content || template?.content || '<p>Start writing...</p>');
  const status = String(body.status || 'Draft');
  if (!DOCUMENT_STATUSES.has(status) || status === 'Published') throw new HttpError(400, 'New documents must begin in a valid unpublished state');
  const owner = context.user.name;
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO documents
      (id, space_id, parent_id, title, content, status, owner_name, linked_feature_id, is_trashed, created_at, updated_at, folder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(documentId, body.space_id, body.parent_id || null, title, content, status, owner, body.linked_feature_id || null, 0, timestamp, timestamp, body.folder_id || null);
    db.prepare('INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('ver'), documentId, 1, title, content, status, owner, 'Created page', timestamp);
    logActivity(db, 'created document', 'document', documentId, owner);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return documentDetail(db, documentId);
}

function createDocumentFolder(db, body, context) {
  const name = String(body.name || '').trim();
  const spaceId = String(body.space_id || '');
  const parentFolderId = body.parent_folder_id || null;
  if (!name || !spaceId) throw new Error('Folder name and space are required');
  if (parentFolderId) {
    const parent = db.prepare(`SELECT id FROM document_folders WHERE id = ? AND space_id = ?`).get(parentFolderId, spaceId);
    if (!parent) throw new HttpError(400, 'The selected parent folder is not in this space');
  }
  const duplicate = db.prepare(`SELECT id FROM document_folders WHERE space_id = ? AND COALESCE(parent_folder_id, '') = COALESCE(?, '') AND name = ? COLLATE NOCASE`).get(spaceId, parentFolderId, name);
  if (duplicate) throw new HttpError(409, 'A folder with this name already exists here');
  const folderId = id('FOLDER');
  const timestamp = now();
  db.prepare(`INSERT INTO document_folders (id, space_id, parent_folder_id, name, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(folderId, spaceId, parentFolderId, name, timestamp, timestamp, context.user.name);
  logActivity(db, 'created document folder', 'folder', folderId, context.user.name);
  return db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(folderId);
}

function updateDocumentFolder(db, folderId, body, context) {
  const current = db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(folderId);
  if (!current) return null;
  const name = body.name === undefined ? current.name : String(body.name).trim();
  const parentFolderId = body.parent_folder_id === undefined ? current.parent_folder_id : body.parent_folder_id || null;
  if (!name) throw new HttpError(400, 'Folder name is required');
  if (parentFolderId === folderId) throw new HttpError(400, 'A folder cannot be its own parent');
  if (parentFolderId) {
    const parent = db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(parentFolderId);
    if (!parent || parent.space_id !== current.space_id) throw new HttpError(400, 'The selected parent folder is not in this space');
    let ancestorId = parent.id;
    while (ancestorId) {
      if (ancestorId === folderId) throw new HttpError(400, 'A folder cannot be moved beneath one of its descendants');
      ancestorId = db.prepare(`SELECT parent_folder_id FROM document_folders WHERE id = ?`).get(ancestorId)?.parent_folder_id || null;
    }
  }
  const duplicate = db.prepare(`SELECT id FROM document_folders WHERE space_id = ? AND COALESCE(parent_folder_id, '') = COALESCE(?, '') AND name = ? COLLATE NOCASE AND id != ?`).get(current.space_id, parentFolderId, name, folderId);
  if (duplicate) throw new HttpError(409, 'A folder with this name already exists here');
  db.prepare(`UPDATE document_folders SET name = ?, parent_folder_id = ?, updated_at = ? WHERE id = ?`).run(name, parentFolderId, now(), folderId);
  logActivity(db, 'updated document folder', 'folder', folderId, context.user.name);
  return db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(folderId);
}

function deleteDocumentFolder(db, folderId, context) {
  const folder = db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(folderId);
  if (!folder) return false;
  const childFolder = db.prepare(`SELECT id FROM document_folders WHERE parent_folder_id = ? LIMIT 1`).get(folderId);
  const document = db.prepare(`SELECT id FROM documents WHERE folder_id = ? LIMIT 1`).get(folderId);
  if (childFolder || document) throw new HttpError(409, 'Move or delete the folder contents before deleting this folder');
  db.prepare(`DELETE FROM document_folders WHERE id = ?`).run(folderId);
  logActivity(db, 'deleted document folder', 'folder', folderId, context.user.name);
  return true;
}

function updateDocument(db, documentId, body, context) {
  const current = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!current) return null;
  if (current.is_trashed) throw new HttpError(409, 'Restore this document before editing it');
  const next = {
    title: body.title === undefined ? current.title : String(body.title).trim(),
    content: body.content === undefined ? current.content : String(body.content),
    status: body.status === undefined ? current.status : String(body.status),
    space_id: body.space_id === undefined ? current.space_id : String(body.space_id),
    parent_id: body.parent_id === undefined ? current.parent_id : body.parent_id || null,
    linked_feature_id: body.linked_feature_id === undefined ? current.linked_feature_id : body.linked_feature_id || null,
    folder_id: body.folder_id === undefined ? current.folder_id : body.folder_id || null,
    owner_name: current.owner_name
  };
  if (!next.title) throw new HttpError(400, 'Title is required');
  if (!DOCUMENT_STATUSES.has(next.status)) throw new HttpError(400, 'Invalid document status');
  if (next.space_id !== current.space_id) throw new HttpError(400, 'Use the document move endpoint to change spaces');
  validateDocumentPlacement(db, documentId, next.space_id, next.folder_id, next.parent_id);
  const duplicate = db.prepare(`SELECT id FROM documents WHERE space_id = ? AND title = ? COLLATE NOCASE AND is_trashed = 0 AND id != ?`).get(next.space_id, next.title, documentId);
  if (duplicate) throw new HttpError(409, 'A document with this title already exists in the selected space. Choose a unique title.');
  const editableContentChanged = next.title !== current.title || next.content !== current.content;
  if (next.status === 'Published' && current.status !== 'Published') throw new HttpError(400, 'Use the publish endpoint to publish a document');
  if (current.status === 'Published' && editableContentChanged) next.status = 'Draft';
  const contentChanged = editableContentChanged || next.status !== current.status;
  const metadataChanged = next.folder_id !== current.folder_id || next.parent_id !== current.parent_id || next.linked_feature_id !== current.linked_feature_id;
  if (!contentChanged && !metadataChanged) return documentDetail(db, documentId);
  const timestamp = now();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE documents SET title=?, content=?, status=?, space_id=?, parent_id=?, linked_feature_id=?, owner_name=?, updated_at=?, folder_id=? WHERE id=?`)
      .run(next.title, next.content, next.status, next.space_id, next.parent_id, next.linked_feature_id, next.owner_name, timestamp, next.folder_id, documentId);
    if (contentChanged && body.create_version !== false) {
      const version = db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM document_versions WHERE document_id = ?').get(documentId).value;
      db.prepare('INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('ver'), documentId, version, next.title, next.content, next.status, context.user.name, String(body.change_summary || 'Updated page'), timestamp);
    }
    logActivity(db, contentChanged ? 'updated document' : 'updated document metadata', 'document', documentId, context.user.name);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return documentDetail(db, documentId);
}

function moveDocument(db, documentId, body, context) {
  const current = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(documentId);
  if (!current) return null;
  if (current.is_trashed) throw new HttpError(409, 'Restore this document before moving it');
  const destinationSpaceId = String(body.space_id || current.space_id);
  const destinationFolderId = body.folder_id || null;
  if (!canCreateInSpace(db, context, destinationSpaceId)) throw new HttpError(403, 'You cannot move this document to that space');
  validateDocumentPlacement(db, documentId, destinationSpaceId, destinationFolderId, null);
  const tree = documentTree(db, documentId);
  if (destinationSpaceId !== current.space_id) {
    for (const document of tree) {
      const duplicate = db.prepare(`SELECT id FROM documents WHERE space_id = ? AND title = ? COLLATE NOCASE AND is_trashed = 0 AND id NOT IN (${tree.map(() => '?').join(',')}) LIMIT 1`)
        .get(destinationSpaceId, document.title, ...tree.map(item => item.id));
      if (duplicate) throw new HttpError(409, `A document titled "${document.title}" already exists in the destination space`);
    }
  }
  const timestamp = now();
  db.exec('BEGIN');
  try {
    if (destinationSpaceId !== current.space_id) {
      db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM documents WHERE id = ? UNION ALL SELECT d.id FROM documents d JOIN tree ON d.parent_id = tree.id)
        UPDATE documents SET space_id = ?, folder_id = NULL, updated_at = ? WHERE id IN (SELECT id FROM tree)`).run(documentId, destinationSpaceId, timestamp);
      db.prepare(`UPDATE documents SET parent_id = NULL, folder_id = ? WHERE id = ?`).run(destinationFolderId, documentId);
    } else {
      db.prepare(`UPDATE documents SET folder_id = ?, parent_id = NULL, updated_at = ? WHERE id = ?`).run(destinationFolderId, timestamp, documentId);
    }
    logActivity(db, 'moved document tree', 'document', documentId, context.user.name);
    auditSecurity(db, context, 'document.move', 'document', documentId, 'success', `${current.space_id}:${current.folder_id || 'root'} -> ${destinationSpaceId}:${destinationFolderId || 'root'}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return documentDetail(db, documentId);
}

function publishDocument(db, documentId, body, context) {
  const current = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(documentId);
  if (!current) return null;
  if (current.is_trashed) throw new HttpError(409, 'Restore this document before publishing it');
  if (current.status === 'Archived') throw new HttpError(409, 'Archived documents must be returned to Draft before publishing');
  const timestamp = now();
  const versionId = id('ver');
  const versionNumber = db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM document_versions WHERE document_id = ?').get(documentId).value;
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(versionId, documentId, versionNumber, current.title, current.content, 'Published', context.user.name, String(body.change_summary || 'Published document'), timestamp);
    db.prepare(`UPDATE documents SET status = 'Published', published_version_id = ?, published_at = ?, published_by = ?, updated_at = ? WHERE id = ?`).run(versionId, timestamp, context.user.name, timestamp, documentId);
    logActivity(db, 'published document', 'document', documentId, context.user.name);
    auditSecurity(db, context, 'document.publish', 'document', documentId, 'success', `version ${versionNumber}`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return documentDetail(db, documentId);
}

function trashDocument(db, documentId, context) {
  const existing = db.prepare(`SELECT id FROM documents WHERE id = ?`).get(documentId);
  if (!existing) return false;
  const timestamp = now();
  db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM documents WHERE id = ? UNION ALL SELECT d.id FROM documents d JOIN tree ON d.parent_id = tree.id)
    UPDATE documents SET is_trashed = 1, deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id IN (SELECT id FROM tree)`).run(documentId, timestamp, context.user.name, timestamp);
  logActivity(db, 'moved document tree to trash', 'document', documentId, context.user.name);
  auditSecurity(db, context, 'document.trash', 'document', documentId, 'success');
  return true;
}

function restoreDocumentTree(db, documentId, context) {
  const tree = documentTree(db, documentId);
  if (!tree.length) return false;
  for (const document of tree) {
    const duplicate = db.prepare(`SELECT id FROM documents WHERE space_id = ? AND title = ? COLLATE NOCASE AND is_trashed = 0 AND id != ?`).get(document.space_id, document.title, document.id);
    if (duplicate) throw new HttpError(409, `Cannot restore "${document.title}" because an active document has the same title`);
  }
  const timestamp = now();
  db.prepare(`WITH RECURSIVE tree(id) AS (SELECT id FROM documents WHERE id = ? UNION ALL SELECT d.id FROM documents d JOIN tree ON d.parent_id = tree.id)
    UPDATE documents SET is_trashed = 0, deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id IN (SELECT id FROM tree)`).run(documentId, timestamp);
  logActivity(db, 'restored document tree', 'document', documentId, context.user.name);
  auditSecurity(db, context, 'document.restore', 'document', documentId, 'success');
  return true;
}

const qaConfigs = {
  risks: {
    table: 'risks', prefix: 'RISK', required: ['feature_id', 'title'],
    columns: ['id', 'feature_id', 'title', 'likelihood', 'impact', 'residual_score', 'treatment', 'owner_name', 'status', 'due_date'],
    defaults: { likelihood: 3, impact: 3, residual_score: 9, treatment: 'Assess and mitigate', owner_name: 'Patrick', status: 'Open', due_date: null }
  },
  defects: {
    table: 'defects', prefix: 'BUG', required: ['feature_id', 'title'],
    columns: ['id', 'feature_id', 'test_case_id', 'title', 'severity', 'status', 'owner_name', 'environment', 'updated_at'],
    defaults: { test_case_id: null, severity: 'Medium', status: 'Open', owner_name: 'Patrick', environment: 'QA', updated_at: null }
  },
  'test-cases': {
    table: 'test_cases', prefix: 'TC', required: ['feature_id', 'title'],
    columns: ['id', 'feature_id', 'requirement_id', 'title', 'kind', 'priority', 'status', 'automation_status', 'latest_result', 'owner_name', 'updated_at'],
    defaults: { requirement_id: null, kind: 'Functional', priority: 'Medium', status: 'Draft', automation_status: 'Planned', latest_result: 'Not Run', owner_name: 'Patrick', updated_at: null }
  },
  automation: {
    table: 'automation_backlog', prefix: 'AUTO', required: ['feature_id', 'title'],
    columns: ['id', 'feature_id', 'test_case_id', 'title', 'value_score', 'effort_score', 'status', 'owner_name', 'repository', 'target_milestone'],
    defaults: { test_case_id: null, value_score: 5, effort_score: 5, status: 'Discovery', owner_name: 'Patrick', repository: '', target_milestone: '' }
  }
};

function createQaRecord(db, kind, body, context) {
  const config = qaConfigs[kind];
  if (!config) throw new Error('Unsupported QA record type');
  for (const field of config.required) if (!String(body[field] || '').trim()) throw new Error(`${field} is required`);
  const record = { ...config.defaults, ...body, id: body.id || id(config.prefix) };
  record.owner_name = context.user.name;
  if ('updated_at' in record && !record.updated_at) record.updated_at = now();
  const placeholders = config.columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${config.table} (${config.columns.join(', ')}) VALUES (${placeholders})`).run(...config.columns.map(column => record[column] ?? null));
  logActivity(db, `created ${kind}`, kind, record.id);
  return db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(record.id);
}

function createComment(db, documentId, body, context) {
  const document = db.prepare('SELECT id FROM documents WHERE id = ? AND is_trashed = 0').get(documentId);
  if (!document) throw new Error('Document not found');
  const text = String(body.body || '').trim();
  if (!text) throw new Error('Comment is required');
  const commentId = id('COM');
  const timestamp = now();
  db.prepare('INSERT INTO document_comments VALUES (?, ?, ?, ?, ?, ?, ?)').run(commentId, documentId, context.user.name, text, 'Open', timestamp, null);
  logActivity(db, 'commented on document', 'document', documentId, context.user.name);
  return db.prepare('SELECT * FROM document_comments WHERE id = ?').get(commentId);
}

function restoreDocumentVersion(db, documentId, versionId, actor = 'Patrick') {
  const current = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(documentId);
  if (!current) throw new HttpError(404, 'Document not found');
  if (current.is_trashed) throw new HttpError(409, 'Restore this document before restoring a version');
  const version = db.prepare('SELECT * FROM document_versions WHERE id = ? AND document_id = ?').get(versionId, documentId);
  if (!version) throw new Error('Document version not found');
  const duplicate = db.prepare(`SELECT id FROM documents WHERE space_id = ? AND title = ? COLLATE NOCASE AND is_trashed = 0 AND id != ?`).get(current.space_id, version.title, documentId);
  if (duplicate) throw new HttpError(409, `Cannot restore this version because an active document is titled "${version.title}"`);
  const timestamp = now();
  const nextVersion = db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM document_versions WHERE document_id = ?').get(documentId).value;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE documents SET title = ?, content = ?, status = 'Draft', updated_at = ? WHERE id = ?`).run(version.title, version.content, timestamp, documentId);
    db.prepare('INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('ver'), documentId, nextVersion, version.title, version.content, 'Draft', actor, `Restored version ${version.version_number}`, timestamp);
    logActivity(db, `restored document version ${version.version_number}`, 'document', documentId, actor);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return documentDetail(db, documentId);
}

function compareDocumentVersions(db, documentId, fromVersionId, toVersionId) {
  const from = db.prepare(`SELECT * FROM document_versions WHERE id = ? AND document_id = ?`).get(fromVersionId, documentId);
  const to = db.prepare(`SELECT * FROM document_versions WHERE id = ? AND document_id = ?`).get(toVersionId, documentId);
  if (!from || !to) throw new HttpError(404, 'Document version not found');
  return {
    from,
    to,
    changes: {
      title_changed: from.title !== to.title,
      content_changed: from.content !== to.content,
      status_changed: from.status !== to.status
    }
  };
}

function plainTextExcerpt(html, query) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const index = text.toLowerCase().indexOf(String(query || '').toLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 55);
  return `${start ? '…' : ''}${text.slice(start, start + 150)}${start + 150 < text.length ? '…' : ''}`;
}

function search(db, context, query) {
  const normalized = String(query || '').trim();
  if (!normalized) return [];
  const term = `%${normalized.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const visibleIds = new Set(visibleDocuments(db, context).filter(document => !document.is_trashed).map(document => document.id));
  const documents = db.prepare(`SELECT d.id, d.title, d.content, d.status, d.updated_at, d.folder_id, f.name AS folder_name, s.id AS space_id, s.name AS space_name, 'document' AS type
    FROM documents d JOIN spaces s ON s.id = d.space_id LEFT JOIN document_folders f ON f.id = d.folder_id
    WHERE d.is_trashed = 0 AND (d.title LIKE ? ESCAPE '\\' OR d.content LIKE ? ESCAPE '\\') ORDER BY d.updated_at DESC LIMIT 50`)
    .all(term, term).filter(document => visibleIds.has(document.id)).slice(0, 8)
    .map(document => ({ ...document, excerpt: plainTextExcerpt(document.content, normalized), content: undefined }));
  const features = db.prepare(`SELECT id, title, status, 'feature' AS type FROM features WHERE workspace_id = ? AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') LIMIT 8`).all(context.workspace.id, term, term);
  return [...documents, ...features].slice(0, 12);
}

const AUTOMATION_RUN_TYPES = new Set(['Smoke', 'Feature', 'Individual', 'E2E', 'Regression']);
const AUTOMATION_TYPES = new Set(['Browser', 'API', 'MCP', 'All']);
const AUTOMATION_ENVIRONMENTS = new Set(['QA', 'Staging', 'Preview']);
const AUTOMATION_PROJECTS = new Set(['chromium', 'firefox', 'webkit', 'all']);

function automationAssetsForRun(db, run) {
  const clauses = [`r.workspace_id = ?`, `a.status = 'Active'`];
  const params = [run.workspace_id];
  if (run.run_type === 'Smoke') clauses.push(`a.suite_type = 'Smoke'`);
  if (run.run_type === 'E2E') clauses.push(`a.suite_type = 'E2E'`);
  if (run.run_type === 'Feature') {
    clauses.push('m.feature_id = ?');
    params.push(run.feature_id);
  }
  if (run.run_type === 'Individual') {
    clauses.push('m.test_case_id = ?');
    params.push(run.test_case_id);
  }
  if (run.automation_type !== 'All') {
    clauses.push('a.automation_type = ?');
    params.push(run.automation_type);
  }
  clauses.push('a.repository_id = ?');
  params.push(run.repository_id);
  return db.prepare(`SELECT a.*, m.test_case_id, m.feature_id
    FROM automation_assets a
    JOIN automation_repositories r ON r.id = a.repository_id
    JOIN automation_mappings m ON m.asset_id = a.id
    WHERE ${clauses.join(' AND ')} ORDER BY a.external_test_id`).all(...params);
}

function automationRunDetail(db, workspaceId, runId) {
  const run = db.prepare(`SELECT ar.*, u.display_name AS requested_by_name, r.name AS repository_name
    FROM automation_runs ar
    JOIN users u ON u.id = ar.requested_by
    JOIN automation_repositories r ON r.id = ar.repository_id
    WHERE ar.id = ? AND ar.workspace_id = ?`).get(runId, workspaceId);
  if (!run) return null;
  return {
    ...run,
    summary: JSON.parse(run.summary_json || '{}'),
    results: db.prepare(`SELECT result.*, asset.external_test_id, asset.title, asset.file_path
      FROM automation_results result JOIN automation_assets asset ON asset.id = result.asset_id
      WHERE result.run_id = ? ORDER BY asset.external_test_id`).all(runId).map(result => ({ ...result, evidence: JSON.parse(result.evidence_json || '{}') }))
  };
}

function completeDemoAutomationRun(db, runId) {
  const run = db.prepare(`SELECT * FROM automation_runs WHERE id = ? AND status = 'Running'`).get(runId);
  if (!run) return;
  const assets = automationAssetsForRun(db, run);
  const timestamp = now();
  db.exec('BEGIN');
  try {
    const insert = db.prepare(`INSERT OR IGNORE INTO automation_results
      (id, run_id, asset_id, test_case_id, feature_id, status, duration_ms, retry_count, error_summary, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    assets.forEach((asset, index) => {
      insert.run(id('result'), runId, asset.id, asset.test_case_id, asset.feature_id, 'Passed', 720 + index * 185, 0, '', JSON.stringify({ adapter: 'local-demo', artifact: null }), timestamp);
      db.prepare(`UPDATE test_cases SET latest_result = 'Passed', updated_at = ? WHERE id = ?`).run(timestamp, asset.test_case_id);
    });
    const summary = { total: assets.length, passed: assets.length, failed: 0, skipped: 0 };
    db.prepare(`UPDATE automation_runs SET status = 'Passed', completed_at = ?, summary_json = ? WHERE id = ? AND status = 'Running'`)
      .run(timestamp, JSON.stringify(summary), runId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function scheduleDemoAutomationRun(db, runId, delayMs, timers) {
  const runningTimer = setTimeout(() => {
    timers.delete(runningTimer);
    try { db.prepare(`UPDATE automation_runs SET status = 'Running', started_at = ? WHERE id = ? AND status = 'Queued'`).run(now(), runId); } catch {}
  }, Math.max(1, Math.floor(delayMs / 3)));
  const completionTimer = setTimeout(() => {
    timers.delete(completionTimer);
    try { completeDemoAutomationRun(db, runId); } catch {}
  }, Math.max(2, delayMs));
  runningTimer.unref?.();
  completionTimer.unref?.();
  timers.add(runningTimer);
  timers.add(completionTimer);
}

function createAutomationRun(db, body, context, delayMs, timers) {
  const runType = String(body.run_type || '');
  if (!AUTOMATION_RUN_TYPES.has(runType)) throw new Error('Invalid run type');
  if (runType === 'Feature' && !body.feature_id) throw new Error('Feature is required for a feature run');
  if (runType === 'Individual' && !body.test_case_id) throw new Error('Test case is required for an individual run');
  const automationType = String(body.automation_type || 'All');
  if (!AUTOMATION_TYPES.has(automationType)) throw new Error('Invalid automation type');
  const environment = String(body.environment || 'QA');
  const projectName = String(body.project_name || 'chromium');
  if (!AUTOMATION_ENVIRONMENTS.has(environment)) throw new Error('Invalid automation environment');
  if (!AUTOMATION_PROJECTS.has(projectName)) throw new Error('Invalid Playwright project');
  const repository = db.prepare(`SELECT * FROM automation_repositories WHERE id = ? AND workspace_id = ? AND status = 'Active'`).get(body.repository_id, context.workspace.id);
  if (!repository) throw new Error('Invalid automation repository');
  if (body.feature_id && !db.prepare('SELECT 1 FROM features WHERE id = ? AND workspace_id = ?').get(body.feature_id, context.workspace.id)) throw new Error('Invalid feature');
  if (body.test_case_id && !db.prepare(`SELECT 1 FROM test_cases t JOIN features f ON f.id = t.feature_id WHERE t.id = ? AND f.workspace_id = ?`).get(body.test_case_id, context.workspace.id)) throw new Error('Invalid test case');

  const runId = id('RUN');
  const timestamp = now();
  const run = {
    id: runId,
    workspace_id: context.workspace.id,
    repository_id: repository.id,
    run_type: runType,
    automation_type: automationType,
    feature_id: body.feature_id || null,
    test_case_id: body.test_case_id || null,
    environment,
    project_name: projectName,
    status: 'Queued',
    requested_by: context.user.id,
    provider_run_id: `local-demo-${runId}`,
    commit_sha: String(body.commit_sha || 'demo-commit'),
    branch: String(body.branch || repository.default_branch),
    started_at: null,
    completed_at: null,
    created_at: timestamp,
    summary_json: '{}'
  };
  const assets = automationAssetsForRun(db, run);
  if (!assets.length) throw new Error('Invalid automation scope: no eligible mapped assets were found');
  run.summary_json = JSON.stringify({ total: assets.length, passed: 0, failed: 0, skipped: 0 });
  db.prepare(`INSERT INTO automation_runs
    (id, workspace_id, repository_id, run_type, automation_type, feature_id, test_case_id, environment, project_name, status, requested_by, provider_run_id, commit_sha, branch, started_at, completed_at, created_at, summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(...['id','workspace_id','repository_id','run_type','automation_type','feature_id','test_case_id','environment','project_name','status','requested_by','provider_run_id','commit_sha','branch','started_at','completed_at','created_at','summary_json'].map(field => run[field]));
  logActivity(db, `requested ${runType.toLowerCase()} automation run`, 'automation-run', runId, context.user.name);
  auditSecurity(db, context, 'automation.run.dispatch', 'automation-run', runId, 'success', `${runType}:${automationType}:${environment}:${projectName}`);
  scheduleDemoAutomationRun(db, runId, delayMs, timers);
  return automationRunDetail(db, context.workspace.id, runId);
}

function ingestAutomationResults(db, body, context) {
  const key = String(body.idempotency_key || '').trim();
  if (!key) throw new Error('Idempotency key is required');
  const payloadHash = sha256(JSON.stringify(body));
  const previous = db.prepare(`SELECT * FROM automation_ingestion_events WHERE workspace_id = ? AND idempotency_key = ?`).get(context.workspace.id, key);
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new Error('Invalid idempotency key reuse with a different payload');
    return { duplicate: true, ...JSON.parse(previous.result_json) };
  }
  const run = db.prepare(`SELECT * FROM automation_runs WHERE id = ? AND workspace_id = ?`).get(body.run_id, context.workspace.id);
  if (!run) throw new Error('Invalid automation run');
  if (['Passed', 'Failed', 'Cancelled'].includes(run.status)) throw new Error('Invalid automation run state: results are already final');
  const results = Array.isArray(body.results) ? body.results : [];
  if (!results.length) throw new Error('Automation results are required');
  const timestamp = now();
  const counts = { total: results.length, passed: 0, failed: 0, skipped: 0 };
  db.exec('BEGIN');
  try {
    const insert = db.prepare(`INSERT INTO automation_results
      (id, run_id, asset_id, test_case_id, feature_id, status, duration_ms, retry_count, error_summary, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of results) {
      const asset = automationAssetsForRun(db, run).find(candidate => candidate.id === item.asset_id);
      if (!asset) throw new Error('Invalid automation result asset for this run scope');
      const resultStatus = ['Passed', 'Failed', 'Skipped'].includes(item.status) ? item.status : 'Failed';
      counts[resultStatus.toLowerCase()] += 1;
      insert.run(id('result'), run.id, asset.id, asset.test_case_id, asset.feature_id, resultStatus, Number(item.duration_ms || 0), Number(item.retry_count || 0), String(item.error_summary || ''), JSON.stringify(item.evidence || {}), timestamp);
      db.prepare('UPDATE test_cases SET latest_result = ?, updated_at = ? WHERE id = ?').run(resultStatus, timestamp, asset.test_case_id);
    }
    const finalStatus = counts.failed ? 'Failed' : 'Passed';
    db.prepare(`UPDATE automation_runs SET status = ?, started_at = COALESCE(started_at, ?), completed_at = ?, summary_json = ? WHERE id = ?`)
      .run(finalStatus, timestamp, timestamp, JSON.stringify(counts), run.id);
    const result = { run_id: run.id, status: finalStatus, summary: counts };
    db.prepare(`INSERT INTO automation_ingestion_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id('ingest'), context.workspace.id, key, 'run.completed', payloadHash, timestamp, timestamp, JSON.stringify(result));
    db.exec('COMMIT');
    return { duplicate: false, ...result };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function serveStatic(requestPath, response) {
  const relative = requestPath === '/' ? 'index.html' : decodeURIComponent(requestPath.slice(1));
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(response, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'Not found' });
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(filePath)] || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': `${mime}; charset=utf-8`,
      'Cache-Control': ['.html', '.js', '.css'].includes(path.extname(filePath)) ? 'no-cache' : 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });
    response.end(data);
  });
}

function createApp(options = {}) {
  const db = openDatabase(options.dbPath || process.env.QA_DB_PATH || DEFAULT_DB_PATH);
  const loginAttempts = new Map();
  const automationTimers = new Set();
  const demoRunDelayMs = options.demoRunDelayMs ?? 900;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const method = request.method || 'GET';
    try {
      if (method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { status: 'ok' });
      if (method === 'POST' && url.pathname === '/api/auth/login') {
        const address = request.socket.remoteAddress || 'local';
        const recent = (loginAttempts.get(address) || []).filter(timestamp => Date.now() - timestamp < 15 * 60 * 1000);
        if (recent.length >= 8) return sendJson(response, 429, { error: 'Too many login attempts. Try again later.' });
        const body = await readBody(request);
        const result = authenticate(db, body.email, body.password, request);
        if (!result) {
          recent.push(Date.now());
          loginAttempts.set(address, recent);
          return sendJson(response, 401, { error: 'Email or password is incorrect.' });
        }
        loginAttempts.delete(address);
        return sendJson(response, 200, { ok: true, csrfToken: result.session.csrfToken, expiresAt: result.session.expiresAt }, { 'Set-Cookie': sessionCookie(result.session.rawToken, request) });
      }

      const context = getAuthContext(db, request);
      if (method === 'GET' && url.pathname === '/api/auth/session') {
        return sendJson(response, 200, context ? { authenticated: true, ...context } : { authenticated: false });
      }
      if (url.pathname.startsWith('/api/') && !context) return sendJson(response, 401, { error: 'Authentication required' });
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && url.pathname !== '/api/auth/login' && request.headers['x-csrf-token'] !== context.session.csrfToken) {
        auditSecurity(db, context, 'csrf.validation', 'request', url.pathname, 'denied', method);
        return sendJson(response, 403, { error: 'Invalid security token' });
      }
      if (method === 'POST' && url.pathname === '/api/auth/logout') {
        db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(now(), context.session.id);
        auditSecurity(db, context, 'auth.logout', 'user', context.user.id, 'success');
        return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
      }
      if (method === 'GET' && url.pathname === '/api/bootstrap') return sendJson(response, 200, bootstrap(db, context));
      if (method === 'GET' && url.pathname === '/api/search') return sendJson(response, 200, { results: search(db, context, url.searchParams.get('q') || '') });
      if (method === 'GET' && url.pathname === '/api/automation/runs') {
        const runs = db.prepare(`SELECT ar.*, u.display_name AS requested_by_name, r.name AS repository_name
          FROM automation_runs ar JOIN users u ON u.id = ar.requested_by JOIN automation_repositories r ON r.id = ar.repository_id
          WHERE ar.workspace_id = ? ORDER BY ar.created_at DESC LIMIT 50`).all(context.workspace.id)
          .map(run => ({ ...run, summary: JSON.parse(run.summary_json || '{}') }));
        return sendJson(response, 200, { runs });
      }
      let automationMatch = url.pathname.match(/^\/api\/automation\/runs\/([^/]+)$/);
      if (automationMatch && method === 'GET') {
        const detail = automationRunDetail(db, context.workspace.id, automationMatch[1]);
        return detail ? sendJson(response, 200, detail) : sendJson(response, 404, { error: 'Automation run not found' });
      }
      if (method === 'POST' && url.pathname === '/api/automation/runs') {
        if (!MANAGE_QA_ROLES.has(context.membership.role)) {
          auditSecurity(db, context, 'automation.run.dispatch', 'automation-run', null, 'denied');
          return sendJson(response, 403, { error: 'Your role cannot dispatch automation runs.' });
        }
        return sendJson(response, 202, createAutomationRun(db, await readBody(request), context, demoRunDelayMs, automationTimers));
      }
      if (method === 'POST' && url.pathname === '/api/automation/ingest') {
        if (!MANAGE_QA_ROLES.has(context.membership.role)) return sendJson(response, 403, { error: 'Your role cannot ingest automation evidence.' });
        return sendJson(response, 200, ingestAutomationResults(db, await readBody(request), context));
      }
      if (method === 'GET' && url.pathname === '/api/documents') {
        return sendJson(response, 200, listDocuments(db, context, Object.fromEntries(url.searchParams)));
      }
      if (method === 'POST' && url.pathname === '/api/documents') {
        const body = await readBody(request);
        if (!canCreateInSpace(db, context, body.space_id) || (body.parent_id && !canEditDocument(db, context, body.parent_id))) {
          auditSecurity(db, context, 'document.create', 'space', body.space_id, 'denied');
          return sendJson(response, 403, { error: 'You cannot create a page in this location.' });
        }
        return sendJson(response, 201, createDocument(db, body, context));
      }
      if (method === 'POST' && url.pathname === '/api/folders') {
        const body = await readBody(request);
        if (!canCreateInSpace(db, context, body.space_id)) return sendJson(response, 403, { error: 'You cannot create a folder in this space.' });
        return sendJson(response, 201, createDocumentFolder(db, body, context));
      }
      if (method === 'GET' && url.pathname === '/api/folders') {
        const documents = visibleDocuments(db, context);
        const folders = visibleDocumentFolders(db, context, documents).filter(folder => !url.searchParams.get('space_id') || folder.space_id === url.searchParams.get('space_id'));
        return sendJson(response, 200, { folders });
      }

      let folderMatch = url.pathname.match(/^\/api\/folders\/([^/]+)$/);
      if (folderMatch && method === 'GET') {
        const folder = visibleDocumentFolders(db, context, visibleDocuments(db, context)).find(item => item.id === folderMatch[1]);
        return folder ? sendJson(response, 200, folder) : sendJson(response, 404, { error: 'Folder not found' });
      }
      if (folderMatch && method === 'PUT') {
        const folder = db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(folderMatch[1]);
        if (!folder) return sendJson(response, 404, { error: 'Folder not found' });
        if (!canCreateInSpace(db, context, folder.space_id)) return sendJson(response, 403, { error: 'You cannot update this folder.' });
        return sendJson(response, 200, updateDocumentFolder(db, folder.id, await readBody(request), context));
      }
      if (folderMatch && method === 'DELETE') {
        const folder = db.prepare(`SELECT * FROM document_folders WHERE id = ?`).get(folderMatch[1]);
        if (!folder) return sendJson(response, 404, { error: 'Folder not found' });
        if (!canCreateInSpace(db, context, folder.space_id)) return sendJson(response, 403, { error: 'You cannot delete this folder.' });
        deleteDocumentFolder(db, folder.id, context);
        return sendJson(response, 200, { ok: true });
      }

      let match = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
      if (match && method === 'GET') {
        if (!canReadDocument(db, context, match[1])) return sendJson(response, 404, { error: 'Document not found' });
        return sendJson(response, 200, documentDetail(db, match[1]));
      }
      if (match && method === 'PUT') {
        if (!canEditDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot edit this page.' });
        const body = await readBody(request);
        if (body.space_id && !canCreateInSpace(db, context, body.space_id)) return sendJson(response, 403, { error: 'You cannot move this page to that space.' });
        if (body.parent_id && !canEditDocument(db, context, body.parent_id)) return sendJson(response, 403, { error: 'You cannot use that parent page.' });
        const result = updateDocument(db, match[1], body, context);
        return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: 'Document not found' });
      }
      if (match && method === 'DELETE') {
        if (!canEditDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot delete this page.' });
        if (!trashDocument(db, match[1], context)) return sendJson(response, 404, { error: 'Document not found' });
        return sendJson(response, 200, { ok: true });
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/publish$/);
      if (match && method === 'POST') {
        if (!canEditDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot publish this document.' });
        const result = publishDocument(db, match[1], await readBody(request), context);
        return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: 'Document not found' });
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/move$/);
      if (match && method === 'POST') {
        if (!canEditDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot move this document.' });
        const result = moveDocument(db, match[1], await readBody(request), context);
        return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: 'Document not found' });
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/restore$/);
      if (match && method === 'POST') {
        if (!canEditDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot restore this page.' });
        if (!restoreDocumentTree(db, match[1], context)) return sendJson(response, 404, { error: 'Document not found' });
        return sendJson(response, 200, { ok: true });
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/versions$/);
      if (match && method === 'GET') {
        if (!canReadDocument(db, context, match[1])) return sendJson(response, 404, { error: 'Document not found' });
        return sendJson(response, 200, { versions: db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC').all(match[1]) });
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/versions\/([^/]+)\/restore$/);
      if (match && method === 'POST') {
        if (!canEditDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot restore a version of this page.' });
        return sendJson(response, 200, restoreDocumentVersion(db, match[1], match[2], context.user.name));
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/versions\/([^/]+)$/);
      if (match && method === 'GET') {
        if (!canReadDocument(db, context, match[1])) return sendJson(response, 404, { error: 'Document not found' });
        const version = db.prepare(`SELECT * FROM document_versions WHERE id = ? AND document_id = ?`).get(match[2], match[1]);
        return version ? sendJson(response, 200, version) : sendJson(response, 404, { error: 'Document version not found' });
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/compare$/);
      if (match && method === 'GET') {
        if (!canReadDocument(db, context, match[1])) return sendJson(response, 404, { error: 'Document not found' });
        return sendJson(response, 200, compareDocumentVersions(db, match[1], url.searchParams.get('from'), url.searchParams.get('to')));
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/comments$/);
      if (match && method === 'GET') {
        if (!canReadDocument(db, context, match[1])) return sendJson(response, 404, { error: 'Document not found' });
        return sendJson(response, 200, { comments: db.prepare(`SELECT * FROM document_comments WHERE document_id = ? ORDER BY CASE status WHEN 'Open' THEN 0 ELSE 1 END, created_at DESC`).all(match[1]) });
      }
      if (match && method === 'POST') {
        if (!canCommentDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot comment on this page.' });
        return sendJson(response, 201, createComment(db, match[1], await readBody(request), context));
      }

      match = url.pathname.match(/^\/api\/documents\/([^/]+)\/permissions$/);
      if (match && method === 'GET') {
        if (!canEditDocument(db, context, match[1])) return sendJson(response, 403, { error: 'You cannot manage sharing for this page.' });
        return sendJson(response, 200, { permissions: db.prepare(`SELECT p.document_id, p.user_id, p.access_level, u.display_name, u.initials FROM document_permissions p JOIN users u ON u.id = p.user_id WHERE p.document_id = ? ORDER BY u.display_name`).all(match[1]) });
      }
      if (match && method === 'PUT') {
        if (!canEditDocument(db, context, match[1]) || !SHARE_DOCUMENT_ROLES.has(context.membership.role)) return sendJson(response, 403, { error: 'You cannot manage sharing for this page.' });
        const body = await readBody(request);
        const member = db.prepare(`SELECT 1 FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? AND status = 'active'`).get(context.workspace.id, body.user_id);
        if (!member || body.user_id === context.user.id) return sendJson(response, 400, { error: 'Select another active workspace member.' });
        if (!body.access_level) db.prepare('DELETE FROM document_permissions WHERE document_id = ? AND user_id = ?').run(match[1], body.user_id);
        else if (['Viewer', 'Commenter', 'Editor'].includes(body.access_level)) db.prepare(`INSERT INTO document_permissions VALUES (?, ?, ?, ?, ?) ON CONFLICT(document_id, user_id) DO UPDATE SET access_level = excluded.access_level, granted_by = excluded.granted_by, created_at = excluded.created_at`).run(match[1], body.user_id, body.access_level, context.user.id, now());
        else return sendJson(response, 400, { error: 'Invalid access level.' });
        auditSecurity(db, context, 'document.share', 'document', match[1], 'success', `${body.user_id}:${body.access_level || 'removed'}`);
        return sendJson(response, 200, { ok: true });
      }

      match = url.pathname.match(/^\/api\/comments\/([^/]+)\/resolve$/);
      if (match && method === 'POST') {
        const comment = db.prepare('SELECT document_id FROM document_comments WHERE id = ?').get(match[1]);
        if (!comment || !canCommentDocument(db, context, comment.document_id)) return sendJson(response, 403, { error: 'You cannot resolve this comment.' });
        const result = db.prepare(`UPDATE document_comments SET status = 'Resolved', resolved_at = ? WHERE id = ?`).run(now(), match[1]);
        return result.changes ? sendJson(response, 200, { ok: true }) : sendJson(response, 404, { error: 'Comment not found' });
      }

      match = url.pathname.match(/^\/api\/qa\/([^/]+)$/);
      if (match && method === 'POST') {
        if (!MANAGE_QA_ROLES.has(context.membership.role)) return sendJson(response, 403, { error: 'Your role cannot create QA records.' });
        return sendJson(response, 201, createQaRecord(db, match[1], await readBody(request), context));
      }

      if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API route not found' });
      serveStatic(url.pathname, response);
    } catch (error) {
      const status = error.status || (/required|invalid|unsupported|already exists|unique title|selected folder|parent folder/i.test(error.message) ? 400 : 500);
      sendJson(response, status, { error: error.message });
    }
  });
  server.on('close', () => {
    for (const timer of automationTimers) clearTimeout(timer);
    automationTimers.clear();
    db.close();
  });
  return { server, db };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  const { server } = createApp();
  server.listen(port, '127.0.0.1', () => {
    console.log(`QA Space is running at http://127.0.0.1:${port}`);
  });
}

module.exports = { createApp, openDatabase, bootstrap };
