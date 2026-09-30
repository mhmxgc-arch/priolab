// Turns the Sites source in sites-secure/ into a Node server for APP-01,
// inside the Docker build only -- nothing in the repository is modified.
//
// Every rewrite is asserted: if the collaborator changes a line this depends
// on, the build FAILS here with the reason, instead of producing an image that
// runs wrong. A failed build never reaches the live site: the deployer leaves
// the running container as it was, and CI turns red on the same commit.
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] || ".";
const here = path.dirname(fileURLToPath(import.meta.url));
const at = f => path.join(root, f);
const fail = msg => { console.error(`adapt: ${msg}`); process.exit(1); };
const say = msg => console.log(`adapt: ${msg}`);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// 1. Sites-only tooling: the Vite/Workers build and its preview scripts are not
//    part of the app and would only drag wrangler and workerd into the image.
for (const f of ["vite.config.ts", "build", "scripts", "cloudflare-env.d.ts", "drizzle.config.ts",
  "lib/connectors.ts", "lib/connector-context.ts", "lib/connector-contract.mts", "lib/connector-errors.mts",
  "lib/connector-preview.d.ts", "components/connector-error.tsx"])
  rmSync(at(f), { recursive: true, force: true });

// 2. `cloudflare:workers` -> the SQLite-backed stand-in.
copyFileSync(path.join(here, "workers.ts"), at("lib/platform-workers.ts"));
let rewired = 0;
for (const file of walk(root).filter(f => /\.(ts|tsx|mts)$/.test(f))) {
  const src = readFileSync(file, "utf8");
  if (!src.includes('"cloudflare:workers"')) continue;
  writeFileSync(file, src.replaceAll('"cloudflare:workers"', '"@/lib/platform-workers"'));
  rewired++;
  say(`cloudflare:workers -> platform-workers in ${path.relative(root, file)}`);
}
if (!rewired) fail("no import of cloudflare:workers found -- the database wiring changed, review deploy/v2/workers.ts");

// 3. Edge runtime -> Node, where node:sqlite exists.
for (const file of walk(at("app")).filter(f => /\.(ts|tsx)$/.test(f))) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(/^export const runtime = ["']edge["'];?[ \t]*$/m, "");
  if (out !== src) { writeFileSync(file, out); say(`runtime edge -> nodejs in ${path.relative(root, file)}`); }
}

// 4. Client IP: Sites passes cf-connecting-ip, Traefik passes X-Real-Ip. The
//    router strips any cf-connecting-ip a client sends (see compose.yaml).
{
  const file = at("lib/server.ts"), src = readFileSync(file, "utf8");
  const from = 'request.headers.get("cf-connecting-ip")';
  if (!src.includes(from)) fail("lib/server.ts no longer reads cf-connecting-ip -- the IP allowlist wiring changed, review adapt.mjs step 4");
  writeFileSync(file, src.replaceAll(from, '(request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip"))'));
  say("clientIp falls back to x-real-ip");
}

// 4b. Same-origin check: Next's standalone server builds request.url from its
//     listen address (http://0.0.0.0:3000), not from the Host header, so the
//     check would refuse every real POST. It compares with the public origin
//     from the environment instead -- a fixed value, not a request header.
{
  const file = at("lib/server.ts"), src = readFileSync(file, "utf8");
  const from = "origin === new URL(request.url).origin";
  if (!src.includes(from)) fail("lib/server.ts validOrigin changed -- review adapt.mjs step 4b");
  writeFileSync(file, src.replaceAll(from, "origin === (process.env.PUBLIC_ORIGIN || new URL(request.url).origin)"));
  say("validOrigin compares with PUBLIC_ORIGIN");
}

// 5. next.config: keep the app's own options, add standalone output.
if (!existsSync(at("next.config.ts"))) fail("next.config.ts is gone -- review deploy/v2/next.config.ts");
renameSync(at("next.config.ts"), at("next.config.sites.ts"));
copyFileSync(path.join(here, "next.config.ts"), at("next.config.ts"));

// 6. package.json: drop the Sites toolchain; the app builds with plain next.
{
  const pkg = JSON.parse(readFileSync(at("package.json"), "utf8"));
  for (const d of ["@cloudflare/vite-plugin", "@vitejs/plugin-react", "@vitejs/plugin-rsc",
    "drizzle-kit", "json-rpc-2.0", "raw-body", "react-server-dom-webpack", "vinext", "vite", "wrangler", "eslint", "eslint-config-next"])
    delete pkg.devDependencies?.[d];
  delete pkg.overrides;
  pkg.scripts = { build: "next build" };
  writeFileSync(at("package.json"), JSON.stringify(pkg, null, 2));
}

// 7. pnpm policy: the Sites store paths and the miniflare override do not apply here.
{
  const file = at("pnpm-workspace.yaml");
  if (existsSync(file)) writeFileSync(file, readFileSync(file, "utf8").split("\n")
    .filter(l => !/^(storeDir|cacheDir|overrides):/.test(l) && !/^\s+miniflare>sharp/.test(l))
    .join("\n"));
}

// 8. The dashboard loads jszip from its own folder; the README says to copy it in.
if (!existsSync(at("public/jszip.min.js"))) {
  const v1 = path.join(root, "..", "dist", "jszip.min.js");
  if (!existsSync(v1)) fail("public/jszip.min.js missing and dist/jszip.min.js not found");
  copyFileSync(v1, at("public/jszip.min.js"));
  say("jszip.min.js copied from dist/");
}
say("done");
