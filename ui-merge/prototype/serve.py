"""Tiny no-cache static server for iterating on the prototype.
Usage: python serve.py [port]   (default 5177)
Sends Cache-Control: no-store so the browser always loads the latest file.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5177
    print(f"OneGrid prototype (no-cache) on http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
