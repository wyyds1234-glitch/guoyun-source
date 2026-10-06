import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// An allowlist snapshot, never a mirror of the private repository or its history.
export function allowedSource(path, installerPaths) {
  if (path.startsWith('public/downloads/')) return path === 'public/downloads/latest.json' || installerPaths.has(path);
  return ['public/', 'functions/', 'migrations/', 'scripts/', 'tests/', 'src-tauri/'].some(prefix => path.startsWith(prefix))
    || ['README.md', '.gitignore', 'package.json', 'package-lock.json', 'wrangler.jsonc', 'worker-configuration.d.ts', 'foundation/assets.json', '.github/workflows/tauri-release.yml'].includes(path);
}

export function publicSourceContent(path, content) {
  if (path === 'package.json') {
    const pkg = JSON.parse(content);
    for (const name of ['deploy', 'deploy:preview', 'db:migrate:remote', 'db:migrate:preview']) delete pkg.scripts[name];
    return JSON.stringify(pkg, null, 2) + '\n';
  }
  if (path === '.github/workflows/tauri-release.yml') {
    content = content.replace('  push:\n    tags: ["v*.*.*"]\n', '');
    for (const job of ['validate-source', 'build', 'publish-manifest']) {
      content = content.replace(new RegExp(`(^  ${job}:\\n)(?:    if:.*\\n)?`, 'm'), `$1    if: github.repository == 'wyyds1234-glitch/guoyun'\n`);
    }
  }
  if (path === 'wrangler.jsonc') {
    const config = JSON.parse(content);
    config.name = 'guoyun-local';
    delete config.env;
    for (const binding of config.d1_databases || []) {
      binding.database_name = 'guoyun-local-data';
      binding.database_id = '00000000-0000-0000-0000-000000000000';
    }
    return JSON.stringify(config, null, 2) + '\n';
  }
  return content;
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /(?:CLOUDFLARE_API_TOKEN|TAURI_SIGNING_PRIVATE_KEY)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{24,}["']/,
];

export function exportPublicSource(source, destination) {
  source = resolve(source);
  destination = resolve(destination);
  if (destination === source || destination.startsWith(source + '/')) throw new Error('Export must be outside the source repository');
  if (existsSync(destination) && readdirSync(destination).length) throw new Error('Export destination must be empty; nothing will be overwritten');
  const manifest = JSON.parse(readFileSync(join(source, 'public/downloads/latest.json'), 'utf8'));
  const installers = new Set(Object.values(manifest.platforms).filter(p => p.available && p.asset).map(p => `public/${p.asset.replace(/^\//, '')}`));
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean).filter(path => allowedSource(path, installers));
  // Scan before copying, and report paths only: never print possible secrets.
  for (const path of files) {
    if (/(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars|.*\.(?:pem|p12|key))$/.test(path)) throw new Error(`Forbidden credential file: ${path}`);
    const bytes = readFileSync(join(source, path));
    if (!bytes.includes(0) && secretPatterns.some(pattern => pattern.test(bytes.toString('utf8')))) throw new Error(`Potential secret; review before publication: ${path}`);
  }
  for (const path of files) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    let bytes = readFileSync(join(source, path));
    if (['package.json', 'wrangler.jsonc', '.github/workflows/tauri-release.yml'].includes(path)) {
      bytes = Buffer.from(publicSourceContent(path, bytes.toString('utf8')));
    }
    writeFileSync(target, bytes, { mode: statSync(join(source, path)).mode & 0o777 });
  }
  writeFileSync(join(destination, 'BUILDING.md'), `# 构建游戏源码\n\n本仓库是公开源码副本，不包含生产凭据、玩家存档、内部报告或旧 Git 历史。\n\n推荐 Node.js 24。安装并检查：\n\n\`\`\`sh\nnpm ci\nnpm run check\nnpm test\nnpm run types:check\nnpm run dev\n\`\`\`\n\n本地游戏入口为开发服务器的 /play/。部署自有后端时，需创建自己的 D1 数据库并替换 wrangler.jsonc 中的占位 ID，再执行迁移；不共享正式玩家数据。\n\n桌面版使用 Tauri 2，另需 Rust 和平台构建依赖。\`npm run desktop:prepare\` 准备内置前端；安装 Tauri CLI 后按本机平台构建。桌面发布工作流仅作构建参考，在公开副本中禁用生产发布。\n\n地图与依赖授权见 [数据来源](public/data/SOURCES.md)。源码开放查看、下载不等于对第三方素材另行授予许可。\n`);
  console.log(`Public export ready: ${files.length} tracked source files; no history or private documents copied.`);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/export-public-source.mjs <empty-directory>');
  exportPublicSource(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv[2]);
}
