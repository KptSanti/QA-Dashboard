const state = {
  data: null,
  auth: null,
  saveTimer: null,
  searchTimer: null,
  automationPollTimer: null,
  activeFeatureTab: 'overview'
};

const main = document.querySelector('#main-content');
const sidebar = document.querySelector('#sidebar-nav');
const createDialog = document.querySelector('#create-dialog');
const recordDialog = document.querySelector('#record-dialog');
const shareDialog = document.querySelector('#share-dialog');
const runDialog = document.querySelector('#run-dialog');

const icons = {
  home: '⌂', recent: '◷', starred: '☆', personal: '♙', page: '▤', product: '◆', release: '◇',
  tests: '✓', risk: '△', coverage: '▦', readiness: '◉', defect: '!', metrics: '↗', automation: '⚡', runs: '▶', capacity: '♟', trash: '♲'
};

async function api(url, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && state.auth?.session?.csrfToken ? { 'X-CSRF-Token': state.auth.session.csrfToken } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

function canEditDocument(documentId) {
  return ['Owner', 'Editor'].includes(state.data?.documentAccess?.[documentId]);
}

function canCommentDocument(documentId) {
  return ['Owner', 'Editor', 'Commenter'].includes(state.data?.documentAccess?.[documentId]);
}

function canCreateContent() {
  return ['Organization Admin', 'Workspace Admin', 'Senior QA', 'QA Engineer', 'Automation/QA Engineer', 'Contributor'].includes(state.data?.currentUser?.role);
}

function canManageQa() {
  return ['Organization Admin', 'Workspace Admin', 'Senior QA', 'QA Engineer', 'Automation/QA Engineer'].includes(state.data?.currentUser?.role);
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sanitizeHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  const allowed = new Set(['P', 'BR', 'H2', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'A', 'HR']);
  for (const element of [...template.content.querySelectorAll('*')]) {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (element.tagName !== 'A' || attribute.name !== 'href') element.removeAttribute(attribute.name);
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') || '';
      if (!/^(https?:|mailto:|#\/)/i.test(href)) element.removeAttribute('href');
    }
  }
  return template.innerHTML;
}

function slug(value) {
  return String(value || '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function status(value) {
  return `<span class="status ${slug(value)}">${esc(value)}</span>`;
}

function formatDate(value, withTime = false) {
  if (!value) return 'Not set';
  const options = withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return new Intl.DateTimeFormat('en', options).format(new Date(value));
}

function featureTitle(featureId) {
  return state.data.features.find(item => item.id === featureId)?.title || featureId || 'Unlinked';
}

function documentTitle(documentId) {
  return state.data.documents.find(item => item.id === documentId)?.title || documentId || 'Top level';
}

function toast(message) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  document.querySelector('#toast-region').append(item);
  setTimeout(() => item.remove(), 3200);
}

function navigate(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

function routeButton(label, route, icon, active = false, className = 'sidebar-link') {
  return `<button class="${className}${active ? ' active' : ''}" data-route="${route}"><span class="nav-icon">${icon}</span><span class="tree-title">${esc(label)}</span></button>`;
}

function buildDocumentTree(documents, parentId = null, depth = 0) {
  return documents
    .filter(doc => (doc.parent_id || null) === parentId)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(doc => `${routeButton(doc.title, `#/document/${doc.id}`, '<span class="page-glyph">▤</span>', location.hash === `#/document/${doc.id}`, 'tree-link').replace('class="tree-link', `class="tree-link depth-${Math.min(depth, 5)}`)}${buildDocumentTree(documents, doc.id, depth + 1)}`)
    .join('');
}

function renderSidebar() {
  const { spaces, documents } = state.data;
  const active = location.hash || '#/home';
  const personal = spaces.find(space => space.type === 'personal');
  const sharedSpaces = spaces.filter(space => space.type !== 'personal');
  const personalDocs = documents.filter(doc => doc.space_id === personal?.id && !doc.is_trashed);
  sidebar.innerHTML = `
    ${routeButton('Home', '#/home', icons.home, active === '#/home')}
    ${routeButton('Recent', '#/recent', icons.recent, active === '#/recent')}
    ${routeButton('Starred', '#/starred', icons.starred, active === '#/starred')}
    ${personal ? `<div class="nav-heading"><span>Personal</span>${personal.owner_name === state.data.currentUser.name ? `<button data-new-page="${personal.id}" title="New personal page">+</button>` : ''}</div>
    ${routeButton(personal.name, '#/personal', icons.personal, active === '#/personal')}
    ${buildDocumentTree(personalDocs)}` : ''}
    <div class="nav-heading"><span>Workspace</span>${canCreateContent() ? '<button data-create-document title="Create page">+</button>' : ''}</div>
    ${sharedSpaces.map(space => {
      const docs = documents.filter(doc => doc.space_id === space.id && !doc.is_trashed);
      return `${routeButton(space.name, `#/space/${space.id}`, space.type === 'release' ? icons.release : space.type === 'product' ? icons.product : icons.page, active === `#/space/${space.id}`)}${buildDocumentTree(docs)}`;
    }).join('')}
    <div class="nav-heading"><span>QA operations</span></div>
    ${routeButton('Test cases', '#/qa/tests', icons.tests, active === '#/qa/tests')}
    ${routeButton('Risk Register', '#/qa/risks', icons.risk, active === '#/qa/risks')}
    ${routeButton('Coverage Matrix', '#/qa/coverage', icons.coverage, active === '#/qa/coverage')}
    ${routeButton('Release Readiness', '#/qa/readiness', icons.readiness, active === '#/qa/readiness')}
    ${routeButton('Defect Log', '#/qa/defects', icons.defect, active === '#/qa/defects')}
    ${routeButton('Metrics', '#/qa/metrics', icons.metrics, active === '#/qa/metrics')}
    ${routeButton('Automation Backlog', '#/qa/automation', icons.automation, active === '#/qa/automation')}
    ${routeButton('Automation CLI', '#/qa/runs', icons.runs, active === '#/qa/runs')}
    ${routeButton('Team Capacity', '#/qa/capacity', icons.capacity, active === '#/qa/capacity')}
  `;
}

function breadcrumb(items) {
  return `<div class="breadcrumb">${items.map((item, index) => `${index ? '<span>/</span>' : ''}${item.route ? `<button data-route="${item.route}">${esc(item.label)}</button>` : `<span>${esc(item.label)}</span>`}`).join('')}</div>`;
}

function pageHeader(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-header"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}</div><div class="page-actions">${actions}</div></div>`;
}

function calculateCoverage(featureId) {
  const requirements = state.data.requirements.filter(item => !featureId || item.feature_id === featureId);
  if (!requirements.length) return 0;
  const covered = requirements.filter(requirement => state.data.testCases.some(test => test.requirement_id === requirement.id && test.status === 'Approved')).length;
  return Math.round((covered / requirements.length) * 100);
}

function homeView() {
  const { features, risks, defects, testCases, activity } = state.data;
  const openRisks = risks.filter(item => item.status !== 'Closed').length;
  const openDefects = defects.filter(item => !['Closed', 'Resolved'].includes(item.status)).length;
  const automationCoverage = Math.round(testCases.filter(item => item.automation_status === 'Automated').length / Math.max(1, testCases.length) * 100);
  const criticalCoverage = calculateCoverage();
  return `<div class="page-shell"><div class="page-content wide">
    ${pageHeader('Workspace overview', 'Quality operations', 'One source of truth for feature readiness, QA evidence, automation, and team capacity.', `<button class="secondary-button" data-route="#/qa/readiness">Review release</button>${canCreateContent() ? '<button class="primary-button" data-create-document>Create page</button>' : ''}`)}
    <div class="summary-strip">
      <div class="summary-item"><strong>${features.length}</strong><span>Active features</span></div>
      <div class="summary-item"><strong>${criticalCoverage}%</strong><span>Requirement coverage</span></div>
      <div class="summary-item"><strong>${openRisks}</strong><span>Open risks</span></div>
      <div class="summary-item"><strong>${openDefects}</strong><span>Open defects</span></div>
      <div class="summary-item"><strong>${automationCoverage}%</strong><span>Automation coverage</span></div>
    </div>
    <div class="content-grid">
      <div>
        <section class="section">
          <div class="section-header"><h2>Feature quality</h2><button class="section-link" data-route="#/space/space-product">View product space</button></div>
          <div class="feature-list">
            ${features.map(feature => `<button class="feature-row" data-route="#/feature/${feature.id}">
              <span><span class="feature-id">${esc(feature.id)} · ${esc(feature.release_name)}</span><span class="feature-title">${esc(feature.title)}</span></span>
              <span>${status(feature.status)}</span><span>${status(feature.readiness)}</span><span>${esc(feature.qa_owner)}</span>
            </button>`).join('')}
          </div>
        </section>
        <section class="section">
          <div class="section-header"><h2>Needs attention</h2></div>
          <div class="data-table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Feature</th><th>State</th><th>Owner</th></tr></thead><tbody>
            ${risks.filter(item => item.residual_score >= 8).map(item => `<tr><td><button class="row-link" data-route="#/qa/risks">${esc(item.id)} · ${esc(item.title)}</button></td><td>${esc(item.feature_id)}</td><td>${status(item.status)}</td><td>${esc(item.owner_name)}</td></tr>`).join('')}
            ${defects.filter(item => item.severity === 'Critical').map(item => `<tr><td><button class="row-link" data-route="#/qa/defects">${esc(item.id)} · ${esc(item.title)}</button></td><td>${esc(item.feature_id)}</td><td>${status(item.status)}</td><td>${esc(item.owner_name)}</td></tr>`).join('')}
          </tbody></table></div>
        </section>
      </div>
      <aside>
        <section class="panel">
          <div class="panel-header">Recent activity</div>
          <div class="panel-body"><ul class="activity-list">${activity.slice(0, 6).map(item => `<li><strong>${esc(item.actor_name)}</strong> ${esc(item.action)} <strong>${esc(item.entity_id)}</strong><time>${formatDate(item.created_at, true)}</time></li>`).join('')}</ul></div>
        </section>
        <section class="section panel">
          <div class="panel-header">QA cadence</div>
          <div class="panel-body"><p><strong>Today</strong><br><span class="subtitle">Async team update</span></p><p><strong>Next QA sync</strong><br><span class="subtitle">Every two weeks</span></p><p><strong>Release review</strong><br><span class="subtitle">2026.09 · At risk</span></p></div>
        </section>
      </aside>
    </div>
  </div></div>`;
}

function spaceView(spaceId, personal = false) {
  const space = personal ? state.data.spaces.find(item => item.type === 'personal') : state.data.spaces.find(item => item.id === spaceId);
  if (!space) return notFoundView();
  const documents = state.data.documents.filter(doc => doc.space_id === space.id && !doc.is_trashed);
  const topLevel = documents.filter(doc => !doc.parent_id);
  return `<div class="page-shell"><div class="page-content">
    ${breadcrumb([{ label: state.data.workspace.name, route: '#/home' }, { label: space.name }])}
    ${pageHeader(space.type === 'personal' ? 'Private by default' : `${space.type} space`, space.name, space.type === 'personal' ? 'Draft privately, share selectively, and publish approved knowledge to a workspace.' : 'Create structured documentation and connect approved pages to feature evidence.', canCreateContent() && (space.type !== 'personal' || space.owner_name === state.data.currentUser.name) ? `<button class="primary-button" data-new-page="${space.id}">Create page</button>` : '')}
    ${space.type === 'personal' ? '<div class="callout"><span>i</span><div><strong>Your personal space is private.</strong><br>Pages remain visible only to you until you share or publish them.</div></div>' : ''}
    <section class="section">
      <div class="section-header"><h2>Pages</h2><span class="subtitle">${documents.length} page${documents.length === 1 ? '' : 's'}</span></div>
      ${topLevel.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>Title</th><th>Status</th><th>Feature</th><th>Owner</th><th>Updated</th></tr></thead><tbody>${topLevel.map(doc => documentRow(doc, documents)).join('')}</tbody></table></div>` : emptyState('No pages yet', canCreateContent() ? 'Create the first page in this space.' : 'No pages are available to your role.', canCreateContent() ? `<button class="primary-button" data-new-page="${space.id}">Create page</button>` : '')}
    </section>
  </div></div>`;
}

function documentRow(doc, allDocs, depth = 0) {
  const children = allDocs.filter(item => item.parent_id === doc.id).sort((a, b) => a.title.localeCompare(b.title));
  return `<tr><td><button class="row-link indent-${Math.min(depth, 5)}" data-route="#/document/${doc.id}">${depth ? '↳ ' : ''}${esc(doc.title)}</button></td><td>${status(doc.status)}</td><td>${doc.linked_feature_id ? `<button class="row-link" data-route="#/feature/${doc.linked_feature_id}">${esc(doc.linked_feature_id)}</button>` : '<span class="subtitle">Not linked</span>'}</td><td>${esc(doc.owner_name)}</td><td>${formatDate(doc.updated_at)}</td></tr>${children.map(child => documentRow(child, allDocs, depth + 1)).join('')}`;
}

function emptyState(title, body, action = '') {
  return `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;
}

async function documentView(documentId) {
  const doc = state.data.documents.find(item => item.id === documentId);
  if (!doc || doc.is_trashed) return setMain(notFoundView());
  const mayEdit = canEditDocument(doc.id);
  const mayComment = canCommentDocument(doc.id);
  const space = state.data.spaces.find(item => item.id === doc.space_id);
  const [versions, comments] = await Promise.all([
    api(`/api/documents/${doc.id}/versions`),
    api(`/api/documents/${doc.id}/comments`)
  ]);
  setMain(`<div class="document-layout">
    <article class="document-canvas"><div class="document-inner">
      <div class="doc-topline">
        ${breadcrumb([{ label: space.name, route: space.type === 'personal' ? '#/personal' : `#/space/${space.id}` }, ...(doc.parent_id ? [{ label: documentTitle(doc.parent_id), route: `#/document/${doc.parent_id}` }] : []), { label: doc.title }])}
        <div class="page-actions"><span id="save-state" class="save-state">${mayEdit ? 'Saved' : 'Read only'} ${formatDate(doc.updated_at, true)}</span>${mayEdit ? '<button id="share-document" class="secondary-button">Share</button><button id="save-version" class="secondary-button">Save version</button><button id="delete-document" class="quiet-button">•••</button>' : ''}</div>
      </div>
      ${!mayEdit ? '<div class="callout read-only-banner"><span>i</span><div><strong>Read-only access</strong><br>Your current role can view this page but cannot change its content or properties.</div></div>' : ''}
      <input id="document-title" class="document-title" value="${esc(doc.title)}" aria-label="Document title"${mayEdit ? '' : ' readonly'}>
      ${mayEdit ? `<div class="editor-toolbar" aria-label="Formatting toolbar">
        <button class="toolbar-button" data-command="bold" title="Bold"><strong>B</strong></button>
        <button class="toolbar-button" data-command="italic" title="Italic"><em>I</em></button>
        <button class="toolbar-button" data-command="underline" title="Underline"><u>U</u></button>
        <span class="toolbar-separator"></span>
        <button class="toolbar-button" data-block="h2">H2</button>
        <button class="toolbar-button" data-block="h3">H3</button>
        <button class="toolbar-button" data-block="p">Text</button>
        <span class="toolbar-separator"></span>
        <button class="toolbar-button" data-command="insertUnorderedList" title="Bulleted list">• List</button>
        <button class="toolbar-button" data-command="insertOrderedList" title="Numbered list">1. List</button>
        <button class="toolbar-button" data-command="formatBlock" data-value="blockquote" title="Callout">Quote</button>
        <button class="toolbar-button" id="add-link" title="Add link">Link</button>
      </div>` : ''}
      <div id="document-editor" class="editor" contenteditable="${mayEdit ? 'true' : 'false'}" role="textbox" aria-multiline="true">${sanitizeHtml(doc.content)}</div>
    </div></article>
    <aside class="document-aside">
      <section class="aside-section"><h3 class="aside-heading">Page details</h3><div class="property-list">
        <label>Status<select id="doc-status"${mayEdit ? '' : ' disabled'}>${['Draft','In Review','Approved','Published','Archived'].map(item => `<option${doc.status === item ? ' selected' : ''}>${item}</option>`).join('')}</select></label>
        <label>Space<select id="doc-space"${mayEdit ? '' : ' disabled'}>${state.data.spaces.map(item => `<option value="${item.id}"${doc.space_id === item.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
        <label>Parent page<select id="doc-parent"${mayEdit ? '' : ' disabled'}><option value="">No parent page</option>${state.data.documents.filter(item => item.id !== doc.id && !item.is_trashed).map(item => `<option value="${item.id}"${doc.parent_id === item.id ? ' selected' : ''}>${esc(item.title)}</option>`).join('')}</select></label>
        <label>Linked feature<select id="doc-feature"${mayEdit ? '' : ' disabled'}><option value="">No feature link</option>${state.data.features.map(item => `<option value="${item.id}"${doc.linked_feature_id === item.id ? ' selected' : ''}>${esc(item.id)} · ${esc(item.title)}</option>`).join('')}</select></label>
        <label>Owner<span class="meta-value">${esc(doc.owner_name)}</span></label>
      </div></section>
      <section class="aside-section"><h3 class="aside-heading">Version history</h3><div>${versions.versions.slice(0, 8).map(version => `<button class="version-item"${mayEdit ? ` data-restore-version="${version.id}" data-version-number="${version.version_number}" title="Restore this version"` : ' disabled'}><strong>Version ${version.version_number} · ${esc(version.author_name)}</strong><span>${formatDate(version.created_at, true)} · ${esc(version.change_summary)}</span></button>`).join('')}</div></section>
      <section class="aside-section"><h3 class="aside-heading">Comments</h3>
        <div class="comment-list">${comments.comments.length ? comments.comments.map(comment => `<article class="comment-item ${slug(comment.status)}"><div class="comment-head"><span><strong>${esc(comment.author_name)}</strong><br><span class="comment-meta">${formatDate(comment.created_at, true)} · ${esc(comment.status)}</span></span>${comment.status === 'Open' && mayComment ? `<button class="comment-action" data-resolve-comment="${comment.id}">Resolve</button>` : ''}</div><p>${esc(comment.body)}</p></article>`).join('') : '<p class="subtitle">No comments yet.</p>'}</div>
        ${mayComment ? '<form id="comment-form" class="comment-form"><textarea name="body" maxlength="1000" required placeholder="Add a page comment"></textarea><button class="secondary-button" type="submit">Comment</button></form>' : '<p class="subtitle">Your role cannot add comments.</p>'}
      </section>
    </aside>
  </div>`);
  bindDocumentEditor(doc, mayEdit, mayComment);
}

function bindDocumentEditor(doc, mayEdit, mayComment) {
  if (!mayEdit) {
    if (mayComment) bindCommentActions(doc);
    return;
  }
  const editor = document.querySelector('#document-editor');
  const title = document.querySelector('#document-title');
  const saveState = document.querySelector('#save-state');
  const scheduleSave = () => {
    saveState.textContent = 'Saving...';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveCurrentDocument(doc, false), 900);
  };
  editor.addEventListener('input', scheduleSave);
  title.addEventListener('input', scheduleSave);
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
    document.execCommand(button.dataset.command, false, button.dataset.value || null);
    editor.focus();
    scheduleSave();
  }));
  document.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => {
    document.execCommand('formatBlock', false, button.dataset.block);
    editor.focus();
    scheduleSave();
  }));
  document.querySelector('#add-link').addEventListener('click', () => {
    const href = prompt('Paste a web or workspace link');
    if (href) document.execCommand('createLink', false, href);
    editor.focus();
    scheduleSave();
  });
  ['doc-status','doc-space','doc-parent','doc-feature'].forEach(id => document.querySelector(`#${id}`).addEventListener('change', () => saveCurrentDocument(doc, true)));
  document.querySelector('#save-version').addEventListener('click', () => saveCurrentDocument(doc, true));
  document.querySelector('#share-document').addEventListener('click', () => openShareDialog(doc));
  document.querySelectorAll('[data-restore-version]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm(`Restore version ${button.dataset.versionNumber}? Your current page remains in history.`)) return;
    await api(`/api/documents/${doc.id}/versions/${button.dataset.restoreVersion}/restore`, { method: 'POST', body: '{}' });
    toast(`Version ${button.dataset.versionNumber} restored`);
    await reloadData(false);
    await documentView(doc.id);
  }));
  bindCommentActions(doc);
  document.querySelector('#delete-document').addEventListener('click', async () => {
    if (!confirm(`Move "${doc.title}" and any child pages to Trash?`)) return;
    await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
    toast('Page moved to Trash');
    await reloadData();
    navigate(doc.space_id === 'space-personal' ? '#/personal' : `#/space/${doc.space_id}`);
  });
}

