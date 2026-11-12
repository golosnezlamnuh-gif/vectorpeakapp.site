// Test fixtures that mimic the documented TVmaze response shapes. Shows are fictional.
// Used only by tests and by the offline build self-test; none of this ships in site/.

const N = (id, name, code = 'US', tz = 'America/New_York') => ({ id, name, country: { name: code === 'US' ? 'United States' : 'United Kingdom', code, timezone: tz }, officialSite: null });
const W = (id, name, code = null) => ({ id, name, country: code ? { name: 'United States', code, timezone: 'America/New_York' } : null, officialSite: null });

export const SHOWS = {
  1: { name: 'Harbor Lights', type: 'Scripted', genres: ['Drama', 'Crime'], net: N(1, 'NBC'), weight: 92, rating: 8.1, runtime: 60, premiered: '2019-09-26', status: 'Running',
    summary: '<p>A harbor town police unit <b>investigates</b> crimes that tie back to one old shipwreck. Season seven is darker than ever &amp; more personal.</p>' },
  2: { name: 'The Long Shift', type: 'Scripted', genres: ['Drama', 'Medical'], net: N(2, 'ABC'), weight: 88, rating: 7.6, runtime: 60, premiered: '2022-01-12', status: 'Running',
    summary: '<p>Night-shift staff at an overstretched city hospital.</p>' },
  3: { name: 'Paper Moons', type: 'Scripted', genres: ['Comedy'], net: N(3, 'CBS'), weight: 75, rating: 7.0, runtime: 30, premiered: '2024-10-03', status: 'Running',
    summary: '<p>Three roommates run a failing stationery shop.</p>' },
  4: { name: 'Bluff Creek', type: 'Scripted', genres: ['Drama', 'Mystery'], net: N(4, 'FOX'), weight: 70, rating: null, runtime: 60, premiered: '2026-11-10', status: 'Running',
    summary: '<p>A deputy returns to the mountain town she swore she would never see again.</p>' },
  5: { name: 'Salt & Ash', type: 'Scripted', genres: ['Drama', 'Thriller'], net: N(5, 'FX'), weight: 94, rating: 8.7, runtime: 58, premiered: '2021-03-04', status: 'Running',
    summary: '<p>A salt-mining family empire is shaken by a decades-old betrayal.</p>' },
  6: { name: 'Quiet Orbit', type: 'Scripted', genres: ['Science-Fiction', 'Drama'], net: N(6, 'AMC'), weight: 81, rating: 8.3, runtime: 60, premiered: '2025-04-20', status: 'Running',
    summary: '<p>The crew of a deep-space relay station loses contact with Earth.</p>' },
  7: { name: 'Midnight Ledger', type: 'Scripted', genres: ['Drama', 'Crime'], net: N(7, 'HBO'), weight: 97, rating: 9.0, runtime: 55, premiered: '2018-06-10', status: 'Running',
    summary: '<p>An accountant keeps two sets of books for the city’s most dangerous families.</p>' },
  8: { name: 'Kitchen Wars', type: 'Reality', genres: ['Food'], net: N(8, 'Food Network'), weight: 55, rating: 6.4, runtime: 60, premiered: '2015-02-01', status: 'Running',
    summary: '<p>Eight chefs, one pantry, and a ticking clock.</p>' },
  9: { name: 'Lantern Hill', type: 'Scripted', genres: ['Fantasy', 'Drama'], net: N(9, 'The CW'), weight: 64, rating: 7.2, runtime: 60, premiered: '2023-10-08', status: 'Running',
    summary: '<p>Every house on Lantern Hill hides a door to somewhere else.</p>' },
  10: { name: 'Old Money', type: 'Scripted', genres: ['Drama'], net: N(10, 'Showtime'), weight: 78, rating: 7.9, runtime: 50, premiered: '2026-10-25', status: 'Running',
    summary: '<p>A merger forces two feuding banking dynasties under one roof.</p>' },
  11: { name: 'Static', type: 'Animation', genres: ['Comedy', 'Science-Fiction'], net: N(11, 'Adult Swim'), weight: 66, rating: 7.8, runtime: 15, premiered: '2017-07-16', status: 'Running',
    summary: '<p>A repairman fixes televisions that receive broadcasts from other universes.</p>' },
  12: { name: 'Night Desk', type: 'Talk Show', genres: ['Comedy'], net: N(12, 'NBC'), weight: 90, rating: null, runtime: 60, premiered: '2014-02-17', status: 'Running', summary: '<p>Late-night interviews and sketches.</p>' },
  13: { name: 'Evening Report', type: 'News', genres: [], net: N(13, 'CBS'), weight: 80, rating: null, runtime: 30, premiered: '1999-01-04', status: 'Running', summary: null },
  14: { name: 'The Weekly Quiz', type: 'Game Show', genres: [], net: N(14, 'ABC'), weight: 40, rating: null, runtime: 30, premiered: '2010-09-12', status: 'Running', summary: null },
  15: { name: 'Pixel Pals', type: 'Animation', genres: ['Children', 'Comedy'], net: N(15, 'Nickelodeon'), weight: 50, rating: 6.9, runtime: 25, premiered: '2020-01-03', status: 'Running',
    summary: '<p>Tiny game characters get a surprise visitor.</p>' },
  16: { name: 'Deep Field', type: 'Documentary', genres: ['Nature', 'Science'], net: N(16, 'PBS'), weight: 45, rating: 8.0, runtime: 60, premiered: '2012-10-01', status: 'Running',
    summary: '<p>How astronomers map the earliest galaxies.</p>' },
  17: { name: 'Gridlock', type: 'Scripted', genres: ['Action', 'Crime'], net: N(17, 'USA Network'), weight: 58, rating: 6.8, runtime: 60, premiered: '2025-06-02', status: 'Running',
    summary: '<p>A traffic-cop crew chases a heist that moves through the city’s tunnels.</p>' },
  18: { name: 'The Understudy', type: 'Scripted', genres: ['Comedy'], net: N(18, 'Comedy Central'), weight: 52, rating: 7.1, runtime: 30, premiered: '2024-02-20', status: 'Running',
    summary: '<p>A stand-in actor keeps getting the lead role by accident.</p>' },
  19: { name: 'Frost Line', type: 'Scripted', genres: ['Thriller', 'Horror'], net: N(19, 'Paramount Network'), weight: 61, rating: 7.4, runtime: 60, premiered: '2026-09-14', status: 'Running',
    summary: '<p>A research station, a snowstorm, and a head count that does not add up.</p>' },
  20: { name: 'Orchard Street', type: 'Scripted', genres: ['Drama', 'Romance'], net: N(20, 'The CW'), weight: 49, rating: null, runtime: 60, premiered: '2025-01-21', status: 'Running', summary: null },
  21: { name: 'Estrellas del Norte', type: 'Scripted', genres: ['Drama'], net: N(21, 'Univision'), weight: 60, rating: null, runtime: 60, premiered: '2024-03-03', status: 'Running', language: 'Spanish',
    summary: '<p>Una familia, un ranchero.</p>' },
  // streaming
  31: { name: 'Nine Rooms', type: 'Scripted', genres: ['Thriller', 'Mystery'], web: W(31, 'Netflix'), weight: 95, rating: null, runtime: 52, premiered: '2026-11-10', status: 'Running',
    summary: '<p>Nine strangers wake up in a house with nine locked rooms.</p>' },
  32: { name: 'Hollow Season', type: 'Scripted', genres: ['Drama', 'Fantasy'], web: W(32, 'Max', 'US'), weight: 86, rating: 8.4, runtime: 58, premiered: '2024-08-18', status: 'Running',
    summary: '<p>The long-awaited third season picks up one winter after the flood.</p>' },
  33: { name: 'Tin Crown', type: 'Scripted', genres: ['Drama', 'History'], web: W(33, 'Apple TV+'), weight: 83, rating: 8.0, runtime: 55, premiered: '2023-05-05', status: 'Running',
    summary: '<p>A minor king, a major war.</p>' },
  34: { name: 'Last Signal', type: 'Documentary', genres: ['Science', 'Technology'], web: W(34, 'Prime Video', 'US'), weight: 48, rating: 7.7, runtime: 45, premiered: '2026-11-10', status: 'Running',
    summary: '<p>Inside the final days of a deep-space probe.</p>' },
  35: { name: 'Sweet Hours', type: 'Scripted', genres: ['Comedy', 'Romance'], web: W(35, 'Hulu', 'US'), weight: 72, rating: 7.3, runtime: 28, premiered: '2025-09-09', status: 'Running',
    summary: '<p>Two pastry chefs fall in love over a shared oven.</p>' },
  36: { name: 'Neon Alley', type: 'Animation', genres: ['Action', 'Anime'], web: W(36, 'Disney+'), weight: 57, rating: 7.5, runtime: 24, premiered: '2022-04-02', status: 'Running',
    summary: '<p>A courier races through a city that never sleeps.</p>' },
  37: { name: 'Quiet Please', type: 'Scripted', genres: ['Comedy'], web: W(37, 'Peacock', 'US'), weight: 44, rating: 6.6, runtime: 22, premiered: '2025-02-02', status: 'Running', summary: null },
  38: { name: 'Das Haus', type: 'Scripted', genres: ['Drama'], web: W(38, 'Netflix'), weight: 62, rating: 7.9, runtime: 50, premiered: '2024-11-01', status: 'Running', language: 'German',
    summary: '<p>Eine Familie.</p>' }
};

