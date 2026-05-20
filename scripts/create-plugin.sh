#!/usr/bin/env bash
# create-plugin.sh — scaffold a new pares-radix plugin from template
#
# Usage: ./scripts/create-plugin.sh my-plugin "My Plugin" "author-name"

set -euo pipefail

PLUGIN_ID="${1:-}"
PLUGIN_NAME="${2:-}"
AUTHOR="${3:-plures}"

if [[ -z "$PLUGIN_ID" ]]; then
  echo "Usage: $0 <plugin-id> [\"Plugin Name\"] [author]"
  echo ""
  echo "Example: $0 weather-advisor \"Weather Advisor\" kayodebristol"
  exit 1
fi

if [[ -z "$PLUGIN_NAME" ]]; then
  # Convert kebab-case to Title Case
  PLUGIN_NAME=$(echo "$PLUGIN_ID" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1))substr($i,2)}1')
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TEMPLATE_DIR="$REPO_ROOT/template"
DEST_DIR="$REPO_ROOT/plugins/$PLUGIN_ID"

if [[ -d "$DEST_DIR" ]]; then
  echo "Error: plugins/$PLUGIN_ID already exists"
  exit 1
fi

echo "Creating plugin: $PLUGIN_ID"
echo "  Name:   $PLUGIN_NAME"
echo "  Author: $AUTHOR"
echo "  Path:   plugins/$PLUGIN_ID/"
echo ""

# Copy template
cp -r "$TEMPLATE_DIR" "$DEST_DIR"

# Replace placeholders
find "$DEST_DIR" -type f \( -name "*.json" -o -name "*.ts" -o -name "*.px" -o -name "*.md" \) -exec sed -i \
  -e "s/{{plugin-id}}/$PLUGIN_ID/g" \
  -e "s/{{Plugin Name}}/$PLUGIN_NAME/g" \
  -e "s/{{your-name}}/$AUTHOR/g" \
  -e "s/{{Brief description of your plugin}}/A pares-radix plugin/g" \
  {} \;

echo "✅ Plugin scaffolded at plugins/$PLUGIN_ID/"
echo ""
echo "Next steps:"
echo "  1. Edit plugins/$PLUGIN_ID/manifest.json (description, keywords)"
echo "  2. Write your .px logic in plugins/$PLUGIN_ID/px/"
echo "  3. Implement handlers in plugins/$PLUGIN_ID/src/handlers/"
echo "  4. Write tests in plugins/$PLUGIN_ID/tests/"
echo "  5. Run tests: px run plugins/$PLUGIN_ID/tests/plugin.px"
