import * as fs from "fs/promises";
import * as path from "path";
import { DESCRIPTIONS } from "../server.js";
import { Roleplay, RoleplayResult, TranscriptEntry } from "./roleplay.js";
import { scoreCriteria, ScoredCriterion } from "./scorer.js";
import { prettyTranscriptEntry } from "./utils.js";
import Bottleneck from "bottleneck";
import { getScenarios } from "./scenario/index.js";
import { prettyPrintFile } from "./pretty.js";
import { EvalResult } from "./scenario/types.js";

// Configure a bottleneck limiter for Anthropic API calls
const anthropicLimiter = new Bottleneck({
  maxConcurrent: 10, // Allow up to 10 concurrent requests
});

// Setup handling for rate limit and overloaded errors
anthropicLimiter.on("failed", (error: any, jobInfo) => {
  const errorObj = error.error?.error || error;
  const statusCode = error.status || 0;
  const errorType = errorObj.type;

  // Check for rate limits or service overload
  if (
    statusCode === 429 ||
    errorType === "rate_limit_error" ||
    errorType === "overloaded_error"
  ) {
    console.error(
      `API error: ${errorType || statusCode}, pausing all requests for 60 seconds`,
    );

    // Stop all requests for 60 seconds
    anthropicLimiter.updateSettings({
      reservoir: 0, // No requests allowed
    });

    // Resume after 60 seconds
    setTimeout(() => {
      console.error("Resuming API requests");
      anthropicLimiter.updateSettings({
        reservoir: null, // Reset to unlimited
      });
    }, 60000);

    // Retry this job after a delay
    return 1000; // 1 second delay before retry
  }

  console.error(
    `API error not related to rate limiting: ${JSON.stringify(errorObj)}`,
  );
  // For other errors, don't retry
  return null;
});

// Throttled wrapper for any Anthropic API operation
const withAnthropicThrottle = <T>(operation: () => Promise<T>): Promise<T> => {
  return anthropicLimiter.schedule(() => operation());
};

// Using shared EvalResult type from types.js

// Run a single evaluation with the specified scenario
const runSingleEval = async (
  scenarioName: string,
  outputPath: string,
  modelName: string = "claude-3-5-haiku-latest",
  descriptions: typeof DESCRIPTIONS = DESCRIPTIONS,
): Promise<EvalResult> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  const scenarios = await getScenarios(descriptions);
  if (!scenarios[scenarioName]) {
    console.error(`Scenario "${scenarioName}" not found`);
    process.exit(1);
  }

  const scenario = scenarios[scenarioName];
  console.error(
    `Running scenario: ${scenario.roleplay.name} with maxTurns: ${scenario.maxTurns}`,
  );

  // Create roleplay with throttle-aware methods
  const roleplay = new Roleplay(
    process.env.ANTHROPIC_API_KEY,
    scenario.roleplay,
    modelName,
    withAnthropicThrottle, // Pass the throttle wrapper
  );

  // Start with the initial message
  const initialMessage: TranscriptEntry = {
    type: "spoke",
    speaker: "roleplayer",
    content: scenario.roleplay.initialMessage
  };
  
  const transcript: any[] = [initialMessage];
  console.error(prettyTranscriptEntry(initialMessage));

  // Iterate through transcript entries as they come in
  for await (const entry of roleplay) {
    transcript.push(entry);
    console.error(prettyTranscriptEntry(entry));

    // Break after maxTurns
    if (transcript.length >= scenario.maxTurns) {
      break;
    }
  }

  const result = roleplay.getResult();

  // Score the criteria with throttling
  const scores = await withAnthropicThrottle(() =>
    scoreCriteria(process.env.ANTHROPIC_API_KEY!, scenario.criteria, {
      transcript,
      result,
    }),
  );

  // Write results to the output path
  const evalResult = { transcript, result, scores };
  await fs.writeFile(outputPath, JSON.stringify(evalResult, null, 2));
  console.error(`Results saved to ${outputPath}`);

  return evalResult;
};