function showObj(id) {
  const s = SHOWS[id];
  return {
    id, url: `https://www.tvmaze.com/shows/${id}/x`, name: s.name, type: s.type, language: s.language === undefined ? 'English' : s.language,
    genres: s.genres, status: s.status, runtime: s.runtime, averageRuntime: s.runtime, premiered: s.premiered, ended: null,
    officialSite: `https://example.org/${id}`, schedule: { time: '21:00', days: ['Tuesday'] }, rating: { average: s.rating }, weight: s.weight,
    network: s.net || null, webChannel: s.web || null, externals: { tvrage: null, thetvdb: null, imdb: id === 7 ? 'tt1234567' : null },
    image: id === 20 ? null : { medium: `https://static.tvmaze.com/uploads/images/medium_portrait/${id}/poster.jpg`, original: `https://static.tvmaze.com/uploads/images/original_untouched/${id}/poster.jpg` },
    summary: s.summary, updated: 1700000000, _links: { self: { href: `https://api.tvmaze.com/shows/${id}` } }
  };
}

function offsetFor(date) { return date >= '2026-11-01' && date < '2027-03-14' ? '-05:00' : '-04:00'; } // US Eastern, DST ends 2026-11-01

let EP = 900000;
function air(date, id, time, season, number, name, runtime, summary, opts = {}) {
  const timed = !!time;
  const stamp = timed ? `${date}T${time}:00${offsetFor(date)}` : `${date}T12:00:00+00:00`;
  return {
    // deterministic: the same show/day/number always gets the same episode id
    id: opts.id || id * 10000000 + (Number(date.slice(5, 7)) * 31 + Number(date.slice(8))) * 100 + ((number || 0) % 100),
    url: `https://www.tvmaze.com/episodes/${id}`, name, season, number, type: opts.type || 'regular', airdate: date, airtime: timed ? time : '',
    airstamp: stamp, runtime: runtime === undefined ? null : runtime, rating: { average: opts.rating === undefined ? null : opts.rating },
    image: opts.noImage ? null : { medium: `https://static.tvmaze.com/uploads/images/medium_landscape/${id}/e.jpg`, original: `https://static.tvmaze.com/uploads/images/original_untouched/${id}/e.jpg` },
    summary: summary === undefined ? null : summary, show: showObj(id), _links: { self: { href: 'https://api.tvmaze.com/episodes/1' } }
  };
}
const dayIndex = (date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse('2026-11-10T00:00:00Z')) / 86400000);

