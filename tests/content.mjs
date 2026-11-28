// Tests for the guide and note machinery: the Markdown renderer (including hostile input), the header reader and the publishing rules.
// Run: node tests/content.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderMarkdown, parseFrontMatter, countWords, slugifyHeading, plainInline } from '../tools/md.mjs';
import { loadGuides, loadNotes, textProblems } from '../tools/content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.tmp-test-content');
const { util: U } = createRequire(import.meta.url)(path.join(ROOT, 'src/assets/js/render.js'));
let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.error('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n    got:  ${JSON.stringify(a)}\n    want: ${JSON.stringify(b)}`);
const md = (s, ctx) => renderMarkdown(s, ctx).html;

/* ------------------------------------------------------------------ markdown basics */
eq(md('Hello **bold** and *italic* and `code`.'), '<p>Hello <strong>bold</strong> and <em>italic</em> and <code>code</code>.</p>', 'inline formatting');
eq(md('snake_case_word and 2*3*4 stay plain'), '<p>snake_case_word and 2*3*4 stay plain</p>', 'underscores inside words and spaced stars are not emphasis');
eq(md('## One\n\nText\n\n### Two\n\nMore'), '<h2 id="one">One</h2>\n<p>Text</p>\n<h3 id="two">Two</h3>\n<p>More</p>', 'headings get ids');
{
  const r = renderMarkdown('## Same\n\n## Same\n\n## Same!');
  eq(r.headings.map((h) => h.id), ['same', 'same-2', 'same-3'], 'heading ids are unique');
}
{
  const warns = []; const r = renderMarkdown('# Top\n\ntext', { warn: (m) => warns.push(m) });
  ok(/<h2 id="top">Top<\/h2>/.test(r.html) && warns.length === 1, 'an H1 in the body becomes H2 with a warning');
}
eq(md('- a\n- b\n  - b1\n  - b2\n- c'), '<ul><li>a</li><li>b<ul><li>b1</li><li>b2</li></ul></li><li>c</li></ul>', 'nested bullet list');
eq(md('1. one\n2. two\n   wrapped\n3) three'), '<ol><li>one</li><li>two wrapped</li><li>three</li></ol>', 'numbered list with a wrapped line');
eq(md('> quoted line\n> second\n>\n> new para'), '<blockquote><p>quoted line second</p><p>new para</p></blockquote>', 'block quote');
eq(md('line one\nline two\n\nnext'), '<p>line one line two</p>\n<p>next</p>', 'soft line breaks join');
eq(md('Intro\n- a\n- b'), '<p>Intro</p>\n<ul><li>a</li><li>b</li></ul>', 'a list can follow a paragraph without a blank line');
eq(md('---\n\ntext'), '<hr>\n<p>text</p>', 'horizontal rule');
eq(md('```\n<b>x</b>\n```'), '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>', 'fenced code is escaped');
{
  const html = md('| Eastern | Pacific |\n| --- | --- |\n| 8 PM | **5 PM** |\n| 9 PM | 6 PM |');
  ok(/<div class="table-wrap"><table><thead><tr><th scope="col">Eastern<\/th><th scope="col">Pacific<\/th><\/tr><\/thead><tbody><tr><td>8 PM<\/td><td><strong>5 PM<\/strong><\/td><\/tr>/.test(html) && /<td>6 PM<\/td><\/tr><\/tbody><\/table><\/div>/.test(html), 'pipe table');
}
eq(plainInline('A **bold** [link](/x/) and `code`'), 'A bold link and code', 'plainInline');
eq(slugifyHeading('Why 8/7c? Rock & Roll!'), 'why-8-7c-rock-and-roll', 'slugifyHeading');
eq(countWords("It's a well-known 8/7c fact: 3 words"), 8, 'countWords counts words, keeps inner apostrophes and hyphens');

/* ------------------------------------------------------------------ links */
{
  const warns = []; const ctx = { warn: (m) => warns.push(m), isKnownPath: (p) => ['/', '/guides/', '/guides/real/'].includes(p) };
  eq(md('[site](https://example.org/a?x=1&y=2)', ctx), '<p><a href="https://example.org/a?x=1&amp;y=2" rel="noopener">site</a></p>', 'external link');
  eq(md('[home](/) and [guide](/guides/real/#top)', ctx), '<p><a href="/">home</a> and <a href="/guides/real/#top">guide</a></p>', 'site links, with an anchor');
  eq(md('[gone](/guides/missing/)', ctx), '<p>gone</p>', 'a link to an unknown site page becomes plain text');
  ok(warns.length === 1 && /does not exist/.test(warns[0]), 'and says so');
}

/* ------------------------------------------------------------------ hostile input stays inert */
{
  const bad = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '**<b onclick=x>hi</b>**', '[x](javascript:alert(1))', '[x](data:text/html;base64,AAAA)',
    '[x](https://a.test/"onmouseover="alert(1))', "[x](https://a.test/'onmouseover='alert(1))", '[x](//evil.test/x)', '`<script>`', '![i](https://a.test/x.png)',
    '| <script> | b |\n|---|---|\n| <img src=x onerror=y> | 2 |', '> <iframe src=//x></iframe>', '- <svg onload=alert(1)>', '## <img src=x onerror=alert(1)>',
    '[<img src=x onerror=1>](https://a.test/)', '&lt;script&gt;'
  ];
  for (const b of bad) {
    const html = md(b);
    const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
    ok(tags.every((t) => ['p', 'strong', 'em', 'code', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'blockquote', 'pre', 'hr'].includes(t)), `only safe tags for ${JSON.stringify(b)}: ${html}`);
    ok(!/\son\w+=|javascript:|<script|<img|<iframe|<svg/i.test(html.replace(/&lt;[^]*?&gt;/g, '')), `no live handlers or scripts for ${JSON.stringify(b)}: ${html}`);
    ok(!/href="(?!https?:\/\/|\/)/.test(html), `no unsafe href for ${JSON.stringify(b)}: ${html}`);
  }
  ok(!/href=/.test(md('[x](//evil.test/x)')), 'protocol-relative links are not links');
}

/* ------------------------------------------------------------------ header */
{
  const r = parseFrontMatter('﻿---\ntitle: “A smart title”\ndescription: "Plain quotes"\ndate: 2026-12-01\n# a comment\ncategory: Explainers\nbad line\n---\n\nBody here\n');
  eq(r.data, { title: 'A smart title', description: 'Plain quotes', date: '2026-12-01', category: 'Explainers' }, 'header fields, curly and plain quotes, comments');
  eq(r.bad, ['bad line'], 'a malformed header line is reported');
  eq(r.body.trim(), 'Body here', 'the body follows the header');
  ok(parseFrontMatter('No header here').hasFront === false, 'no header is detected');
  ok(parseFrontMatter('---\r\ntitle: Windows\r\n---\r\nBody').data.title === 'Windows', 'Windows line endings');
}

/* ------------------------------------------------------------------ publishing rules */
ok(textProblems('Fine, normal text about TV.').length === 0, 'normal text passes');
for (const bad of ['As an AI language model I cannot', 'Total: [VERIFY: lead actor]', 'TODO add more', 'Lorem ipsum dolor', 'Sure, here is the article you asked for', 'Meta description: nice', '[insert source here]', 'I hope this helps!', 'Here is the revised article:']) {
  ok(textProblems(bad).length > 0, `detects: ${bad}`);
}
ok(textProblems('See [source](https://x.test) and [Name](/y/)').length === 0, 'a normal link whose label starts with "source" or "name" is not a placeholder');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const words = (n, seed = 'alpha') => Array.from({ length: n }, (_, i) => `${seed}${i % 97}x`).join(' ') + '.';
const para = (n, seed) => words(n, seed);
const guide = (header, body) => `---\n${header}\n---\n\n${body}\n`;
const longBody = (seed) => `## First part\n\n${para(160, seed)}\n\n## Second part\n\n${para(160, seed + 'b')}\n\n## Third part\n\n${para(160, seed + 'c')}\n`;
const HEAD = (t, d = '2026-11-20', extra = '') => `title: ${t}\ndescription: ${'A description of the right size that explains what this page is about. '.repeat(2).trim()}\ndate: ${d}\ncategory: Explainers${extra}`;
const files = {
  'good-one.md': guide(HEAD('Good one'), longBody('g1')),
  'good-two.md': guide(HEAD('Good two', '2026-11-22', '\nupdated: 2026-11-25'), longBody('g2') + '\nSee [the first](/guides/good-one/), [missing](/guides/nope/) and [coming soon](/guides/future/).\n'),
  'future.md': guide(HEAD('Future', '2026-12-30'), longBody('f')),
  'draft.md': guide(HEAD('Draft', '2026-11-01', '\ndraft: true'), longBody('d')),
  'short.md': guide(HEAD('Short'), '## A\n\n' + para(100, 's')),
  'marker.md': guide(HEAD('Marker'), longBody('m') + '\nThe lead actor is [VERIFY: name].\n'),
  'chatbot.md': guide(HEAD('Chatbot'), 'Sure, here is the article.\n\n' + longBody('c')),
  'Bad_Name.md': guide(HEAD('Bad name'), longBody('b')),
  'no-header.md': longBody('n'),
  'no-title.md': guide('description: x\ndate: 2026-11-20', longBody('t')),
  'bad-date.md': guide('title: Bad date\ndescription: x\ndate: 2026-13-45', longBody('bd')),
  'copycat.md': guide(HEAD('Copycat'), longBody('g1')),
  '_ignored.md': guide(HEAD('Ignored'), longBody('i')),
  'README.md': 'not a guide'
};
const gdir = path.join(TMP, 'guides'); fs.mkdirSync(gdir);
for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(gdir, f), t);
{
  const warns = [];
  const { guides, stats } = loadGuides(gdir, { today: '2026-11-26', warn: (m) => warns.push(m), isKnownPath: (p) => ['/', '/guides/'].includes(p) });
  const slugs = guides.map((g) => g.slug).sort();
  eq(slugs, ['copycat', 'good-one', 'good-two'], 'only the valid, dated, finished guides are published');
  eq(guides[0].slug, 'good-two', 'newest first');
  eq(stats, { draft: 1, scheduled: 1, rejected: 7 }, 'drafts and future guides are held back silently; the rest is reported');
  const text = warns.join('\n');
  ok(/short\.md was NOT published: only \d+ words/.test(text), 'warns about a short guide');
  ok(/marker\.md was NOT published: it still contains an unresolved \[VERIFY/.test(text), 'warns about a leftover marker');
  ok(/chatbot\.md was NOT published/.test(text), 'warns about chatbot text');
  ok(/Bad_Name\.md was NOT published: the file name/.test(text), 'warns about a bad file name');
  ok(/no-header\.md was NOT published: it must start with a header/.test(text), 'warns about a missing header');
  ok(/no-title\.md was NOT published: the header has no title/.test(text), 'warns about a missing title');
  ok(/bad-date\.md was NOT published: the header date/.test(text), 'warns about a bad date');
  ok(/\/guides\/nope\/ points to a page that does not exist/.test(text), 'warns about a link to an unpublished guide');
  ok(!/\/guides\/future\//.test(text), 'a link to a guide that is only scheduled for a later day produces no warning');
  ok(/good-one\.md and .*copycat\.md share \d+% of their wording|copycat\.md and .*good-one\.md share \d+% of their wording/.test(text), 'warns about near-copies');
  ok(!/_ignored|README/.test(text), 'files starting with _ and README.md are ignored without noise');
  const two = guides.find((g) => g.slug === 'good-two');
  ok(two.updated === '2026-11-25' && two.minutes >= 1 && /<a href="\/guides\/good-one\/">the first<\/a>/.test(two.html) && !/href="\/guides\/nope\//.test(two.html) && !/href="\/guides\/future\//.test(two.html) && /coming soon/.test(two.html), 'updated date, reading time, internal link kept, unknown and scheduled links unlinked');
  ok(guides.every((g) => g.words >= 300 && g.description.length >= 70 && g.headings.length >= 3), 'published guides carry words, description and headings');
  const eqToday = loadGuides(gdir, { today: '2026-12-30', warn: () => {}, isKnownPath: () => true }).guides.map((g) => g.slug);
  ok(eqToday.includes('future'), 'a guide appears on its date');
}

/* notes */
const ndir = path.join(TMP, 'notes'); fs.mkdirSync(ndir);
fs.writeFileSync(path.join(ndir, '2026-11-24.txt'), 'Hi everyone!\n\nSecond.\n\nThird.\n\nFourth.\n\nFifth is dropped.\n');
fs.writeFileSync(path.join(ndir, '2026-11-25.txt'), 'Short note [VERIFY: x].\n');
fs.writeFileSync(path.join(ndir, '2026-12-30.txt'), 'Future note.\n');
fs.writeFileSync(path.join(ndir, '2026-11-26.txt'), 'word '.repeat(400) + '\n');
fs.writeFileSync(path.join(ndir, '2026-02-30.txt'), 'Impossible date.\n');
fs.writeFileSync(path.join(ndir, 'notes-draft.txt'), 'Wrong name.\n');
fs.writeFileSync(path.join(ndir, 'README.txt'), 'About notes.\n');
{
  const warns = [];
  const notes = loadNotes(ndir, { today: '2026-11-26', warn: (m) => warns.push(m), clip: U.clip });
  eq(notes.map((n) => n.date), ['2026-11-26', '2026-11-24'], 'notes: newest first, future / flagged / invalid files are left out');
  eq(notes[1].paras, ['Hi everyone!', 'Second.', 'Third.', 'Fourth.'], 'notes: at most four paragraphs');
  ok(notes[0].paras.join('').length <= 1500, 'notes: at most 1,500 characters');
  const text = warns.join('\n');
  ok(/2026-11-25\.txt was NOT published/.test(text) && /longer than 1,500/.test(text) && /2026-02-30\.txt is ignored/.test(text) && /notes-draft\.txt is ignored/.test(text) && !/README/.test(text), 'notes: each problem is reported once, README is quiet');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`content: ${checks - failures}/${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
