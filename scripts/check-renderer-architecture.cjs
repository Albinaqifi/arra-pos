const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(__dirname, 'renderer-architecture.json');
const slash = value => value.replaceAll('\\', '/');

function normalizeCoordinator(source) {
  return esbuild.transformSync(source, { loader: 'js', format: 'esm', legalComments: 'none', charset: 'utf8' }).code;
}

function fingerprint(source) {
  const normalized = normalizeCoordinator(source);
  return {
    sha256: crypto.createHash('sha256').update(normalized).digest('hex'),
    methods: [...normalized.matchAll(/^  (?:async )?([\w$]+)\([^\n]*\) \{/gm)].map(match => match[1]),
  };
}

function verifyCoordinator(source, contract) {
  const actual = fingerprint(source);
  const errors = [];
  if (actual.sha256 !== contract.coordinator.sha256) {
    errors.push('App.js differs from its reviewed composition contract. Feature behavior belongs in its owner; an intentional extraction/wiring change needs review and an explicit contract update.');
  }
  const unexpected = actual.methods.filter(name => !contract.coordinator.methods.includes(name));
  if (unexpected.length) errors.push('Unapproved App methods: ' + unexpected.join(', '));
  return errors;
}

function verifyGraph(inputs, contract) {
  const errors = [], graph = new Map();
  for (const [rawFile, input] of Object.entries(inputs)) {
    const file = slash(rawFile);
    if (!file.startsWith('src/')) continue;
    if (file.startsWith('src/desktop/')) errors.push('Privileged desktop code entered the renderer: ' + file);
    const imports = (input.imports || []).filter(item => !item.external).map(item => slash(item.path));
    graph.set(file, imports);
    for (const target of imports) {
      if ((target === 'src/App.js' && file !== 'src/renderer-entry.js') || target === 'src/renderer-entry.js') {
        errors.push('Reverse coordinator dependency: ' + file + ' -> ' + target);
      }
      if (file.startsWith('src/shared/') && target.startsWith('src/') && !target.startsWith('src/shared/')) {
        const edge = file + ' -> ' + target;
        if (!contract.legacySharedEdges.includes(edge)) errors.push('Shared code imports a feature: ' + edge);
      }
    }
  }
  const active = new Set(), done = new Set();
  function visit(file, route) {
    if (active.has(file)) { errors.push('Renderer dependency cycle: ' + [...route, file].join(' -> ')); return; }
    if (done.has(file) || !graph.has(file)) return;
    active.add(file);
    for (const imported of graph.get(file)) visit(imported, [...route, file]);
    active.delete(file); done.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
  if (contract.phase === 'coordinator' && contract.legacySharedEdges.length) errors.push('Final coordinator contract cannot retain shared-feature exceptions.');
  return [...new Set(errors)];
}

function checkArchitecture() {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const source = fs.readFileSync(path.join(root, 'src/App.js'), 'utf8');
  const result = esbuild.buildSync({ absWorkingDir: root, entryPoints: ['src/renderer-entry.js'], bundle: true, write: false, metafile: true, format: 'iife', logLevel: 'silent' });
  const errors = [...verifyCoordinator(source, contract), ...verifyGraph(result.metafile.inputs, contract)];
  if (errors.length) throw new Error('Renderer architecture check failed:\n' + errors.map(error => '- ' + error).join('\n'));
  return { phase: contract.phase, inputs: Object.keys(result.metafile.inputs).length };
}

if (require.main === module) {
  try {
    const result = checkArchitecture();
    console.log('Renderer architecture check passed (' + result.phase + ', ' + result.inputs + ' modules).');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { checkArchitecture, fingerprint, verifyCoordinator, verifyGraph };
