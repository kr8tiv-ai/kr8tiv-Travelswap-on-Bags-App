process.chdir('frontend');
const { execSync } = require('child_process');
try {
  const out = execSync('npm run build', { encoding: 'utf8', stdio: 'pipe' });
  console.log(out);
} catch (e) {
  console.log(e.stdout || '');
  console.error(e.stderr || '');
  process.exit(e.status || 1);
}
