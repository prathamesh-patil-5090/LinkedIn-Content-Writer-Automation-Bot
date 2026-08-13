require('./load-env.cjs');
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node prisma/run.cjs <command> [...args]');
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  cwd: path.resolve(__dirname, '..'),
});

child.on('exit', (code) => process.exit(code ?? 1));
