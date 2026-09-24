#!/usr/bin/env bash
# Assembles the GitHub Pages site into ${1:-_site} from site/, docs/ and brand assets.
set -euo pipefail
OUT="${1:-_site}"
VERSION=$(node -p "require('./package.json').version")
DATE=$(date -u +%Y-%m-%d)

rm -rf "$OUT"
mkdir -p "$OUT/brand" "$OUT/screenshots" "$OUT/fonts"
cp site/index.html site/sitemap.xml llms.txt "$OUT/"
cp docs/brand/meetmind-wordmark-light.png docs/brand/meetmind-wordmark-dark.png "$OUT/brand/"
cp docs/brand/social-preview.png "$OUT/og-image.png"
cp docs/screenshots/*.png "$OUT/screenshots/"
cp extension/fonts/DMSans-Variable.woff2 extension/fonts/OFL.txt "$OUT/fonts/"
cp assets/icons/icon.svg "$OUT/icon.svg"
cp assets/icons/icon32.png "$OUT/icon-32.png"
cp assets/icons/icon256.png "$OUT/icon-256.png"
touch "$OUT/.nojekyll"

sed -i "s/__VERSION__/${VERSION}/g" "$OUT/index.html"
sed -i "s/__DATE__/${DATE}/g" "$OUT/sitemap.xml"
echo "Built $OUT (v${VERSION}, ${DATE})"
