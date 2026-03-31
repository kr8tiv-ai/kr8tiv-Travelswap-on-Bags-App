// Verification script for S05 tasks — works on Windows
const fs = require('fs');
const path = require('path');

const results = [];
let allPass = true;

function check(name, condition) {
  const pass = !!condition;
  results.push({ name, pass });
  if (!pass) allPass = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`);
}

// T01 checks: README.md
const readme = fs.existsSync('README.md') ? fs.readFileSync('README.md', 'utf8') : '';
const h2Count = (readme.match(/^## /gm) || []).length;

check('README.md exists', fs.existsSync('README.md'));
check(`README has >= 8 H2 sections (found ${h2Count})`, h2Count >= 8);
check('README has "API Reference"', readme.includes('API Reference'));
check('README has "docker-compose"', readme.includes('docker-compose'));
check('README has "/api/strategies"', readme.includes('/api/strategies'));

// T02 checks: docs/APP_STORE_LISTING.md
const listingPath = path.join('docs', 'APP_STORE_LISTING.md');
const listing = fs.existsSync(listingPath) ? fs.readFileSync(listingPath, 'utf8') : '';

check('docs/APP_STORE_LISTING.md exists', fs.existsSync(listingPath));
check('docs/screenshots/ directory exists', fs.existsSync(path.join('docs', 'screenshots')));
check('Listing has "FlightBrain"', listing.includes('FlightBrain'));
check('Listing has "Features"', listing.includes('Features'));
check('Listing has description', listing.includes('Description') || listing.includes('description'));
check('Listing has screenshot references', listing.includes('screenshots/'));
check('Listing distinguishes implemented vs planned', listing.includes('Implemented') && listing.includes('Planned'));

console.log(`\n${results.filter(r => r.pass).length}/${results.length} checks passed`);
process.exit(allPass ? 0 : 1);
