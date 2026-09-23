#!/usr/bin/env bash
set -euo pipefail

tag=${1:?Укажите версионный тег}
repo=${GITHUB_REPOSITORY:-rprokhorov/wheel-of-fortune}
owner=${repo%%/*}
owner=${owner,,}

if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release create "$tag" --repo "$repo" --generate-notes --verify-tag
fi

notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
gh release view "$tag" --repo "$repo" --json body --jq .body > "$notes"
if grep -Fq '<!-- wheel-images -->' "$notes"; then
  exit 0
fi

cat >> "$notes" <<EOF

<!-- wheel-images -->
## Образы контейнеров

- [Сайт](https://github.com/$repo/pkgs/container/wheel-of-fortune): \`ghcr.io/$owner/wheel-of-fortune:$tag\`
- [Коллектор](https://github.com/$repo/pkgs/container/wheel-collector): \`ghcr.io/$owner/wheel-collector:$tag\`

Оба образа доступны для amd64 и arm64.
EOF
gh release edit "$tag" --repo "$repo" --notes-file "$notes"
