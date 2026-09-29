# Priolab — פריסה / النشر

`https://priolab.xprsit.net` · container `priolab` on APP-01 behind Traefik.

- **Automatic:** every push to `main` is pulled by the APP-01 deployer within a
  minute (read-only deploy key `deploy-priolab`), rebuilt, started, and rolled
  back to the previous image if the healthcheck fails.
- **What is served:** `dist/` exactly as committed, by nginx (`Dockerfile`,
  `deploy/nginx.conf`). No build step — edit `dist/` and push.
- **Privacy:** a strict CSP (`connect-src 'none'`) means the page cannot send
  an uploaded report anywhere. A new external script/CDN or an API call needs a
  matching change in `deploy/nginx.conf`, or the browser will block it.
- The repository is public: never commit reports, Excel files or secrets.
