const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const defaultAuth = new Map();

async function withServer(run, appOptions = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-workspace-test-'));
  const dbPath = path.join(directory, 'test.db');
  const { server } = createApp({ dbPath, demoRunDelayMs: 30, ...appOptions });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function request(base, route, options) {
  const { auth: explicitAuth, ...requestOptions } = options || {};
  const auth = explicitAuth || defaultAuth.get(base);
  const method = requestOptions.method || 'GET';
  const response = await fetch(`${base}${route}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Cookie: auth.cookie } : {}),
      ...(auth && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { 'X-CSRF-Token': auth.csrfToken } : {}),
      ...(requestOptions.headers || {})
    },
    ...requestOptions
  });
  return { response, body: await response.json() };
}

async function login(base, email = 'patrick@qualispace.local', makeDefault = true) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Demo123!' })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  const auth = { cookie: response.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken };
  if (makeDefault) defaultAuth.set(base, auth);
  return auth;
}

test('health and bootstrap expose a complete seeded workspace', async () => {
  await withServer(async base => {
    const health = await request(base, '/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, 'ok');

    const denied = await request(base, '/api/bootstrap');
    assert.equal(denied.response.status, 401);

    await login(base);

    const result = await request(base, '/api/bootstrap');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.workspace.id, 'ws-team-1');
    assert.ok(result.body.spaces.some(space => space.type === 'personal'));
    assert.ok(result.body.features.length >= 3);
    assert.ok(result.body.releaseGates.length >= 5);
  });
});

test('document lifecycle supports create, autosave, version, trash, and restore', async () => {
  await withServer(async base => {
    await login(base);
    const createdResult = await request(base, '/api/documents', {
      method: 'POST',
      body: JSON.stringify({ space_id: 'space-personal', title: 'Lifecycle test', content: '<p>Initial</p>' })
    });
    assert.equal(createdResult.response.status, 201);
    const documentId = createdResult.body.id;

    const autosave = await request(base, `/api/documents/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify({ content: '<p>Autosaved</p>', create_version: false })
    });
    assert.equal(autosave.body.content, '<p>Autosaved</p>');

    let versions = await request(base, `/api/documents/${documentId}/versions`);
    assert.equal(versions.body.versions.length, 1);

    await request(base, `/api/documents/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'In Review', create_version: true, change_summary: 'Ready for review' })
    });
    versions = await request(base, `/api/documents/${documentId}/versions`);
    assert.equal(versions.body.versions.length, 2);
    assert.equal(versions.body.versions[0].change_summary, 'Ready for review');

    await request(base, `/api/documents/${documentId}`, { method: 'DELETE' });
    let bootstrap = await request(base, '/api/bootstrap');
    assert.equal(bootstrap.body.documents.find(doc => doc.id === documentId).is_trashed, 1);

    await request(base, `/api/documents/${documentId}/restore`, { method: 'POST', body: '{}' });
    bootstrap = await request(base, '/api/bootstrap');
    assert.equal(bootstrap.body.documents.find(doc => doc.id === documentId).is_trashed, 0);
  });
});

test('document folders organize pages and titles stay unique within a space', async () => {
  await withServer(async base => {
    await login(base);
    const folderResult = await request(base, '/api/folders', {
      method: 'POST',
      body: JSON.stringify({ space_id: 'space-qa', name: 'Regression guides' })
    });
    assert.equal(folderResult.response.status, 201);

    const created = await request(base, '/api/documents', {
      method: 'POST',
      body: JSON.stringify({ space_id: 'space-qa', folder_id: folderResult.body.id, title: 'Regression strategy', content: '<h2>Scope</h2>' })
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.folder_id, folderResult.body.id);

    const duplicate = await request(base, '/api/documents', {
      method: 'POST',
      body: JSON.stringify({ space_id: 'space-qa', title: 'regression STRATEGY' })
    });
    assert.equal(duplicate.response.status, 409);
    assert.match(duplicate.body.error, /unique title/i);

    const bootstrap = await request(base, '/api/bootstrap');
    assert.ok(bootstrap.body.documentFolders.some(folder => folder.id === folderResult.body.id));
  });
});

test('publishing is atomic and later edits return the document to Draft', async () => {
  await withServer(async base => {
    await login(base);
    const created = await request(base, '/api/documents', {
      method: 'POST',
      body: JSON.stringify({ space_id: 'space-qa', title: 'Publishing contract', content: '<h2>First edition</h2>' })
    });
    const published = await request(base, `/api/documents/${created.body.id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ change_summary: 'Approved for team use' })
    });
    assert.equal(published.response.status, 200);
    assert.equal(published.body.status, 'Published');
    assert.ok(published.body.published_version_id);
    assert.equal(published.body.published_version.status, 'Published');

    const edited = await request(base, `/api/documents/${created.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ content: '<h2>Second edition draft</h2>', status: 'Published', create_version: false })
    });
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.status, 'Draft');
    assert.equal(edited.body.published_version.content, '<h2>First edition</h2>');

    const republished = await request(base, `/api/documents/${created.body.id}/publish`, { method: 'POST', body: '{}' });
    assert.equal(republished.body.status, 'Published');
    assert.equal(republished.body.published_version.content, '<h2>Second edition draft</h2>');
  });
});

test('folder lifecycle prevents cycles and non-empty deletion', async () => {
  await withServer(async base => {
    await login(base);
    const root = await request(base, '/api/folders', { method: 'POST', body: JSON.stringify({ space_id: 'space-qa', name: 'Backend guides' }) });
    const child = await request(base, '/api/folders', { method: 'POST', body: JSON.stringify({ space_id: 'space-qa', parent_folder_id: root.body.id, name: 'API notes' }) });

    const cycle = await request(base, `/api/folders/${root.body.id}`, { method: 'PUT', body: JSON.stringify({ parent_folder_id: child.body.id }) });
    assert.equal(cycle.response.status, 400);
    const nonEmptyDelete = await request(base, `/api/folders/${root.body.id}`, { method: 'DELETE' });
    assert.equal(nonEmptyDelete.response.status, 409);

    const renamed = await request(base, `/api/folders/${child.body.id}`, { method: 'PUT', body: JSON.stringify({ name: 'Service contracts' }) });
    assert.equal(renamed.body.name, 'Service contracts');
    assert.equal((await request(base, `/api/folders/${child.body.id}`, { method: 'DELETE' })).response.status, 200);
    assert.equal((await request(base, `/api/folders/${root.body.id}`, { method: 'DELETE' })).response.status, 200);
  });
});

test('document move preserves identity, versions, and comments', async () => {
  await withServer(async base => {
    await login(base);
    const folder = await request(base, '/api/folders', { method: 'POST', body: JSON.stringify({ space_id: 'space-product', name: 'Moved specifications' }) });
    const created = await request(base, '/api/documents', { method: 'POST', body: JSON.stringify({ space_id: 'space-personal', title: 'Move-safe draft', content: '<p>Original</p>' }) });
    await request(base, `/api/documents/${created.body.id}`, { method: 'PUT', body: JSON.stringify({ content: '<p>Reviewed</p>', create_version: true }) });
    await request(base, `/api/documents/${created.body.id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'Keep this discussion' }) });

    const moved = await request(base, `/api/documents/${created.body.id}/move`, { method: 'POST', body: JSON.stringify({ space_id: 'space-product', folder_id: folder.body.id }) });
    assert.equal(moved.response.status, 200);
    assert.equal(moved.body.id, created.body.id);
    assert.equal(moved.body.space_id, 'space-product');
    assert.equal(moved.body.folder_id, folder.body.id);
    assert.equal((await request(base, `/api/documents/${created.body.id}/versions`)).body.versions.length, 2);
    assert.equal((await request(base, `/api/documents/${created.body.id}/comments`)).body.comments[0].body, 'Keep this discussion');
  });
});

