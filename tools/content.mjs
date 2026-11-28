/* Loads the editor's own content: guides (content/guides/*.md) and daily notes (content/notes/YYYY-MM-DD.txt).
 *
 * Publishing rules, applied on every build:
 *   - a file dated in the future stays hidden until that day (US Eastern), so a batch can be prepared in advance and released one per day;
 *   - "draft: true" in a guide keeps it hidden;
 *   - a file is NOT published (and the build log says why) when it still contains placeholders such as [VERIFY ...], TODO or lorem ipsum,
 *     chatbot leftovers such as "As an AI language model", a missing header, or fewer than 300 words (guides);
 *   - near-copies of another guide produce a warning.
 * Nothing here ever stops the build: a rejected file is simply left out, so one bad file cannot block the daily update. */
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontMatter, renderMarkdown, plainInline, countWords } from './md.mjs';

const isYmd = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s; // rejects 2026-13-45 and 2026-02-30
};

export const PLACEHOLDERS = [
  [/\[\s*verify\b[^\]]*\]/i, 'an unresolved [VERIFY ...] marker (check the fact, then remove the marker)'],
  [/\b(?:TODO|TBD|FIXME)\b/, 'a TODO/TBD placeholder'],
  [/lorem ipsum/i, 'placeholder text (lorem ipsum)'],
  [/\[(?:insert|add|your|source|citation|link|name|date|image|photo)\b[^\]]*\](?!\()/i, 'a [placeholder] in square brackets'],
  [/\{\{[^}]*\}\}|<insert[^>]*>/i, 'a template placeholder'],
  [/\bX{3,}\b/, 'an XXX placeholder']
];
export const CHATBOT_LEFTOVERS = [
  [/\bas an ai\b/i, '"as an AI" (chatbot wording)'],
  [/\blanguage model\b/i, '"language model" (chatbot wording)'],
  [/\bi (?:can(?:no|')t|cannot|am unable to|do not have|don't have) (?:browse|access|verify|provide real[- ]time|real[- ]time)/i, 'a chatbot disclaimer about browsing or real-time data'],
  [/\bknowledge cutoff\b|\bmy training data\b|\bas of my last (?:update|knowledge)/i, 'a chatbot remark about its training data'],
  [/^\W*(?:sure|certainly|absolutely|of course)[!,.]/im, 'a chatbot opening such as "Sure," or "Certainly!"'],
  [/\bhere(?:'s| is) (?:the|your|a|an) (?:revised |updated |final |complete |full |short )?(?:article|draft|guide|note|version|text|post)\b/i, 'a chatbot line such as "Here is the article"'],
  [/\bi hope this helps\b|\blet me know if you (?:need|want|would like)\b|\bfeel free to (?:ask|reach out)\b/i, 'a chatbot closing line'],
  [/^\W*(?:meta description|word count|seo title|primary keyword|keywords?|slug|character count)\s*[:：]/im, 'an SEO note line such as "Meta description:" left in the text']
];
/** Everything wrong with a piece of text that is about to be published. */
export function textProblems(text) {
  const found = [];
  for (const [re, label] of [...PLACEHOLDERS, ...CHATBOT_LEFTOVERS]) if (re.test(text)) found.push(label);
  return found;
}

const shingles = (text) => {
  const w = text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean), s = new Set();
  for (let i = 0; i + 8 <= w.length; i++) s.add(w.slice(i, i + 8).join(' '));
  return s;
};

/** Guides. opts: { today (YYYY-MM-DD, US Eastern), warn(msg), rel(file) -> label, isKnownPath(path), minWords } */
export function loadGuides(dir, opts) {
  const { today, warn } = opts, minWords = opts.minWords || 300;
  const rel = opts.rel || ((f) => f);
  const stats = { draft: 0, scheduled: 0, rejected: 0 };
  if (!fs.existsSync(dir)) return { guides: [], stats };
  const files = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f) && !f.startsWith('_') && f.toLowerCase() !== 'readme.md').sort();
  const reject = (f, why) => { stats.rejected++; warn(`${rel(path.join(dir, f))} was NOT published: ${why}`); };

  // pass 1: header and publishing rules
  const staged = [], waiting = new Set(); // waiting: guides dated for a later day
  
  for (const f of files) {
    const slug = f.replace(/\.md$/i, '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) { reject(f, 'the file name must use lowercase letters, digits and hyphens only, for example how-to-pick-a-show.md'); continue; }
    const { data, body, hasFront, bad } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!hasFront) { reject(f, 'it must start with a header between two --- lines containing title, description and date'); continue; }
    if (bad && bad.length) warn(`${rel(path.join(dir, f))}: header line ignored (use "key: value"): ${bad[0].slice(0, 50)}`);
    const known = new Set(['title', 'description', 'date', 'updated', 'category', 'author', 'draft']);
    for (const k of Object.keys(data)) if (!known.has(k)) warn(`${rel(path.join(dir, f))}: unknown header field "${k}" is ignored`);
    if (/^(true|yes|1)$/i.test(data.draft || '')) { stats.draft++; continue; }
    const title = (data.title || '').replace(/\s+/g, ' ').trim();
    if (!title) { reject(f, 'the header has no title'); continue; }
    if (!isYmd(data.date)) { reject(f, `the header date "${data.date || ''}" must look like 2026-12-01`); continue; }
    if (data.date > today) { stats.scheduled++; waiting.add(slug); continue; }
    const probs = textProblems(`${title}\n${data.description || ''}\n${body}`);
    if (probs.length) { reject(f, 'it still contains ' + probs.join('; ')); continue; }
    staged.push({ f, slug, data, body, title });
  }
  const slugs = new Set(staged.map((s) => s.slug));
  const staticPaths = opts.isKnownPath || (() => true);
  const isKnownPath = (p) => (/^\/guides\/[^/]+\/$/.test(p) ? slugs.has(p.split('/')[2]) : staticPaths(p));

  // pass 2: render, count, validate
  const guides = [];
  for (const s of staged) {
    const where = rel(path.join(dir, s.f));
    const r = renderMarkdown(s.body, { warn: (m) => warn(`${where}: ${m}`), isKnownPath, isPending: (p) => /^\/guides\/[^/]+\/$/.test(p) && waiting.has(p.split('/')[2]) });
    if (r.words < minWords) { stats.rejected++; warn(`${where} was NOT published: only ${r.words} words, at least ${minWords} are needed (aim for 600 to 1,000)`); continue; }
    if (r.words < 500) warn(`${where}: ${r.words} words is on the short side. Guides of 600 to 1,000 words tend to be more useful.`);
    const h2 = r.headings.filter((h) => h.level === 2).length;
    if (h2 < 3) warn(`${where}: only ${h2} section heading(s) (## ...). Guides are easier to read with at least 3.`);
    if (s.title.length > 100) warn(`${where}: the title is ${s.title.length} characters; search results cut it off after about 60`);
    let description = (s.data.description || '').replace(/\s+/g, ' ').trim();
    if (!description) { description = (r.paragraphs[0] || '').slice(0, 158); warn(`${where}: no description in the header; the first paragraph is used instead`); }
    else if (description.length < 70 || description.length > 170) warn(`${where}: the description is ${description.length} characters; 110 to 160 works best in search results`);
    let updated = s.data.updated || '';
    if (updated && (!isYmd(updated) || updated < s.data.date || updated > today)) { warn(`${where}: the "updated" date "${updated}" is ignored (it must be a real date between the publish date and today)`); updated = ''; }
    guides.push({
      slug: s.slug, file: where, title: s.title, description, date: s.data.date, updated,
      category: (s.data.category || 'Guides').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Guides',
      author: (s.data.author || '').trim().slice(0, 80),
      html: r.html, headings: r.headings, words: r.words, minutes: Math.max(1, Math.round(r.words / 200)),
      summary: plainInline(r.paragraphs[0] || ''), paragraphs: r.paragraphs
    });
  }

  // near-copies
  const sh = guides.map((g) => shingles(g.paragraphs.join(' ')));
  for (let a = 0; a < guides.length; a++) for (let b = a + 1; b < guides.length; b++) {
    const [small, big] = sh[a].size <= sh[b].size ? [sh[a], sh[b]] : [sh[b], sh[a]];
    if (small.size < 20) continue;
    let shared = 0; for (const x of small) if (big.has(x)) shared++;
    if (shared / small.size > 0.35) warn(`${guides[a].file} and ${guides[b].file} share ${Math.round(100 * shared / small.size)}% of their wording. Google treats near-copies as low value; rewrite one of them.`);
  }
  guides.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : x.slug < y.slug ? -1 : 1));
  return { guides, stats };
}

