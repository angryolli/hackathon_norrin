import { Badge } from "@/components/ui/badge";
import type { Chip } from "@/lib/browser-api";

const styles: Record<Chip, string> = {
  normal: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  drifting: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  stuck: "bg-red-500/20 text-red-300 border-red-500/30",
  out_of_range: "bg-red-500/20 text-red-300 border-red-500/30",
  excluded: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
};

const labels: Record<Chip, string> = {
  normal: "Normal",
  drifting: "Drifting",
  stuck: "Stuck",
  out_of_range: "Out-of-range",
  excluded: "Excluded — sensor fault",
};

export function StatusChip({ status }: { status: Chip }) {
  return (
    <Badge variant="outline" className={styles[status]}>
      {labels[status]}
    </Badge>
  );
}
