# Priolab — פריסה / النشر

`https://priolab.xprsit.net` · container `priolab` on APP-01 behind Traefik.

- **Automatic:** every push to `main` is pulled by the APP-01 deployer within a
  minute (read-only deploy key `deploy-priolab`), rebuilt, started, and rolled
  back to the previous image if the healthcheck fails.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) checks the JavaScript,
  builds the same image and requires every container to boot healthy, on every
  push and pull request. It is generic over `compose.yaml`: a backend or a
  database added later is covered without editing it.
- **What is served:** `dist/` exactly as committed, by nginx (`Dockerfile`,
  `deploy/nginx.conf`). No build step — edit `dist/` and push.
- **Privacy:** a strict CSP (`connect-src 'none'`) means the page cannot send
  an uploaded report anywhere. A new external script/CDN or an API call needs a
  matching change in `deploy/nginx.conf`, or the browser will block it.
- The repository is public: never commit reports, Excel files or secrets.
- **Adding a server (e.g. login):** the image today serves `dist/` only. A backend
  needs its own service in `compose.yaml`, secrets in `.env` on APP-01 (never
  here) and persistent data under `/srv/priolab/` -- ask the platform owner.
