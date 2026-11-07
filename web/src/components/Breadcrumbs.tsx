import { Link } from "react-router-dom";

export type BreadcrumbItem = {
  label: string;
  to?: string;
};

export default function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <nav className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs text-[var(--axon-muted)] mb-4 pb-1">
      <Link to="/" className="hover:text-[var(--axon-text)] transition flex items-center gap-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
          <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3m10-11v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Home</span>
      </Link>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-[var(--axon-border)]">/</span>
            {item.to && !isLast ? (
              <Link to={item.to} className="hover:text-[var(--axon-text)] transition">
                {item.label}
              </Link>
            ) : (
              <span className={`font-semibold ${isLast ? "text-[var(--axon-text)]" : ""}`}>
                {item.label}
              </span>
            )}
          </div>
        );
      })}
    </nav>
  );
}
