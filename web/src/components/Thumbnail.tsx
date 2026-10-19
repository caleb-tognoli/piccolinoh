import { cn } from "../ui/cn";

/** YouTube's 320×180 still for a video. */
export function Thumbnail({ videoId, class: className }: { videoId: string; class?: string }) {
  return (
    <img
      src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
      alt=""
      loading="lazy"
      class={cn("aspect-video shrink-0 rounded-md bg-raised object-cover", className)}
    />
  );
}