/** US network schedule for a date (same shape as GET /schedule?country=US&date=) */
export function scheduleUS(date) {
  const d = dayIndex(date);
  const n = (base) => Math.max(1, base + d);
  const list = [
    air(date, 1, '20:00', 7, n(5), 'The Tide Table', 60, '<p>Detective Marlow follows a lead to the old cannery, where the first clue to the shipwreck turns up. Meanwhile, the harbor master hides a secret.</p>', { rating: 8.4 }),
    air(date, 2, '21:00', 3, n(5), 'Double Coverage', 60, '<p>A flu outbreak leaves the ward understaffed on the busiest night of the year.</p>'),
    air(date, 3, '20:30', 2, n(5), 'Moving Day', 30, '<p>The roommates <i>finally</i> repaint the shop. It does not go well.</p>', { noImage: true }),
    air(date, 5, '22:00', 4, d === 0 || d === 3 ? 1 : n(1) + 1, 'Embers', 58, '<p>Four years after the collapse, the family gathers for a funeral nobody wants to attend.</p>', { rating: 8.9 }),
    air(date, 6, '21:00', 2, n(6), 'Handshake Protocol', 60, '<p>A message arrives from Earth, but it is addressed to someone who died.</p>'),
    air(date, 7, '21:00', 5, n(9), 'Closing Entries', 55, '<p>The ledger finally goes to the people it was meant to protect.</p>', { rating: 9.2 }),
    air(date, 8, '20:00', 12, n(4), 'Mystery Basket', 60, '<p>Chefs must cook with ingredients from a vending machine.</p>'),
    air(date, 9, '20:00', 6, n(3), 'The Green Door', 60, null),
    air(date, 10, '21:00', 1, n(3), 'The Merger', 50, '<p>Both families pretend to like each other for one weekend.</p>'),
    air(date, 11, '23:30', 9, n(8), 'Channel Surfing', 15, '<p>The repairman finds a station that is broadcasting him.</p>'),
    air(date, 12, '23:35', 12, n(100), 'Guest: A. Singer', 60, '<p>Interviews and a musical performance.</p>'),
    air(date, 13, '18:30', 1, 1, 'Evening Report', 30, null),
    air(date, 14, '19:00', 8, n(20), 'Quiz Night', 30, null),
    air(date, 15, '17:00', 4, n(2), 'Pixel Party', 25, '<p>Everyone is invited. Nobody can find the door.</p>'),
    air(date, 16, '21:00', 14, n(7), 'The Oldest Light', null, '<p>Astronomers map the first galaxies.</p>'),
    air(date, 17, '22:00', 2, n(2), 'Gridlock', 60, '<p>A tunnel closes at rush hour.</p>'),
    air(date, 18, '22:00', 3, n(3), 'Curtain Call', 30, '<p>The lead disappears an hour before the show.</p>'),
    air(date, 19, '21:00', 1, n(5), 'Head Count', 60, '<p>Eleven people in, ten people out.</p>'),
    air(date, 20, '21:00', 2, n(1), 'Pilot Light', 60, null),
    air(date, 21, '20:00', 3, n(1), 'Capítulo uno', 60, '<p>Una familia.</p>')
  ];
  if (d === 0) list.push(air(date, 4, '20:00', 1, 1, 'Pilot', 60, '<p>Deputy Reyes drives into Bluff Creek with a box of files and no plan.</p>'));
  return list;
}

