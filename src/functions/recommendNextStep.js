

// src/functions/recommendNextStep.js  (Functions v4, ESM)
import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';
import OpenAI from 'openai';

app.http('recommendNextStep', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    /* 1. ENV SETTINGS -------------------------------------------------- */
    const connStr = process.env.COSMOS_CONNECTION;
    const [dbId, containerId] = (process.env.CONTACTS_CONTAINER || '').split('|');
    if (!connStr || !dbId || !containerId) {
      return { status: 500, body: 'Cosmos settings missing.' };
    }

    /* 2. CONNECT TO COSMOS --------------------------------------------- */
    const client    = new CosmosClient(connStr);
    const container = client.database(dbId).container(containerId);

    /* 3. WHICH CONTACT -------------------------------------------------- */
    const url = new URL(request.url);
    const id  = url.searchParams.get('id') || 'demo-1';
    const pk  = 'me';

    /* 4. READ CONTACT --------------------------------------------------- */
    let contact;
    try {
      const { resource } = await container.item(id, pk).read();
      contact = resource;
    } catch {
      return { status: 404, body: `Contact ${id} not found.` };
    }
/* 4-b. CACHE CHECK -------------------------------------------------- */
const cacheLifespanMs = 24 * 60 * 60 * 1000;          // 24 h
let freshEnough = false;
if (contact.nextAction && contact.nextActionGeneratedAt) {
  const age = Date.now() - new Date(contact.nextActionGeneratedAt).getTime();
  freshEnough = age < cacheLifespanMs;
}
if (freshEnough) {
  // serve cached recommendation; skip GPT entirely
  return {
    status: 200,
    jsonBody: {
      contactName: contact.contactName,
      companyName: contact.companyName,
      priority:    contact.priority,
      nextStep:    contact.nextAction,
      notes:       contact.notes,
      cached:      true
    }
  };
}

    /* 5. GPT SUGGESTION ------------------------------------------------- */
    let nextStep = '(GPT call failed)';
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const chat = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert sales coach. Give concise, actionable next steps.'
          },
          {
            role: 'user',
            content: `Here is a CRM contact in JSON:\n\n${JSON.stringify(
              contact,
              null,
              2
            )}\n\nPlease suggest exactly one next follow-up action (1–2 sentences) that reflects lifecycleStage, dealStage, priority, lastTouch, lastCall, lastEmailOpen, nextActionDue, and any painPoints.`
          }
        ]
      });
      nextStep = chat.choices[0].message.content.trim();
    } catch (err) {
      context.error('OpenAI error', err);
    }

    /* 6. WRITE BACK TO COSMOS ------------------------------------------ */
    try {
      contact.nextAction            = nextStep;
contact.nextActionGeneratedAt = new Date().toISOString();
      await container.items.upsert(contact);
    } catch (err) {
      context.error('Cosmos upsert error', err);
    }

    /* 7. RETURN --------------------------------------------------------- */
    return {
      status: 200,
      jsonBody: {
        contactName: contact.contactName,
        companyName: contact.companyName,
        priority:    contact.priority,
        nextStep:    contact.nextAction,
        notes:       contact.notes
      }
    };
  }
});