// Run multiple evaluations in parallel
const runMultipleEvals = async (
  scenarioName: string,
  count: number,
  outputDir: string,
  modelName: string = "claude-3-5-haiku-latest",
  descriptions: typeof DESCRIPTIONS = DESCRIPTIONS,
  customTimestamp?: string,
): Promise<EvalResult[]> => {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const descriptionsSource =
    descriptions === DESCRIPTIONS ? "default" : "custom";
  const timestamp =
    customTimestamp || new Date().toISOString().replace(/[:.]/g, "-");

  console.error(`Running ${count} evaluations of ${scenarioName} in parallel`);

  // Prepare evaluation tasks
  const evalTasks = Array.from({ length: count }, (_, i) => {
    const outputPath = path.join(
      outputDir,
      `${scenarioName}-${descriptionsSource}-${timestamp}-${i + 1}.json`,
    );
    return {
      index: i + 1,
      outputPath,
      run: () =>
        runSingleEval(scenarioName, outputPath, modelName, descriptions),
    };
  });

  // Run all evaluations in parallel
  const results = await Promise.all(
    evalTasks.map(async (task) => {
      console.error(`\nStarting evaluation ${task.index} of ${count}`);
      const result = await task.run();
      console.error(`Completed evaluation ${task.index} of ${count}`);
      return result;
    }),
  );

  // Print summary to console
  console.error(`\nCompleted ${count} evaluations of ${scenarioName}`);

  // Calculate and show average scores
  const criteriaMap = new Map<string, { sum: number; count: number }>();

  results.forEach((result) => {
    result.scores.forEach((score) => {
      const existing = criteriaMap.get(score.name) || { sum: 0, count: 0 };
      criteriaMap.set(score.name, {
        sum: existing.sum + score.score,
        count: existing.count + 1,
      });
    });
  });

  console.error("\nAverage scores for this scenario:");
  [...criteriaMap.entries()].forEach(([criterion, { sum, count }]) => {
    const average = sum / count;
    console.error(`${criterion}: ${average.toFixed(2)}`);
  });

  return results;
};

