const fs = require('node:fs');

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4173';
const sourcePath = process.argv[2];
const title = process.argv[3];

function inline(value) {
  return value
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replaceAll('\\|', '|'));
}

function markdownTable(lines) {
  const rows = lines.map(tableCells);
  if (rows.length < 2 || rows[0].length < 2 || rows[1].length !== rows[0].length || !rows[1].every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  const alignments = rows[1].map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
  const cells = (row, tag) => alignments.map((alignment, index) => `<${tag} data-align="${alignment}"${tag === 'th' ? ' scope="col"' : ''}>${inline(row[index] || '')}</${tag}>`).join('');
  return `<table><thead><tr>${cells(rows[0], 'th')}</tr></thead><tbody>${rows.slice(2).map(row => `<tr>${cells(row, 'td')}</tr>`).join('')}</tbody></table>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.replaceAll('\r', '').split('\n');
  const output = [];
  let list = null;
  const closeList = () => { if (list) output.push(`</${list}>`); list = null; };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) { closeList(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(4, Math.max(2, heading[1].length));
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (bullet || ordered) {
      const nextList = ordered ? 'ol' : 'ul';
      if (list !== nextList) { closeList(); list = nextList; output.push(`<${list}>`); }
      output.push(`<li>${inline((bullet || ordered)[1])}</li>`);
      continue;
    }
    if (line.startsWith('|')) {
      closeList();
      const tableLines = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      const table = markdownTable(tableLines);
      if (table) output.push(table);
      else for (const tableLine of tableLines) output.push(`<pre>${inline(tableLine)}</pre>`);
      continue;
    }
    closeList();
    output.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return output.join('');
}

async function main() {
  if (!sourcePath || !title) throw new Error('Usage: node scripts/publish-phase-doc.js <markdown-file> <page-title>');
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patrick@qualispace.local', password: process.env.QA_DEMO_PASSWORD || 'Demo123!' })
  });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const auth = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': auth.csrfToken };
  const search = await fetch(`${base}/api/search?q=${encodeURIComponent(title)}`, { headers: { Cookie: cookie } });
  const matches = (await search.json()).results || [];
  const existing = matches.find(item => item.type === 'document' && item.title === title);
  const body = {
    space_id: 'space-qa',
    title,
    content: markdownToHtml(fs.readFileSync(sourcePath, 'utf8')),
    status: 'In Review',
    linked_feature_id: 'FEAT-103',
    create_version: true,
    change_summary: 'Automation CLI scope added and implementation baseline published'
  };
  const response = await fetch(existing ? `${base}/api/documents/${existing.id}` : `${base}/api/documents`, {
    method: existing ? 'PUT' : 'POST', headers, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Publish failed: ${response.status} ${await response.text()}`);
  const document = await response.json();
  console.log(`${existing ? 'Updated' : 'Created'} ${document.id}`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { markdownToHtml };
