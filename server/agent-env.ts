/** Audio credentials belong to the companion, never its coding-agent children. */
export function agentEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name]) =>
        !name.startsWith('OPENAI_') &&
        !name.startsWith('AZURE_OPENAI_') &&
        name !== 'CODEX_API_KEY',
    ),
  );
}