// Run multiple scenarios with summarized results
const run = async (
  scenarioNames: string[],
  count: number,
  outputDir: string,
  modelName: string = "claude-3-5-haiku-latest",
  descriptions: typeof DESCRIPTIONS = DESCRIPTIONS,
): Promise<void> => {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const descriptionsSource =
    descriptions === DESCRIPTIONS ? "default" : "custom";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  console.error(
    `Running ${count} evaluations of ${scenarioNames.length} scenarios: ${scenarioNames.join(", ")}`,
  );

  const allResults: Record<string, EvalResult[]> = {};
  const allScores: Record<string, Record<string, number[]>> = {};

  // Run all scenarios in parallel
  const scenarioPromises = scenarioNames.map(async (scenarioName) => {
    console.error(`\n==== Starting scenario: ${scenarioName} ====`);

    const results = await runMultipleEvals(
      scenarioName,
      count,
      outputDir,
      modelName,
      descriptions,
      `${scenarioName}-${descriptionsSource}-${timestamp}`,
    );

    return { scenarioName, results };
  });

  // Wait for all scenarios to complete
  const completedScenarios = await Promise.all(scenarioPromises);

  // Process results
  for (const { scenarioName, results } of completedScenarios) {
    allResults[scenarioName] = results;

    // Collect scores for this scenario
    allScores[scenarioName] = {};

    // Gather all criteria used in this scenario
    const allCriteriaForScenario = new Set<string>();
    results.forEach((result) => {
      result.scores.forEach((score) => {
        allCriteriaForScenario.add(score.name);
      });
    });

    // Collect all scores for each criterion
    allCriteriaForScenario.forEach((criterion) => {
      allScores[scenarioName][criterion] = results.map((result) => {
        const score = result.scores.find((s) => s.name === criterion);
        return score ? score.score : 0;
      });
    });
  }

  // Create a consolidated results summary
  // This will include average scores for all criteria and highlight low scores

  // Global average scores across all scenarios
  const globalScores: Record<
    string,
    {
      totalScore: number;
      count: number;
      lowScoreReasons: Array<{
        scenario: string;
        runIndex: number;
        score: number;
        reason: string;
      }>;
    }
  > = {};

  // Collect all scores and low score reasons from all scenarios
  for (const scenarioName of scenarioNames) {
    const scenarioResults = allResults[scenarioName];

    scenarioResults.forEach((result, runIndex) => {
      result.scores.forEach((scoredCriterion) => {
        const { name, score, reason } = scoredCriterion;

        // Initialize criterion in global scores if not exists
        if (!globalScores[name]) {
          globalScores[name] = {
            totalScore: 0,
            count: 0,
            lowScoreReasons: [],
          };
        }

        // Add score to global total
        globalScores[name].totalScore += score;
        globalScores[name].count += 1;

        // Record low scores with reasons
        if (score <= 0.6) {
          globalScores[name].lowScoreReasons.push({
            scenario: scenarioName,
            runIndex,
            score,
            reason,
          });
        }
      });
    });
  }

  // Prepare the consolidated report
  const consolidatedReport = {
    runInfo: {
      scenarios: scenarioNames,
      model: modelName,
      timestamp,
      totalRuns: Object.values(allResults).flat().length,
    },
    criteriaResults: Object.entries(globalScores)
      .map(([criterion, data]) => {
        const averageScore = data.totalScore / data.count;
        return {
          criterion,
          averageScore,
          occurrences: data.count,
          lowScores: data.lowScoreReasons.sort((a, b) => a.score - b.score), // Sort by score ascending
        };
      })
      .sort((a, b) => a.averageScore - b.averageScore), // Sort criteria by average score
  };

  // Write consolidated report to file
  const reportPath = path.join(outputDir, `eval-report-${timestamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(consolidatedReport, null, 2));
  console.error(`\nConsolidated evaluation report saved to ${reportPath}`);

  // Print summary statistics to console
  console.error("\n==== Evaluation Summary ====");
  console.error(`Scenarios: ${scenarioNames.join(", ")}`);
  console.error(
    `Total evaluation runs: ${consolidatedReport.runInfo.totalRuns}`,
  );

  console.error("\nCriteria Average Scores (sorted by score):");
  consolidatedReport.criteriaResults.forEach((criteria) => {
    console.error(
      `  ${criteria.criterion}: ${criteria.averageScore.toFixed(2)}`,
    );
  });

  // Print low score highlights
  const lowScoreCriteria = consolidatedReport.criteriaResults.filter(
    (c) => c.lowScores.length > 0,
  );

  if (lowScoreCriteria.length > 0) {
    console.error("\nLow Score Highlights (score <= 0.6):");
    lowScoreCriteria.forEach((criteria) => {
      console.error(
        `\n  ${criteria.criterion} - Avg: ${criteria.averageScore.toFixed(2)}, Low scores: ${criteria.lowScores.length}`,
      );

      // Print up to 3 lowest score reasons per criterion
      criteria.lowScores.slice(0, 3).forEach((lowScore) => {
        console.error(
          `    • ${lowScore.scenario} (${lowScore.score.toFixed(2)}): ${lowScore.reason.split("\n")[0]}`,
        );
      });
    });
  }
};

// CLI command types and arguments interfaces

// Help command
interface HelpArgs {
  command: "help";
}

// List command
interface ListArgs {
  command: "list";
}

// Run command
interface RunArgs {
  command: "run";
  scenarioNames: string[];
  count: number;
  outputDir: string;
  modelName: string;
  descriptionsPath: string;
  runAllScenarios: boolean;
}

// Pretty command
interface PrettyArgs {
  command: "pretty";
  filePath: string;
}

// Union type for all command arguments
type CliArgs = HelpArgs | ListArgs | RunArgs | PrettyArgs;

// Print help message
const printHelp = (): void => {
  console.log(`
Usage:
  bun run src/evals/index.ts <command> [options]

Commands:
  list                            List available scenarios
  run <scenario...> [options]     Run evaluations for one or more scenarios
  pretty <file-path>              Format an evaluation result file in human-readable format

Options for 'run':
  --count, -c <number>            Number of evaluations to run per scenario (default: 1)
  --output-dir, -o <path>         Directory to save results (default: ./eval-results)
  --model, -m <model-name>        Model to use (default: claude-3-5-haiku-latest)
  --descriptions, -d <file-path>  Path to JSON file with custom descriptions
  --all                           Run all available scenarios

Examples:
  bun run src/evals/index.ts run screenreader                 # Run one scenario
  bun run src/evals/index.ts run screenreader voice-designer  # Run multiple scenarios
  bun run src/evals/index.ts run --all -c 3                   # Run all scenarios 3 times each
  bun run src/evals/index.ts pretty ./current/result-file.json # Format a result file
  `);
};

// Parse help command
const parseHelpCommand = (): HelpArgs => {
  return { command: "help" };
};

// Parse list command
const parseListCommand = (): ListArgs => {
  return { command: "list" };
};

// Parse run command
const parseRunCommand = (args: string[]): RunArgs => {
  const runArgs: RunArgs = {
    command: "run",
    scenarioNames: [],
    count: 1,
    outputDir: "./eval-results",
    modelName: "claude-3-5-haiku-latest",
    descriptionsPath: "",
    runAllScenarios: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--all") {
      runArgs.runAllScenarios = true;
    } else if ((arg === "--count" || arg === "-c") && i + 1 < args.length) {
      const countArg = parseInt(args[++i], 10);
      if (isNaN(countArg) || countArg < 1) {
        console.error("Error: count must be a positive integer");
        process.exit(1);
      }
      runArgs.count = countArg;
    } else if (
      (arg === "--output-dir" || arg === "-o") &&
      i + 1 < args.length
    ) {
      runArgs.outputDir = args[++i];
    } else if ((arg === "--model" || arg === "-m") && i + 1 < args.length) {
      runArgs.modelName = args[++i];
    } else if (
      (arg === "--descriptions" || arg === "-d") &&
      i + 1 < args.length
    ) {
      runArgs.descriptionsPath = args[++i];
    } else if (!arg.startsWith("-")) {
      runArgs.scenarioNames.push(arg);
    } else {
      console.error(`Error: unknown option ${arg}`);
      process.exit(1);
    }
  }

  return runArgs;
};

// Parse pretty command
const parsePrettyCommand = (args: string[]): PrettyArgs => {
  if (args.length < 1) {
    console.error("Error: missing file path for pretty command");
    process.exit(1);
  }

  return {
    command: "pretty",
    filePath: args[0],
  };
};

// Parse command line arguments
const parseCommandArgs = (args: string[]): CliArgs => {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return parseHelpCommand();
  }

  const command = args[0];

  if (command === "list") {
    return parseListCommand();
  }

  if (command === "run") {
    return parseRunCommand(args.slice(1));
  }
  
  if (command === "pretty") {
    return parsePrettyCommand(args.slice(1));
  }

  console.error(`Error: unknown command '${command}'`);
  process.exit(1);
};

// List all available scenarios
const listScenarios = async (): Promise<void> => {
  const scenarios = await getScenarios(DESCRIPTIONS);

  console.log("Available scenarios:");
  for (const [id, scenario] of Object.entries(scenarios)) {
    console.log(`- ${id}: ${scenario.roleplay.name}`);
  }
};

// Load custom descriptions from a file
const loadCustomDescriptions = async (
  filePath: string,
): Promise<typeof DESCRIPTIONS> => {
  try {
    console.error(`Loading custom descriptions from ${filePath}`);
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading custom descriptions: ${error}`);
    process.exit(1);
  }
};