/** Notes: one plain-text file per day. A blank line starts a new paragraph. Max 4 paragraphs and 1,500 characters. */
export function loadNotes(dir, opts) {
  const { today, warn, clip } = opts;
  const rel = opts.rel || ((f) => f);
  const notes = [];
  if (!fs.existsSync(dir)) return notes;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.txt$/);
    if (!m) { if (/\.txt$/i.test(f) && !/^readme\.txt$/i.test(f)) warn(`${rel(path.join(dir, f))} is ignored: name notes like 2026-11-10.txt`); continue; }
    const date = m[1], where = rel(path.join(dir, f));
    if (!isYmd(date)) { warn(`${where} is ignored: ${date} is not a real date`); continue; }
    if (date > today) continue; // prepared in advance, released on its day
    const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
    const probs = textProblems(raw);
    if (probs.length) { warn(`${where} was NOT published: it still contains ${probs.join('; ')}`); continue; }
    const paras = raw.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4);
    let left = 1500; const out = [];
    for (const p of paras) { if (left <= 40) break; out.push(clip(p, left)); left -= p.length; }
    if (paras.join('').length > 1500) warn(`${where} is longer than 1,500 characters. Only the beginning is shown.`);
    if (out.length) notes.push({ date, paras: out, words: countWords(out.join(' ')) });
  }
  notes.sort((a, b) => (a.date < b.date ? 1 : -1));
  return notes;
}