/** Streaming schedule (shape of GET /schedule/web: show lives under _embedded.show) */
function web(items) { return items.map((e) => { const { show, ...rest } = e; return { ...rest, _embedded: { show } }; }); }
export function webUS(date) {
  const d = dayIndex(date);
  return web([
    air(date, 32, '03:00', 3, 1, 'Thaw', 58, '<p>A year after the flood, the survivors argue over what to rebuild.</p>', { rating: 8.5 }),
    air(date, 32, '03:00', 3, 2, 'High Water', 58, '<p>The council votes.</p>'),
    air(date, 34, '', 1, 1, 'The Final Orbit', 45, '<p>The probe’s last signal reaches mission control.</p>'),
    air(date, 35, '', 2, Math.max(1, 4 + d), 'Second Rise', 28, null),
    air(date, 37, '', 1, 6 + (d > 0 ? d : 0), 'Mute', 22, null),
    air(date, 33, '09:00', 2, 1, 'The Minor King', 55, '<p>A coronation, a rebellion, and a very short guest list.</p>'),
    // same episode id as in the TV list: must be de-duplicated
    { ...air(date, 1, '20:00', 7, Math.max(1, 5 + d), 'The Tide Table', 60, '<p>duplicate</p>', { id: 1 }), id: scheduleUS(date)[0].id }
  ]);
}
export function webGlobal(date) {
  return web([
    air(date, 31, '03:00', 1, 1, 'Room One', 52, '<p>The first door opens on a kitchen that looks exactly like yours.</p>'),
    air(date, 31, '03:00', 1, 2, 'Room Two', 52, '<p>The second door does not open at all.</p>'),
    air(date, 36, '', 3, Math.max(1, 7 + dayIndex(date)), 'Courier Run', 24, '<p>A package that cannot be delivered.</p>'),
    air(date, 38, '', 2, 4, 'Folge vier', 50, '<p>Deutsch.</p>')
  ]);
}
export function scheduleGB(date) {
  const gb = (id, name, show) => ({ ...show, id: ++EP, name });
  return [
    { ...air(date, 3, '21:00', 1, 1, 'Cold Snap', 45, '<p>A flood warning in a seaside town.</p>'), show: { ...showObj(3), id: 903, name: 'Tide Warning', network: N(90, 'BBC One', 'GB', 'Europe/London') } }
  ].map((e) => ({ ...e, airstamp: `${date}T21:00:00+00:00` }));
}

