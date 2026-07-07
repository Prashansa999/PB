declare module "gif-encoder-2" {
  class GIFEncoder {
    constructor(
      width: number,
      height: number,
      algorithm?: "neuquant" | "octree",
      useOptimizer?: boolean,
      totalFrames?: number
    );
    out: { data: number[] };
    start(): void;
    setDelay(ms: number): void;
    setRepeat(repeat: number): void;
    setQuality(quality: number): void;
    addFrame(pixels: Uint8Array | Uint8ClampedArray): void;
    finish(): void;
  }
  export = GIFEncoder;
}
