#!/bin/zsh
# Double-click to run Freewheel on your Mac. Closing this Terminal stops the companion.
set -eu
FREEWHEEL_APP_DIR="${0:A:h}"
cd "$FREEWHEEL_APP_DIR"
if ! command -v npm >/dev/null 2>&1; then
  print 'Freewheel needs Node.js 22 or newer. Install Node.js, then open this file again.'
  read '?Press Return to close. '
  exit 1
fi
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ ! -f dist/index.html ]]; then npm run build; fi
print '\nFreewheel will be available at http://127.0.0.1:4318'
print 'Keep this Terminal open while using Freewheel. Press Control-C to quit.\n'
# Browser opening is intentionally left to the user; the URL is clickable in Terminal.
npm start
