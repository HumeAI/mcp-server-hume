import { spawnSync, spawn } from "child_process";

type Command = {
  cmd: string;
  argsWithPath: (path: string) => string[];
  argsWithStdin: string[] | null;
};

let defaultAudioPlayer: Command | null | undefined = undefined;
const findDefaultAudioPlayer = (): Command | null => {
  if (defaultAudioPlayer === undefined) {
    defaultAudioPlayer = findDefaultAudioPlayer_();
  }
  return defaultAudioPlayer;
};
const findDefaultAudioPlayer_ = (): Command | null => {
  const isWindows = process.platform === "win32";

  const atEnd =
    (...arr: string[]) =>
    (path: string) => [...arr, path];

  // Ordered by preference
  const commonPlayers: Command[] = isWindows
    ? [
        {
          cmd: "ffplay",
          argsWithPath: atEnd("-nodisp", "-autoexit"),
          argsWithStdin: ["-nodisp", "-autoexit", "-i", "-"],
        },
        {
          cmd: "mpv",
          argsWithPath: atEnd("--no-video"),
          argsWithStdin: ["--no-video", "-"],
        },
        { cmd: "mplayer", argsWithPath: atEnd(""), argsWithStdin: ["-"] },
        {
          cmd: "powershell",
          argsWithPath: (path) => [
            "-c",
            `"(New-Object Media.SoundPlayer '${path}').PlaySync()"`,
          ],
          argsWithStdin: null,
        },
      ]
    : [
        {
          cmd: "ffplay",
          argsWithPath: atEnd("-nodisp", "-autoexit"),
          argsWithStdin: ["-nodisp", "-autoexit", "-i", "-"],
        },
        { cmd: "mplayer", argsWithPath: atEnd(""), argsWithStdin: ["-"] },
        {
          cmd: "mpv",
          argsWithPath: atEnd("--no-video"),
          argsWithStdin: ["--no-video", "-"],
        },
        { cmd: "aplay", argsWithPath: atEnd(""), argsWithStdin: ["-"] },
        { cmd: "play", argsWithPath: atEnd(""), argsWithStdin: ["-"] },
        { cmd: "afplay", argsWithPath: atEnd(""), argsWithStdin: null },
      ];

  for (const player of commonPlayers) {
    const checkCmd = isWindows ? "where" : "which";
    try {
      spawnSync(checkCmd, [player.cmd]);
      return player; // found!
    } catch {}
  }

  return null;
};

export const playAudioFile = async (path: string): Promise<unknown> => {
  const command = ensureAudioPlayer(findDefaultAudioPlayer());
  const isWindows = process.platform === "win32";
  const sanitizedPath = isWindows ? path.replace(/\\/g, "\\\\") : path;

  return new Promise((resolve, reject) => {
    const process = spawn(command.cmd, [...command.argsWithPath(sanitizedPath)], {
      stdio: ["ignore", "ignore", "ignore"],
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Audio player exited with code ${code}`));
      }
    });

    process.on("error", (err) => {
      reject(err);
    });
  });
};

export const parseCustomCommand = (command: string): Command => {
  const [cmd, ...args] = command.split(" ");
  const argsWithPath = (path: string) =>
    args.map((arg) => arg.replace("$AUDIO_FILE", path));
  const argsWithStdin = args.some((arg) => arg.includes("$AUDIO_FILE"))
    ? argsWithPath("-")
    : args;

  return {
    cmd,
    argsWithPath,
    argsWithStdin,
  };
};

const ensureAudioPlayer = (command: Command | null): Command => {
  if (!command) {
    throw new Error(
      "No audio player found. Please install ffmpeg and make sure `ffplay` is in your path.",
    );
  }
  return command;
};

const ensureStdinSupport = (
  command: Command,
): Command & { argsWithStdin: string[] } => {
  const { argsWithStdin } = command;
  if (!argsWithStdin) {
    throw new Error(`The audio player does not support playing from stdin.`);
  }
  return { ...command, argsWithStdin };
};

export class AudioPlayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioPlayerError";
  }
}

export type AudioPlayer = {
  sendAudio: (audioBuffer: Buffer) => void;
  close: () => Promise<void>;
};

export const getStdinAudioPlayer = (): AudioPlayer => {
  const command = ensureStdinSupport(
    ensureAudioPlayer(findDefaultAudioPlayer()),
  );

  const proc = spawn(command.cmd, [...command.argsWithStdin], {
    stdio: ["pipe", "ignore", "ignore"],
  });

  return {
    sendAudio: (audioBuffer: Buffer) => {
      proc.stdin.write(audioBuffer);
    },
    close: async () => {
      proc.stdin.end();
      
      return new Promise<void>((resolve, reject) => {
        proc.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new AudioPlayerError(`Audio player exited with code ${code}`));
          }
        });

        proc.on("error", (err) => {
          reject(new AudioPlayerError(err.message));
        });
      });
    },
  };
};