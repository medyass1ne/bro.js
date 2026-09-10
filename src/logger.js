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
  const version = "2.0.1";
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
