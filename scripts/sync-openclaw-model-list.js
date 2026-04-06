const fs = require('fs');
const path = require('path');
const { getSavedKeys } = require('../src/key-store');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function main() {
  const savedKeys = await getSavedKeys();
  const homeDir = process.env.USERPROFILE;
  const configPath = path.join(homeDir, '.openclaw', 'openclaw.json');
  const authPath = path.join(homeDir, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');

  const config = readJsonFile(configPath);
  const authProfiles = readJsonFile(authPath);

  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.model = {
    ...(config.agents.defaults.model || {}),
    primary: 'google/gemini-2.5-flash',
  };
  config.agents.defaults.models = {
    ...(config.agents.defaults.models || {}),
    'google/gemini-flash-latest': { alias: 'Gemini Flash Latest' },
    'google/gemini-2.5-flash': { alias: 'Gemini 2.5 Flash' },
    'google/gemini-2.5-pro': { alias: 'Gemini 2.5 Pro' },
    'google/gemini-2.0-flash': { alias: 'Gemini 2.0 Flash' },
    'openrouter/auto': { alias: 'OpenRouter' },
    'openrouter/qwen/qwen3.6-plus:free': { alias: 'OpenRouter Free' },
  };

  config.auth = config.auth || {};
  config.auth.profiles = {
    ...(config.auth.profiles || {}),
    'google:default': { provider: 'google', mode: 'api_key' },
    'openrouter:default': { provider: 'openrouter', mode: 'api_key' },
  };

  authProfiles.version = 1;
  authProfiles.profiles = authProfiles.profiles || {};
  authProfiles.lastGood = authProfiles.lastGood || {};

  if (savedKeys.geminiApiKey) {
    authProfiles.profiles['google:default'] = {
      type: 'api_key',
      provider: 'google',
      key: savedKeys.geminiApiKey,
    };
    authProfiles.lastGood.google = 'google:default';
  }

  if (savedKeys.openrouterApiKey) {
    authProfiles.profiles['openrouter:default'] = {
      type: 'api_key',
      provider: 'openrouter',
      key: savedKeys.openrouterApiKey,
    };
    authProfiles.lastGood.openrouter = 'openrouter:default';
  }

  writeJsonFile(configPath, config);
  writeJsonFile(authPath, authProfiles);

  console.log(`SYNCED_OPENROUTER_LIST=${Boolean(savedKeys.openrouterApiKey)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});