#!/usr/bin/env bash
set -euo pipefail

tag=${1:?Укажите версионный тег}
repo=${GITHUB_REPOSITORY:-rprokhorov/wheel-of-fortune}
owner=${repo%%/*}
owner=${owner,,}
release_notes="docs/releases/$tag.md"

if [[ ! -s "$release_notes" ]]; then
  printf 'Не найдено описание релиза: %s\n' "$release_notes" >&2
  exit 1
fi

if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release create "$tag" --repo "$repo" --notes-file "$release_notes" --verify-tag
fi

notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
cp "$release_notes" "$notes"

cat >> "$notes" <<EOF

<!-- wheel-images -->
## Образы контейнеров

- [Сайт](https://github.com/$repo/pkgs/container/wheel-of-fortune): \`ghcr.io/$owner/wheel-of-fortune:$tag\`
- [Коллектор](https://github.com/$repo/pkgs/container/wheel-collector): \`ghcr.io/$owner/wheel-collector:$tag\`

Оба образа доступны для amd64 и arm64.
EOF
gh release edit "$tag" --repo "$repo" --notes-file "$notes"