function bindCommentActions(doc) {
  document.querySelectorAll('[data-resolve-comment]').forEach(button => button.addEventListener('click', async () => {
    await api(`/api/comments/${button.dataset.resolveComment}/resolve`, { method: 'POST', body: '{}' });
    toast('Comment resolved');
    await documentView(doc.id);
  }));
  document.querySelector('#comment-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api(`/api/documents/${doc.id}/comments`, { method: 'POST', body: JSON.stringify({ body: form.get('body') }) });
    toast('Comment added');
    await reloadData(false);
    await documentView(doc.id);
  });
}

async function saveCurrentDocument(doc, createVersion) {
  clearTimeout(state.saveTimer);
  const body = {
    title: document.querySelector('#document-title').value,
    content: sanitizeHtml(document.querySelector('#document-editor').innerHTML),
    status: document.querySelector('#doc-status').value,
    space_id: document.querySelector('#doc-space').value,
    parent_id: document.querySelector('#doc-parent').value || null,
    linked_feature_id: document.querySelector('#doc-feature').value || null,
    create_version: createVersion,
    change_summary: createVersion ? 'Saved page version' : 'Autosaved changes'
  };
  try {
    const updated = await api(`/api/documents/${doc.id}`, { method: 'PUT', body: JSON.stringify(body) });
    Object.assign(doc, updated);
    const saveState = document.querySelector('#save-state');
    if (saveState) saveState.textContent = createVersion ? 'Version saved' : 'All changes saved';
    if (createVersion) toast('New page version saved');
    await reloadData(false);
  } catch (error) {
    const saveState = document.querySelector('#save-state');
    if (saveState) saveState.textContent = 'Could not save';
    toast(error.message);
  }
}

