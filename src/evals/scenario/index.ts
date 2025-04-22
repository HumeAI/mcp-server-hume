import { DESCRIPTIONS } from '../../server.js';
import { EvalScenario } from './types.js';
import { screenreaderScenario } from './screenreader.js';
import { pickyScreenreaderScenario } from './picky-screenreader.js';
import { habitualScreenreaderScenario } from './habitual-screenreader.js';
import { voiceDesignerScenario } from './voice-designer.js';
import { voiceExplorerScenario } from './voice-explorer.js';
import { aiPoetScenario } from './ai-poet.js';
import { aiPlaywrightScenario } from './ai-playwright.js';

// Get all available scenarios
export const getScenarios = async (descriptions: typeof DESCRIPTIONS): Promise<Record<string, EvalScenario>> => {
  return {
    "screenreader": await screenreaderScenario(descriptions),
    "picky-screenreader": await pickyScreenreaderScenario(descriptions),
    "habitual-screenreader": await habitualScreenreaderScenario(descriptions),
    "voice-designer": await voiceDesignerScenario(descriptions),
    "voice-explorer": await voiceExplorerScenario(descriptions),
    "ai-poet": await aiPoetScenario(descriptions),
    "ai-playwright": await aiPlaywrightScenario(descriptions)
  };
};