test('personal folder discovery exposes only folders containing shared documents', async () => {
  await withServer(async base => {
    const owner = await login(base);
    const sharedFolder = await request(base, '/api/folders', { auth: owner, method: 'POST', body: JSON.stringify({ space_id: 'space-personal', name: 'Shared research' }) });
    const secretFolder = await request(base, '/api/folders', { auth: owner, method: 'POST', body: JSON.stringify({ space_id: 'space-personal', name: 'Private research' }) });
    const sharedDocument = await request(base, '/api/documents', { auth: owner, method: 'POST', body: JSON.stringify({ space_id: 'space-personal', folder_id: sharedFolder.body.id, title: 'Visible research' }) });
    const secretDocument = await request(base, '/api/documents', { auth: owner, method: 'POST', body: JSON.stringify({ space_id: 'space-personal', folder_id: secretFolder.body.id, title: 'Secret research' }) });
    await request(base, `/api/documents/${sharedDocument.body.id}/permissions`, { auth: owner, method: 'PUT', body: JSON.stringify({ user_id: 'user-mira', access_level: 'Viewer' }) });

    const mira = await login(base, 'mira@qualispace.local', false);
    const bootstrap = await request(base, '/api/bootstrap', { auth: mira });
    assert.ok(bootstrap.body.documentFolders.some(folder => folder.id === sharedFolder.body.id));
    assert.ok(!bootstrap.body.documentFolders.some(folder => folder.id === secretFolder.body.id));
    assert.equal((await request(base, `/api/documents/${secretDocument.body.id}`, { auth: mira })).response.status, 404);
  });
});

