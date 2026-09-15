"use client";

/** Generic error page: never shows technical details. The server log has the request ID. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="auth">
      <div className="section">
        <h1>Something went wrong</h1>
        <p>Please try again. If it keeps happening, tell your administrator what you were doing and the time.</p>
        <button className="btn-inline" onClick={() => reset()}>Try again</button>
      </div>
    </main>
  );
}
