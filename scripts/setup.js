// scripts/setup.js
// Creates the gitignored local files from their templates when they are missing.
// Never overwrites an existing file. Runs automatically after `npm install`.

const fs   = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  ['config.example.js', 'config.js'],
  ['candidate_profile.example.js', 'candidate_profile.js'],
];

for (const [template, target] of files) {
  const src  = path.join(root, template);
  const dest = path.join(root, target);
  if (fs.existsSync(dest)) {
    console.log(`[setup] ${target} already exists, leaving it alone.`);
  } else if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[setup] Created ${target} from ${template}. Edit it with your own values.`);
  }
}
