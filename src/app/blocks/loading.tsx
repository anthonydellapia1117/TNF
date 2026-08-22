import { Skeleton } from "@/components/ui/skeleton";

export default function BlocksLoading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full sm:h-32" />
      <div className="space-y-3">
        <div className="flex justify-end gap-1">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-28" />
        </div>
        <div className="mx-auto grid w-full max-w-3xl grid-cols-10 gap-1 sm:gap-1.5">
          {Array.from({ length: 100 }, (_, i) => (
            <Skeleton key={i} className="aspect-square sm:aspect-auto sm:h-16" />
          ))}
        </div>
        <Skeleton className="mx-auto h-4 w-64" />
      </div>
    </div>
  );
}
