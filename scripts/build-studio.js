// Embed maintainable module sources into the single installable userscript.
// Each bundle is a pair of generated blocks at the end of the file.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'weld-companion.user.js');
const bundles = [
  { marker: 'STUDIO', sources: ['studio-core.js', 'studio-dad.js', 'studio-ui.js'] },
  { marker: 'PROJECT', sources: ['project-core.js', 'project-ui.js'] },
  { marker: 'DEV', sources: ['dev-core.js', 'dev-ui.js'] },
  { marker: 'SKILLS', sources: ['skills-core.js', 'skills-ui.js'] }
];
const normalize = s => s.replace(/\r\n/g, '\n');
const current = normalize(fs.readFileSync(file, 'utf8'));
let output = current;
for (const { marker, sources } of bundles) {
  const start = `/* BEGIN GENERATED ${marker} */`, end = `/* END GENERATED ${marker} */`;
  const body = sources.map(name => normalize(fs.readFileSync(path.join(root, 'src', name), 'utf8')).trimEnd()).join('\n\n');
  const block = start + '\n' + body + '\n' + end + '\n';
  const from = output.indexOf(start);
  if (from === -1) output = output.trimEnd() + '\n\n' + block;
  else {
    const to = output.indexOf(end, from);
    if (to === -1) throw new Error(`Missing ${marker} end marker.`);
    output = output.slice(0, from) + block + output.slice(to + end.length).replace(/^\n/, '');
  }
}
if (process.argv.includes('--check')) {
  if (output !== current) { console.error('Generated bundles are stale. Run npm run build.'); process.exitCode = 1; }
  else console.log('Generated bundles match source.');
} else fs.writeFileSync(file, output);
