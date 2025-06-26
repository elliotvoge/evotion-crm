// testCosmos.js – reads one contact
const { CosmosClient } = require("@azure/cosmos");

const conn = process.env.COSMOS_CONNECTION;   // pulls from local.settings.json at runtime
const client = new CosmosClient(conn);

(async () => {
  const container = client
    .database("crm-data")
    .container("contacts");

  const { resource } = await container
    .item("demo-1", "o-demo-1")   // (id, partitionKey)
    .read();

  console.log("FULL NAME:", resource.fullName);
})();
