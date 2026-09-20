import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m"
};

export function formatMethod(method) {
  const m = method.toUpperCase().padEnd(6);
  switch(method.toUpperCase()) {
    case 'GET': return `${colors.green}${colors.bold}${m}${colors.reset}`;
    case 'POST': return `${colors.blue}${colors.bold}${m}${colors.reset}`;
    case 'PUT': return `${colors.yellow}${colors.bold}${m}${colors.reset}`;
    case 'DELETE': return `${colors.red}${colors.bold}${m}${colors.reset}`;
    case 'PATCH': return `${colors.magenta}${colors.bold}${m}${colors.reset}`;
    default: return `${colors.white}${colors.bold}${m}${colors.reset}`;
  }
}

export function printBanner(port, durationMs) {
  const time = durationMs.toFixed(0);
  
  let version = "2.2.0";
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    version = pkg.version;
  } catch(e) {}
  
  const innerWidth = 47;

  const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");

  const formatLine = (content = "") => {
    const visibleLength = stripAnsi(content).length;
    const padding = Math.max(0, innerWidth - visibleLength);
    return `${colors.green}│${colors.reset}${content}${" ".repeat(padding)}${colors.green}│${colors.reset}`;
  };

  const borderTop = `${colors.green}╭${"─".repeat(innerWidth)}╮${colors.reset}`;
  const borderBottom = `${colors.green}╰${"─".repeat(innerWidth)}╯${colors.reset}`;

  console.log("");
  console.log(borderTop);
  console.log(formatLine());
  console.log(formatLine(`   ${colors.bold}bro.js${colors.reset} v${version}`));
  console.log(formatLine());
  console.log(formatLine(`   ➜  ${colors.bold}Local:${colors.reset}   ${colors.cyan}http://localhost:${port}${colors.reset}`));
  console.log(formatLine(`   ➜  ${colors.bold}Ready in:${colors.reset} ${colors.yellow}${time}ms${colors.reset}`));
  console.log(formatLine());
  console.log(borderBottom);
  console.log("");
}

export function printRoute(method, routePath, hasAuth, isLast = false) {
  const branch = isLast ? "╰──" : "├──";
  const coloredMethod = formatMethod(method);
  const authIcon = hasAuth ? " 🔒" : "";
  
  console.log(`  ${colors.dim}${branch}${colors.reset} ${coloredMethod} ${routePath}${authIcon}`);
}

export function printHotReload(fileName, event, reloadTimeMs, resourceType = 'Route') {
  const time = typeof reloadTimeMs === 'number' ? reloadTimeMs.toFixed(0) : reloadTimeMs;
  console.log(`\n  ${colors.cyan}${resourceType} updated:${colors.reset} ${colors.bold}${fileName}${colors.reset} ${colors.dim}(${event})${colors.reset}`);
  console.log(`  ${colors.dim}Remapped in ${time}ms${colors.reset}\n`);
}

export function createLogger(config = {}) {
  const isJson = config.format === 'json';
  const levelPriority = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
  const currentLevel = levelPriority[config.level] ?? levelPriority.info;

  const redactKeys = config.redact || ['password', 'token', 'secret', 'authorization'];
  
  const redact = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(redact);
    const newObj = { ...obj };
    for (const key of Object.keys(newObj)) {
      if (redactKeys.some(r => key.toLowerCase().includes(r))) {
        newObj[key] = '[REDACTED]';
      } else if (typeof newObj[key] === 'object') {
        newObj[key] = redact(newObj[key]);
      }
    }
    return newObj;
  };

  const log = (level, message, meta = {}) => {
    if (levelPriority[level] < currentLevel) return;
    const timestamp = new Date().toISOString();
    
    if (isJson) {
      console[level === 'debug' ? 'log' : level](JSON.stringify({ level, timestamp, message, ...redact(meta) }));
    } else {
      const colorMap = { debug: colors.dim, info: colors.cyan, warn: colors.yellow, error: colors.red };
      const c = colorMap[level] || colors.reset;
      let metaStr = Object.keys(meta).length ? ` ${colors.dim}${JSON.stringify(redact(meta))}${colors.reset}` : '';
      console[level === 'debug' ? 'log' : level](`${colors.dim}[${timestamp}]${colors.reset} ${c}[${level.toUpperCase()}]${colors.reset} ${message}${metaStr}`);
    }
  };

  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    time: (label) => {
      const start = performance.now();
      return (msg, meta) => log('info', msg || `${label} completed`, { ...meta, durationMs: performance.now() - start });
    }
  };
}
