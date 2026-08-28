const test = require('node:test');
const assert = require('node:assert/strict');
const { markdownToHtml } = require('../scripts/publish-phase-doc');

test('document publishing converts Markdown tables to semantic HTML', () => {
  const html = markdownToHtml(`## Access

| Role | Dispatch | Notes |
| --- | :---: | ---: |
| QA Engineer | Yes | Feature and smoke |
| Viewer | No | Read only |`);

  assert.match(html, /<table><thead><tr>/);
  assert.match(html, /<th data-align="center" scope="col">Dispatch<\/th>/);
  assert.match(html, /<td data-align="right">Feature and smoke<\/td>/);
  assert.doesNotMatch(html, /<pre>\|/);
});
