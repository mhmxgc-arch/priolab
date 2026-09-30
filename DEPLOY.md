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

On Sites the platform-authenticated owner creates the first admin. On APP-01,
Traefik strips those headers from every request. After the container starts,
open an interactive SSH shell on APP-01 and run the following commands there.
The password is read without echoing it or putting it in a command argument.
The command succeeds only when the database has no users:

```sh
read -rsp 'Temporary admin password: ' PRIOLAB_ADMIN_PASSWORD
printf '\n'
printf '%s' "$PRIOLAB_ADMIN_PASSWORD" | docker exec -i priolab node /app/bootstrap-admin.mjs
unset PRIOLAB_ADMIN_PASSWORD
```

Then open the site and log in as `admin` with the temporary password. The first
login requires a different complex password (8 or more characters, with an
uppercase letter, lowercase letter, digit and symbol). Add the displayed
setup key in Google Authenticator and enter its six-digit code to finish.
Further users are created from the admin screen.
