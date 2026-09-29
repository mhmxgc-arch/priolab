# Priolab is a static site: dist/ is served as-is, every Excel file is parsed in
# the visitor's browser and nothing reaches the server. nginx-unprivileged runs
# as uid 101 on port 8080, so the container needs no capabilities and keeps a
# read-only root filesystem (compose gives it a tmpfs /tmp).
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 8080
