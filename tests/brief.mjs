// Unit tests for the editor's desk helpers (src/assets/js/brief.js) and for the prompt templates in prompts/.
// They also check that the browser-side checks agree with the build's own publishing rules (tools/content.mjs).  Run: node tests/brief.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as F from './fixtures.mjs';
import { PLACEHOLDERS, CHATBOT_LEFTOVERS, textProblems as serverProblems } from '../tools/content.mjs';
import { parseFrontMatter, countWords as serverWords } from '../tools/md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const CO = require('../src/assets/js/render.js');
const B = require('../src/assets/js/brief.js');
const RULES = { placeholders: PLACEHOLDERS.map(([re, label]) => [re.source, re.flags, label]), chatbot: CHATBOT_LEFTOVERS.map(([re, label]) => [re.source, re.flags, label]) };

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, '\n  ', String(e.message).split('\n').slice(0, 6).join('\n   ')); } };
const rowsFor = (date) => CO.model.buildRows([{ items: F.scheduleUS(date), source: 'tv' }, { items: F.webUS(date), source: 'web' }, { items: F.webGlobal(date), source: 'web' }]);
const words = (n, seed = 'w') => Array.from({ length: n }, (_, i) => `${seed}${(i * 7919) % 997}`).join(' ');

/* ------------------------------------------------------------------ facts */
const day = B.buildFacts(rowsFor('2026-11-10'), { date: '2026-11-10' });
t('facts: header, source line and the sections the prompts rely on', () => {
  assert.match(day.text, /^DATE: Tuesday, November 10, 2026 \(US Eastern Time, written "ET" below\)\nSOURCE: TVmaze schedule data/);
  for (const h of ['OVERVIEW', 'TOP PICKS', 'OTHER NEW EPISODES', 'NO FIXED TIME', 'SCHEDULE QUIRKS', 'NOT IN THIS DATA']) assert.ok(day.text.includes(h), h);
  assert.deepEqual([day.stats.episodes, day.stats.shows, day.stats.picks], [26, 24, 5]);
});
t('facts: only what the site itself would show', () => {
  assert.ok(!/Estrellas|Das Haus/.test(day.text), 'non-English shows are left out');
  assert.ok(!/Night Desk|Evening Report|Weekly Quiz/.test(day.text), 'talk, news and game shows are left out');
});
t('facts: times are Eastern, with the ET label, and numbers come from the data', () => {
  assert.match(day.text, /1\. Nine Rooms - "Room One" \(S01E01\), Netflix, 3:00 AM ET, 52 min\. Series premiere\./);
  assert.match(day.text, /Salt & Ash - "Embers" \(S04E01\), FX, 10:00 PM ET, 58 min\. Season 4 premiere\. Genres: Drama, Thriller\. TVmaze rating 8\.9\./);
  assert.match(day.text, /- Busiest start time: 9:00 PM ET \(7 episodes\)\./);
  assert.match(day.text, /- Episodes with no fixed time \(usually streaming\): 4\./);
  assert.match(day.text, /- 8:00 PM ET - Bluff Creek \(FOX\) S01E01 - Series premiere/);
  assert.ok(!/\b(AM|PM)\b(?! ET)/.test(day.text.replace(/\d{1,2}:\d{2} (AM|PM) ET/g, '').replace('(11 PM to 5 AM ET)', '')), 'every clock time carries ET');
});
t('facts: quirks are worked out from the data', () => {
  assert.match(day.text, /Streaming releases with a listed time: .*Nine Rooms \(Netflix, 3:00 AM ET\)/);
  assert.match(day.text, /Nine Rooms has 2 episodes listed today \(S01E01, S01E02\)/);
  assert.match(day.text, /New series today: .*Nine Rooms/);
  assert.match(day.text, /Late-night TV starts \(11 PM to 5 AM ET\): Static\./);
  assert.ok(!/Clash:/.test(day.text) || !/Clash: \d of the top picks start at 3:00 AM/.test(day.text), 'streaming releases never count as a clash');
});
t('facts: an empty day says so and tells the assistant not to write', () => {
  const e = B.buildFacts([], { date: '2026-11-10' });
  assert.match(e.text, /No new episodes were found for this date\. Do not write a note from this data\./);
  assert.equal(e.stats.episodes, 0);
  assert.ok(!/TOP PICKS/.test(e.text));
});
t('facts: nothing in the block can be mistaken for an unfilled template field', () => {
  assert.ok(!/\{\{|\}\}/.test(day.text));
  const odd = rowsFor('2026-11-10'); odd[0].show = 'Show {{FACTS}}'; odd[0].summary = 'Summary with {{DRAFT}}';
  const filled = B.fillPrompt('A\n{{FACTS}}\nB', { FACTS: B.buildFacts(odd, { date: '2026-11-10' }).text });
  assert.deepEqual(filled.missing, [], 'values are never scanned again for fields');
});
t('week facts: totals, premieres and one pick per day', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => { const d = CO.time.ymdAdd('2026-11-10', i); return { date: d, rows: rowsFor(d) }; });
  const w = B.buildWeekFacts(days, {});
  assert.match(w.text, /^WEEK: Tuesday, November 10, 2026 to Monday, November 16, 2026/);
  for (const h of ['OVERVIEW', 'NEW SERIES THIS WEEK', 'RETURNING SEASONS THIS WEEK', 'TOP PICK OF EACH DAY', 'NOT IN THIS DATA']) assert.ok(w.text.includes(h), h);
  assert.equal((w.text.match(/^- (Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday) November \d+ \(\d+ episodes\): /gm) || []).length, 7);
  assert.equal(w.stats.episodes, days.reduce((n, d) => n + B.buildFacts(d.rows, { date: d.date }).stats.episodes, 0), 'the week total is the sum of the days');
  assert.deepEqual([w.stats.newSeries, w.stats.returning], [3, 4], 'the same premiere listed on several days is counted once');
  assert.match(w.text, /- Premieres: 3 new series, 4 returning seasons\./);
  assert.equal((w.text.match(/Nine Rooms \(Netflix\) S01E01, Thriller/g) || []).length, 1);
});

