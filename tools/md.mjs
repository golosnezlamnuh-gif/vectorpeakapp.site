/* A small, safe Markdown renderer and front-matter reader for the site's guides (Node 20+, no dependencies).
 *
 * Supported: ## and ### headings, paragraphs, bullet and numbered lists (one nested level), block quotes,
 * simple pipe tables, horizontal rules, code spans and fenced code, **bold**, *italic*, [links](https://example.org) and
 * site links like [text](/guides/my-guide/).
 * Not supported on purpose: raw HTML (it is shown as text, never run), images, scripts. Everything is escaped first. */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Reads the --- block at the top of a file: simple "key: value" lines. Returns { data, body, hasFront }. */
export function parseFrontMatter(raw) {
  raw = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = raw.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { data: {}, body: raw, hasFront: false };
  const data = {}, bad = [];
  for (const line of m[1].split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) { bad.push(line.trim()); continue; }
    let v = kv[2].trim();
    // plain quotes and the curly quotes some AI tools produce
    const q = v.match(/^(["'“‘])([\s\S]*)(["'”’])$/);
    if (q) v = q[2].trim();
    data[kv[1].toLowerCase()] = v;
  }
  return { data, body: raw.slice(m[0].length), hasFront: true, bad };
}

/** Ids the page itself uses; a heading with the same name gets a numbered id instead. */
const RESERVED_IDS = ['main', 'toast', 'clock', 'side', 'feed', 'note', 'snapshot', 'results', 'rail', 'ed-h', 'toc', 'article-end'];

export function slugifyHeading(s) {
  return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

/** Words in a plain-text string (letters and digits, with inner apostrophes and hyphens kept). */
export function countWords(text) {
  const m = String(text).match(/[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/g);
  return m ? m.length : 0;
}

/** Plain text of an inline Markdown string (used for table-of-contents labels and summaries). */
export function plainInline(s) {
  return String(s)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[^\w])[*_](?=\S)([\s\S]*?)(?<=\S)[*_](?![\w])/g, '$1$2')
    .replace(/\s+/g, ' ').trim();
}

/** Renders Markdown to HTML. ctx: { warn(msg), isKnownPath(pathname), isPending(pathname) }. Returns { html, headings, paragraphs, text, words }. */
export function renderMarkdown(src, ctx = {}) {
  const warn = ctx.warn || (() => {});
  const known = ctx.isKnownPath || (() => true);
  const pending = ctx.isPending || (() => false); // a page that exists but is scheduled for a later day: shown as plain text for now, without a warning

  const link = (label, rawUrl) => {
    const url = unesc(rawUrl).trim();
    if (/^https?:\/\/[^\s"'<>`]+$/i.test(url)) return `<a href="${esc(url)}" rel="noopener">${label}</a>`;
    if (/^\/(?!\/)[^\s"'<>`]*$/.test(url)) {
      const p = url.split(/[?#]/)[0];
      if (known(p)) return `<a href="${esc(url)}">${label}</a>`;
      if (pending(p)) return label;
      warn(`link to ${url} points to a page that does not exist (yet); it is shown as plain text`);
      return label;
    }
    warn(`link "${url.slice(0, 60)}" is not an http(s) or site link; it is shown as plain text`);
    return label;
  };
  const emphasis = (s) => s
    .replace(/\*\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]+?)(?<=[^\s_])_(?![\w])/g, '$1<em>$2</em>');
  const inline = (text) => {
    let s = esc(text);
    const stash = [];
    const keep = (html) => '\u0001' + (stash.push(html) - 1) + '\u0001';
    s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${c}</code>`));
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\n]*)\)/g, (_, alt) => { warn('an image was removed: this site does not use images inside guides'); return alt; });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label, url) => keep(link(emphasis(label), url)));
    s = emphasis(s);
    return s.replace(/\u0001(\d+)\u0001/g, (_, i) => stash[+i]);
  };

  const lines = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [], headings = [], paragraphs = [], used = new Set(RESERVED_IDS);
  const isBlank = (l) => !l.trim();
  const isHr = (l) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const isUl = (l) => /^\s*[-*+]\s+\S/.test(l) && !isHr(l);
  const isOl = (l) => /^\s*\d{1,3}[.)]\s+\S/.test(l);
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
  const startsBlock = (l, next) => /^#{1,4}\s/.test(l) || /^```/.test(l) || /^>/.test(l) || isUl(l) || isOl(l) || isHr(l) || (l.includes('|') && next !== undefined && isTableSep(next));
  const uniqueId = (text) => { let id = slugifyHeading(text), n = 2; const base = id; while (used.has(id)) id = base + '-' + n++; used.add(id); return id; };
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    if (/^```/.test(line)) {
      const code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    let m = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (m) {
      let level = m[1].length;
      if (level === 1) { warn(`"# ${m[2].slice(0, 40)}" is a first-level heading; the page title is the only H1, so it was changed to a second-level heading`); level = 2; }
      if (level === 4) level = 3;
      const id = uniqueId(plainInline(m[2]));
      headings.push({ level, text: plainInline(m[2]), id });
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
      i++; continue;
    }
    if (isHr(line)) { out.push('<hr>'); i++; continue; }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line); i += 2;
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(cells(lines[i++]));
      out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th scope="col">${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      for (const r of rows) paragraphs.push(r.join(' '));
      continue;
    }
    if (/^>/.test(line)) {
      const q = [];
      while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      const paras = q.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
      out.push('<blockquote>' + paras.map((p) => `<p>${inline(p)}</p>`).join('') + '</blockquote>');
      paras.forEach((p) => paragraphs.push(p));
      continue;
    }
    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items = []; // { text, kids: [] }
      while (i < lines.length && !isBlank(lines[i]) || (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length && /^\s+(?:[-*+]|\d{1,3}[.)])\s+\S/.test(lines[i + 1]))) {
        const l = lines[i];
        if (isBlank(l)) { i++; continue; }
        const mm = l.match(/^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/);
        if (mm && !isHr(l)) {
          const indent = mm[1].length;
          if (indent >= 2 && items.length) items[items.length - 1].kids.push(mm[3]);
          else items.push({ text: mm[3], kids: [] });
        } else if (/^\s+\S/.test(l) && items.length) {
          const last = items[items.length - 1];
          if (last.kids.length) last.kids[last.kids.length - 1] += ' ' + l.trim(); else last.text += ' ' + l.trim();
        } else break;
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map((it) => `<li>${inline(it.text)}` + (it.kids.length ? `<ul>${it.kids.map((k) => `<li>${inline(k)}</li>`).join('')}</ul>` : '') + '</li>').join('') + `</${tag}>`);
      for (const it of items) { paragraphs.push(it.text); it.kids.forEach((k) => paragraphs.push(k)); }
      continue;
    }
    // paragraph
    const buf = [];
    while (i < lines.length && !isBlank(lines[i]) && !(buf.length && startsBlock(lines[i], lines[i + 1]))) buf.push(lines[i++].trim());
    const text = buf.join(' ');
    out.push(`<p>${inline(text)}</p>`);
    paragraphs.push(text);
  }
  const html = out.join('\n');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  return { html, headings, paragraphs: paragraphs.map(plainInline), text, words: countWords(text) };
}
