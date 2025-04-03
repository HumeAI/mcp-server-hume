import { test, expect, mock } from 'bun:test';
import DeinterleavingPlayer from './deinterleaving_player.js';

// a1, b1, c1, a2, b2, A3, c2, b3, C3, B4
// a1, a2, A3, b1, b2, B3, b4, c1, c2, C3


const parseInput = (inputStr: string): [string, boolean, number, string ] => {
  const generationId = inputStr[0].toLowerCase();
  const chunkIndex = parseInt(inputStr[1])
  const isLastChunk = inputStr[0].toUpperCase() === inputStr[0]
  const filePath = inputStr;
  return [ generationId, isLastChunk, chunkIndex, filePath ];
};

const flushEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));
test('DeinterleavingPlayer should play chunks in correct order', async () => {
  const playbacks: Record<string, {resolve: () => void}> = {};
  const mockPlayAudio = mock((filePath: string): Promise<void> => {
    return new Promise((resolve) => {
      if (playbacks[filePath]) {
        throw new Error(`Unexpected: ${filePath} was played twice`);
      }
      playbacks[filePath] = {resolve};
    })
  });

  const player = new DeinterleavingPlayer(mockPlayAudio);
  const q = (x: string) => player.enqueue(...parseInput(x));
  const playNext = () => {
    player.playNextAudio();
  }

  q("a0");
  playNext();
  await flushEventLoop();
  expect(playbacks["a0"]).toBeDefined();

  q("b0");
  playNext();
  await flushEventLoop();
  expect(playbacks["b0"]).not.toBeDefined();

  playbacks["a0"].resolve();
  expect(playbacks["b0"]).not.toBeDefined();

  q("a1");
});

// Add more test cases for edge scenarios:
// - Empty queue
// - Only one generation
// - Enqueueing after playback starts (more complex setup)
// - Missing chunks (how should it behave?)
