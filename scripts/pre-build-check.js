#!/usr/bin/env node

/**
 * Pre-build validation script
 * Checks environment, dependencies, and configuration before building
 */

const fs = require('fs');
const path = require('path');

let hasErrors = false;

function error(message) {
  console.error(`❌ ${message}`);
  hasErrors = true;
}

function success(message) {
  console.log(`✅ ${message}`);
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

console.log('Running pre-build checks...\n');

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (majorVersion < 20) {
  error(`Node.js version ${nodeVersion} is too old. Required: >=20.9.0`);
} else {
  success(`Node.js version ${nodeVersion} is compatible`);
}

// Check for required environment file
const envLocal = path.join(process.cwd(), '.env.local');
const envExample = path.join(process.cwd(), 'env.example');
if (!fs.existsSync(envLocal) && fs.existsSync(envExample)) {
  info('.env.local not found (using env.example as reference)');
} else if (fs.existsSync(envLocal)) {
  success('.env.local exists');
}

// Check for required directories
const requiredDirs = ['src', 'src/app', 'src/lib'];
for (const dir of requiredDirs) {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    error(`Required directory missing: ${dir}`);
  } else {
    success(`Directory exists: ${dir}`);
  }
}

// Check for critical files
const criticalFiles = [
  'package.json',
  'tsconfig.json',
  'next.config.js',
  'src/app/page.tsx',
  'src/app/layout.tsx',
];
for (const file of criticalFiles) {
  const filePath = path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    error(`Critical file missing: ${file}`);
  } else {
    success(`File exists: ${file}`);
  }
}

// Check package.json has required scripts
try {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const requiredScripts = ['dev', 'build', 'start'];
  for (const script of requiredScripts) {
    if (!packageJson.scripts || !packageJson.scripts[script]) {
      error(`Required script missing: ${script}`);
    } else {
      success(`Script exists: ${script}`);
    }
  }
} catch (err) {
  error(`Failed to read package.json: ${err.message}`);
}

// Check node_modules exists
const nodeModules = path.join(process.cwd(), 'node_modules');
if (!fs.existsSync(nodeModules)) {
  error('node_modules not found. Run "npm install" first.');
} else {
  success('node_modules exists');
}

console.log('\n' + '='.repeat(50));
if (hasErrors) {
  console.error('\n❌ Pre-build checks failed. Please fix the errors above.');
  process.exit(1);
} else {
  console.log('\n✅ All pre-build checks passed!');
  process.exit(0);
}
