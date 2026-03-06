#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.server
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / 'webapp'


def main() -> None:
    parser = argparse.ArgumentParser(description='Serve the demographic heatmap webapp locally.')
    parser.add_argument('--port', type=int, default=8000, help='Port to bind the local server to.')
    args = parser.parse_args()

    if not WEB_ROOT.exists():
        raise SystemExit(f'Missing web root: {WEB_ROOT}')

    handler = lambda *handler_args, **handler_kwargs: http.server.SimpleHTTPRequestHandler(
        *handler_args,
        directory=str(WEB_ROOT),
        **handler_kwargs,
    )

    with socketserver.TCPServer(('', args.port), handler) as server:
        print(f'Serving {WEB_ROOT} at http://localhost:{args.port}')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nStopping server.')


if __name__ == '__main__':
    main()
