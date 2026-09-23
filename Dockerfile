# Статичный сайт — только раздача файлов, сборка не нужна.
FROM nginx:1.31.0-alpine@sha256:2f07d83bf561b506400dc183b1b2003803e39efbd22451f848adaba14d28c7c7

LABEL org.opencontainers.image.title="Колесо фортуны" \
      org.opencontainers.image.description="Сайт-рандомайзер с настраиваемым списком" \
      org.opencontainers.image.source="https://github.com/rprokhorov/wheel-of-fortune"

COPY docker/nginx-main.conf /etc/nginx/nginx.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY favicon.svg favicon.png apple-touch-icon.png /usr/share/nginx/html/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
COPY music/     /usr/share/nginx/html/music/

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