function featureView(featureId) {
  const feature = state.data.features.find(item => item.id === featureId);
  if (!feature) return notFoundView();
  const requirements = state.data.requirements.filter(item => item.feature_id === featureId);
  const tests = state.data.testCases.filter(item => item.feature_id === featureId);
  const risks = state.data.risks.filter(item => item.feature_id === featureId);
  const defects = state.data.defects.filter(item => item.feature_id === featureId);
  const automation = state.data.automation.filter(item => item.feature_id === featureId);
  const automationAssets = state.data.automationAssets.filter(item => item.feature_id === featureId);
  const automationRuns = state.data.automationRuns.filter(item => item.feature_id === featureId);
  const documents = state.data.documents.filter(item => item.linked_feature_id === featureId && !item.is_trashed);
  const coverage = calculateCoverage(featureId);
  const passed = tests.filter(item => item.latest_result === 'Passed').length;
  return `<div class="page-shell"><div class="page-content wide">
    ${breadcrumb([{ label: state.data.workspace.name, route: '#/home' }, { label: 'Features', route: '#/space/space-product' }, { label: feature.id }])}
    <div class="feature-hero"><p class="eyebrow">${esc(feature.id)} · ${esc(feature.release_name)}</p><h1>${esc(feature.title)}</h1><p class="subtitle">${esc(feature.description)}</p>
      <div class="feature-meta"><div class="meta-item"><span class="meta-label">Status</span>${status(feature.status)}</div><div class="meta-item"><span class="meta-label">Readiness</span>${status(feature.readiness)}</div><div class="meta-item"><span class="meta-label">Priority</span><span class="meta-value">${esc(feature.priority)}</span></div><div class="meta-item"><span class="meta-label">QA owner</span><span class="meta-value">${esc(feature.qa_owner)}</span></div><div class="meta-item"><span class="meta-label">Coverage</span><span class="meta-value">${coverage}%</span></div></div>
    </div>
    <div class="tabs">${['overview','requirements','tests','risks','defects','automation','activity'].map(tab => `<button class="tab${state.activeFeatureTab === tab ? ' active' : ''}" data-feature-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join('')}</div>
    <div id="feature-tab-content">${featureTabContent(state.activeFeatureTab, { feature, requirements, tests, risks, defects, automation, automationAssets, automationRuns, documents, coverage, passed })}</div>
  </div></div>`;
}

function featureTabContent(tab, data) {
  const { feature, requirements, tests, risks, defects, automation, automationAssets, automationRuns, documents, coverage, passed } = data;
  if (tab === 'overview') return `<div class="content-grid"><div>
    <section><div class="section-header"><h2>Quality summary</h2></div><div class="summary-strip four"><div class="summary-item"><strong>${coverage}%</strong><span>Requirements covered</span></div><div class="summary-item"><strong>${passed}/${tests.length}</strong><span>Tests passed</span></div><div class="summary-item"><strong>${risks.filter(item => item.status !== 'Closed').length}</strong><span>Open risks</span></div><div class="summary-item"><strong>${defects.filter(item => item.status !== 'Closed').length}</strong><span>Open defects</span></div></div></section>
    <section class="section"><div class="section-header"><h2>Linked documentation</h2>${canCreateContent() ? `<button class="section-link" data-create-document data-feature="${feature.id}">Create feature page</button>` : ''}</div>${documents.length ? `<div class="data-table-wrap"><table class="data-table"><tbody>${documents.map(doc => `<tr><td><button class="row-link" data-route="#/document/${doc.id}">${esc(doc.title)}</button></td><td>${status(doc.status)}</td><td>${formatDate(doc.updated_at)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No linked pages', 'Create a feature specification or test plan.')}</section>
  </div><aside><div class="panel"><div class="panel-header">Readiness signal</div><div class="panel-body"><p>${status(feature.readiness)}</p><div class="progress-track"><div class="progress-fill ${coverage < 70 ? 'warning' : 'success'} ${progressClass(coverage)}"></div></div><p class="subtitle">Coverage is ${coverage}%. ${defects.some(item => item.severity === 'Critical' && item.status !== 'Closed') ? 'A critical defect blocks readiness.' : 'No open critical defect is linked.'}</p></div></div></aside></div>`;
  if (tab === 'requirements') return table(['Requirement','Criticality','Coverage'], requirements.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, esc(item.criticality), status(item.status)]));
  if (tab === 'tests') return table(['Test case','Type','Priority','Approval','Automation','Latest result'], tests.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, esc(item.kind), esc(item.priority), status(item.status), status(item.automation_status), status(item.latest_result)]));
  if (tab === 'risks') return table(['Risk','Likelihood','Impact','Residual','Treatment','Status'], risks.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, item.likelihood, item.impact, `<strong>${item.residual_score}</strong>`, esc(item.treatment), status(item.status)]));
  if (tab === 'defects') return table(['Defect','Severity','Status','Owner','Environment'], defects.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, status(item.severity), status(item.status), esc(item.owner_name), esc(item.environment)]));
  if (tab === 'automation') return `<div class="section-header"><h2>Executable mappings</h2><button class="section-link" data-route="#/qa/runs">Open Automation CLI</button></div>${table(['Asset','Test case','Suite','Automation type','Path','Status'], automationAssets.map(item => [`<strong>${esc(item.external_test_id)}</strong><br>${esc(item.title)}`, esc(item.test_case_id), esc(item.suite_type), status(item.automation_type), `<code>${esc(item.file_path)}</code>`, status(item.status)]))}<section class="section"><div class="section-header"><h2>Feature run evidence</h2></div>${table(['Run','Scope','Automation type','Environment','Result','Requested'], automationRuns.map(run => [`<button class="row-link" data-route="#/qa/runs">${esc(run.id)}</button>`, esc(run.run_type), status(run.automation_type), esc(run.environment), status(run.status), formatDate(run.created_at, true)]))}</section><section class="section"><div class="section-header"><h2>Automation backlog</h2></div>${table(['Candidate','Value','Effort','Status','Owner','Repository'], automation.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, item.value_score, item.effort_score, status(item.status), esc(item.owner_name), esc(item.repository)]))}</section>`;
  return emptyState('Activity timeline', 'Feature-specific audit events will appear here as the team works.');
}

function table(headers, rows) {
  if (!rows.length) return emptyState('Nothing here yet', 'Add the first linked record to begin traceability.');
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const moduleMeta = {
  tests: ['Test Case Database', 'Versioned manual and automated test coverage connected to features.'],
  risks: ['Risk Register', 'Identify, score, treat, and monitor feature-level quality risks.'],
  coverage: ['Coverage Matrix', 'Trace requirements through approved cases to current execution evidence.'],
  readiness: ['Release Readiness', 'Make evidence-backed go/no-go decisions using explicit gates.'],
  defects: ['Defect Log', 'Track failures, fixes, retests, and escaped defects by feature.'],
  metrics: ['Quality Metrics', 'Operational quality signals without individual productivity scoring.'],
  automation: ['Automation Backlog', 'Prioritize manual scenarios for Playwright implementation.'],
  runs: ['Automation CLI', 'Run Browser, API, and MCP automation by smoke scope, feature, suite, or individual test case.'],
  capacity: ['Team Capacity', 'Balance QA demand, availability, and cross-pod support.']
};

function qaView(module) {
  const meta = moduleMeta[module] || moduleMeta.tests;
  const addKind = { tests: 'test-cases', risks: 'risks', defects: 'defects', automation: 'automation' }[module];
  return `<div class="page-shell"><div class="page-content wide">
    ${breadcrumb([{ label: state.data.workspace.name, route: '#/home' }, { label: 'QA Operations' }, { label: meta[0] }])}
    ${pageHeader('QA Operations', meta[0], meta[1], module === 'runs' && canManageQa() ? '<button class="primary-button" data-open-run-dialog>Run tests</button>' : addKind && canManageQa() ? `<button class="primary-button" data-add-record="${addKind}">Add ${module === 'tests' ? 'test case' : module === 'automation' ? 'candidate' : module.slice(0, -1)}</button>` : '')}
    ${qaModuleContent(module)}
  </div></div>`;
}

function qaModuleContent(module) {
  const d = state.data;
  if (module === 'tests') return table(['Test case','Feature','Type','Priority','Approval','Automation','Latest result','Owner'], d.testCases.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, `<button class="row-link" data-route="#/feature/${item.feature_id}">${esc(item.feature_id)}</button>`, esc(item.kind), esc(item.priority), status(item.status), status(item.automation_status), status(item.latest_result), esc(item.owner_name)]));
  if (module === 'risks') return table(['Risk','Feature','L','I','Residual','Treatment','Owner','Status','Due'], d.risks.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, `<button class="row-link" data-route="#/feature/${item.feature_id}">${esc(item.feature_id)}</button>`, item.likelihood, item.impact, `<strong>${item.residual_score}</strong>`, esc(item.treatment), esc(item.owner_name), status(item.status), formatDate(item.due_date)]));
  if (module === 'coverage') {
    const rows = d.requirements.map(requirement => {
      const tests = d.testCases.filter(test => test.requirement_id === requirement.id);
      return [`<strong>${esc(requirement.id)}</strong><br>${esc(requirement.title)}`, `<button class="row-link" data-route="#/feature/${requirement.feature_id}">${esc(requirement.feature_id)}</button>`, esc(requirement.criticality), tests.map(test => esc(test.id)).join(', ') || '<span class="status danger">Gap</span>', tests.some(test => test.status === 'Approved') ? status('Covered') : status('Gap'), tests.map(test => status(test.latest_result)).join(' ') || 'Not run'];
    });
    return `<div class="callout"><span>i</span><div><strong>Coverage is evidence-based.</strong><br>A requirement counts as covered only when it has an approved linked test case.</div></div><section class="section">${table(['Requirement','Feature','Criticality','Linked tests','Coverage','Latest result'], rows)}</section>`;
  }
  if (module === 'readiness') {
    const failed = d.releaseGates.filter(item => item.status === 'Failed').length;
    const atRisk = d.releaseGates.filter(item => item.status === 'At Risk').length;
    return `<div class="callout warning"><span>!</span><div><strong>Release 2026.09 is At Risk.</strong><br>${failed} failed gate and ${atRisk} gates need evidence. Senior QA approval is required for any override.</div></div><section class="section"><div class="gate-list">${d.releaseGates.map(gate => `<div class="gate-row"><span class="gate-mark ${slug(gate.status)}">${gate.status === 'Passed' ? '✓' : gate.status === 'Failed' ? '×' : '!'}</span><strong>${esc(gate.title)}</strong>${status(gate.status)}<span class="subtitle">${esc(gate.evidence)} · ${esc(gate.owner_name)}</span></div>`).join('')}</div></section>`;
  }
  if (module === 'defects') return table(['Defect','Feature','Test','Severity','Status','Owner','Environment','Updated'], d.defects.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, `<button class="row-link" data-route="#/feature/${item.feature_id}">${esc(item.feature_id)}</button>`, esc(item.test_case_id || 'Exploratory'), status(item.severity), status(item.status), esc(item.owner_name), esc(item.environment), formatDate(item.updated_at)]));
  if (module === 'automation') return `<div class="callout"><span>i</span><div><strong>Every approved manual case needs an automation disposition.</strong><br>Automate it, plan it, or record an approved exception.</div></div><section class="section">${table(['Candidate','Feature','Test','Value','Effort','Priority index','Status','Owner','Repository','Target'], d.automation.map(item => [`<strong>${esc(item.id)}</strong><br>${esc(item.title)}`, `<button class="row-link" data-route="#/feature/${item.feature_id}">${esc(item.feature_id)}</button>`, esc(item.test_case_id || 'Not linked'), item.value_score, item.effort_score, (item.value_score / Math.max(1, item.effort_score)).toFixed(1), status(item.status), esc(item.owner_name), esc(item.repository || 'Not set'), esc(item.target_milestone || 'Not set')]))}</section>`;
  if (module === 'runs') return automationRunsView();
  if (module === 'capacity') return capacityView();
  return metricsView();
}

function automationRunsView() {
  const d = state.data;
  const runRows = d.automationRuns.map(run => {
    const summary = run.summary || {};
    const scope = run.feature_id
      ? `<button class="row-link" data-route="#/feature/${run.feature_id}">${esc(run.feature_id)} · ${esc(featureTitle(run.feature_id))}</button>`
      : run.test_case_id ? `<strong>${esc(run.test_case_id)}</strong>` : 'All eligible mappings';
    const result = run.status === 'Queued' || run.status === 'Running'
      ? status(run.status)
      : `${status(run.status)}<br><span class="subtitle">${summary.passed || 0} passed · ${summary.failed || 0} failed</span>`;
    return [`<button class="row-link" data-inspect-run="${run.id}"><strong>${esc(run.id)}</strong></button><br><span class="subtitle">${formatDate(run.created_at, true)}</span>`, esc(run.run_type), status(run.automation_type), scope, esc(run.environment), esc(run.project_name), result, esc(run.requested_by_name), esc(run.repository_name)];
  });
  const assetRows = d.automationAssets.map(asset => [
    `<strong>${esc(asset.external_test_id)}</strong><br><span class="subtitle">${esc(asset.title)}</span>`,
    esc(asset.suite_type),
    status(asset.automation_type),
    `<button class="row-link" data-route="#/feature/${asset.feature_id}">${esc(asset.feature_id)}</button>`,
    esc(asset.test_case_id),
    `<code>${esc(asset.file_path)}</code>`,
    status(asset.status)
  ]);
  return `<div class="callout local-adapter-callout"><span>i</span><div><strong>Local demo adapter is active.</strong><br>This validates selection and lifecycle behavior using predefined assets. Connect an approved CI provider before production use.</div></div>
    <div class="run-summary-strip">
      <div><strong>${d.automationRuns.length}</strong><span>Recorded runs</span></div>
      <div><strong>${d.automationRuns.filter(run => ['Queued','Running'].includes(run.status)).length}</strong><span>In progress</span></div>
      <div><strong>${d.automationAssets.length}</strong><span>Mapped assets</span></div>
      <div><strong>${new Set(d.automationAssets.map(asset => asset.feature_id)).size}</strong><span>Features covered</span></div>
    </div>
    <section class="section"><div class="section-header"><h2>Recent runs</h2><span class="subtitle">Newest first · auto-refreshes while active</span></div>${table(['Run','Scope type','Automation type','Selection','Environment','Project','Result','Requested by','Repository'], runRows)}<div id="run-detail-panel"></div></section>
    <section class="section"><div class="section-header"><h2>Automation asset mappings</h2><span class="subtitle">Repository → automation type → executable asset → test case → feature</span></div>${table(['Automation asset','Suite','Type','Feature','Test case','Path','Status'], assetRows)}</section>`;
}

async function inspectAutomationRun(runId) {
  const panel = document.querySelector('#run-detail-panel');
  if (!panel) return;
  panel.innerHTML = '<div class="loading-inline">Loading run evidence…</div>';
  try {
    const run = await api(`/api/automation/runs/${runId}`);
    const results = run.results || [];
    panel.innerHTML = `<div class="run-detail"><div class="section-header"><div><p class="eyebrow">Run evidence</p><h2>${esc(run.id)}</h2></div>${status(run.status)}</div>
      <div class="run-detail-meta"><span><strong>Provider reference</strong>${esc(run.provider_run_id)}</span><span><strong>Branch</strong>${esc(run.branch)}</span><span><strong>Commit</strong>${esc(run.commit_sha)}</span><span><strong>Started</strong>${formatDate(run.started_at, true)}</span></div>
      ${results.length ? table(['Test','Feature','Case','Result','Duration','Retries','Evidence'], results.map(result => [`<strong>${esc(result.external_test_id)}</strong><br>${esc(result.title)}`, `<button class="row-link" data-route="#/feature/${result.feature_id}">${esc(result.feature_id)}</button>`, esc(result.test_case_id), status(result.status), `${result.duration_ms} ms`, result.retry_count, result.evidence?.artifact ? esc(result.evidence.artifact) : 'Metadata only'])) : emptyState('Run is still active', 'Evidence appears here after the adapter reports a terminal result.')}
    </div>`;
    bindDynamicActions();
  } catch (error) { panel.innerHTML = `<div class="callout warning"><span>!</span><div>${esc(error.message)}</div></div>`; }
}

function metricsView() {
  const d = state.data;
  const reqCoverage = calculateCoverage();
  const passRate = Math.round(d.testCases.filter(item => item.latest_result === 'Passed').length / Math.max(1, d.testCases.filter(item => item.latest_result !== 'Not Run').length) * 100);
  const automationCoverage = Math.round(d.testCases.filter(item => item.automation_status === 'Automated').length / Math.max(1, d.testCases.length) * 100);
  const criticalDefects = d.defects.filter(item => item.severity === 'Critical' && item.status !== 'Closed').length;
  return `<div class="metric-grid">
    ${metric('Requirement coverage', `${reqCoverage}%`, 'Approved tests linked to in-scope requirements', reqCoverage)}
    ${metric('Executed pass rate', `${passRate}%`, 'Passed among currently executed test cases', passRate)}
    ${metric('Automation coverage', `${automationCoverage}%`, 'Automated among approved automation-eligible cases', automationCoverage)}
    ${metric('Open critical defects', String(criticalDefects), 'Must reach zero or receive an authorized override', criticalDefects ? 25 : 100, criticalDefects ? 'warning' : 'success')}
  </div><section class="section"><div class="callout"><span>i</span><div><strong>Metric definitions are visible and stable.</strong><br>Filters and historical snapshots will use the same central definitions as feature and release views.</div></div></section>`;
}

function metric(label, value, description, percent, tone = '') {
  return `<div class="metric-block"><span class="eyebrow">${esc(label)}</span><div class="metric-value">${esc(value)}</div><p>${esc(description)}</p><div class="progress-track"><div class="progress-fill ${tone} ${progressClass(percent)}"></div></div></div>`;
}

function progressClass(percent) {
  const bucket = Math.max(0, Math.min(100, Math.round(Number(percent || 0) / 5) * 5));
  return `progress-${bucket}`;
}

function capacityView() {
  const rows = state.data.capacity.map(item => {
    const utilization = Math.round(item.allocated_hours / Math.max(1, item.available_hours) * 100);
    return [`<strong>${esc(item.member_name)}</strong><br><span class="subtitle">${esc(item.role_name)}</span>`, `<button class="row-link" data-route="#/feature/${item.feature_id}">${esc(item.feature_id)} · ${esc(featureTitle(item.feature_id))}</button>`, esc(item.sprint_name), `${item.available_hours}h`, `${item.allocated_hours}h`, status(utilization > 100 ? 'Overallocated' : utilization > 85 ? 'Near Capacity' : 'Available')];
  });
  return `<div class="callout warning"><span>!</span><div><strong>Automation capacity needs review.</strong><br>Sam Rivera is allocated above available capacity. Senior QA should rebalance work or record a borrowing decision.</div></div><section class="section">${table(['Team member','Feature allocation','Sprint','Available','Allocated','Signal'], rows)}</section>`;
}

function recentView() {
  const docs = state.data.documents.filter(item => !item.is_trashed).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return `<div class="page-shell"><div class="page-content">${pageHeader('Workspace', 'Recent', 'Pages and feature documentation updated most recently.')}${table(['Page','Space','Status','Owner','Updated'], docs.map(doc => [`<button class="row-link" data-route="#/document/${doc.id}">${esc(doc.title)}</button>`, esc(state.data.spaces.find(space => space.id === doc.space_id)?.name || ''), status(doc.status), esc(doc.owner_name), formatDate(doc.updated_at, true)]))}</div></div>`;
}

function starredView() {
  const docs = state.data.documents.filter(item => ['DOC-001','DOC-002','DOC-005'].includes(item.id));
  return `<div class="page-shell"><div class="page-content">${pageHeader('Workspace', 'Starred', 'Your important QA pages and release evidence.')}${table(['Page','Status','Feature','Owner'], docs.map(doc => [`<button class="row-link" data-route="#/document/${doc.id}">${esc(doc.title)}</button>`, status(doc.status), esc(doc.linked_feature_id || 'Workspace standard'), esc(doc.owner_name)]))}</div></div>`;
}

function settingsView() {
  const trashed = state.data.documents.filter(item => item.is_trashed);
  return `<div class="page-shell"><div class="page-content">
    ${breadcrumb([{ label: state.data.workspace.name, route: '#/home' }, { label: 'Settings' }])}
    ${pageHeader('Administration', 'Workspace settings', 'Manage workspace policy, members, integrations, and recoverable content.')}
    <div class="tabs"><button class="tab active">General</button><button class="tab">Permissions</button><button class="tab">Integrations</button><button class="tab">Audit log</button><button class="tab">Trash</button></div>
    <section class="section"><div class="section-header"><h2>Workspace details</h2></div><div class="panel"><div class="panel-body"><div class="property-list"><label>Workspace name<span class="meta-value">${esc(state.data.workspace.name)}</span></label><label>Documentation retention<span class="meta-value">30 days after moving to Trash</span></label><label>Release authority<span class="meta-value">Senior QA</span></label><label>Tenant isolation<span class="meta-value">Application and database policy enforced</span></label></div></div></div></section>
    <section class="section"><div class="section-header"><h2>Access and security</h2><span>${status(state.data.currentUser.role)}</span></div>
      <div class="callout"><span>i</span><div><strong>Authentication and authorization are enforced.</strong><br>Sessions expire after two idle hours or twelve total hours. Personal pages are undiscoverable unless their owner shares them directly.</div></div>
      <div class="section">${table(['Member','Role','Status'], state.data.members.map(member => [`<strong>${esc(member.display_name)}</strong>`, status(member.role), status(member.status)]))}</div>
    </section>
    <section class="section"><div class="section-header"><h2>Trash</h2><span class="subtitle">Recoverable content</span></div>${trashed.length ? `<div class="trash-list">${trashed.map(doc => `<div class="trash-row"><span><strong>${esc(doc.title)}</strong><br><span class="subtitle">Deleted ${formatDate(doc.updated_at)}</span></span><button class="secondary-button" data-restore-document="${doc.id}">Restore</button></div>`).join('')}</div>` : emptyState('Trash is empty', 'Deleted pages will remain recoverable here during retention.')}</section>
  </div></div>`;
}

function notFoundView() {
  return `<div class="page-shell"><div class="page-content reading">${emptyState('Page not found', 'The content may have moved or you may not have access.', '<button class="primary-button" data-route="#/home">Return home</button>')}</div></div>`;
}

function setMain(html) {
  main.innerHTML = html;
  main.scrollTop = 0;
  bindDynamicActions();
}

async function renderRoute() {
  if (!state.data) return;
  clearTimeout(state.automationPollTimer);
  state.automationPollTimer = null;
  renderSidebar();
  const hash = location.hash || '#/home';
  const parts = hash.slice(2).split('/');
  if (parts[0] === 'home' || !parts[0]) return setMain(homeView());
  if (parts[0] === 'personal') return setMain(spaceView(null, true));
  if (parts[0] === 'space') return setMain(spaceView(parts[1]));
  if (parts[0] === 'document') return documentView(parts[1]);
  if (parts[0] === 'feature') return setMain(featureView(parts[1]));
  if (parts[0] === 'qa') {
    setMain(qaView(parts[1]));
    if (parts[1] === 'runs' && state.data.automationRuns.some(run => ['Queued', 'Running'].includes(run.status))) {
      state.automationPollTimer = setTimeout(() => reloadData(), 700);
    }
    return;
  }
  if (parts[0] === 'recent') return setMain(recentView());
  if (parts[0] === 'starred') return setMain(starredView());
  if (parts[0] === 'settings') return setMain(settingsView());
  setMain(notFoundView());
}

function bindDynamicActions() {
  document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.route)));
  document.querySelectorAll('[data-create-document]').forEach(button => button.addEventListener('click', () => openCreateDialog(null, button.dataset.feature)));
  document.querySelectorAll('[data-new-page]').forEach(button => button.addEventListener('click', () => openCreateDialog(button.dataset.newPage)));
  document.querySelectorAll('[data-add-record]').forEach(button => button.addEventListener('click', () => openRecordDialog(button.dataset.addRecord)));
  document.querySelectorAll('[data-open-run-dialog]').forEach(button => button.addEventListener('click', openRunDialog));
  document.querySelectorAll('[data-inspect-run]').forEach(button => button.addEventListener('click', () => inspectAutomationRun(button.dataset.inspectRun)));
  document.querySelectorAll('[data-feature-tab]').forEach(button => button.addEventListener('click', () => {
    state.activeFeatureTab = button.dataset.featureTab;
    renderRoute();
  }));
  document.querySelectorAll('[data-restore-document]').forEach(button => button.addEventListener('click', async () => {
    await api(`/api/documents/${button.dataset.restoreDocument}/restore`, { method: 'POST' });
    toast('Page tree restored');
    await reloadData();
  }));
}

function openRunDialog() {
  const form = document.querySelector('#run-form');
  form.reset();
  document.querySelector('#run-repository').innerHTML = state.data.automationRepositories.map(repository => `<option value="${repository.id}">${esc(repository.name)} · ${esc(repository.provider)}</option>`).join('');
  document.querySelector('#run-feature').innerHTML = '<option value="">Not required for this run type</option>' + state.data.features.map(feature => `<option value="${feature.id}">${esc(feature.id)} · ${esc(feature.title)}</option>`).join('');
  document.querySelector('#run-test-case').innerHTML = '<option value="">Not required for this run type</option>' + state.data.testCases.map(testCase => `<option value="${testCase.id}">${esc(testCase.id)} · ${esc(testCase.title)}</option>`).join('');
  const typeSelect = document.querySelector('#run-type');
  const featureSelect = document.querySelector('#run-feature');
  const testCaseSelect = document.querySelector('#run-test-case');
  const syncRequirement = () => {
    const featureRequired = typeSelect.value === 'Feature';
    const testCaseRequired = typeSelect.value === 'Individual';
    featureSelect.required = featureRequired;
    testCaseSelect.required = testCaseRequired;
    featureSelect.closest('label').classList.toggle('required-field', featureRequired);
    testCaseSelect.closest('label').classList.toggle('required-field', testCaseRequired);
    if (!featureRequired) featureSelect.value = '';
    if (!testCaseRequired) testCaseSelect.value = '';
  };
  typeSelect.onchange = syncRequirement;
  syncRequirement();
  runDialog.showModal();
}

function openCreateDialog(spaceId, featureId) {
  const spaceSelect = document.querySelector('#create-space');
  const parentSelect = document.querySelector('#create-parent');
  const featureSelect = document.querySelector('#create-feature');
  const templateSelect = document.querySelector('#create-template');
  templateSelect.innerHTML = state.data.documentTemplates.map(template => `<option value="${template.id}" title="${esc(template.description)}">${esc(template.name)}</option>`).join('');
  spaceSelect.innerHTML = state.data.spaces.map(space => `<option value="${space.id}"${space.id === spaceId ? ' selected' : ''}>${esc(space.name)}</option>`).join('');
  parentSelect.innerHTML = '<option value="">No parent page</option>' + state.data.documents.filter(doc => !doc.is_trashed).map(doc => `<option value="${doc.id}">${esc(doc.title)}</option>`).join('');
  featureSelect.innerHTML = '<option value="">No feature link yet</option>' + state.data.features.map(feature => `<option value="${feature.id}"${feature.id === featureId ? ' selected' : ''}>${esc(feature.id)} · ${esc(feature.title)}</option>`).join('');
  document.querySelector('#create-form').reset();
  if (spaceId) spaceSelect.value = spaceId;
  if (featureId) featureSelect.value = featureId;
  createDialog.showModal();
  setTimeout(() => document.querySelector('#create-form [name="title"]').focus(), 50);
}

const recordFields = {
  risks: `<div class="content-grid"><label>Likelihood (1-5)<input name="likelihood" type="number" min="1" max="5" value="3"></label><label>Impact (1-5)<input name="impact" type="number" min="1" max="5" value="3"></label></div><label>Treatment<input name="treatment" value="Assess and mitigate"></label>`,
  defects: `<div class="content-grid"><label>Severity<select name="severity"><option>Critical</option><option>High</option><option selected>Medium</option><option>Low</option></select></label><label>Environment<select name="environment"><option>QA</option><option>Staging</option><option>Production</option></select></label></div>`,
  'test-cases': `<div class="content-grid"><label>Type<select name="kind"><option>Functional</option><option>Integration</option><option>E2E</option><option>Security</option><option>Accessibility</option></select></label><label>Priority<select name="priority"><option>Critical</option><option>High</option><option selected>Medium</option><option>Low</option></select></label></div><label>Automation disposition<select name="automation_status"><option>Planned</option><option>Automated</option><option>Deferred</option><option>Exception</option></select></label>`,
  automation: `<div class="content-grid"><label>Value (1-10)<input name="value_score" type="number" min="1" max="10" value="5"></label><label>Effort (1-10)<input name="effort_score" type="number" min="1" max="10" value="5"></label></div><label>Repository<input name="repository" placeholder="qa-e2e"></label>`
};

function openRecordDialog(kind) {
  const labels = { risks: 'Add risk', defects: 'Add defect', 'test-cases': 'Add test case', automation: 'Add automation candidate' };
  document.querySelector('#record-form').reset();
  document.querySelector('#record-form [name="kind"]').value = kind;
  document.querySelector('#record-dialog-title').textContent = labels[kind];
  document.querySelector('#record-feature').innerHTML = state.data.features.map(feature => `<option value="${feature.id}">${esc(feature.id)} · ${esc(feature.title)}</option>`).join('');
  document.querySelector('#record-extra-fields').innerHTML = recordFields[kind] || '';
  recordDialog.showModal();
}

async function openShareDialog(doc) {
  try {
    const data = await api(`/api/documents/${doc.id}/permissions`);
    const form = document.querySelector('#share-form');
    form.reset();
    form.elements.document_id.value = doc.id;
    document.querySelector('#share-user').innerHTML = state.data.members
      .filter(member => member.id !== state.data.currentUser.id)
      .map(member => `<option value="${member.id}">${esc(member.display_name)} · ${esc(member.role)}</option>`).join('');
    document.querySelector('#current-shares').innerHTML = data.permissions.length
      ? `<div class="share-list">${data.permissions.map(permission => `<div class="share-row"><span><strong>${esc(permission.display_name)}</strong><br>${esc(permission.access_level)}</span><span class="avatar-button">${esc(permission.initials)}</span></div>`).join('')}</div>`
      : '<div class="login-help">This page has no direct user shares. Space and role permissions may still apply.</div>';
    shareDialog.showModal();
  } catch (error) { toast(error.message); }
}

async function reloadData(render = true) {
  state.data = await api('/api/bootstrap');
  document.querySelector('#workspace-name').textContent = state.data.workspace.name;
  const accountButton = document.querySelector('#account-button');
  accountButton.textContent = state.data.currentUser.initials;
  accountButton.title = `${state.data.currentUser.name} · ${state.data.currentUser.role} · Click to sign out`;
  document.querySelector('#global-create').hidden = !canCreateContent();
  document.querySelector('#app-shell').classList.remove('logged-out');
  renderSidebar();
  if (render) await renderRoute();
}

function showLogin(message = '') {
  state.auth = null;
  state.data = null;
  document.querySelector('#app-shell').classList.add('logged-out');
  sidebar.innerHTML = '';
  main.innerHTML = `<div class="login-page"><section class="login-card">
    <p class="eyebrow">Secure workspace</p>
    <h1>Sign in to Qualispace</h1>
    <p class="subtitle">Your identity and workspace role determine which pages and QA actions you can access.</p>
    <form id="login-form">
      <label>Email address<input name="email" type="email" autocomplete="username" required value="patrick@qualispace.local"></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required value="Demo123!"></label>
      <p id="login-error" class="login-error">${esc(message)}</p>
      <button class="primary-button" type="submit">Sign in</button>
    </form>
    <div class="login-help"><strong>Local demonstration accounts</strong><br>Patrick: Senior QA · Mira: QA Engineer · Avery: Release Approver · Viewer: read only.<br>Use the account name followed by <code>@qualispace.local</code>. The local demo password is <code>Demo123!</code>.</div>
  </section></div>`;
  document.querySelector('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    const errorElement = document.querySelector('#login-error');
    button.disabled = true;
    errorElement.textContent = 'Signing in...';
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
      state.auth = await api('/api/auth/session');
      await reloadData();
      toast(`Signed in as ${state.auth.user.name}`);
    } catch (error) {
      errorElement.textContent = error.message;
    } finally { button.disabled = false; }
  });
}

async function initialize() {
  try {
    state.auth = await api('/api/auth/session');
    if (!state.auth.authenticated) return showLogin();
    await reloadData();
  } catch (error) {
    if (error.status === 401) showLogin();
    else showLogin(error.message);
  }
}

document.addEventListener('click', event => {
  const routeTarget = event.target.closest('[data-route]');
  if (routeTarget && !routeTarget.closest('#main-content') && !routeTarget.closest('#sidebar-nav')) navigate(routeTarget.dataset.route);
});

document.querySelector('#global-create').addEventListener('click', () => openCreateDialog());
document.querySelector('#account-button').addEventListener('click', async () => {
  if (!state.auth || !confirm(`Sign out ${state.auth.user.name}?`)) return;
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  showLogin('You have signed out.');
});
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

document.querySelector('#create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.parent_id ||= null;
  body.linked_feature_id ||= null;
  try {
    const created = await api('/api/documents', { method: 'POST', body: JSON.stringify(body) });
    createDialog.close();
    toast('Page created');
    await reloadData(false);
    navigate(`#/document/${created.id}`);
  } catch (error) { toast(error.message); }
});

