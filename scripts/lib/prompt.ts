/** Terminal prompts for operator scripts. Hidden input never echoes; every prompt can be pre-filled with SETUP_<KEY> for automated tests. */
export function ask(key: string, question: string, opts: { hidden?: boolean; optional?: boolean } = {}): Promise<string> {
  const preset = process.env[`SETUP_${key}`];
  if (preset !== undefined) return Promise.resolve(preset);
  return new Promise((done, fail) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    if (!stdin.isTTY) return fail(new Error(`No terminal available for "${key}". Run this in PowerShell.`));
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("\n");
          if (!value && !opts.optional) { ask(key, question, opts).then(done, fail); return; }
          return done(value.trim());
        }
        if (ch === "\u0003") { stdin.setRawMode(false); process.stdout.write("\nCancelled.\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") { if (value) { value = value.slice(0, -1); if (!opts.hidden) process.stdout.write("\b \b"); } continue; }
        value += ch;
        process.stdout.write(opts.hidden ? "*" : ch);
      }
    };
    stdin.on("data", onData);
  });
}

