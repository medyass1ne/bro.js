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
  const version = "1.0.0";
  
  console.log("");
  console.log(`${colors.green}╭───────────────────────────────────────────────╮${colors.reset}`);
  console.log(`${colors.green}│${colors.reset}                                               ${colors.green}│${colors.reset}`);
  console.log(`${colors.green}│${colors.reset}   ${colors.bold}bro.js${colors.reset} v${version}                           ${colors.green}│${colors.reset}`);
  console.log(`${colors.green}│${colors.reset}                                               ${colors.green}│${colors.reset}`);
  console.log(`${colors.green}│${colors.reset}   ➜  ${colors.bold}Local:${colors.reset}   ${colors.cyan}http://localhost:${port}${colors.reset}         ${colors.green}│${colors.reset}`);
  console.log(`${colors.green}│${colors.reset}   ➜  ${colors.bold}Ready in:${colors.reset} ${colors.yellow}${time}ms${colors.reset}                         ${colors.green}│${colors.reset}`);
  console.log(`${colors.green}│${colors.reset}                                               ${colors.green}│${colors.reset}`);
  console.log(`${colors.green}╰───────────────────────────────────────────────╯${colors.reset}`);
  console.log("");
}

export function printRoute(method, routePath, hasAuth, isLast = false) {
  const branch = isLast ? "╰──" : "├──";
  const coloredMethod = formatMethod(method);
  const authIcon = hasAuth ? " 🔒" : "";
  
  console.log(`  ${colors.dim}${branch}${colors.reset} ${coloredMethod} ${routePath}${authIcon}`);
}

export function printHotReload(fileName, event, reloadTimeMs) {
  const time = typeof reloadTimeMs === 'number' ? reloadTimeMs.toFixed(0) : reloadTimeMs;
  console.log(`\n  ${colors.cyan}Route updated:${colors.reset} ${colors.bold}${fileName}${colors.reset} ${colors.dim}(${event})${colors.reset}`);
  console.log(`  ${colors.dim}Remapped in ${time}ms${colors.reset}\n`);
}
