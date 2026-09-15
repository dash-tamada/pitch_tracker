"use client";

import "./globals.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="auth">
          <div className="section">
            <h1>Something went wrong</h1>
            <p>Please try again.</p>
            <button className="btn-inline" onClick={() => reset()}>Try again</button>
          </div>
        </main>
      </body>
    </html>
  );
}
