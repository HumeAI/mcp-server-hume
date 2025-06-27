import * as fs from "fs/promises";
import * as path from "path";
import { DESCRIPTIONS } from "../server.js";
import { EvalResult, Roleplay, TranscriptEntry } from "./roleplay.js";
import { scoreCriteria, } from "./scorer.js";
import { prettyTranscriptEntry } from "./utils.js";
import Bottleneck from "bottleneck";
import { getScenarios } from "./scenario/index.js";
import { prettyPrintFile } from "./pretty.js";

const anthropicLimiter = new Bottleneck({
  maxConcurrent: 10,
});

anthropicLimiter.on("failed", (error: any) => {
  const errorObj = error.error?.error || error;
  const statusCode = error.status || 0;
  const errorType = errorObj.type;

  if (
    statusCode === 429 ||
    errorType === "rate_limit_error" ||
    errorType === "overloaded_error"
  ) {
    console.error(
      `API error: ${errorType || statusCode}, pausing all requests for 60 seconds`,
    );

    anthropicLimiter.updateSettings({
      reservoir: 0,
    });

    setTimeout(() => {
      console.error("Resuming API requests");
      anthropicLimiter.updateSettings({
        reservoir: null,
      });
    }, 60000);

    return 1000;
  }

  console.error(
    `API error not related to rate limiting: ${JSON.stringify(errorObj)}`,
  );
  return null;
});

const withAnthropicThrottle = <T>(operation: () => Promise<T>): Promise<T> => {
  return anthropicLimiter.schedule(() => operation());
};

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

  const roleplay = new Roleplay(
    process.env.ANTHROPIC_API_KEY,
    scenario.roleplay,
    modelName,
    withAnthropicThrottle,
  );

  const initialMessage: TranscriptEntry = {
    type: "spoke",
    speaker: "roleplayer",
    content: scenario.roleplay.initialMessage
  };
  
  const transcript: any[] = [initialMessage];
  console.error(prettyTranscriptEntry(initialMessage));

  for await (const entry of roleplay) {
    transcript.push(entry);
    console.error(prettyTranscriptEntry(entry));

    if (transcript.length >= scenario.maxTurns) {
      break;
    }
  }

  const result = roleplay.getResult();

  const scores = await withAnthropicThrottle(() =>
    scoreCriteria(process.env.ANTHROPIC_API_KEY!, scenario.criteria, {
      transcript,
      result,
    }),
  );

  const evalResult = { transcript, result, scores };
  await fs.writeFile(outputPath, JSON.stringify(evalResult, null, 2));
  console.error(`Results saved to ${outputPath}`);

  return evalResult;
};

const runMultipleEvals = async (
  scenarioName: string,
  count: number,
  outputDir: string,
  modelName: string = "claude-3-5-haiku-latest",
  descriptions: typeof DESCRIPTIONS = DESCRIPTIONS,
  customTimestamp?: string,
): Promise<EvalResult[]> => {
  await fs.mkdir(outputDir, { recursive: true });

  // Convert timestamp to unix format for shorter filenames
  const unixTimestamp = customTimestamp || 
    Math.floor(new Date().getTime() / 1000).toString();

  console.error(`Running ${count} evaluations of ${scenarioName} in parallel`);

  const evalTasks = Array.from({ length: count }, (_, i) => {
    // Create shorter filenames by avoiding repetition and using unix timestamp
    const outputPath = path.join(
      outputDir,
      `${scenarioName}-${unixTimestamp}-${i + 1}.json`,
    );
    return {
      index: i + 1,
      outputPath,
      run: () =>
        runSingleEval(scenarioName, outputPath, modelName, descriptions),
    };
  });

  const results = await Promise.all(
    evalTasks.map(async (task) => {
      console.error(`\nStarting evaluation ${task.index} of ${count}`);
      const result = await task.run();
      console.error(`Completed evaluation ${task.index} of ${count}`);
      return result;
    }),
  );

  console.error(`\nCompleted ${count} evaluations of ${scenarioName}`);

  const criteriaMap = new Map<string, { sum: number; count: number }>();

  results.forEach((result) => {
    result.scores.forEach((score) => {
      // Skip n/a scores for numeric calculations
      if (score.score === "n/a") {
        return;
      }
      
      const existing = criteriaMap.get(score.name) || { sum: 0, count: 0 };
      criteriaMap.set(score.name, {
        sum: existing.sum + (score.score as number),
        count: existing.count + 1,
      });
    });
  });

  console.error("\nAverage scores for this scenario:");
  [...criteriaMap.entries()].forEach(([criterion, { sum, count }]) => {
    if (count > 0) {
      const average = sum / count;
      console.error(`${criterion}: ${average.toFixed(2)} (from ${count} numeric scores)`);
    } else {
      console.error(`${criterion}: no numeric scores (all n/a)`);
    }
  });

  return results;
};

