/** Server-rendered SVG charts: no client JS, no inline styles (works under the strict CSP), readable without colour. */
export function HBarChart({ data, title, valueSuffix = "" }: { data: { label: string; value: number }[]; title: string; valueSuffix?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const row = 26, labelW = 150, barW = 300, h = data.length * row + 10;
  return (
    <figure className="section">
      <figcaption><h2>{title}</h2></figcaption>
      {data.length === 0 ? <p className="muted">No data yet.</p> : (
        <svg className="chart" viewBox={`0 0 ${labelW + barW + 60} ${h}`} role="img" aria-label={title}>
          {data.map((d, i) => {
            const w = Math.round((d.value / max) * barW);
            return (
              <g key={d.label} transform={`translate(0 ${i * row + 4})`}>
                <text x={labelW - 8} y={15} textAnchor="end">{d.label.length > 22 ? `${d.label.slice(0, 21)}…` : d.label}</text>
                <rect className="bar" x={labelW} y={3} width={Math.max(w, d.value > 0 ? 2 : 0)} height={16} rx={3} />
                <text x={labelW + w + 6} y={15}>{d.value}{valueSuffix}</text>
              </g>
            );
          })}
        </svg>
      )}
    </figure>
  );
}

export function GroupedMonthChart({ data, title, series }: { data: Record<string, number | string>[]; title: string; series: { key: string; label: string; cls: string }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0))));
  const colW = 48, chartH = 140, w = Math.max(data.length * colW + 40, 300);
  const bw = Math.floor((colW - 10) / series.length);
  return (
    <figure className="section">
      <figcaption><h2>{title}</h2><p className="subtle">{series.map((s) => s.label).join(" · ")}</p></figcaption>
      {data.length === 0 ? <p className="muted">No data yet.</p> : (
        <svg className="chart" viewBox={`0 0 ${w} ${chartH + 40}`} role="img" aria-label={title}>
          {data.map((d, i) => (
            <g key={String(d.month)} transform={`translate(${20 + i * colW} 0)`}>
              {series.map((s, j) => {
                const v = Number(d[s.key] ?? 0);
                const bh = Math.round((v / max) * chartH);
                return <rect key={s.key} className={s.cls} x={j * bw} y={chartH - bh + 10} width={bw - 2} height={bh}><title>{`${d.month} ${s.label}: ${v}`}</title></rect>;
              })}
              <text x={colW / 2 - 6} y={chartH + 28} textAnchor="middle">{String(d.month).slice(2)}</text>
            </g>
          ))}
        </svg>
      )}
    </figure>
  );
}

export function Funnel({ steps }: { steps: { label: string; count: number }[] }) {
  const max = Math.max(1, steps[0]?.count ?? 1);
  return (
    <figure className="section">
      <figcaption><h2>Pitch funnel</h2></figcaption>
      <svg className="chart" viewBox={`0 0 520 ${steps.length * 30 + 6}`} role="img" aria-label="Pitch funnel">
        {steps.map((s, i) => {
          const w = Math.max(Math.round((s.count / max) * 360), s.count ? 4 : 0);
          return (
            <g key={s.label} transform={`translate(0 ${i * 30})`}>
              <text x={130} y={19} textAnchor="end">{s.label}</text>
              <rect className="bar" x={140 + (360 - w) / 2} y={4} width={w} height={20} rx={4} />
              <text x={510} y={19} textAnchor="end">{s.count}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
