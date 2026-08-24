// OneGrid Teams demo bot — Microsoft 365 Agents SDK.
// Receives messages from Microsoft Teams and proxies them to the deployed OneGrid
// assistant, so operators/executives can ask about fleet health, risk, work orders
// and predictions from inside Teams. Grounded entirely in your Fabric workspace.
//
// Two modes (switch with the "/ontology" and "/assistant" commands):
//   assistant (default) — the tool-calling agent (live KQL/DAX over Fabric)
//   ontology            — the published Fabric Data Agent (semantic-model grounded)

const { AgentApplication, MemoryStorage } = require('@microsoft/agents-hosting');
const { startServer } = require('@microsoft/agents-hosting-express');
const { askChat, askOntology, dataAgentAvailable, APP_URL } = require('./onegrid');

const app = new AgentApplication({ storage: new MemoryStorage() });

const WELCOME =
  "**OneGrid Assistant** is connected. Ask about fleet health, asset risk, anomalies, " +
  "work orders or predictions — grounded in your Fabric workspace.\n\n" +
  "Try: *\"What is the overall fleet health right now?\"* or *\"Which asset is the biggest risk this week?\"*\n\n" +
  "Commands: **/ontology** (ask the Fabric Data Agent) · **/assistant** (tool-calling agent) · **/help**";

app.onConversationUpdate('membersAdded', async (context) => {
  const added = context.activity.membersAdded || [];
  const selfId = context.activity.recipient?.id;
  if (added.some((m) => m.id !== selfId)) await context.sendActivity(WELCOME);
});

app.onMessage('/help', async (context) => { await context.sendActivity(WELCOME); });

app.onMessage('/assistant', async (context, state) => {
  state.conversation.mode = 'assistant';
  await context.sendActivity('Switched to the **tool-calling assistant** (live KQL/DAX over Fabric).');
});

app.onMessage('/ontology', async (context, state) => {
  if (!(await dataAgentAvailable())) {
    await context.sendActivity('The Fabric Data Agent is not configured on this OneGrid deployment.');
    return;
  }
  state.conversation.mode = 'ontology';
  await context.sendActivity('Switched to the **Fabric Data Agent** (grounded in the OneGrid semantic model).');
});

app.onActivity('message', async (context, state) => {
  const text = (context.activity.text || '').trim();
  if (!text || text.startsWith('/')) return; // slash-commands handled by their own routes

  try { await context.sendActivity({ type: 'typing' }); } catch { /* some channels ignore typing */ }

  const mode = state.conversation.mode || 'assistant';
  const history = Array.isArray(state.conversation.history) ? state.conversation.history.slice(-8) : [];

  try {
    const result = mode === 'ontology'
      ? await askOntology(text)
      : await askChat(text, { history });

    const reply = (result.reply || 'No answer returned.').trim();
    await context.sendActivity(reply);

    // Keep a short rolling history so the tool-calling assistant has context.
    state.conversation.history = history
      .concat([{ role: 'user', content: text }, { role: 'assistant', content: reply }])
      .slice(-8);
  } catch (e) {
    await context.sendActivity(`⚠️ ${e.message}`);
  }
});

app.onError(async (context, error) => {
  console.error('[teams-bot] error:', error);
  try { await context.sendActivity('Something went wrong talking to OneGrid.'); } catch { /* ignore */ }
});

console.log(`[teams-bot] OneGrid Teams demo starting. App target: ${APP_URL || '(ONEGRID_APP_URL not set)'}`);
startServer(app);
