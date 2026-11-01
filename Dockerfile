# Статичный сайт — только раздача файлов, сборка не нужна.
FROM nginx:1.31.8-alpine@sha256:785835ea65db4bba6f021acc0f3be91b0fef76a53fe41f8588c6698d2aed0606

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
