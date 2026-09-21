// Shared types for the Habit Coach, used by the server (which produces these data parts) and the
// browser (which renders them). Keeping them in one file means the two sides can't drift apart.
import type { UIMessage } from "ai";

/** State of one book agent. The server re-sends this whole object each time it changes. */
export interface AgentState {
  bookId: number;
  book: string;
  status: "searching" | "writing" | "done" | "error";
  /** The search queries this agent chose to run (it decides these itself). */
  searches: string[];
  /** The agent's write-up of that author's advice, with page citations. */
  summary?: string;
  error?: string;
}

/**
 * Custom data parts the coach streams alongside the final answer text:
 *  - stage: which phase we're in (drives the progress header)
 *  - plan:  the planner's sub-questions
 *  - agent: one per book; sent repeatedly with the same id, and the SDK replaces the earlier copy
 */
export type CoachMessage = UIMessage<
  unknown,
  {
    stage: { label: string };
    plan: { subQuestions: string[] };
    agent: AgentState;
  }
>;
