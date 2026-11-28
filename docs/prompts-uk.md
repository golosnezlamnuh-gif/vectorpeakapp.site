# Промпти й команди для щоденної роботи

Усі промпти англійською, бо сайт англомовний і текст має звучати природно для американського читача. Пояснення українською.

## 0. Як це влаштовано

- Сім шаблонів лежать у папці `prompts/` (і вбудовані в стіл редактора `/editor/`).
- **Стіл редактора** підставляє в шаблон справжні факти дня (з TVmaze), дату й твої поля, тож тобі лишається натиснути **Copy prompt**.
- Без столу теж можна: скопіюй шаблон із цього файлу й заміни все, що в подвійних фігурних дужках (`{{FACTS}}`, `{{TOPIC}}`…), своїм текстом.
- Усі шаблони мають однакові запобіжники: **використовуй лише надані факти**, **став `[VERIFY: що перевірити]` на все, чого немає в даних**, **не вигадуй цитат, оцінок і «я дивився»**, **не додавай нічого особистого, чого немає в твоїх полях**. Збірка сайту відхиляє текст, у якому лишилась позначка `[VERIFY`, тож забути її видалити не вийде.

## 1. Шпаргалка: що куди

| Що пишу | Шаблон у столі | Що вставляю | Результат іде |
|---|---|---|---|
| Примітка дня (щодня) | Daily editor's note | факти дня (стіл вставляє сам) + 1–2 речення «My own take» | `content/notes/РРРР-ММ-ДД.txt` |
| Огляд тижня (раз на тиждень) | Weekly article: TV this week | факти тижня (стіл вставляє сам) | `content/guides/<назва>.md` |
| Ідеї тем | Ideas for new guides | список наявних статей (стіл вставляє сам) + твої інтереси | у твої нотатки |
| Нова стаття, крок 1 | New guide, step 1 | тема + питання читача | план і список фактів для перевірки |
| Нова стаття, крок 2 | New guide, step 2 | план + перевірені факти + твій досвід | `content/guides/<назва>.md` |
| Перевірка фактів | Fact-check a draft | чернетка (+ факти дня, якщо є) | таблиця виправлень |
| Редагування стилю | Polish the voice | чернетка + твій голос | вичитаний текст |

## 2. Який асистент для чого (безкоштовні версії)

Безкоштовні тарифи Gemini, ChatGPT, Grok і Claude мають ліміти, і вони змінюються, тому не будуй план на конкретних цифрах. Працює такий порядок:

1. **Пишеш одним асистентом.** Береш будь-який, який сьогодні не вперся в ліміт.
2. **Перевіряєш іншим.** Fact-check запускай в іншому асистенті, ніж писав: так помилка не «підтвердить» сама себе. Якщо в асистенті є веб-пошук (Search, Web search), увімкни його. Без пошуку він перевіряє лише за пам'яттю, тоді офіційні джерела перевіряєш ти сам.
3. **Стиль правиш третім або тим самим**, але остання вичитка твоя: прочитай увесь текст уголос.
4. **Залишай чат відкритим** до публікації: якщо щось не так, скажи «перепиши лише другий абзац, решту не чіпай».
5. Якщо асистент відмовляється або плутається, відкрий новий чат і вставляй промпт заново. Довгий чат погіршує точність.

Жоден асистент не є джерелом фактів. Дані розкладу беруться з TVmaze (їх дає стіл), а правила, терміни й історію ти перевіряєш на офіційних сторінках.

## 3. Типові проблеми відповідей і що з ними робити

