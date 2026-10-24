#!/usr/bin/env node
/* Writes docs/SKILLS-CATALOG.md from the shipped skill catalog (src/skills-*.js). Run: npm run docs:skills */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const S = require(path.join(root, 'src', 'skills-core.js'));
const Extra = require(path.join(root, 'src', 'skills-extra.js'));
const version = (fs.readFileSync(path.join(root, 'weld-companion.user.js'), 'utf8').match(/@version\s+(\S+)/) || [])[1] || '?';

const typeTitle = Object.fromEntries(S.types.map(t => [t.id, t.title]));
const source = Object.fromEntries(S.sources.map(s => [s.id, s]));
const recent = new Set(Extra.rows.map(r => r[1]));
const anchor = s => s.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
const mode = m => m === 'review' ? 'Review only' : 'Makes changes';
const types = t => t.length ? t.map(x => typeTitle[x] || x).join(', ') : 'Any generator';

function skill(p) {
  const L = [`### ${p.title}`, '', `\`${p.id}\` · **${mode(p.mode)}** · ${types(p.types)}${recent.has(p.id) ? ' · new in 1.93.0' : ''}`, '',
    `*${p.description}*`, '', p.task, '', '**Workflow**', ''];
  p.steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));
  L.push('', `**Done when:** ${p.check}`, '');
  if (p.refs.length) L.push(`**Structure references:** ${p.refs.map(id => (S.refPack(id) || { title: id }).title).join(', ')}`, '');
  if (p.sources.length) L.push(`**Inspired by:** ${p.sources.map(s => source[s] ? `[${source[s].title}](${source[s].url})` : s).join(', ')}`, '');
  return L.join('\n');
}

const md = ['# Weld skills catalog', '',
  `Every skill preset in **Weld > Skills** (Weld Companion ${version}): **${S.presets.length} skills in ${S.categories.length} sections**. ` +
  `${recent.size} of them are new in 1.93.0 (marked). Generated from \`src/skills-*.js\` by \`npm run docs:skills\`; if this file and the source disagree, the source wins.`, '',
  'Each entry shows the task text, the workflow and the acceptance check Weld puts in the prompt. How to run a skill: [SKILLS.md](SKILLS.md). Research sources: [SKILLS-SOURCES.md](SKILLS-SOURCES.md).', '',
  '## Contents', '', '| Section | Skills | New in 1.93.0 |', '| --- | ---: | ---: |'];
for (const c of S.categories) {
  const list = S.presets.filter(p => p.category === c.id);
  md.push(`| [${c.title}](#${anchor(c.title)}) | ${list.length} | ${list.filter(p => recent.has(p.id)).length || ''} |`);
}
md.push(`| **Total** | **${S.presets.length}** | **${recent.size}** |`, '',
  'Modes: **Review only** asks the helper for evidence and recommendations without edits. **Makes changes** asks for the smallest complete change, preserved features and storage, and honest verification.', '');
for (const c of S.categories) {
  md.push(`## ${c.title}`, '');
  for (const p of S.presets.filter(p => p.category === c.id)) md.push(skill(p));
}
const out = path.join(root, 'docs', 'SKILLS-CATALOG.md');
fs.writeFileSync(out, md.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
console.log('Wrote docs/SKILLS-CATALOG.md: ' + S.presets.length + ' skills.');
