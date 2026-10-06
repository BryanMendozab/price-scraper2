export function Topbar({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="border-b border-line-soft bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium tracking-tight">{title}</h1>
          <p className="truncate text-[11px] text-dim">{subtitle}</p>
        </div>
      </div>
    </header>
  );
}
