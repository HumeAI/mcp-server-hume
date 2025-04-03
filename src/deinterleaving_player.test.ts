import { test, expect, mock } from 'bun:test';
import DeinterleavingPlayer from './deinterleaving_player.js';


const parseInput = (inputStr: string): { generationId: string, chunkIndex: number, isLastChunk: boolean, filePath: string } => {
  const generationId = inputStr[0].toLowerCase(); // First character indicates generationId
  const chunkIndex = parseInt(inputStr[1])
  const isLastChunk = inputStr[0].toUpperCase() === inputStr[0]
  const filePath = inputStr;
  return { generationId, chunkIndex, isLastChunk, filePath };
};

test('DeinterleavingPlayer should play chunks in correct order', async () => {
  const playedFilePaths: string[] = [];
  const mockPlayAudio = mock(async (filePath: string, delay: number = 1): Promise<void> => {
    console.log(`Mock playing: ${filePath}`); // Optional: for debugging test run
    playedFilePaths.push(filePath);
    // Simulate async operation completion
    await new Promise(resolve => setTimeout(resolve, delay)); // Small delay to mimic async
  });

  const player = new DeinterleavingPlayer(mockPlayAudio);

  // Input sequence (0-based index, uppercase = isLastChunk)
  // Original: a1, b1, c1, a2, b2, A3, c2, b3, C3, B4
  // Adapted (0-based): a0, b0, c0, a1, b1, A2, c1, b2, C2, B3
  const inputSequence = [
    "a0", "b0", "c0", "a1", "b1", "A2", "c1", "b2", "C2", "B3"
  ];

  // Expected playback order (based on 0-based adaptation)
  const expectedPlaybackOrder = [
    "a0", "a1", "A2", "b0", "b1", "b2", "B3", "c0", "c1", "C2"
  ];

  // --- Action ---

  // 1. Enqueue all items in the specified order
  inputSequence.forEach(itemStr => {
    const item = parseInput(itemStr);
    console.log(`Enqueuing: ${JSON.stringify(item)}`); // Optional: for debugging
    player.enqueue(item.generationId, item.isLastChunk, item.chunkIndex, item.filePath);
  });

  // 2. Trigger playback for each expected item
  // We call playNextAudio sequentially. The internal promise chain handles the actual async playback order.
  for (let i = 0; i < expectedPlaybackOrder.length; i++) {
    player.playNextAudio();
  }

  // 3. Wait for all asynchronous playback operations to complete
  // Accessing the internal `currentPlayback` promise to wait for the chain.
  // We need to cast player to 'any' to access the private member in the test.
  await (player as any).currentPlayback;

  // --- Assertion ---

  expect(mockPlayAudio).toHaveBeenCalledTimes(expectedPlaybackOrder.length);
  expect(playedFilePaths).toEqual(expectedPlaybackOrder);

  // Optional: Check internal state if needed (might make test brittle)
  // expect((player as any).toPlay.length).toBe(0); // Should be empty if all dequeued
  // const finalState = {
  //   genId: (player as any).currentGenerationId,
  //   chunkIdx: (player as any).currentChunkIndex,
  //   isLast: (player as any).currentIsLastChunk,
  // };
  // // The state should reflect the *last* played item ('C2' in this case)
  // expect(finalState).toEqual({ genId: 'c', chunkIdx: 2, isLast: true });
});

// Add more test cases for edge scenarios:
// - Empty queue
// - Only one generation
// - Enqueueing after playback starts (more complex setup)
// - Missing chunks (how should it behave?)
