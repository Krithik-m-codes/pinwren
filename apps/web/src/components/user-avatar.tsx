import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export const initials = (name?: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

export function UserAvatar({
  name,
  image,
  className,
}: {
  name?: string | null | undefined;
  image?: string | null | undefined;
  className?: string | undefined;
}) {
  return (
    <Avatar className={cn("size-6", className)}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback className="text-[10px] font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
