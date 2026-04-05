const path = require('node:path');
const { spawn } = require('node:child_process');

const defaultCertFile = path.resolve(__dirname, '..', 'resources', 'certs', 'openclaw-controller-selfsigned.pfx');
const defaultCertPassword = '123456';

const certFile = String(process.env.WIN_CERT_FILE || defaultCertFile).trim();
const certPassword = String(
  process.env.WIN_CERT_PASSWORD || (certFile === defaultCertFile ? defaultCertPassword : ''),
).trim();

if (!certFile || !certPassword) {
  console.error('Missing WIN_CERT_FILE or WIN_CERT_PASSWORD.');
  console.error('WIN_CERT_FILE mac dinh se tro toi resources/certs/openclaw-controller-selfsigned.pfx trong project nay.');
  console.error('Voi cert test mac dinh cua project, WIN_CERT_PASSWORD mac dinh la 123456.');
  console.error('Hay set WIN_CERT_PASSWORD hoac chay build-signed-win.bat de build signed installer.');
  process.exit(1);
}

process.env.CSC_LINK = certFile;
process.env.CSC_KEY_PASSWORD = certPassword;

const builderBin = require.resolve('electron-builder/out/cli/cli.js');
const child = spawn(process.execPath, [builderBin, '--win', 'nsis', '--x64'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
