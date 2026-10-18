export interface TestCase {
  id: string;
  module: string;
  title: string;
  steps: string;
  expected: string;
  priority: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** true when the provider did not report usage and we estimated (chars / 4) */
  estimated: boolean;
}

export interface CallUsage extends TokenUsage {
  label: string;
  ms: number;
}

export interface UsageTotals extends TokenUsage {
  calls: number;
}

/** A GitHub Copilot custom agent from `.github/agents/*.agent.md`. */
export interface AgentDef {
  id: string;
  name: string;
  description: string;
  /** Name passed to `copilot --agent` (frontmatter `name`). */
  copilotAgent: string;
  file: string;
}

/** Events streamed from the server to the UI (NDJSON, one per line) */
export type StreamEvent =
  | { type: 'progress'; text: string }
  | { type: 'usage'; call: CallUsage; totals: UsageTotals }
  | {
      type: 'done';
      downloadUrl: string;
      fileName: string;
      stats: { testCases: number; modules: number };
      totals: UsageTotals;
      calls: CallUsage[];
    }
  | { type: 'error'; text: string };
