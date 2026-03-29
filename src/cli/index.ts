#!/usr/bin/env node
// ============================================================
// Orchestra CLI — Multi-Agent Orchestration Framework
// Usage:
//   orchestra run "research quantum computing"
//   orchestra status
//   orchestra approve <task-id>
//   orchestra agents
// ============================================================

import { Orchestrator } from "../core/orchestrator.js";
import { LocalStore } from "../infra/local-store.js";
import chalk from "chalk";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

async function main(): Promise<void> {
  const store = new LocalStore();
  const orchestrator = new Orchestrator(store, {
    defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-20250514",
    verbose: true,
  });

  // Setup logging
  orchestrator.eventBus.on("run:started", (e) => {
    if (e.type === "run:started") {
      console.log(chalk.blue("\n▶ Starting:"), e.goal);
    }
  });

  orchestrator.eventBus.on("task:planned", (e) => {
    if (e.type === "task:planned") {
      console.log(chalk.cyan("📋 Plan created:"), e.subtasks.length, "subtasks");
    }
  });

  orchestrator.eventBus.on("agent:thinking", (e) => {
    if (e.type === "agent:thinking") {
      console.log(chalk.gray(`  💭 ${e.agentId}:`), e.thought.slice(0, 100));
    }
  });

  orchestrator.eventBus.on("task:completed", (e) => {
    if (e.type === "task:completed") {
      console.log(chalk.green("  ✓"), e.task.goal);
    }
  });

  orchestrator.eventBus.on("task:failed", (e) => {
    if (e.type === "task:failed") {
      console.log(chalk.red("  ✗"), e.task.goal, "—", e.error);
    }
  });

  orchestrator.eventBus.on("tool:called", (e) => {
    if (e.type === "tool:called") {
      console.log(chalk.yellow(`  🔧 ${e.toolCall.toolName}`), `(${e.toolCall.durationMs}ms)`);
    }
  });

  orchestrator.eventBus.on("run:completed", (e) => {
    if (e.type === "run:completed") {
      console.log(chalk.green("\n✓ Completed:"), e.goal);
    }
  });

  orchestrator.eventBus.on("run:failed", (e) => {
    if (e.type === "run:failed") {
      console.log(chalk.red("\n✗ Failed:"), e.goal, "—", e.error);
    }
  });

  switch (command) {
    case "run": {
      const goal = args.slice(1).join(" ");
      if (!goal) {
        console.error("Usage: orchestra run <goal>");
        process.exit(1);
      }

      await orchestrator.setupDefaultAgents();
      const result = await orchestrator.run(goal, false);
      console.log("\n" + chalk.bold("Result:"));
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "status": {
      const tasks = await store.listTasks();
      if (tasks.length === 0) {
        console.log("No tasks. Run: orchestra run \"your goal\"");
        break;
      }
      console.log(chalk.bold("\nTasks:"));
      for (const task of tasks) {
        const statusColor =
          task.status === "completed" ? chalk.green :
          task.status === "failed" ? chalk.red :
          task.status === "in_progress" ? chalk.yellow :
          chalk.gray;
        console.log(`  ${statusColor(task.status.padEnd(18))} ${task.goal.slice(0, 60)}`);
        console.log(`  ${chalk.gray(task.id)}`);
      }
      break;
    }

    case "approve": {
      const approvalId = args[1];
      if (!approvalId) {
        const pending = await store.getPendingApprovals();
        if (pending.length === 0) {
          console.log("No pending approvals.");
          break;
        }
        console.log(chalk.bold("\nPending Approvals:"));
        for (const a of pending) {
          console.log(`  ${chalk.yellow("⏳")} ${a.id}`);
          console.log(`     Task: ${a.context.goal}`);
          console.log(`     Risk: ${a.context.riskLevel}`);
        }
        console.log("\nUsage: orchestra approve <id> [reason]");
        break;
      }
      const reason = args.slice(2).join(" ") || "Approved via CLI";
      const gate = new (await import("../infra/approval-gate.js")).ApprovalGate(
        store,
        orchestrator.eventBus,
        orchestrator.stateMachine,
      );
      await gate.approve(approvalId, "cli-user", reason);
      console.log(chalk.green("✓ Approved:"), approvalId);
      break;
    }

    case "reject": {
      const rejectId = args[1];
      const rejectReason = args.slice(2).join(" ") || "Rejected via CLI";
      if (!rejectId) {
        console.error("Usage: orchestra reject <id> [reason]");
        break;
      }
      const gate = new (await import("../infra/approval-gate.js")).ApprovalGate(
        store,
        orchestrator.eventBus,
        orchestrator.stateMachine,
      );
      await gate.reject(rejectId, "cli-user", rejectReason);
      console.log(chalk.red("✗ Rejected:"), rejectId);
      break;
    }

    case "agents": {
      const agents = await store.listAgents();
      if (agents.length === 0) {
        console.log("No agents registered. Run a goal first.");
        break;
      }
      console.log(chalk.bold("\nRegistered Agents:"));
      for (const a of agents) {
        const status = a.active ? chalk.green("active") : chalk.gray("inactive");
        console.log(`  ${a.role.padEnd(12)} ${a.name.padEnd(15)} ${a.model.padEnd(30)} ${status}`);
      }
      break;
    }

    case "memory": {
      const query = args.slice(1).join(" ") || "";
      const memories = query
        ? await store.recallMemories(query, 10)
        : await store.recallMemories("*", 20);
      if (memories.length === 0) {
        console.log("No memories stored yet.");
        break;
      }
      console.log(chalk.bold(`\nMemories${query ? ` matching "${query}"` : ""}:`));
      for (const m of memories) {
        console.log(`  ${chalk.gray(m.memoryType.padEnd(12))} ${m.content.slice(0, 80)}`);
      }
      break;
    }

    case "help":
    case "--help":
    case "-h":
      console.log(`
${chalk.bold("Orchestra")} — Multi-Agent Orchestration Framework

${chalk.bold("Usage:")} orchestra <command> [options]

${chalk.bold("Commands:")}
  run <goal>           Run a goal through planner → workers → validator
  status               Show all tasks and their status
  approve [id]         List or approve pending human approvals
  reject <id> [reason] Reject a pending approval
  agents               List registered agents
  memory [query]       Search agent memories
  help                 Show this help

${chalk.bold("Environment:")}
  ANTHROPIC_API_KEY    Required for Claude models
  OPENAI_API_KEY       Required for OpenAI models
  DEFAULT_MODEL        Default LLM (default: claude-sonnet-4-20250514)

${chalk.bold("Examples:")}
  orchestra run "research the latest AI agent frameworks and summarize"
  orchestra run "analyze this codebase and suggest improvements"
  orchestra status
  orchestra approve abc123 "looks good"
`);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log('Run "orchestra help" for usage.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red("Error:"), err.message);
  process.exit(1);
});
