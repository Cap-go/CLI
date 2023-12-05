import * as p from "@clack/prompts";

export type JsonLogger = {
    intro: (message: string) => void;
    warning: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    outro: (message: string) => void;
    printJson: (value: object) => void;
    spinner: () => {
        start: (message: string) => void;
        stop: (message: string) => void;
    }
}

export const jsonLogger = (jsonFormat: boolean = false): JsonLogger => {
  const log = {
    intro: (message: string) => {
      if (!jsonFormat) p.intro(message);
    },
    info: (message: string) => {
      if (!jsonFormat) p.log.info(message);
    },
    printJson: (value: object) => {
      if (jsonFormat) console.log(JSON.stringify(value));
    },
    warning: (message: string) => {
      if (!jsonFormat) p.log.warning(message);
    },
    outro: (message: string) => {
      if (!jsonFormat) p.outro(message);
    },
    error: (message: string) => {
      if (!jsonFormat) p.log.error(message);
      else console.error(JSON.stringify({ error: message }));
    },
    spinner: () => {
      const s = p.spinner();
      return {
        start: (message:string) => s.start(message),
        stop: (message:string) => s.stop(message)
      }
    }
  };
  return log;
};
