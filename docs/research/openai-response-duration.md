# OpenAI response duration and agent activity classification

## Question

Can elapsed time without a child-agent event reliably distinguish a working OpenAI reasoning model from a stale run?

## Findings

- OpenAI does not publish a fixed maximum generation duration for current reasoning models. Its background-mode guide says Codex and Deep Research tasks can take **several minutes** and recommends asynchronous background execution for long-running work rather than treating a short period without output as failure. [OpenAI background mode](https://developers.openai.com/api/docs/guides/background)
- OpenAI describes GPT-5.6 Pro as suitable for difficult work that can tolerate higher latency, and describes high or xhigh reasoning as appropriate for complex or long-running agentic tasks. This makes latency task- and configuration-dependent rather than a universal health signal. [OpenAI reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- Official OpenAI SDK requests default to a **10-minute client timeout**, and that timeout is configurable. The Flex guide explicitly demonstrates increasing it to 15 minutes for complex work. This is a client deadline, not a maximum model execution time. [OpenAI Flex processing](https://developers.openai.com/api/docs/guides/flex-processing), [official openai-node library](https://github.com/openai/openai-node#timeouts)
- OpenAI's Responses WebSocket connection has a **60-minute connection limit**, after which clients reconnect and continue. This limits one transport connection, not one response or agent run. [OpenAI WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode)
- Background responses remain `queued` or `in_progress` until the API reports a terminal state, and clients are instructed to keep polling. The authoritative provider lifecycle is therefore stronger evidence than elapsed silence. [OpenAI background mode](https://developers.openai.com/api/docs/guides/background)

## Design implication

Taumel should not infer that a run is probably or definitely stale solely because 60 seconds or five minutes elapsed without an assistant turn. Five minutes is shorter than the official SDK's default request timeout, and OpenAI explicitly supports multi-minute and long-running reasoning.

The activity surface should report what is observably happening—starting, waiting on the model, executing a tool, or lacking an authoritative dispatch—and expose the last activity timestamp as evidence. A timeout or overdue state should be based on an actual configured deadline or terminal provider/host event, not a hard-coded latency guess.
