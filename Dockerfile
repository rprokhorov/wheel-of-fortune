# Статичный сайт — только раздача файлов, сборка не нужна.
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Колесо фортуны" \
      org.opencontainers.image.description="Сайт-рандомайзер с настраиваемым списком" \
      org.opencontainers.image.source="https://github.com/rprokhorov/wheel-of-fortune" \
      org.opencontainers.image.licenses="MIT"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
COPY music/     /usr/share/nginx/html/music/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
