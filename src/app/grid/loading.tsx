import { Skeleton } from "@/components/ui/skeleton";

export default function GridLoading() {
  return (
    <div className="space-y-5">
      <div className="flex gap-1">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-12" />
        ))}
      </div>
      <div className="mx-auto max-w-md space-y-2 text-center">
        <Skeleton className="mx-auto h-4 w-64" />
        <Skeleton className="mx-auto h-12 w-80" />
      </div>
      <Skeleton className="aspect-square w-full max-w-2xl mx-auto" />
    </div>
  );
}