export function showFull(id, nowIso = '2026-11-10T21:42:00-05:00') {
  const s = showObj(id);
  const now = Date.parse(nowIso);
  const eps = [];
  for (let sn = 1; sn <= 2; sn++) for (let n = 1; n <= 10; n++) {
    const ts = now + ((sn - 2) * 10 + (n - 5)) * 7 * 86400000;
    const dt = new Date(ts).toISOString();
    eps.push({ id: id * 10000 + sn * 100 + n, name: `Episode ${sn}x${n}`, season: sn, number: n, type: 'regular', airdate: dt.slice(0, 10), airtime: '21:00', airstamp: dt, runtime: 60,
      rating: { average: n % 3 ? 7.5 : null }, summary: '<p>Plot.</p>', image: null });
  }
  eps.push({ id: id * 10000 + 999, name: 'Holiday special', season: 2, number: null, type: 'significant_special', airdate: '2026-12-25', airtime: '', airstamp: '2026-12-25T12:00:00+00:00', runtime: 90, rating: { average: null }, summary: null, image: null });
  const cast = [['Ada Rowe', 'Det. Marlow'], ['Ben Okoye', 'Harbor Master'], ['Chi Tran', 'Coroner'], ['Dmitri Vale', 'Mayor']].map(([p, c], i) => ({
    person: { id: 100 + i, name: p, image: null }, character: { id: 200 + i, name: c }, self: false, voice: false }));
  return { ...s, _embedded: { episodes: eps, cast } };
}
export function showWithNext(id, nowIso = '2026-11-10T21:42:00-05:00') {
  const s = showObj(id);
  const when = new Date(Date.parse(nowIso) + 2 * 86400000 + 3600000).toISOString();
  return { ...s, _embedded: { nextepisode: { id: id * 10 + 7, name: 'Next one', season: 2, number: 7, type: 'regular', airdate: when.slice(0, 10), airtime: '21:00', airstamp: when, runtime: 60, summary: '<p>Soon.</p>', image: null } } };
}
export function search(q) {
  const ids = Object.keys(SHOWS).map(Number).filter((id) => SHOWS[id].name.toLowerCase().includes(q.toLowerCase()));
  return ids.map((id) => ({ score: 1.2, show: showObj(id) }));
}
