declare namespace YT {
  interface PlayerOptions {
    height?: string | number;
    width?: string | number;
    videoId?: string;
    playerVars?: {
      controls?: 0 | 1;
      disablekb?: 0 | 1;
      fs?: 0 | 1;
      iv_load_policy?: 1 | 3;
      rel?: 0 | 1;
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
    cueVideoById(options: { videoId: string; startSeconds?: number }): void;
    getCurrentTime(): number;
    getPlayerState(): number;
    /** A suggestion: the player may round it, so read back getPlaybackRate(). */
    setPlaybackRate(rate: number): void;
    getPlaybackRate(): number;
    getIframe(): HTMLIFrameElement;
    setVolume(volume: number): void;
    mute(): void;
    unMute(): void;
    destroy(): void;
  }
}

interface Window {
  YT?: typeof YT;
  onYouTubeIframeAPIReady?: () => void;
}
