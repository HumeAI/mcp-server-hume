export default class DeinterleavingPlayer {
  private playAudio: (filePath: string) => Promise<void>
  constructor(playAudio: ( filePath: string) => Promise<void>) {
    this.playAudio = playAudio;
  }

  private currentPlayback : Promise<void> = Promise.resolve()
  private toPlay: Array<{generationId: string, chunkIndex: number, isLastChunk: boolean, filePath: string}> = []
  private currentGenerationId: string = ""
  private currentChunkIndex: number = 0
  private currentIsLastChunk: boolean = true
  enqueue(generationId: string, isLastChunk: boolean, chunkIndex: number, filePath: string) {
    this.toPlay.push({
      generationId,
      isLastChunk,
      filePath,
      chunkIndex
    });
  }
  private dequeue() {
    const nextGuy = this.toPlay.find((el) => {
      if (!this.currentIsLastChunk) {
        if (el.generationId === this.currentGenerationId && el.chunkIndex === this.currentChunkIndex + 1) {
          return true;
        }
      } else {
        if (el.generationId !== this.currentGenerationId && el.chunkIndex === 0) {
          return true;
        }
      }
      return false;
    });
    if (!nextGuy) {
      return null;
    }
    this.currentGenerationId = nextGuy.generationId;
    this.currentChunkIndex = nextGuy.chunkIndex;
    this.currentIsLastChunk = nextGuy.isLastChunk;
    return nextGuy;
  }
  playNextAudio = () => {
    const nextGuy = this.dequeue()
    if (!nextGuy) {
      console.error('There was no audio to play')
      return
    }
    console.error('Queued up a new audio for playback:', nextGuy.generationId, nextGuy.chunkIndex)
    this.currentPlayback = this.currentPlayback.then(() => this.playAudio(nextGuy.filePath))
  }
}