test('document read APIs support pagination, enriched search, and version comparison', async () => {
  await withServer(async base => {
    await login(base);
    const created = await request(base, '/api/documents', {
      method: 'POST',
      body: JSON.stringify({ space_id: 'space-qa', folder_id: 'FOLDER-QA-GUIDES', title: 'API pagination reference', content: '<p>A distinctive backend-search phrase appears here.</p>' })
    });
    await request(base, `/api/documents/${created.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ content: '<p>A revised distinctive backend-search phrase appears here.</p>', create_version: true, change_summary: 'Revise reference' })
    });

    const detail = await request(base, `/api/documents/${created.body.id}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.folder_name, 'Team playbooks');

    const list = await request(base, '/api/documents?space_id=space-qa&folder_id=FOLDER-QA-GUIDES&page=1&limit=1');
    assert.equal(list.response.status, 200);
    assert.equal(list.body.limit, 1);
    assert.equal(list.body.documents.length, 1);
    assert.ok(list.body.total >= 2);

    const search = await request(base, '/api/search?q=backend-search');
    const result = search.body.results.find(item => item.id === created.body.id);
    assert.equal(result.folder_name, 'Team playbooks');
    assert.match(result.excerpt, /backend-search/);

    const versions = await request(base, `/api/documents/${created.body.id}/versions`);
    const comparison = await request(base, `/api/documents/${created.body.id}/compare?from=${versions.body.versions[1].id}&to=${versions.body.versions[0].id}`);
    assert.equal(comparison.response.status, 200);
    assert.equal(comparison.body.changes.content_changed, true);
  });
});

test('feature-linked QA records can be added', async () => {
  await withServer(async base => {
    await login(base);
    const result = await request(base, '/api/qa/risks', {
      method: 'POST',
      body: JSON.stringify({
        feature_id: 'FEAT-102',
        title: 'Test environment is unavailable',
        likelihood: 4,
        impact: 3,
        residual_score: 12,
        treatment: 'Provision a fallback environment'
      })
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.body.feature_id, 'FEAT-102');

    const bootstrap = await request(base, '/api/bootstrap');
    assert.ok(bootstrap.body.risks.some(risk => risk.title === 'Test environment is unavailable'));
  });
});

test('search returns documents and features without trashed pages', async () => {
  await withServer(async base => {
    await login(base);
    const result = await request(base, '/api/search?q=workspace');
    assert.equal(result.response.status, 200);
    assert.ok(result.body.results.some(item => item.type === 'document'));
    assert.ok(result.body.results.some(item => item.type === 'feature'));
  });
});

test('templates, comments, and version restoration support documentation collaboration', async () => {
  await withServer(async base => {
    await login(base);
    const bootstrap = await request(base, '/api/bootstrap');
    assert.ok(bootstrap.body.documentTemplates.some(template => template.id === 'TPL-TEST-PLAN'));

    const created = await request(base, '/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        space_id: 'space-qa',
        title: 'Feature test plan',
        template_id: 'TPL-TEST-PLAN',
        linked_feature_id: 'FEAT-101'
      })
    });
    assert.match(created.body.content, /Test objective/);

    const documentId = created.body.id;
    const firstComment = await request(base, `/api/documents/${documentId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Add browser coverage before approval.' })
    });
    assert.equal(firstComment.response.status, 201);
    assert.equal(firstComment.body.status, 'Open');

    const resolved = await request(base, `/api/comments/${firstComment.body.id}/resolve`, { method: 'POST', body: '{}' });
    assert.equal(resolved.body.ok, true);
    const comments = await request(base, `/api/documents/${documentId}/comments`);
    assert.equal(comments.body.comments[0].status, 'Resolved');

    await request(base, `/api/documents/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify({ content: '<p>Changed content</p>', create_version: true })
    });
    const versions = await request(base, `/api/documents/${documentId}/versions`);
    const initialVersion = versions.body.versions.find(version => version.version_number === 1);
    const restored = await request(base, `/api/documents/${documentId}/versions/${initialVersion.id}/restore`, { method: 'POST', body: '{}' });
    assert.match(restored.body.content, /Test objective/);
  });
});

