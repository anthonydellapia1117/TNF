import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="text-3xl font-semibold tabular-nums">404</p>
      <p className="mt-2 text-muted-foreground">
        That page doesn&apos;t exist. The grid does.
      </p>
      <Link
        href="/grid"
        className="mt-6 inline-block rounded-md border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2"
      >
        Open the grid
      </Link>
    </div>
  );
}
