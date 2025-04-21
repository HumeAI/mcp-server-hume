# MCP Server Hume - Evaluation Framework

This directory contains the evaluation framework for testing the effectiveness of tool descriptions in various scenarios with the Hume TTS integration.

## Overview

The framework simulates real-world interactions between AI agents and users to measure how well different tool descriptions enable the agent to understand and correctly use the TTS tools.

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

## Evaluation Scenarios

### Basic Scenarios
- **Screen Reader**: Tests basic content reading capabilities
- **Picky Screen Reader**: Tests handling of specific voice parameters
- **Habitual Screen Reader**: Tests continuation across multiple text segments

### Voice Management Scenarios
- **Voice Designer**: Tests voice creation and customization
- **Voice Explorer**: Tests browsing and selecting from voice libraries

### Creative Scenarios
- **AI Poet**: Tests poetic content generation and appropriate voicing
- **AI Playwright**: Tests dialogue reading with different character voices

## Framework Components

- **Roleplay**: Simulates user-agent conversations with specific goals
- **Scoring**: Evaluates performance against predefined criteria
- **Reporting**: Generates detailed reports and highlights areas for improvement

## Results Analysis

Evaluation results are saved to the specified output directory with:
- Individual scenario results with full transcripts
- Consolidated reports with average scores and low-score analysis
- Timestamp-based organization for comparing results over time

## Customizing Tool Descriptions

The framework supports testing different versions of tool descriptions:

1. Default descriptions (from the main codebase)
2. Custom descriptions loaded from JSON files

This enables iterative refinement of tool descriptions based on performance metrics.