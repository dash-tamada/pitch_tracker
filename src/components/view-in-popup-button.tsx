"use client";

/** Opens a document/image in a real popup window instead of navigating the current tab away. */
export function ViewInPopupButton({ href, label = "View" }: { href: string; label?: string }) {
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={() => {
        window.open(href, "_blank", "noopener,noreferrer,width=1000,height=800,menubar=no,toolbar=no,location=no");
      }}
    >
      {label}
    </button>
  );
}
