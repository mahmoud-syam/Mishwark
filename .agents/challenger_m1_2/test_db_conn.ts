import { Client } from "pg";

const connectionStrings = [
  "postgresql://postgres:postgres@localhost:5432/postgres",
  "postgresql://postgres:postgres@localhost:5432/mishwarak",
  "postgresql://postgres:root@localhost:5432/postgres",
  "postgresql://postgres:password@localhost:5432/postgres",
  "postgresql://admin:pass@localhost:5433/mishwarak",
  "postgresql://postgres@localhost:5432/postgres",
];

async function testConnections() {
  for (const conn of connectionStrings) {
    const client = new Client({ connectionString: conn });
    try {
      await client.connect();
      console.log(`SUCCESS: Connected to ${conn}`);
      await client.end();
    } catch (err: any) {
      console.log(`FAILED: ${conn} -> ${err.message}`);
    }
  }
}

testConnections();
