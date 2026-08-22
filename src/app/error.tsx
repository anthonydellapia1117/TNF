"use client";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-24 text-center">
      <p className="text-xl font-semibold">Something went wrong</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-md border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2"
      >
        Try again
      </button>
    </div>
  );
}
