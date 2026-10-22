// End-to-end smoke test: node tests/e2e.mjs  (needs `npm run build` first and Chrome at CHROME_PATH or /usr/bin/google-chrome)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';

const PORT = 4173;
const shots = process.env.SHOTS_DIR;
if (shots) mkdirSync(shots, { recursive: true });
const data = JSON.parse(readFileSync('public/data/schedule.json', 'utf8'));
const lectures = data.courses.filter((c) => c.category === 'lecture');
const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3);

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };

// find two lectures with overlapping slots on the same day
let pair;
outer: for (const a of lectures) for (const b of lectures) {
  if (a.id >= b.id) continue;
  for (const sa of a.slots) for (const sb of b.slots)
    if (sa.day === sb.day && toMin(sa.start) < toMin(sb.end) && toMin(sb.start) < toMin(sa.end)) { pair = [a, b]; break outer; }
}
const cit = lectures.find((c) => c.modules.includes('CIT323007'));
const flagged = lectures.find((c) => c.ects_conflict && c.slots.length);   // a lecture whose credit sources disagree

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const url = `http://localhost:${PORT}/`;
  await page.goto(url);
  await page.waitForSelector('[data-testid=grid] .box');

  const visibleSlots = (c) => (c.slots.some((s) => s.n >= 2) ? c.slots.filter((s) => s.n !== 1) : c.slots);   // one-off dates of recurring lectures are not drawn
  const expectedBoxes = lectures.reduce((n, c) => n + visibleSlots(c).length, 0);
  check('only lectures shown by default', (await page.locator('.box').count()) === expectedBoxes, `${await page.locator('.box').count()} boxes, expected ${expectedBoxes}`);
  check('type filter row has 6 checkboxes', (await page.locator('[data-testid=types] input').count()) === 6);
  check('no type tags (VO/VI) on boxes', (await page.locator('.box .badge').count()) === 0 && !(await page.locator('.box .box-sub').allInnerTexts()).some((t) => /\b(VO|VI|UE|SE)\b/.test(t)));
  const citBox = await page.locator(`[data-key="c${cit.id}:0"]`).innerText();
  check('ECTS shown on the box', new RegExp(`${cit.ects} ECTS`).test(citBox), citBox.replace(/\n/g, ' | '));
  // lectures of different catalogs have different colours
  const colour = async (c) => page.locator(`[data-key="c${c.id}:0"]`).evaluate((e) => getComputedStyle(e).backgroundColor);
  const byCat = {};
  for (const c of lectures.filter((c) => c.slots.length)) byCat[c.catalog] = byCat[c.catalog] ?? c;
  const colours = new Set(await Promise.all(Object.values(byCat).map(colour)));
  check('each catalog has its own colour', colours.size === Object.keys(byCat).length, `${colours.size} colours for ${Object.keys(byCat).join(',')}`);
  const credit = async (k) => (await page.locator(`[data-testid=credit-${k}]`).first().innerText()).replace(/\s+/g, ' ');
  // credit discrepancy checks need a lecture whose sources disagree; since the website follows FPSO 2026 there may be none
  const flaggedBox = flagged ? page.locator(`[data-key="c${flagged.id}:0"]`) : null;
  if (flagged) check('discrepant credits are marked with * on the box', (await flaggedBox.locator('.note-mark').count()) === 1 && /differ between sources/.test(await flaggedBox.locator('.note-mark').getAttribute('title')));
  else check('no lecture with credit discrepancy -> no * anywhere', (await page.locator('.note-mark').count()) === 0);
  check('no marker on a box without discrepancy', (await page.locator(`[data-key="c${cit.id}:0"] .note-mark`).count()) === 0);
  check('legend about * matches the visible marked boxes', (await page.locator('[data-testid=credit-notes]').count()) === (flagged ? 1 : 0));
  check('credits panel starts at zero', /0 \/ 33/.test(await credit('methods')) && /0 \/ 15/.test(await credit('cs')), await credit('cs'));
  if (shots) await page.screenshot({ path: `${shots}/1-main.png` });

  await page.locator('[data-testid=types] label', { hasText: 'Seminars' }).locator('input').check();
  const withSeminars = await page.locator('.box').count();
  const seminarBoxes = data.courses.filter((c) => c.category === 'seminar').reduce((n, c) => n + c.slots.length, 0);
  check('switching on seminars adds their boxes', withSeminars === expectedBoxes + seminarBoxes, `${withSeminars} vs ${expectedBoxes + seminarBoxes}`);
  await page.locator('[data-testid=types] label', { hasText: 'Seminars' }).locator('input').uncheck();

  // overlapping lectures sit side by side
  const key = (c) => `c${c.id}:0`;
  const sa = pair[0].slots.findIndex((s) => pair[1].slots.some((t) => t.day === s.day && toMin(s.start) < toMin(t.end) && toMin(t.start) < toMin(s.end)));
  const sb = pair[1].slots.findIndex((t) => t.day === pair[0].slots[sa].day && toMin(pair[0].slots[sa].start) < toMin(t.end) && toMin(t.start) < toMin(pair[0].slots[sa].end));
  const ba = await page.locator(`[data-key="c${pair[0].id}:${sa}"]`).boundingBox();
  const bb = await page.locator(`[data-key="c${pair[1].id}:${sb}"]`).boundingBox();
  check('overlapping lectures are side by side', Math.abs(ba.x - bb.x) > 50 && ba.x + ba.width <= bb.x + 8 || bb.x + bb.width <= ba.x + 8, `x ${Math.round(ba.x)} / ${Math.round(bb.x)}`);

  // lecture with a one-off date: no extra box, date listed in the popup
  const sbm = lectures.find((c) => c.modules.includes('WZ8119'));
  check('recurring lecture draws only its weekly boxes', (await page.locator(`.box[data-key^="c${sbm.id}:"]`).count()) === visibleSlots(sbm).length, `${await page.locator(`.box[data-key^="c${sbm.id}:"]`).count()} boxes`);
  await page.locator(`.box[data-key^="c${sbm.id}:"] .box-title`).first().click();
  const single = page.locator('[data-testid=single-dates]');
  await single.waitFor();
  check('popup lists the single date', /2027-02-03/.test(await single.innerText()), (await single.innerText()).replace(/\n/g, ' ').slice(0, 100));
  const catLine = await page.locator('[data-testid=catalog-line]').first().innerText();
  check('popup names the catalog and its source', /^Catalog: .+ · (FPSO published in July 2026|TUMonline website|CIT FPSO 2026 website)/.test(catLine), catLine);
  await page.keyboard.press('Escape');

  if (flagged) {
    // popup of the flagged lecture explains the discrepancy
    await flaggedBox.locator('.box-title').click();
    const note = page.locator('[data-testid=ects-note]');
    await note.waitFor();
    check('popup lists the sources by their new labels', /ECTS acc\. to FPSO 26: /.test(await note.innerText()) && /ECTS acc\. to TUM module handbook: /.test(await note.innerText()) && /counted/.test(await note.innerText()), (await note.innerText()).replace(/\n/g, ' '));
    await page.keyboard.press('Escape');
    // selecting it puts a footnote into the credits panel
    await flaggedBox.locator('.box-check').check();
    const foot = await page.locator('[data-testid=credit-notes]').innerText();
    check('credits footnote names the module', foot.includes(flagged.credit_module) && /differ between sources/.test(foot), foot.replace(/\n/g, ' ').slice(0, 120));
    check('catalog row carries a *', (await page.locator(`[data-testid=credit-${flagged.catalog}] .note-mark`).count()) === 1);
    await flaggedBox.locator('.box-check').uncheck();
    check('footnote disappears when deselected (only legend left)', !(await page.locator('[data-testid=credit-notes]').innerText()).includes(flagged.credit_module));
  }

  // popup via click, checkbox does not open it
  await page.locator(`[data-key="c${cit.id}:0"] .box-check`).check();
  check('checkbox click does not open popup', (await page.locator('[data-testid=popup]').count()) === 0);
  check('counter shows 1 selected', (await page.locator('[data-testid=counter]').textContent()).startsWith('1 '));
  check('credits panel counts the selected lecture in its catalog', new RegExp(`${cit.ects} / 15`).test(await credit(cit.catalog)), await credit(cit.catalog));
  await page.locator(`[data-key="c${cit.id}:0"] .box-title`).click();
  const popup = page.locator('[data-testid=popup]');
  await popup.waitFor();
  const text = await popup.innerText();
  check('popup shows lecturer, module link and registration link', /Gagneur/.test(text) && (await popup.locator('a', { hasText: 'Module description' }).count()) === 1 && (await popup.locator('a', { hasText: 'Registration page' }).count()) === 1);
  if (shots) await page.screenshot({ path: `${shots}/2-popup.png` });
  await page.keyboard.press('Escape');
  check('Escape closes popup', (await popup.count()) === 0);

  // Create schedule with CIT323007 + overlapping partner
  await page.locator(`[data-key="c${pair[0].id}:${sa}"] .box-check`).check();
  await page.locator('[data-testid=create]').click();
  await page.waitForSelector('[data-testid=summary]');
  const scheduleBoxes = await page.locator('.box').count();
  const expectedSchedule = [cit, pair[0]].filter((v, i, a) => a.indexOf(v) === i).reduce((n, c) => n + visibleSlots(c).length, 0);
  check('schedule view shows only selected lectures', scheduleBoxes === expectedSchedule, `${scheduleBoxes} vs ${expectedSchedule}`);
  const partner = pair[0].id === cit.id ? pair[1] : pair[0];
  const expectedCs = new Set([cit, pair[0]]);
  const sumByCat = (cat) => [...expectedCs].filter((c) => c.catalog === cat).reduce((m, c) => m.set(c.credit_module, c.ects), new Map());
  const expectedCsSum = [...sumByCat('cs').values()].reduce((a, b) => a + b, 0);
  check('schedule summary shows credits per catalog', new RegExp(`^.*${expectedCsSum} / 15`).test(await credit('cs')), await credit('cs'));
  check('exercises hidden until requested', (await page.locator('.tone-exercise').count()) === 0);

  // exercises and grey-out
  await page.locator('[data-testid=show-exercises]').click();
  const groups = page.locator('.box.tone-exercise');
  const nGroupBoxes = await groups.count();
  check('exercise group boxes appear', nGroupBoxes >= 3, `${nGroupBoxes}`);
  check('fixed shared exercise slot shown', (await page.locator('.box.tone-fixed').count()) >= 1);
  check('pending exercise listed', (await page.locator('[data-testid=pending] li').count()) >= 1);
  const firstGroup = groups.first();
  const chosenKey = await firstGroup.getAttribute('data-key');
  await firstGroup.locator('.box-check').check();
  const eid = chosenKey.split(':')[0]; // g<exerciseId>
  const sib = page.locator(`.box[data-key^="${eid}:"]`);
  const nSib = await sib.count();
  const disabled = await page.locator(`.box.disabled[data-key^="${eid}:"]`).count();
  const checked = await page.locator(`.box.checked[data-key^="${eid}:"]`).count();
  const otherGreyed = await page.locator('.box.tone-exercise.disabled').count() - disabled;
  check('siblings of the same exercise greyed after pick', nSib >= 2 && checked === 1 && disabled === nSib - 1, `${checked} chosen, ${disabled} greyed of ${nSib}`);
  check('other exercises not affected', otherGreyed === 0, `${otherGreyed} greyed elsewhere`);
  check('chosen box not greyed', !(await page.locator(`[data-key="${chosenKey}"]`).getAttribute('class')).includes('disabled'));
  if (shots) await page.screenshot({ path: `${shots}/3-schedule-exercises.png` });

  // reload keeps state
  await page.reload();
  await page.waitForSelector('[data-testid=summary]');
  check('credits survive reload', new RegExp(`${expectedCsSum} / 15`).test(await credit('cs')));
  const rc = await page.locator(`.box.checked[data-key^="${eid}:"]`).count(), rd = await page.locator(`.box.disabled[data-key^="${eid}:"]`).count(), rs = await page.locator(`.box[data-key^="${eid}:"]`).count();
  check('state restored after reload (view, picks)', rc === 1 && rd === nSib - 1, `checked ${rc}, disabled ${rd}, siblings now ${rs} (before ${nSib}), url ${page.url().slice(-80)}`);

  // release the pick
  await page.locator(`[data-key="${chosenKey}"] .box-check`).uncheck();
  check('second click releases and un-greys', (await page.locator('.box.tone-exercise.disabled').count()) === 0);

  // back keeps selection
  await page.locator('[data-testid=back]').click();
  check('selection kept when going back', (await page.locator('[data-testid=counter]').textContent()).startsWith('2 '));
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