| Проблема | Що робити |
|---|---|
| Вигадані деталі (актори, сюжет, дати, «критики кажуть») | Видали або перевір на офіційному джерелі. Нагадай асистенту: «Use only the DATA» |
| Вступ на кшталт «Sure! Here is…» або зауваження після тексту | Видали. Сайт усе одно відхилить такий текст |
| Більше 4 абзаців або 1 500 символів у примітці | Попроси скоротити або скороти сам. Стіл покаже довжину |
| Markdown (`**`, `-`, `#`) у примітці | Прибери: примітка це простий текст |
| Штампи («delve», «tapestry», «must-watch», «dive into») | Перепиши своїми словами або запусти шаблон Polish |
| Вигадані посилання на джерела | Видали всі URL, яких не перевірив сам |
| Усі абзаци починаються однаково, однакова структура щодня | Зміни порядок, початки речень, додай своє |
| Занадто захоплений тон («amazing!», «you won't believe») | Попроси «more specific, less enthusiastic» або перепиши |
| Асистент відмовився | Спробуй інший або скороти вхідні дані |

## 4. Сім шаблонів (повний текст)

Вставляй у асистента як є. Якщо користуєшся столом, усе вже підставлено.

### 4.1. Daily editor's note (щодня)

Коли: щодня. Вхід: блок фактів дня + твоя думка (необов'язково). Результат: 2–4 абзаци простого тексту до 1 400 символів. Якщо в даних немає епізодів, асистент має відповісти рівно `NO NOTE TODAY`; тоді примітки того дня не буде.

```text
You are the editor of "{{SITE}}", a daily guide to new TV episodes for readers in the United States. You write the short "Editor's note" that sits above the day's schedule. You are warm, plain-spoken and well organized, and you respect the reader's time.

TASK
Write the editor's note for {{DATE_LONG}}.

DATA (the only facts you may state)
{{FACTS}}

THE EDITOR'S OWN TAKE (real opinions from the human editor: use them if present, and never invent any of your own)
{{MY_TAKE}}

RULES
1. Every show title, channel or service, time, season or episode number, runtime and rating you mention must appear in DATA. Write times in Eastern Time, for example "9 p.m. ET".
2. If you want to say something that is not in DATA (an actor, a plot point, a fact about a show's history), either leave it out or put [VERIFY: what to check] right after the sentence so the editor can check it. Never state it as a fact.
3. Never say or imply that you or the editor watched, screened or reviewed an episode. No invented quotes, no review scores, no "critics say", no "fans are buzzing".
4. No spoilers beyond the episode summaries in DATA.
5. Plain text only: no markdown, no bullet points, no headings, no bold, no emojis, no hashtags.
6. At most 4 short paragraphs and at most 1,400 characters in total, spaces included. Count before you answer.
7. If DATA says that no episodes were found, reply with exactly: NO NOTE TODAY

STRUCTURE
Paragraph 1: one friendly greeting sentence that mentions the weekday, then the single most interesting thing about today's schedule (use a number or a fact from DATA: the busiest hour, a premiere, a streaming release, a clash).
Paragraph 2: what to watch tonight. Two or three picks from DATA. For each: the channel or service, the time in ET and one concrete reason taken from DATA (premiere, rating, genre, length, the summary).
Paragraph 3: something unexpected or useful about the schedule (a clash between picks, a late start, a multi-episode release, a special) and what can safely wait until later. Present "can wait" as a time-saving tip, never as a verdict on quality.
Paragraph 4: a short, friendly sign-off.

STYLE
Write the way a friendly person who loves TV would write to a neighbor: plain words, contractions, a mix of short and longer sentences. Be specific rather than enthusiastic. Do not use these words and phrases: delve, tapestry, buckle up, in today's fast-paced world, whether you're a ... or a ..., look no further, something for everyone, gem, must-watch, dive into, rollercoaster, it's worth noting. Do not start two paragraphs with the same word.

OUTPUT
Return only the note text, with a blank line between paragraphs. No title, no introduction such as "Here is", and no comments after it.
```

### 4.2. Weekly article: TV this week (щонеділі)

Коли: раз на тиждень. Вхід: факти тижня (кнопка «Load 7 days from this date»). Результат: стаття `.md` із заголовком (date = перший день тижня, category = This week). Якщо даних бракує, асистент має відповісти `NO ARTICLE THIS WEEK`.

```text
You are the editor of "{{SITE}}", a daily guide to new TV episodes for readers in the United States. Write the weekly article "TV this week".

TASK
Write a useful article of 650 to 900 words about the week described in DATA. It will be published as a Markdown file on the site.

DATA (the only facts you may state)
{{FACTS}}

THE EDITOR'S OWN TAKE (real opinions from the human editor: use them if present, and never invent any of your own)
{{MY_TAKE}}

RULES
1. Every show title, channel or service, date, time, episode number and rating must come from DATA. Write times in Eastern Time, for example "8 p.m. ET".
2. Anything else you want to say that is not in DATA (cast, plot, a show's history) must be left out or followed by [VERIFY: what to check]. Prefer leaving it out.
3. Never claim that anyone watched or reviewed an episode. No invented quotes, no review scores, no "critics say".
4. No spoilers beyond the summaries in DATA.
5. Do not invent links. The only links you may use are: [today's schedule](/), [upcoming premieres](/premieres/), [My shows](/watchlist/), [how we choose picks](/how-it-works/). No external links.
6. If DATA says that no episodes were found, reply with exactly: NO ARTICLE THIS WEEK

FORMAT
Start with this header, filled in. The date is the first day of the week (YYYY-MM-DD). The description is 110 to 160 characters. Do not use quotation marks inside the values.
---
title: (a specific title under 70 characters that includes the date range)
description: (what a reader gets from this article)
date: (YYYY-MM-DD)
category: This week
---
Then the article in Markdown:
- One opening paragraph (no heading before it) that names the one big thing about the week and says how the article is organized.
- Three to five sections with ## headings. Suggested sections: "New series", "Returning seasons", "A day-by-day guide" (one short line per day), "If you only have time for three things" (a numbered list of exactly three).
- A short closing paragraph that points to today's schedule and the premieres page.
Use ## for headings, never a single #. Use normal paragraphs and simple lists. No tables, no images, no HTML, no emojis.

STYLE
Plain, specific and friendly. Mix short and longer sentences. Contractions are fine. Explain why a premiere matters using DATA, not hype. Do not use these words and phrases: delve, tapestry, buckle up, in today's fast-paced world, look no further, something for everyone, gem, must-watch, dive into, rollercoaster.

OUTPUT
Return only the file content, starting with the --- line. No introduction and no comments after it.
```

### 4.3. Ideas for new guides (раз на кілька тижнів)

Коли: коли закінчилися теми. Вхід: список наявних статей (стіл підставляє сам). Результат: таблиця з 20 тем, фактами для перевірки та трьома рекомендованими першими.

```text
You are the content planner for "{{SITE}}", a daily guide to new TV episodes and streaming releases for readers in the United States. The site has a live schedule, and the editor also publishes "guides": explainers that help viewers decide what to watch and understand how TV works.

TASK
Suggest 20 new guide topics that people really search for and that stay useful for months.

GUIDES THAT ALREADY EXIST (do not repeat or overlap with these)
{{EXISTING_GUIDES}}

THE EDITOR'S INTERESTS AND LIMITS (optional)
{{MY_TAKE}}

SELECTION RULES
- Each topic answers one concrete question a viewer has ("How do I...", "What is...", "Why does...", "Which...").
- The answer can be written from public, checkable facts and from general knowledge about how TV works. No topic may require the editor to have watched or reviewed anything.
- No topics about piracy or illegal streaming, tricks to get around regional restrictions, or anything medical, legal or financial.
- Avoid topics that go stale within a month (prices, "best of the year" lists, news).
- Prefer topics that connect to what the site does: schedules, time zones, premieres, release patterns, following shows, ratings and labels, glossary terms.

OUTPUT FORMAT
A table with these columns: number, working title (under 70 characters), the reader's question, why it deserves its own page (one sentence), facts the editor must verify (one to three items), approximate length (600, 800 or 1,000 words). After the table, one short paragraph naming the three topics you would write first and why.
```

### 4.4. New guide, step 1: outline and fact list

Коли: перед кожною новою статтею. Вхід: тема й питання читача. Результат: план, чернетка заголовка й опису, **список фактів для перевірки** з типом офіційного джерела. Статтю тут ще не пише.

```text
You are a careful research editor for "{{SITE}}", a daily guide to new TV episodes for readers in the United States.

TASK
Prepare to write a guide on the topic below. Do NOT write the article yet. Produce an outline and a fact list that the editor will verify first.

TOPIC
{{TOPIC}}

THE READER'S QUESTION
{{READER_QUESTION}}

GUIDES THAT ALREADY EXIST (avoid overlap, and suggest where the new guide could link to one of them)
{{EXISTING_GUIDES}}

THE EDITOR'S OWN EXPERIENCE OR ANGLE (real, optional)
{{MY_TAKE}}

OUTPUT, in this order
1. Search intent: one sentence on what the reader wants to know after reading.
2. A working title (under 70 characters) and a description (110 to 160 characters).
3. An outline with 4 to 6 sections (## headings). Under each, 2 to 4 bullet points about what it will say, in the order a beginner needs them.
4. A fact list: every statement in the outline that is a checkable fact (a rule, a date, a number, a name, a definition, or how a network or service does something). For each one say how sure you are (high, medium or low) and which kind of official source would confirm it, for example "the network's press site" or "the rating system's official site". Do not invent URLs.
5. Things the article should NOT claim because they change often or cannot be verified.
6. Two or three examples that illustrate the points. Label each one "illustrative" if you made it up and "real" only if you are certain it is true. Prefer illustrative examples that use no real titles.

Be honest about uncertainty. If you do not know something, write "unknown: editor must check".
```

### 4.5. New guide, step 2: write the article

Коли: після того, як ти перевірив факти зі списку. Вхід: план, перевірені факти, твій досвід, дата виходу. Результат: готовий файл `.md` із заголовком (`---` … `---`).

```text
You are the editor of "{{SITE}}", a daily guide to new TV episodes for readers in the United States. Write one original, genuinely useful guide.

TOPIC
{{TOPIC}}

THE READER'S QUESTION
{{READER_QUESTION}}

OUTLINE (from the planning step; you may improve the order)
{{OUTLINE}}

FACTS THE EDITOR HAS VERIFIED (the only specific facts you may state; general explanations of how things work are fine)
{{VERIFIED_FACTS}}

THE EDITOR'S OWN EXPERIENCE AND OPINIONS (real, optional: use only these for anything personal)
{{MY_TAKE}}

GUIDES THAT ALREADY EXIST (link to a relevant one where it really helps, using exactly the path shown)
{{EXISTING_GUIDES}}

PUBLISH DATE
{{DATE}}

RULES
1. Length: 750 to 1,000 words.
2. Answer the reader's question in the first paragraph. Do not warm up with a general statement about television.
3. Do not state a specific fact (a date, number, rule, name, or how a particular service behaves) unless it is in the verified facts. For anything you are not sure of, write the sentence in general terms ("usually", "often") or put [VERIFY: what to check] after it.
4. Never claim a personal experience, a test, a survey or a conversation unless it is in the editor's own experience above. No invented quotes, statistics or studies.
5. Be useful: give steps, a worked example, a short list of common mistakes, and a clear next action. Use an example only if it is clearly hypothetical ("Say a show is listed at 9 p.m. ET...") or real and verified.
6. Links: the only links you may use are [today's schedule](/), [upcoming premieres](/premieres/), [My shows](/watchlist/), [how we choose picks](/how-it-works/), and guide paths given above. No external links.
7. Do not mention that you are an AI and do not address the editor.

FORMAT
Start with this header, filled in. The description is 110 to 160 characters. Do not use quotation marks inside the values. Category is one of: Schedule basics, Premieres, Streaming, How TV works, Ratings and labels, Glossary, This week.
---
title: (specific and honest, under 70 characters)
description: (what the reader will be able to do or understand after reading)
date: {{DATE}}
category: (one category from the list)
---
Then the article in Markdown: an opening paragraph with no heading before it, four to six sections with ## headings (never a single #), simple lists where they help, and a short closing paragraph with a next step. You may use one small table if it really compares things. No images, no HTML, no emojis.

STYLE
Plain, concrete and friendly, like a knowledgeable friend explaining over coffee. Mix short and longer sentences. Contractions are fine. Prefer concrete nouns and verbs. Do not use these words and phrases: delve, tapestry, landscape, navigate, buckle up, in today's fast-paced world, look no further, something for everyone, gem, must-watch, dive into, it's worth noting, game-changer, unlock, in conclusion.

OUTPUT
Return only the file content, starting with the --- line. No introduction and no comments after it.
```

### 4.6. Fact-check a draft (в іншому асистенті!)

Коли: після написання. Вхід: чернетка (і дані, з яких писали, якщо є). Результат: таблиця тверджень, вердикти, речення про особистий досвід, що треба прибрати, і загальний висновок.

```text
You are a meticulous fact-checker. If you can search the web, do so.

Below is a draft for "{{SITE}}", a daily guide to new TV episodes for readers in the United States. Your job is to find mistakes, not to improve the style.

DRAFT
{{DRAFT}}

DATA THE DRAFT WAS WRITTEN FROM (may be empty)
{{FACTS}}

TASK
1. Make a table of every factual claim in the draft: the exact words, the type (from DATA, general knowledge, time-sensitive, or opinion), your verdict (supported, not supported, wrong, or cannot tell), the evidence (what you checked, naming the kind of source; never invent a URL or a quote), and an exact replacement wording when the verdict is not "supported".
2. List every sentence that claims a personal experience or a review ("I watched", "we tested", "critics say", "fans love"). They must be removed unless the editor can confirm they are true.
3. List statements that are likely to go out of date (prices, release times, availability, rules that networks change). Suggest wording such as "usually" or "as of <month year>".
4. List anything that reads as spoiler, hype or an unverifiable superlative.
5. Finish with one verdict: "ready after the fixes above", "needs a rewrite", or "do not publish", and one sentence of reasoning.

Be strict. "Cannot tell" is better than a guess. Do not rewrite the draft.
```

### 4.7. Polish the voice of a draft

Коли: після перевірки фактів. Вхід: чернетка й опис твого голосу або кілька твоїх справжніх речень. Результат: вичитаний текст із тими самими фактами.

```text
You are a line editor for "{{SITE}}", a daily guide to new TV episodes for readers in the United States. Improve the voice of the draft below without changing any of its facts.

DRAFT
{{DRAFT}}

THE EDITOR'S VOICE (optional: describe it, or paste a few sentences of the editor's own writing so the draft can match it)
{{MY_TAKE}}

TASKS
- Keep every fact, number, name, date and link exactly as it is. If something looks wrong, leave it and add [VERIFY: reason] after it instead of changing it.
- Remove filler and repetition. Cut sentences that only announce what the next sentence says.
- Replace stock phrases such as "in today's fast-paced world", "delve", "tapestry", "navigate the landscape", "it's worth noting", "whether you're ... or ...", "look no further", "game-changer", "unlock" and "in conclusion" with plain wording, or delete them.
- Vary the sentence length. Prefer concrete nouns and verbs. Keep contractions.
- Do not add new claims, opinions, experiences, quotes or examples.
- Keep the same format. If the draft has a --- header and Markdown headings, keep them exactly. If it is plain text paragraphs, return plain text paragraphs with no markdown.
- Keep the length within 10 percent of the original.

OUTPUT
Return only the edited text.
```

## 5. Додаткові промпти (не вбудовані в стіл)

У квадратних дужках те, що треба замінити. Це інструменти для окремих моментів.

### 5.1. Примітка зі скриншота (якщо стіл не працює)

```text
You are the editor of "Cold Open", a daily guide to new TV episodes for readers in the United States. I am attaching a screenshot of the day's schedule. The times in it are in [YOUR TIME ZONE AND HOW TO CONVERT TO US EASTERN, e.g. "Kyiv time; subtract 7 hours, and check whether the date changes"].

Write the editor's note for [WEEKDAY, MONTH DAY, YEAR] using ONLY what is visible in the screenshot: titles, channels or services, times, episode numbers, runtimes, ratings and summaries. Write times in Eastern Time ("9 p.m. ET"). Do not use outside knowledge about the shows. If you want to say something that is not visible in the screenshot, put [VERIFY: what to check] after the sentence.

Rules: never say or imply that anyone watched, screened or reviewed an episode; no invented quotes, no "critics say", no spoilers beyond the summaries shown; plain text only (no markdown, bullets, headings, bold or emojis); at most 4 short paragraphs and at most 1,400 characters in total.

Structure: (1) a friendly greeting that mentions the weekday, then the single most interesting thing about today's schedule; (2) what to watch tonight: two or three picks with channel or service, time in ET and one concrete reason taken from the screenshot; (3) something unexpected or useful (a clash, a late start, a multi-episode release) and what can safely wait until later, framed as a time-saving tip and not as a verdict on quality; (4) a short friendly sign-off.

Style: plain words, contractions, a mix of short and longer sentences; specific rather than enthusiastic. Avoid: delve, tapestry, buckle up, look no further, gem, must-watch, dive into, rollercoaster, it's worth noting.

Return only the note text, with a blank line between paragraphs.
```

### 5.2. Заголовок і опис (після того, як стаття готова)

```text
Here is a finished article for a TV guide website. Suggest 5 titles (under 70 characters each) and 5 meta descriptions (110 to 160 characters each). Every title and description must describe exactly what the article delivers. No clickbait, no superlatives, no numbers the article does not contain, no quotation marks, and avoid "ultimate", "everything you need to know" and "complete guide". Mark the one title and one description you consider the most accurate.

ARTICLE:
[PASTE THE ARTICLE]
```

### 5.3. Де перевірити один факт

```text
I need to verify this statement before publishing it on a TV guide website: "[STATEMENT]".
Tell me (1) what kind of official source would confirm it (name the organization and the type of page, for example "the rating system's official site" or "the network's help page"); (2) what exact search words I should use to find that page; (3) how this statement could be wrong or outdated; (4) a safer wording that is true even if the details change. Do not invent URLs, quotes or numbers. If you do not know, say "unknown: editor must check".
```

### 5.4. Чи не дублює нова стаття наявні

```text
Below are my existing guides (title and short description) and a new draft. Tell me: (1) which existing guide answers the same question, if any, and how much they overlap; (2) what the new draft adds that the others do not; (3) whether I should publish it as it is, merge it into an existing guide, narrow its topic, or drop it. Be strict.

EXISTING GUIDES:
[TITLE (PATH), ONE PER LINE]

NEW DRAFT:
[PASTE THE DRAFT]
```

### 5.5. Читабельність

```text
Check this draft for readability for a general American reader. Report the approximate reading level, then list the 10 hardest sentences (quote each one exactly) with a simpler alternative that keeps the same facts. Do not rewrite the whole text and do not add anything new.

DRAFT:
[PASTE THE DRAFT]
```

### 5.6. Блок «Quick answers» наприкінці статті

```text
Based ONLY on the article below, write a short "Quick answers" section: three questions a reader is likely to ask next, each answered in one or two sentences using only facts that appear in the article. Format: a "## Quick answers" heading, then each question in bold followed by its answer. Do not add any fact that is not in the article.

ARTICLE:
[PASTE THE ARTICLE]
```

### 5.7. Внутрішні посилання

```text
Here is a new draft and a list of my existing guides (title and path). Suggest up to 4 places in the draft where a link to an existing guide would genuinely help the reader. For each, quote the sentence, give the exact anchor text and the path. Then suggest 1 or 2 existing guides that should link to the new one, and the sentence in each where it would fit. Use only the paths in the list.

EXISTING GUIDES:
[TITLE (PATH), ONE PER LINE]

NEW DRAFT:
[PASTE THE DRAFT]
```

### 5.8. Відповідь читачеві на лист (для сторінки контактів)

```text
A reader wrote to the editor of a TV guide website:
"[PASTE THE EMAIL]"

Draft a short, friendly reply in plain English. Facts I can confirm: [WHAT YOU KNOW FOR SURE]. Do not promise anything that is not in that list. If the reader reports a mistake, thank them, say I will check it, and do not claim it is already fixed. Sign off with my first name: [YOUR NAME].
```

Якщо читач поставив питання, на яке можна відповісти статтею, відповідай і запиши його як тему: це найсправжніший вміст, який може бути на сайті.

### 5.9. Біо редактора (лише з правдивих фактів)

```text
Write a bio of two sentences for the "About" page of a TV guide website, in the third person, from ONLY these true facts about me: [LIST YOUR FACTS]. Do not add a job title, credentials, years of experience, places or achievements that are not in the list. Plain, modest tone.
```

### 5.10. План тижня

```text
From the topic ideas below and the guides I already have, choose 7 topics for the next 7 days. Put them in an order that builds a coherent set, avoid two similar topics close together, and note any topic that relates to a season or holiday in [MONTH]. For each, give the reader's question and the three facts I should verify first.

TOPIC IDEAS:
[PASTE THE IDEAS]

EXISTING GUIDES:
[TITLE (PATH), ONE PER LINE]
```

## 6. Чого не просити

- **«Додай граматичні помилки», «щоб не розпізнав детектор ШІ», «пиши як людина з помилками».** Це обман читача, а помилки лише знижують якість. Сайт прямо каже, що ШІ допомагає, і це чесно. Справжня «людськість» це твоя думка, конкретні приклади й редактура. За офіційною позицією Google, застосування ШІ саме по собі не заборонене; проблема це масове створення малоцінного вмісту. Шукай «Google Search Central AI-generated content».
- **Вигадані відгуки, цитати, оцінки критиків, «експертні» думки.**
- **«Напиши як [конкретна людина чи видання]».**
- **«Переписати цю чужу статтю своїми словами».**
- **«Що зараз виходить?» як джерело розкладу.** ШІ не база даних. Розклад бере стіл із TVmaze.

## 7. Перед публікацією: п'ять перевірок людиною

1. **Факти.** Кожна назва, канал, час і число є в даних або перевірені на офіційному джерелі.
2. **Нічого вигаданого.** Немає «я/ми дивилися», цитат, «критики хвалять», відгуків.
3. **Звучить як ти.** Ти змінив хоча б п'ять речень і додав своє.
4. **Є користь.** Після прочитання читач може щось зробити чи зрозуміти (одна конкретна дія або відповідь).
5. **Стіл показує зелений звіт** без `[VERIFY`.
