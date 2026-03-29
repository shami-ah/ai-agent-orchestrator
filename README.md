# Orchestra

**Multi-agent orchestration framework** — Planner/Worker/Validator pattern with human-in-the-loop approval gates.

```
User Goal → Planner Agent → Task DAG → [Approval Gate] → Worker Agents → Validator Agent → Result
```

## Why

Most "multi-agent" frameworks are just prompt chains. Orchestra is a real orchestration system with:

- **Task state machine** — formal lifecycle: `created → planned → pending_approval → in_progress → validating → completed/failed`
- **Dependency-aware execution** — tasks form a DAG, executed in topological order
- **Human-in-the-loop** — approval gates as first-class state transitions, not bolted-on
- **Durable task queue** — tasks survive crashes, support retry with backoff
- **Agent memory** — semantic search over past decisions and learnings
- **Provider abstraction** — Claude and OpenAI through a clean adapter pattern
- **Tool registry** — Zod-validated input/output schemas for every tool
- **Event-driven** — observable, extensible, testable via typed EventEmitter

## Quick Start

```bash
git clone https://github.com/shami-ah/ai-agent-orchestrator.git
cd ai-agent-orchestrator
npm install
```

Set your API key:
```bash
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY or OPENAI_API_KEY
```

Run a goal:
```bash
npx tsx src/cli/index.ts run "research the latest AI agent frameworks and write a summary"
```

## Architecture

```
                    ┌──────────────────┐
                    │   CLI / Web UI   │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   Orchestrator   │  ← Event-driven core loop
                    └────────┬─────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
   ┌───────▼──────┐  ┌──────▼───────┐  ┌──────▼───────┐
   │   Planner    │  │   Worker(s)  │  │  Validator   │
   │   Agent      │  │   Agent(s)   │  │  Agent       │
   └───────┬──────┘  └──────┬───────┘  └──────┬───────┘
           │                 │                 │
           └─────────────────┼─────────────────┘
                             │
              ┌──────────────┼──────────────────┐
              │              │                  │
     ┌────────▼────┐  ┌─────▼──────┐   ┌───────▼──────┐
     │ Tool        │  │ Task       │   │ Memory       │
     │ Registry    │  │ Queue      │   │ Store        │
     └─────────────┘  └────────────┘   └──────────────┘
```

### Agent Lifecycle: Think → Act → Reflect

Every agent follows the same lifecycle:

1. **Think** — Analyze the task, recall memories, form a plan
2. **Act** — Execute the plan using LLM calls and tools
3. **Reflect** — Store learnings in memory for future tasks

### Task State Machine

```
created → planned → pending_approval → in_progress → validating → completed
                         ↓                  ↓            ↓
                     cancelled           failed ←────────┘
                                            ↓
                                        in_progress (retry)
```

## CLI Commands

```
orchestra run <goal>           Run a goal through the full pipeline
orchestra status               Show all tasks and their status
orchestra approve [id]         List or approve pending approvals
orchestra reject <id> [reason] Reject a pending approval
orchestra agents               List registered agents
orchestra memory [query]       Search agent memories
```

## Project Structure

```
src/
├── types/index.ts           — All shared types, enums, interfaces
├── core/
│   ├── orchestrator.ts      — Main event loop, coordinates everything
│   ├── event-bus.ts         — Typed EventEmitter for observability
│   └── state-machine.ts     — Task lifecycle enforcement
├── agents/
│   ├── base-agent.ts        — Abstract agent with think/act/reflect
│   ├── planner.ts           — Decomposes goals into task DAGs
│   ├── worker.ts            — Executes tasks with tool use loop
│   └── validator.ts         — Reviews output against criteria
├── registry/
│   ├── agent-registry.ts    — Register/discover agents by role
│   └── tool-registry.ts     — Register tools with Zod validation
├── infra/
│   ├── local-store.ts       — JSON file persistence (zero setup)
│   ├── task-queue.ts        — Durable task queue with retry
│   ├── memory.ts            — Semantic memory store
│   └── approval-gate.ts     — Human-in-the-loop gates
├── providers/
│   ├── claude.ts            — Anthropic Claude adapter
│   ├── openai.ts            — OpenAI adapter
│   └── factory.ts           — Provider factory by model name
└── cli/
    └── index.ts             — CLI entry point
```

## Design Decisions

| Decision | Why |
|----------|-----|
| **Event-driven orchestrator** | Observable, extensible, testable. Agents don't know about each other — they communicate through events. |
| **Task state machine** | Prevents invalid transitions. A task can't go from "created" to "completed" — it must go through planning, approval, and execution. |
| **Provider abstraction** | Adding Gemini or local models is one file. The orchestrator doesn't care which LLM is behind an agent. |
| **Local JSON store** | Zero setup for getting started. Swap to Supabase/Postgres for production by implementing the Store interface. |
| **Zod tool validation** | Tools declare their contracts. Invalid input caught before execution, invalid output caught after. |
| **Think/Act/Reflect** | Agents learn from every task. Memory accumulates, improving future performance. |
| **HITL as state transition** | Not a modal popup. Approval gates are part of the task lifecycle — the system pauses cleanly and resumes from exactly where it stopped. |

## Author

**Engr Ahtesham Ahmad** — [GitHub](https://github.com/shami-ah) | [Portfolio](https://portfolio-site-alpha.pages.dev)

## License

MIT