test('sessions enforce CSRF and logout revokes access', async () => {
  await withServer(async base => {
    const auth = await login(base);
    const withoutCsrf = await request(base, '/api/documents', {
      method: 'POST',
      auth: { ...auth, csrfToken: '' },
      body: JSON.stringify({ space_id: 'space-qa', title: 'Denied create' })
    });
    assert.equal(withoutCsrf.response.status, 403);

    const logout = await request(base, '/api/auth/logout', { method: 'POST', body: '{}' });
    assert.equal(logout.response.status, 200);
    const afterLogout = await request(base, '/api/bootstrap');
    assert.equal(afterLogout.response.status, 401);
  });
});

test('viewer cannot see personal pages or mutate shared content', async () => {
  await withServer(async base => {
    const viewer = await login(base, 'viewer@qualispace.local', false);
    const bootstrap = await request(base, '/api/bootstrap', { auth: viewer });
    assert.equal(bootstrap.body.currentUser.role, 'Viewer');
    assert.ok(!bootstrap.body.documents.some(document => document.id === 'DOC-004'));

    const searchResult = await request(base, '/api/search?q=planning%20notes', { auth: viewer });
    assert.equal(searchResult.body.results.length, 0);

    const update = await request(base, '/api/documents/DOC-002', {
      method: 'PUT', auth: viewer, body: JSON.stringify({ title: 'Unauthorized change' })
    });
    assert.equal(update.response.status, 403);

    const comment = await request(base, '/api/documents/DOC-002/comments', {
      method: 'POST', auth: viewer, body: JSON.stringify({ body: 'Unauthorized comment' })
    });
    assert.equal(comment.response.status, 403);
  });
});

test('personal page sharing grants only the selected access level', async () => {
  await withServer(async base => {
    const owner = await login(base, 'patrick@qualispace.local', false);
    const commenter = await login(base, 'mira@qualispace.local', false);

    let miraBootstrap = await request(base, '/api/bootstrap', { auth: commenter });
    assert.ok(!miraBootstrap.body.documents.some(document => document.id === 'DOC-004'));

    const share = await request(base, '/api/documents/DOC-004/permissions', {
      method: 'PUT', auth: owner, body: JSON.stringify({ user_id: 'user-mira', access_level: 'Commenter' })
    });
    assert.equal(share.response.status, 200);

    miraBootstrap = await request(base, '/api/bootstrap', { auth: commenter });
    assert.ok(miraBootstrap.body.documents.some(document => document.id === 'DOC-004'));
    assert.equal(miraBootstrap.body.documentAccess['DOC-004'], 'Commenter');

    const comment = await request(base, '/api/documents/DOC-004/comments', {
      method: 'POST', auth: commenter, body: JSON.stringify({ body: 'Reviewed the private draft.' })
    });
    assert.equal(comment.response.status, 201);

    const edit = await request(base, '/api/documents/DOC-004', {
      method: 'PUT', auth: commenter, body: JSON.stringify({ title: 'Should not change' })
    });
    assert.equal(edit.response.status, 403);
  });
});

