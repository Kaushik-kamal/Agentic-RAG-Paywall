import { Skeleton } from "@/components/ui/Feedback";

export default function Loading() {
  return (
    <div className="shell py-12">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="mt-4 h-72" />
    </div>
  );
}
