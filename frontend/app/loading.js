export default function Loading() {
  return (
    <section>
      <div className="hero">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="skeleton" style={{ width: 200, height: 28 }} />
          <div className="skeleton" style={{ width: 120, height: 24, borderRadius: 999 }} />
        </div>
        <div className="skeleton" style={{ marginTop: 12, width: "60%", height: 16 }} />
        <div className="metrics" style={{ marginTop: 20 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="skeleton metric-card" style={{ height: 100 }} />
          ))}
        </div>
      </div>
    </section>
  );
}
