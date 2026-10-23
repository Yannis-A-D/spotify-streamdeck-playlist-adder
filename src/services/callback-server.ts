import http from "node:http";
import url from "node:url";

export interface CallbackResult {
  code?: string;
  error?: string;
}

export class CallbackServer {
  private server: http.Server | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  public readonly port: number;

  constructor(port = 4388) {
    this.port = port;
  }

  public get redirectUri(): string {
    return `http://127.0.0.1:${this.port}/callback`;
  }

  /**
   * Starts the local HTTP server to wait for Spotify OAuth redirect.
   */
  public listenForCode(expectedState: string, timeoutMs = 120000): Promise<CallbackResult> {
    return new Promise((resolve) => {
      this.close();

      this.server = http.createServer((req, res) => {
        try {
          const parsedUrl = url.parse(req.url || "", true);
          if (parsedUrl.pathname === "/callback") {
            const query = parsedUrl.query;
            const code = query.code as string | undefined;
            const state = query.state as string | undefined;
            const error = query.error as string | undefined;

            if (error) {
              this.sendHtmlResponse(
                res,
                400,
                "Authentication Failed",
                `Spotify reported an error: <b>${escapeHtml(error)}</b>. You can close this tab and try again.`
              );
              resolve({ error: `Spotify auth error: ${error}` });
              this.close();
              return;
            }

            if (!state || state !== expectedState) {
              this.sendHtmlResponse(
                res,
                400,
                "Security Check Failed",
                "Invalid state parameter received. Please try logging in again."
              );
              resolve({ error: "Invalid OAuth state parameter" });
              this.close();
              return;
            }

            if (!code) {
              this.sendHtmlResponse(
                res,
                400,
                "Missing Code",
                "No authorization code was received from Spotify."
              );
              resolve({ error: "No authorization code received" });
              this.close();
              return;
            }

            // Success!
            this.sendHtmlResponse(
              res,
              200,
              "Connected Successfully!",
              "Spotify account linked to your Stream Deck. You can now close this tab and return to the Stream Deck app."
            );
            resolve({ code });
            this.close();
            return;
          }

          // Any other route
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          resolve({ error: errMsg });
          this.close();
        }
      });

      this.server.on("error", (err) => {
        resolve({ error: `Could not start local auth server on port ${this.port}: ${err.message}` });
        this.close();
      });

      this.server.listen(this.port, "127.0.0.1", () => {
        // Set timeout in case user never completes auth in browser
        this.timeoutId = setTimeout(() => {
          resolve({ error: "Authorization timed out. Please try again." });
          this.close();
        }, timeoutMs);
      });
    });
  }

  public close(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // ignore
      }
      this.server = null;
    }
  }

  private sendHtmlResponse(res: http.ServerResponse, statusCode: number, title: string, message: string): void {
    const isSuccess = statusCode >= 200 && statusCode < 300;
    const accentColor = isSuccess ? "#1DB954" : "#e22134";
    const iconSvg = isSuccess
      ? `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#1DB954" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`
      : `<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#e22134" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} - Spotify Stream Deck</title>
  <style>
    * { box-sizing: border-box; }
    body {
      background: #121212;
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #181818;
      border: 1px solid #282828;
      border-radius: 14px;
      padding: 36px 32px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .icon {
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      color: ${accentColor};
    }
    p {
      font-size: 14px;
      line-height: 1.6;
      color: #B3B3B3;
      margin: 0 0 24px 0;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #242424;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      color: #A7A7A7;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${iconSvg}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${message}</p>
    <div class="badge">Stream Deck &bull; Spotify Playlist Adder</div>
  </div>
</body>
</html>`;

    res.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html)
    });
    res.end(html);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
