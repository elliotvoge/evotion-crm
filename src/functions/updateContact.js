// src/functions/updateContact.js
import { app } from '@azure/functions';
import { CosmosClient } from '@azure/cosmos';

const connStr            = process.env.COSMOS_CONNECTION;
const [dbId, containerId] = (process.env.CONTACTS_CONTAINER || '').split('|');
const client             = new CosmosClient(connStr);
const container          = client.database(dbId).container(containerId);

/**
 * POST /api/updateContact?id=<contactId>
 * Body: { ...fieldsToUpdate }
 */
app.http('updateContact', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    /* 0. Guard clauses -------------------------------------------------- */
    if (!connStr || !dbId || !containerId) {
      return { status: 500, body: 'Cosmos settings missing.' };
    }
    const url = new URL(request.url);
    const id  = url.searchParams.get('id');
    if (!id) return { status: 400, body: 'Query string ?id= is required.' };

    let delta;
    try {
      delta = await request.json();            // fields to merge
    } catch {
      return { status: 400, body: 'Body must be valid JSON.' };
    }

    /* 1. Read existing doc --------------------------------------------- */
    const pk = 'me';                            // same partition key
    let contact;
    try {
      const { resource } = await container.item(id, pk).read();
      if (!resource) throw new Error('not found');
      contact = resource;
    } catch {
      return { status: 404, body: `Contact ${id} not found.` };
    }

    /* 2. Merge updates & timestamp ------------------------------------- */
    Object.assign(contact, delta);
    contact.updatedAt = new Date().toISOString();
/* 2-b. Invalidate cached next step --------------------------------- */
delete contact.nextAction;
delete contact.nextActionGeneratedAt;

    /* 3. Upsert back to Cosmos ----------------------------------------- */
    try {
      await container.items.upsert(contact);
    } catch (err) {
      context.error('Cosmos upsert error', err);
      return { status: 500, body: 'Failed to save contact.' };
    }

    /* 4. Done ----------------------------------------------------------- */
    return { status: 200, jsonBody: contact };
  }
});

