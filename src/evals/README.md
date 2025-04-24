# Evals

## Overview

When developing the MCP Server, we noticed that using it could be really annoying. The assistant would make unwanted requests, use the wrong voice, fail to apply continuation appropriately, and fail to make reasonable assumptions about the user's intent in using the tools, unless they user was irritatingly specific in prompting it.

Improving the tool descriptions helped somewhat, but was somewhat unpredictable. We wanted to be disciplined about our approach, and so we developed this evaluation framework.

In this framework, there are three assistants, a "roleplayer", an "agent", and a "scorer". The roleplayer pretends to be a user of the MCP server and is given a realistic scenario to act out. The agent acts as an assistant given access to the tools exposed by the MCP server. Once the roleplayer determines the chat is finished, the "scorer" evaluates the chat transcript according to a set of criteria that reflect what we believe to be good behavior of an assistant using this MCP model.

## Running Evaluations

```bash
# List available scenarios
bun run src/evals/index.ts list

# Run a specific scenario
bun run src/evals/index.ts run screenreader

# Run multiple scenarios
bun run src/evals/index.ts run screenreader voice-designer

# Run all scenarios multiple times
bun run src/evals/index.ts run --all -c 3

# Run with custom tool descriptions
bun run src/evals/index.ts run --all --descriptions improved-descriptions.json
```
