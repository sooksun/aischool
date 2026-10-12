#!/usr/bin/env sh
# Regenerate lib/src/generated from the contract named in swagger_parser.yaml.
set -eu
cd "$(dirname "$0")/.."
rm -rf lib/src/generated
dart run swagger_parser
dart run build_runner build --delete-conflicting-outputs
