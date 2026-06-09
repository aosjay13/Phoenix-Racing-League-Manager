"use client";

export default function Error({ error, reset }) {
  return (
    <section>
      <div className="hero">
        <div className="page-title">
          <h2>Something went wrong</h2>
        </div>
        <p style={{ marginTop: 8, color: "var(--accent-red)", fontSize: "0.9rem" }}>
          {error?.message || "An unexpected error occurred."}
        </p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => reset()}>
          Try again
        </button>
      </div>
    </section>
  );
}
