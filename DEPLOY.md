# Priolab — פריסה / النشر

`https://priolab.xprsit.net` · container `priolab` on APP-01 behind Traefik.

- **Automatic:** every push to `main` is pulled by the APP-01 deployer within a
  minute (read-only deploy key `deploy-priolab`), rebuilt, started, and rolled
  back to the previous image if the healthcheck fails.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) checks the JavaScript,
  builds the same image and requires every container to boot healthy, on every
  push and pull request. It is generic over `compose.yaml`.
- **What is served:** Priolab v2 from `sites-secure/` — Next.js with its own
  login (username + password + TOTP), users, IP allowlist and saved reports.
  `sites-secure/` is written for Sites (Cloudflare Workers + D1);
  `deploy/v2/adapt.mjs` turns it into a Node server with SQLite **inside the
  Docker build only**, and fails the build if a line it relies on changed.
  `dist/` (the old static v1) is no longer served.
- **Data:** one SQLite file, `/srv/priolab/data/priolab.sqlite` on APP-01.
  Migrations from `sites-secure/drizzle/` apply on start. Back this folder up.
- The repository is public: never commit reports, Excel files or secrets.

## Secrets — once, before the first v2 deploy

`/root/stacks/priolab/.env` on APP-01, mode 600 (template: `.env.example`):

```
APP_ENCRYPTION_KEY=<32 random bytes, base64>
```

The copy is `C:\DEV\_SECRETS\priolab.env`. Without it `compose` refuses to run,
so the previous version stays live. Losing the key means every user re-enrolls
TOTP.

## First admin

On Sites the platform-authenticated owner creates the first admin. Here Traefik
strips those headers from every request, so it is done from APP-01, straight to
the container, and only while the database has no users:

```sh
ssh app-01 'docker exec priolab node -e "fetch(\"http://127.0.0.1:3000/api/secure\",{method:\"POST\",headers:{\"content-type\":\"application/json\",origin:\"https://priolab.xprsit.net\",\"oai-authenticated-user-id\":\"owner\"},body:JSON.stringify({action:\"bootstrap\",username:\"admin\",password:process.argv[1]})}).then(r=>r.text()).then(console.log)" "<password, 12+ chars>"'
```

Then open the site, log in as `admin` with that password, and scan the QR code
with Google Authenticator. Further users are created from the admin screen.