/* ------------------------------------------------------------------ prompt templates */
t('fieldsOf and fillPrompt', () => {
  assert.deepEqual(B.fieldsOf('{{SITE}} and {{DATE}}, again {{SITE}} {{DATE_LONG}} {{lower}} {{X1}}'), ['SITE', 'DATE', 'DATE_LONG']);
  const r = B.fillPrompt('Hi {{SITE}}, {{DATE}}: {{FACTS}} / {{MY_TAKE}}', { SITE: 'Cold Open', DATE: '  2026-11-10 ', FACTS: '', MY_TAKE: undefined });
  assert.equal(r.text, 'Hi Cold Open, 2026-11-10: {{FACTS}} / {{MY_TAKE}}');
  assert.deepEqual(r.missing, ['FACTS', 'MY_TAKE']);
  assert.equal(B.fillPrompt('{{SITE}} {{SITE}}', { SITE: 'x' }).text, 'x x');
});
const KNOWN = new Set(['SITE', 'DATE', 'DATE_LONG', 'FACTS', 'MY_TAKE', 'TOPIC', 'READER_QUESTION', 'EXISTING_GUIDES', 'OUTLINE', 'VERIFIED_FACTS', 'DRAFT']);
const PROMPTS = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'prompts')).filter((f) => f.endsWith('.txt')).map((f) => [f.replace(/\.txt$/, ''), fs.readFileSync(path.join(ROOT, 'prompts', f), 'utf8')]));
t('prompts: the seven templates exist and use only fields the desk knows', () => {
  assert.deepEqual(Object.keys(PROMPTS).sort(), ['factcheck', 'guide', 'guide-outline', 'ideas', 'note', 'polish', 'week']);
  for (const [name, text] of Object.entries(PROMPTS)) {
    assert.ok(text.length > 800, `${name}: too short`);
    const unknown = B.fieldsOf(text).filter((k) => !KNOWN.has(k));
    assert.deepEqual(unknown, [], `${name}: unknown fields ${unknown}`);
    assert.ok(!/\{\{(?![A-Z])|(?<![A-Z_])\{[A-Z_]+\}(?!\})/.test(text.replace(/\{\{[A-Z_]+\}\}/g, '')), `${name}: malformed field`);
    assert.ok(text.includes('{{SITE}}'), `${name}: names the site`);
  }
  assert.ok(B.fieldsOf(PROMPTS.note).includes('FACTS') && B.fieldsOf(PROMPTS.week).includes('FACTS'), 'note and week take the facts block');
});
t('prompts: every writing prompt forbids invention and keeps a human in the loop', () => {
  for (const name of ['note', 'week', 'guide']) {
    const text = PROMPTS[name];
    assert.match(text, /\[VERIFY: what to check\]/, `${name}: tells the model to mark unverified claims`);
    assert.match(text, /(?:Never|never) (?:say or imply|claim)[^.]*(?:watched|personal experience)/, `${name}: no invented experience`);
    assert.match(text, /No invented quotes|No invented quotes, statistics or studies/, `${name}: no invented quotes`);
    assert.match(text, /Return only/, `${name}: asks for the text only, without chatter`);
  }
  assert.match(PROMPTS.note, /at most 4 short paragraphs and at most 1,400 characters/i, 'note: stays inside the site limit of 1,500');
  assert.match(PROMPTS.note, /NO NOTE TODAY/);
  assert.match(PROMPTS.factcheck, /never invent a URL/);
  for (const name of ['week', 'guide']) {
    assert.match(PROMPTS[name], /^---\ntitle:.*\ndescription:.*\ndate:.*\ncategory:.*\n---$/m, `${name}: asks for the exact header the site reads`);
    assert.match(PROMPTS[name], /Use ## for headings|never a single #/, `${name}: asks for ## headings`);
  }
  assert.match(PROMPTS.guide, /date: \{\{DATE\}\}/);
});
t('prompts: nothing asks for deliberate mistakes, imitation of real people, or detector evasion', () => {
  for (const [name, text] of Object.entries(PROMPTS)) {
    assert.ok(!/typo|grammatical (?:mistake|error)|human error|undetect|bypass|AI detector|pass as human|sound less like an? AI/i.test(text), `${name}: asks for something deceptive`);
    assert.ok(!/@|https?:\/\//.test(text), `${name}: contains an address or link`);
  }
});
t('prompts: the links they allow all exist on the site', () => {
  const allowed = new Set(['/', '/premieres/', '/watchlist/', '/how-it-works/']);
  for (const [name, text] of Object.entries(PROMPTS)) for (const m of text.matchAll(/\]\((\/[^)]*)\)/g)) assert.ok(allowed.has(m[1]), `${name}: ${m[1]}`);
});

/* ------------------------------------------------------------------ checks agree with the build */
const SAMPLES = ['A perfectly fine sentence about Nine Rooms.', 'The time is [VERIFY: check it].', 'TODO: fill this in', 'Lorem ipsum dolor sit amet', 'See [source] for more', 'See [the site](https://example.org) for more',
  'As an AI language model I cannot browse', 'Sure! Here is the article you asked for.', 'Here is your revised draft:', 'I hope this helps', 'Meta description: something', 'Keywords: tv, schedule', 'Value {{x}} left', 'XXX', 'My training data ends', 'Certainly, the answer is below.', 'a normal line\nSlug: my-guide'];
t('browser checks give the same verdicts as the build rules', () => {
  for (const s of SAMPLES) assert.deepEqual(B.textProblems(s, RULES).sort(), serverProblems(s).sort(), JSON.stringify(s));
  assert.ok(B.textProblems('The time is [VERIFY: check it].', RULES).length >= 1);
  assert.deepEqual(B.textProblems('See [the site](https://example.org) for more', RULES), []);
});
t('front matter and word count match the build', () => {
  const raw = '﻿---\r\ntitle: “A curly title”\r\ndescription: Plain description\r\n# a comment\r\ndate: 2026-12-01\r\nbad line\r\n---\r\nBody text here.';
  const a = B.parseFront(raw), b = parseFrontMatter(raw);
  assert.deepEqual(a.data, b.data); assert.equal(a.body, b.body); assert.equal(a.hasFront, b.hasFront);
  assert.equal(B.parseFront('no header here').hasFront, false);
  for (const s of ['Hello, world: it’s a well-known fact.', 'Rock ’n’ roll 2026-12-01 S02E05', words(50)]) assert.equal(B.countWords(s), serverWords(s), s);
});

/* ------------------------------------------------------------------ note check */
const goodNote = 'Hello, Tuesday! Nine Rooms starts on Netflix at 3 a.m. ET, which is the headline today.\n\nWatch Midnight Ledger on HBO at 9 p.m. ET, then switch to Salt & Ash on FX at 10 p.m. ET.\n\nHollow Season has two episodes out, so it can wait for the weekend.\n\nSee you tomorrow.';
t('note check: a good note is ready', () => {
  const r = B.checkNote(goodNote, RULES);
  assert.deepEqual(r.errors, []); assert.equal(r.paragraphs, 4); assert.ok(r.chars > 150);
});
t('note check: blocks exactly what the build would reject', () => {
  assert.equal(B.checkNote('', RULES).errors.length, 1);
  assert.equal(B.checkNote('   \n\n ', RULES).errors.length, 1);
  const r = B.checkNote(goodNote + '\n\nOne more [VERIFY: the date].', RULES);
  assert.match(r.errors.join(' '), /will NOT publish this note until you remove: an unresolved \[VERIFY/);
  assert.match(B.checkNote('Sure, here is the note.\n\n' + goodNote, RULES).errors.join(' '), /chatbot/);
});
t('note check: warns about what would be cut or shown as typed', () => {
  const long = Array.from({ length: 4 }, () => 'A sentence that goes on and on about television schedules and evenings. '.repeat(7).trim()).join('\n\n');
  assert.match(B.checkNote(long, RULES).warnings.join(' '), /Only the first 1,500 are shown, so the ending .* would be cut/);
  assert.match(B.checkNote(goodNote + '\n\nFifth paragraph.', RULES).warnings.join(' '), /5 paragraphs\. Only the first 4/);
  assert.match(B.checkNote('**Bold** start.\n\n- bullet\n\nText.', RULES).warnings.join(' '), /plain text/);
  assert.match(B.checkNote('Just one short paragraph here.', RULES).warnings.join(' '), /One paragraph is short|Only \d+ characters/);
});

/* ------------------------------------------------------------------ guide check */
const guideBody = (n) => `Opening paragraph ${words(60, 'o')}.\n\n## First\n\n${words(n / 3, 'a')}.\n\n## Second\n\n${words(n / 3, 'b')}.\n\n## Third\n\n${words(n / 3, 'c')}.\n`;
const guideHead = (o = {}) => `---\ntitle: ${o.title ?? 'How to read a TV schedule'}\ndescription: ${o.description ?? 'A description that is long enough to be useful in search results and in the feed, for the tests.'}\ndate: ${o.date ?? '2026-11-01'}\ncategory: Schedule basics\n---\n\n`;
t('guide check: a good guide', () => {
  const r = B.checkGuide(guideHead() + guideBody(600), RULES, '2026-11-10');
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
  assert.equal(r.slug, 'how-to-read-a-tv-schedule'); assert.equal(r.headings, 3); assert.ok(r.words >= 600 && r.words < 700);
});
t('guide check: errors for what the build rejects', () => {
  assert.match(B.checkGuide(guideBody(600), RULES, '2026-11-10').errors.join(' '), /must start with a header/);
  assert.match(B.checkGuide(guideHead({ title: '' }) + guideBody(600), RULES, '2026-11-10').errors.join(' '), /no title/);
  assert.match(B.checkGuide(guideHead({ date: '2026-13-45' }) + guideBody(600), RULES, '2026-11-10').errors.join(' '), /must look like 2026-12-01/);
  assert.match(B.checkGuide(guideHead() + guideBody(150), RULES, '2026-11-10').errors.join(' '), /under 300 words/);
  assert.match(B.checkGuide(guideHead() + guideBody(600) + '\nTODO: add sources\n', RULES, '2026-11-10').errors.join(' '), /TODO/);
  assert.match(B.checkGuide(guideHead({ title: 'Sure, here is the article' }) + guideBody(600), RULES, '2026-11-10').errors.join(' ') + B.checkGuide(guideHead() + guideBody(600) + '\nI hope this helps.\n', RULES, '2026-11-10').errors.join(' '), /chatbot/);
});
t('guide check: warnings and information', () => {
  const r = B.checkGuide(guideHead({ date: '2026-12-01', description: 'Too short.' }) + '# Big heading\n\n' + words(350, 'q') + '\n\n![pic](x.png)\n\n<div>html</div>\n\n[bad](javascript:alert(1)) and [ok](https://example.org) and [site](/premieres/)\n', RULES, '2026-11-10');
  const w = r.warnings.join('\n');
  assert.deepEqual(r.errors, []);
  assert.match(w, /description is 10 characters/); assert.match(w, /Only 0 section heading/); assert.match(w, /single #/); assert.match(w, /Images are not supported/); assert.match(w, /HTML tags/); assert.match(w, /javascript:alert\(1/);
  assert.equal(r.scheduled, true); assert.match(r.info.join(' '), /Dated 2026-12-01: it stays hidden/); assert.match(r.info.join(' '), /1 external link\./);
  assert.match(B.checkGuide(guideHead() + guideBody(330), RULES, '2026-11-10').warnings.join(' '), /short side/);
  assert.match(B.checkGuide('---\ntitle: T\ndescription: ' + 'd'.repeat(200) + '\ndate: 2026-11-01\nupdated: 2026-10-01\n---\n' + guideBody(600), RULES, '2026-11-10').warnings.join(' '), /description is 200 characters[\s\S]*updated date/);
});
t('guide check: the shipped guides pass every check without a single warning', () => {
  const dir = path.join(ROOT, 'content/guides');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && !/^readme/i.test(x))) {
    const r = B.checkGuide(fs.readFileSync(path.join(dir, f), 'utf8'), RULES, '2030-01-01');
    assert.deepEqual([r.errors, r.warnings], [[], []], f);
    assert.match(f, /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/, 'a file name the build accepts: ' + f);
    assert.match(r.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'the desk proposes a usable file name for ' + f);
  }
});

/* ------------------------------------------------------------------ misc */
t('slugify and the GitHub link', () => {
  assert.equal(B.slugify('How to read a TV schedule: ET, PT & more!'), 'how-to-read-a-tv-schedule-et-pt-and-more');
  assert.equal(B.slugify('   '), ''); assert.equal(B.slugify('A'.repeat(200)).length, 70);
  assert.equal(B.githubNewFileUrl('someone/site', 'content/notes', '2026-11-10.txt'), 'https://github.com/someone/site/new/main/content/notes?filename=2026-11-10.txt');
  assert.equal(B.githubNewFileUrl(' https://github.com/someone/site/ ', '/content/guides/', 'a b.md'), 'https://github.com/someone/site/new/main/content/guides?filename=a%20b.md');
  for (const bad of ['', 'someone', 'a/b/c', 'javascript:alert(1)', 'x y/z', 'https://evil.example/a/b']) assert.equal(B.githubNewFileUrl(bad, 'content/notes', 'x.txt'), '', JSON.stringify(bad));
});

console.log(`brief: ${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
