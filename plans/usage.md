---
kind: requirement
status: draft
tags: [usage, provider, command]
depends_on: []
---
# Usage

## Intent

`/usage` reports OpenAI account and quota information in a compact terminal view.
Provider fetching and parsing stay separate from rendering; Pi command wiring
stays at the edge. Scope stays on account and quota rather than general status.

## Requirements

- **usage-cm01** (event-driven): When the user runs `/usage`, the system shall report OpenAI usage and account information.
- **usage-pv01** (ubiquitous): The system shall support OpenAI as the only provider and shall make provider support explicit.
- **usage-rn01** (ubiquitous): The system shall render usage rows compactly in the terminal.
- **usage-ar01** (ubiquitous): The system shall separate provider fetching and parsing from terminal rendering and keep Pi command wiring at the edge.
- **usage-sc01** (ubiquitous): The system shall scope `/usage` output to account and quota information and exclude sandbox, goal, model, and footer state.