document.querySelector('#record-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  const kind = body.kind;
  delete body.kind;
  for (const field of ['likelihood','impact','value_score','effort_score']) if (body[field]) body[field] = Number(body[field]);
  if (kind === 'risks') body.residual_score = body.likelihood * body.impact;
  try {
    await api(`/api/qa/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    recordDialog.close();
    toast('QA record added');
    await reloadData();
  } catch (error) { toast(error.message); }
});

document.querySelector('#run-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  const body = Object.fromEntries(new FormData(form));
  body.feature_id ||= null;
  body.test_case_id ||= null;
  button.disabled = true;
  button.textContent = 'Queueing…';
  try {
    const run = await api('/api/automation/runs', { method: 'POST', body: JSON.stringify(body) });
    runDialog.close();
    toast(`${run.run_type} run queued`);
    await reloadData(false);
    navigate('#/qa/runs');
  } catch (error) { toast(error.message); }
  finally {
    button.disabled = false;
    button.textContent = 'Queue run';
  }
});

document.querySelector('#share-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  const documentId = body.document_id;
  delete body.document_id;
  try {
    await api(`/api/documents/${documentId}/permissions`, { method: 'PUT', body: JSON.stringify(body) });
    shareDialog.close();
    toast(body.access_level ? `Page shared as ${body.access_level}` : 'Direct access removed');
  } catch (error) { toast(error.message); }
});

const searchInput = document.querySelector('#global-search');
const searchResults = document.querySelector('#search-results');
searchInput.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  const query = searchInput.value.trim();
  if (!query) { searchResults.hidden = true; return; }
  state.searchTimer = setTimeout(async () => {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    searchResults.innerHTML = data.results.length ? data.results.map(item => `<button class="search-result" data-search-route="#/${item.type}/${item.id}"><span class="nav-icon">${item.type === 'document' ? icons.page : icons.product}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.type)} · ${esc(item.status)}</small></span></button>`).join('') : '<div class="empty-state">No matching pages or features</div>';
    searchResults.hidden = false;
    searchResults.querySelectorAll('[data-search-route]').forEach(button => button.addEventListener('click', () => {
      searchResults.hidden = true;
      searchInput.value = '';
      navigate(button.dataset.searchRoute);
    }));
  }, 220);
});

document.addEventListener('click', event => {
  if (!event.target.closest('.global-search-wrap')) searchResults.hidden = true;
});

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
  }
});

window.addEventListener('hashchange', renderRoute);

initialize();
