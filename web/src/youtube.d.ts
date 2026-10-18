declare namespace YT {
  interface PlayerOptions {
    height?: string | number;
    width?: string | number;
    videoId?: string;
    playerVars?: {
      controls?: 0 | 1;
      playsinline?: 0 | 1;
      autoplay?: 0 | 1;
    };
    events?: {
      onReady?(e: { target: Player }): void;
      onStateChange?(e: { target: Player; data: number }): void;
      onError?(e: { target: Player; data: number }): void;
    };
  }

  class Player {
    constructor(elementId: string, options: PlayerOptions);
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead?: boolean): void;
    loadVideoById(options: { videoId: string; startSeconds?: number }): void;
    getCurrentTime(): number;
    getPlayerState(): number;
    destroy(): void;
  }
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