// Handle list command
const handleListCommand = async (_args: ListArgs): Promise<void> => {
  await listScenarios();
};

// Handle pretty command
const handlePrettyCommand = async (args: PrettyArgs): Promise<void> => {
  await prettyPrintFile(args.filePath);
};

// Handle run command
const handleRunCommand = async (args: RunArgs): Promise<void> => {
  const {
    scenarioNames,
    count,
    outputDir,
    modelName,
    descriptionsPath,
    runAllScenarios,
  } = args;

  // Load available scenarios
  const availableScenarios = await getScenarios(DESCRIPTIONS);
  const availableScenarioNames = Object.keys(availableScenarios);

  // Determine which scenarios to run
  let scenariosToRun: string[] = [];

  if (runAllScenarios) {
    scenariosToRun = availableScenarioNames;
  } else if (scenarioNames.length > 0) {
    // Validate specified scenarios
    for (const name of scenarioNames) {
      if (!availableScenarioNames.includes(name)) {
        console.error(
          `Error: unknown scenario "${name}". Available scenarios: ${availableScenarioNames.join(", ")}`,
        );
        process.exit(1);
      }
    }
    scenariosToRun = scenarioNames;
  } else {
    console.error("Error: no scenarios specified. Use scenario names or --all");
    process.exit(1);
  }

  // Load custom descriptions if specified
  let descriptions = DESCRIPTIONS;
  if (descriptionsPath) {
    descriptions = await loadCustomDescriptions(descriptionsPath);
  }

  // Run scenarios
  await run(scenariosToRun, count, outputDir, modelName, descriptions);
};

// Execute the command with the parsed arguments
const executeCommand = async (cliArgs: CliArgs): Promise<void> => {
  switch (cliArgs.command) {
    case "help":
      printHelp();
      break;

    case "list":
      await handleListCommand(cliArgs);
      break;

    case "run":
      await handleRunCommand(cliArgs);
      break;
      
    case "pretty":
      await handlePrettyCommand(cliArgs);
      break;
  }
};

// Main function
const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const cliArgs = parseCommandArgs(args);
  await executeCommand(cliArgs);
  process.exit(0);
};

// Execute main function
if (require.main === module) {
  await main();
}