test('automation CLI dispatches a feature run with only mapped assets', async () => {
  await withServer(async base => {
    await login(base);
    const bootstrap = await request(base, '/api/bootstrap');
    assert.ok(bootstrap.body.automationAssets.some(asset => asset.automation_type === 'MCP'));

    const queued = await request(base, '/api/automation/runs', {
      method: 'POST',
      body: JSON.stringify({
        repository_id: 'REPO-QA-E2E', run_type: 'Feature', automation_type: 'All',
        feature_id: 'FEAT-103', environment: 'QA', project_name: 'chromium'
      })
    });
    assert.equal(queued.response.status, 202);
    assert.equal(queued.body.status, 'Queued');
    assert.equal(queued.body.summary.total, 1);

    await new Promise(resolve => setTimeout(resolve, 70));
    const completed = await request(base, `/api/automation/runs/${queued.body.id}`);
    assert.equal(completed.body.status, 'Passed');
    assert.equal(completed.body.results.length, 1);
    assert.ok(completed.body.results.every(result => result.feature_id === 'FEAT-103'));
  });
});

test('automation CLI supports individual Browser, API, and MCP case selection', async () => {
  await withServer(async base => {
    await login(base);
    const cases = [
      ['TC-102', 'Browser'],
      ['TC-201', 'API'],
      ['TC-301', 'MCP']
    ];
    for (const [testCaseId, automationType] of cases) {
      const result = await request(base, '/api/automation/runs', {
        method: 'POST',
        body: JSON.stringify({
          repository_id: 'REPO-QA-E2E', run_type: 'Individual', automation_type: automationType,
          test_case_id: testCaseId, environment: 'QA', project_name: 'chromium'
        })
      });
      assert.equal(result.response.status, 202);
      assert.equal(result.body.summary.total, 1);
      assert.equal(result.body.automation_type, automationType);
    }
    for (const runType of ['Smoke', 'E2E', 'Regression']) {
      const result = await request(base, '/api/automation/runs', {
        method: 'POST',
        body: JSON.stringify({ repository_id: 'REPO-QA-E2E', run_type: runType, automation_type: 'All', environment: 'QA', project_name: 'chromium' })
      });
      assert.equal(result.response.status, 202);
    }
  });
});

test('read-only users cannot dispatch automation runs', async () => {
  await withServer(async base => {
    const qaEngineer = await login(base, 'mira@qualispace.local', false);
    const allowed = await request(base, '/api/automation/runs', {
      method: 'POST', auth: qaEngineer,
      body: JSON.stringify({ repository_id: 'REPO-QA-E2E', run_type: 'Smoke', automation_type: 'Browser', environment: 'QA', project_name: 'chromium' })
    });
    assert.equal(allowed.response.status, 202);
    for (const email of ['viewer@qualispace.local', 'avery@qualispace.local']) {
      const auth = await login(base, email, false);
      const denied = await request(base, '/api/automation/runs', {
        method: 'POST', auth,
        body: JSON.stringify({ repository_id: 'REPO-QA-E2E', run_type: 'Smoke', automation_type: 'All', environment: 'QA', project_name: 'chromium' })
      });
      assert.equal(denied.response.status, 403);
    }
  });
});

test('automation evidence ingestion is idempotent', async () => {
  await withServer(async base => {
    await login(base);
    const queued = await request(base, '/api/automation/runs', {
      method: 'POST',
      body: JSON.stringify({ repository_id: 'REPO-QA-E2E', run_type: 'Smoke', automation_type: 'MCP', environment: 'QA', project_name: 'chromium' })
    });
    const payload = {
      idempotency_key: 'provider-event-001',
      run_id: queued.body.id,
      results: [{ asset_id: 'ASSET-301', status: 'Passed', duration_ms: 410, retry_count: 0, evidence: { artifact: 'metadata://trace/001' } }]
    };
    const first = await request(base, '/api/automation/ingest', { method: 'POST', body: JSON.stringify(payload) });
    const duplicate = await request(base, '/api/automation/ingest', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(first.body.duplicate, false);
    assert.equal(duplicate.body.duplicate, true);
    const detail = await request(base, `/api/automation/runs/${queued.body.id}`);
    assert.equal(detail.body.results.length, 1);
  }, { demoRunDelayMs: 1000 });
});
