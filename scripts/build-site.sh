#!/usr/bin/env bash
# Assembles the GitHub Pages site into ${1:-_site} from site/, docs/ and brand assets.
set -euo pipefail
OUT="${1:-_site}"
# pages.yml passes the newest published release; package.json can be ahead of it.
VERSION="${SITE_VERSION:-$(node -p "require('./package.json').version")}"
# The sitemap's lastmod: when the page last changed, or the linked release came out if later.
DATE=$(git log -1 --format=%cs -- site/index.html 2>/dev/null || true)
if [[ -n "${SITE_RELEASE_DATE:-}" && "$SITE_RELEASE_DATE" > "$DATE" ]]; then DATE="$SITE_RELEASE_DATE"; fi
DATE="${DATE:-$(date -u +%Y-%m-%d)}"
# Shown in the hero. Locally, without pages.yml's release date, the tag's commit date is close enough.
RELEASE_DATE="${SITE_RELEASE_DATE:-$(git log -1 --format=%cs "v${VERSION}" 2>/dev/null || echo "$DATE")}"
RELEASE_LABEL=$(node -e 'console.log(new Date(process.argv[1] + "T00:00:00Z").toLocaleDateString("en-US",
  { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }))' "$RELEASE_DATE")

rm -rf "$OUT"
mkdir -p "$OUT/brand" "$OUT/screenshots" "$OUT/fonts"
cp site/index.html site/404.html site/sitemap.xml llms.txt "$OUT/"
cp site/google*.html "$OUT/"
cp docs/brand/meetmind-wordmark-light.png docs/brand/meetmind-wordmark-dark.png "$OUT/brand/"
cp docs/brand/social-preview.png "$OUT/og-image.png"
cp docs/screenshots/*.png "$OUT/screenshots/"
cp extension/fonts/DMSans-Variable.woff2 extension/fonts/OFL.txt "$OUT/fonts/"
cp assets/icons/icon.svg "$OUT/icon.svg"
cp assets/icons/icon32.png "$OUT/icon-32.png"
cp assets/icons/icon256.png "$OUT/icon-256.png"
touch "$OUT/.nojekyll"

node scripts/build-site-images.js "$OUT"

sed -i -e "s/__VERSION__/${VERSION}/g" -e "s/__DATE__/${DATE}/g" -e "s/__RELEASE_DATE__/${RELEASE_DATE}/g" \
  -e "s/__RELEASE_LABEL__/${RELEASE_LABEL}/g" "$OUT/index.html"
sed -i "s/__DATE__/${DATE}/g" "$OUT/sitemap.xml"
echo "Built $OUT (v${VERSION}, ${DATE})"
