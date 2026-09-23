import { readFileSync } from 'node:fs';

const notes = readFileSync('.release-notes.md', 'utf8').replace(/\r\n/g, '\n');
const yml = readFileSync('.github/workflows/release.yml', 'utf8').replace(/\r\n/g, '\n');

const notesBody = notes.slice(notes.indexOf('## ')).replace(/\s+$/, '');

const m = yml.match(/releaseBody:\s*\|\n([\s\S]*?)\n\s*releaseDraft:/);
if (!m) { console.error('releaseBody not found'); process.exit(2); }
const ymlBody = m[1].split('\n').map(l => l.replace(/^            /, '')).join('\n').replace(/\s+$/, '');

if (notesBody === ymlBody) {
  console.log('PARITY OK — release notes and release.yml body are identical');
} else {
  console.error('PARITY MISMATCH');
  console.error('--- notesBody ---\n' + notesBody);
  console.error('--- ymlBody ---\n' + ymlBody);
  process.exit(1);
}