const run = async (
  scenarioNames: string[],
  count: number,
  outputDir: string,
  modelName: string = "claude-3-5-haiku-latest",
  descriptions: typeof DESCRIPTIONS = DESCRIPTIONS,
): Promise<void> => {
  await fs.mkdir(outputDir, { recursive: true });

  // Use unix timestamp for shorter filenames
  const timestamp = Math.floor(new Date().getTime() / 1000).toString();

  console.error(
    `Running ${count} evaluations of ${scenarioNames.length} scenarios: ${scenarioNames.join(", ")}`,
  );

  const allResults: Record<string, EvalResult[]> = {};
  const allScores: Record<string, Record<string, number[]>> = {};

  const scenarioPromises = scenarioNames.map(async (scenarioName) => {
    console.error(`\n==== Starting scenario: ${scenarioName} ====`);

    const results = await runMultipleEvals(
      scenarioName,
      count,
      outputDir,
      modelName,
      descriptions,
      `${scenarioName}-${timestamp}`,
    );

    return { scenarioName, results };
  });

  const completedScenarios = await Promise.all(scenarioPromises);

  for (const { scenarioName, results } of completedScenarios) {
    allResults[scenarioName] = results;

    allScores[scenarioName] = {};

    const allCriteriaForScenario = new Set<string>();
    results.forEach((result) => {
      result.scores.forEach((score) => {
        allCriteriaForScenario.add(score.name);
      });
    });

    allCriteriaForScenario.forEach((criterion) => {
      allScores[scenarioName][criterion] = results.map((result) => {
        const score = result.scores.find((s) => s.name === criterion);
        // Return the score as is, which can be a number or "n/a"
        return score ? score.score : 0;
      });
    });
  }

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

  for (const scenarioName of scenarioNames) {
    const scenarioResults = allResults[scenarioName];

    scenarioResults.forEach((result, runIndex) => {
      result.scores.forEach((scoredCriterion) => {
        const { name, score, reason } = scoredCriterion;

        // Skip n/a scores for numeric calculations
        if (score === "n/a") {
          return;
        }

        if (!globalScores[name]) {
          globalScores[name] = {
            totalScore: 0,
            count: 0,
            lowScoreReasons: [],
          };
        }

        // We already checked score is not "n/a", so it must be a number
        globalScores[name].totalScore += score as number;
        globalScores[name].count += 1;

        if (typeof score === 'number' && score <= 0.6) {
          globalScores[name].lowScoreReasons.push({
            scenario: scenarioName,
            runIndex,
            score: score as number,
            reason,
          });
        }
      });
    });
  }

  const consolidatedReport = {
    runInfo: {
      scenarios: scenarioNames,
      model: modelName,
      timestamp,
      totalRuns: Object.values(allResults).flat().length,
    },
    criteriaResults: Object.entries(globalScores)
      .map(([criterion, data]) => {
        // Only calculate average if there are numeric scores
        const averageScore = data.count > 0 ? data.totalScore / data.count : null;
        return {
          criterion,
          averageScore,
          occurrences: data.count,
          lowScores: data.lowScoreReasons.sort((a, b) => a.score - b.score),
        };
      })
      // Sort criteria with scores first, then alphabetically for those without scores
      .sort((a, b) => {
        if (a.averageScore !== null && b.averageScore !== null) {
          return a.averageScore - b.averageScore;
        } else if (a.averageScore === null && b.averageScore === null) {
          return a.criterion.localeCompare(b.criterion);
        } else {
          return a.averageScore === null ? 1 : -1; // Put criteria with no scores at the end
        }
      }),
  };

  const reportPath = path.join(outputDir, `eval-report-${timestamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(consolidatedReport, null, 2));
  console.error(`\nConsolidated evaluation report saved to ${reportPath}`);

  console.error("\n==== Evaluation Summary ====");
  console.error(`Scenarios: ${scenarioNames.join(", ")}`);
  console.error(
    `Total evaluation runs: ${consolidatedReport.runInfo.totalRuns}`,
  );

  console.error("\nCriteria Average Scores (sorted by score):");
  consolidatedReport.criteriaResults.forEach((criteria) => {
    if (criteria.averageScore !== null) {
      console.error(
        `  ${criteria.criterion}: ${criteria.averageScore.toFixed(2)} (from ${criteria.occurrences} numeric scores)`,
      );
    } else {
      console.error(
        `  ${criteria.criterion}: n/a (no numeric scores)`,
      );
    }
  });

  const lowScoreCriteria = consolidatedReport.criteriaResults.filter(
    (c) => c.lowScores.length > 0,
  );

  if (lowScoreCriteria.length > 0) {
    console.error("\nLow Score Highlights (score <= 0.6):");
    lowScoreCriteria.forEach((criteria) => {
      console.error(
        `\n  ${criteria.criterion} - Avg: ${criteria.averageScore.toFixed(2)}, Low scores: ${criteria.lowScores.length}`,
      );

      criteria.lowScores.slice(0, 3).forEach((lowScore) => {
        console.error(
          `    • ${lowScore.scenario} (${lowScore.score.toFixed(2)}): ${lowScore.reason.split("\n")[0]}`,
        );
      });
    });
  }
};


interface HelpArgs {
  command: "help";
}

interface ListArgs {
  command: "list";
}

interface RunArgs {
  command: "run";
  scenarioNames: string[];
  count: number;
  outputDir: string;
  modelName: string;
  descriptionsPath: string;
  runAllScenarios: boolean;
}

interface PrettyArgs {
  command: "pretty";
  filePath: string;
}

interface ReEvalArgs {
  command: "reeval";
  filePath: string;
  scenarioName: string;
  outputPath?: string;
}

type CliArgs = HelpArgs | ListArgs | RunArgs | PrettyArgs | ReEvalArgs;

const printHelp = (): void => {
  console.log(`
Usage:
  bun run src/evals/index.ts <command> [options]

Commands:
  list                                  List available scenarios
  run <scenario...> [options]           Run evaluations for one or more scenarios
  pretty <file-path>                    Format an evaluation result file in human-readable format
  reeval <file-path> --scenario <name>  Re-evaluate a transcript with the latest criteria

Options for 'run':
  --count, -c <number>                  Number of evaluations to run per scenario (default: 1)
  --output-dir, -o <path>               Directory to save results (default: ./eval-results)
  --model, -m <model-name>              Model to use (default: claude-3-5-haiku-latest)
  --descriptions, -d <file-path>        Path to JSON file with custom descriptions
  --all                                 Run all available scenarios

Options for 'reeval':
  --scenario, -s <scenario-name>        Scenario name to use for re-evaluation (required)
  --output, -o <file-path>              Output file path (default: adds .redo to input path)

Examples:
  bun run src/evals/index.ts run screenreader                 # Run one scenario
  bun run src/evals/index.ts run screenreader voice-designer  # Run multiple scenarios
  bun run src/evals/index.ts run --all -c 3                   # Run all scenarios 3 times each
  bun run src/evals/index.ts pretty ./current/result-file.json # Format a result file
  bun run src/evals/index.ts reeval ./current/result-file.json --scenario quote-narrator # Re-evaluate a transcript
  `);
};

const parseHelpCommand = (): HelpArgs => {
  return { command: "help" };
};

const parseListCommand = (): ListArgs => {
  return { command: "list" };
};

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

const parseReEvalCommand = (args: string[]): ReEvalArgs => {
  if (args.length < 1) {
    console.error("Error: missing file path for reeval command");
    process.exit(1);
  }

  const reEvalArgs: Partial<ReEvalArgs> = {
    command: "reeval",
    filePath: args[0],
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if ((arg === "--scenario" || arg === "-s") && i + 1 < args.length) {
      reEvalArgs.scenarioName = args[++i];
    } else if ((arg === "--output" || arg === "-o") && i + 1 < args.length) {
      reEvalArgs.outputPath = args[++i];
    } else {
      console.error(`Error: unknown option ${arg}`);
      process.exit(1);
    }
  }

  // Check that scenario name is provided
  if (!reEvalArgs.scenarioName) {
    console.error("Error: --scenario option is required for reeval command");
    console.error("Usage: bun run src/evals/index.ts reeval <file-path> --scenario <scenario-name>");
    process.exit(1);
  }

  return reEvalArgs as ReEvalArgs;
};

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
  
  if (command === "reeval") {
    return parseReEvalCommand(args.slice(1));
  }

  console.error(`Error: unknown command '${command}'`);
  process.exit(1);
};

const listScenarios = async (): Promise<void> => {
  const scenarios = await getScenarios(DESCRIPTIONS);

  console.log("Available scenarios:");
  for (const [id, scenario] of Object.entries(scenarios)) {
    console.log(`- ${id}: ${scenario.roleplay.name}`);
  }
};

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

const handleListCommand = async (_args: ListArgs): Promise<void> => {
  await listScenarios();
};

const handlePrettyCommand = async (args: PrettyArgs): Promise<void> => {
  await prettyPrintFile(args.filePath);
};

const handleReEvalCommand = async (args: ReEvalArgs): Promise<void> => {
  try {
    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY environment variable is required");
      process.exit(1);
    }
    
    // Read the input file
    const content = await fs.readFile(args.filePath, 'utf-8');
    const evalResult = JSON.parse(content) as EvalResult;
    
    // Get the scenarios with the latest criteria
    const scenarios = await getScenarios(DESCRIPTIONS);
    if (!scenarios[args.scenarioName]) {
      console.error(`Error: Scenario "${args.scenarioName}" not found`);
      process.exit(1);
    }
    
    const scenario = scenarios[args.scenarioName];
    
    // Generate new scores with the latest criteria
    console.error(`Re-evaluating transcript from "${args.filePath}" using scenario "${args.scenarioName}"`);
    const newScores = await withAnthropicThrottle(() => 
      scoreCriteria(process.env.ANTHROPIC_API_KEY!, scenario.criteria, {
        transcript: evalResult.transcript,
        result: evalResult.result,
      })
    );
    
    // Determine the output path
    const outputPath = args.outputPath || `${args.filePath}.redo`;
    
    // Create a new result with the updated scores
    const newEvalResult = { 
      ...evalResult,
      scores: newScores 
    };
    
    // Save the re-evaluated result
    await fs.writeFile(outputPath, JSON.stringify(newEvalResult, null, 2));
    console.error(`Re-evaluated results saved to ${outputPath}`);
    
    // Print a diff between old and new scores
    console.log('\nScore Comparison:');
    console.log('================\n');
    
    // Create maps for easier comparison
    const oldScoreMap = new Map(evalResult.scores.map(s => [s.name, s]));
    const newScoreMap = new Map(newScores.map(s => [s.name, s]));
    
    // Get all unique criteria names
    const allCriteria = new Set([
      ...evalResult.scores.map(s => s.name),
      ...newScores.map(s => s.name)
    ]);
    
    // Display comparison for each criterion
    [...allCriteria].sort().forEach(criterion => {
      const oldScore = oldScoreMap.get(criterion);
      const newScore = newScoreMap.get(criterion);
      
      console.log(`Criterion: ${criterion}`);
      
      if (oldScore && newScore) {
        // Format the scores based on whether they are numeric or n/a
        const oldScoreDisplay = typeof oldScore.score === 'number' ? oldScore.score.toFixed(2) : oldScore.score;
        const newScoreDisplay = typeof newScore.score === 'number' ? newScore.score.toFixed(2) : newScore.score;
        
        // Display different types of transitions between score types
        if (oldScore.score === "n/a" && newScore.score === "n/a") {
          // Both n/a
          console.log(`  Old score: n/a`);
          console.log(`  New score: n/a (unchanged)`);
        } else if (oldScore.score === "n/a" && typeof newScore.score === 'number') {
          // Changed from n/a to numeric
          console.log(`  Old score: n/a`);
          console.log(`  New score: ${newScoreDisplay} (now being evaluated)`);
        } else if (typeof oldScore.score === 'number' && newScore.score === "n/a") {
          // Changed from numeric to n/a
          console.log(`  Old score: ${oldScoreDisplay}`);
          console.log(`  New score: n/a (no longer applicable)`);
        } else if (typeof oldScore.score === 'number' && typeof newScore.score === 'number') {
          // Both numeric - can compare
          const scoreDiff = newScore.score - oldScore.score;
          const diffChar = scoreDiff > 0 ? '↑' : (scoreDiff < 0 ? '↓' : '=');
          const diffColor = scoreDiff > 0 ? 'better' : (scoreDiff < 0 ? 'worse' : 'same');
          
          console.log(`  Old score: ${oldScoreDisplay}`);
          console.log(`  New score: ${newScoreDisplay} ${diffChar} (${Math.abs(scoreDiff).toFixed(2)} ${diffColor})`);
        }
        
        // Always show reason differences
        if (oldScore.reason !== newScore.reason) {
          console.log('  Old reason: ' + oldScore.reason.split('\n')[0]);
          console.log('  New reason: ' + newScore.reason.split('\n')[0]);
        }
      } else if (oldScore) {
        const oldScoreDisplay = typeof oldScore.score === 'number' ? oldScore.score.toFixed(2) : oldScore.score;
        console.log(`  Old score: ${oldScoreDisplay}`);
        console.log('  New score: N/A (criterion removed)');
      } else if (newScore) {
        const newScoreDisplay = typeof newScore.score === 'number' ? newScore.score.toFixed(2) : newScore.score;
        console.log('  Old score: N/A (new criterion)');
        console.log(`  New score: ${newScoreDisplay}`);
      }
      
      console.log('');
    });
    
    // Calculate overall score changes, excluding n/a scores
    const numericOldScores = evalResult.scores.filter(s => typeof s.score === 'number');
    const numericNewScores = newScores.filter(s => typeof s.score === 'number');

    const oldAverage = numericOldScores.length > 0 
      ? numericOldScores.reduce((sum, s) => sum + (s.score as number), 0) / numericOldScores.length 
      : 0;
    
    const newAverage = numericNewScores.length > 0 
      ? numericNewScores.reduce((sum, s) => sum + (s.score as number), 0) / numericNewScores.length
      : 0;
    
    const overallDiff = newAverage - oldAverage;
    const overallDiffChar = overallDiff > 0 ? '↑' : (overallDiff < 0 ? '↓' : '=');
    
    console.log('Overall Score:');
    console.log(`  Old average: ${oldAverage.toFixed(2)} (from ${numericOldScores.length} numeric scores)`);
    console.log(`  New average: ${newAverage.toFixed(2)} ${overallDiffChar} (from ${numericNewScores.length} numeric scores)`);
    if (numericNewScores.length > 0 && numericOldScores.length > 0) {
      console.log(`  Difference: ${Math.abs(overallDiff).toFixed(2)} ${overallDiff > 0 ? 'better' : (overallDiff < 0 ? 'worse' : 'same')}`);
    }
    
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

const handleRunCommand = async (args: RunArgs): Promise<void> => {
  const {
    scenarioNames,
    count,
    outputDir,
    modelName,
    descriptionsPath,
    runAllScenarios,
  } = args;

  const availableScenarios = await getScenarios(DESCRIPTIONS);
  const availableScenarioNames = Object.keys(availableScenarios);

  let scenariosToRun: string[] = [];

  if (runAllScenarios) {
    scenariosToRun = availableScenarioNames;
  } else if (scenarioNames.length > 0) {
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

  let descriptions = DESCRIPTIONS;
  if (descriptionsPath) {
    descriptions = await loadCustomDescriptions(descriptionsPath);
  }

  await run(scenariosToRun, count, outputDir, modelName, descriptions);
};

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
      
    case "reeval":
      await handleReEvalCommand(cliArgs);
      break;
  }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const cliArgs = parseCommandArgs(args);
  await executeCommand(cliArgs);
  process.exit(0);
};

if (require.main === module) {
  await main();
}
