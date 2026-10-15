#!/usr/bin/env bash
# Downloads real MC8 editor export files published by a third party (bwanab/MC8_setups) into
# tests/fixtures/external/ (git-ignored). The repository carries no license, so Signal Loom
# does not redistribute them; they are only used locally for fixture validation.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p tests/fixtures/external
base="https://raw.githubusercontent.com/bwanab/MC8_setups/main"
curl -fsSL "$base/Morningstar_MC8_Bank_Backup_Mainstage%20FX_20250202_112517.json" -o "tests/fixtures/external/Morningstar_MC8_Bank_Backup_Mainstage_FX_20250202_112517.json"
curl -fsSL "$base/Morningstar_MC8_All_Banks_Backup_20250202_112454.json" -o "tests/fixtures/external/Morningstar_MC8_All_Banks_Backup_20250202_112454.json"
echo "Fetched MC8 fixtures into tests/fixtures/external/."
echo "ML10X: copy an editor 'Device Backup' JSON to tests/fixtures/external/ml10x-editor-device-backup.json to enable its reader test."
