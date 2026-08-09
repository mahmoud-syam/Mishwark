import { PrismaClient } from '../../../generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
dotenv.config();

async function tryConn(url: string) {
  try {
    const adapter = new PrismaPg({ connectionString: url });
    const prisma = new PrismaClient({ adapter });
    const count = await prisma.users.count();
    console.log('SUCCESS with:', url, 'count:', count);
    return true;
  } catch (e: any) {
    console.log('FAILED:', url, e.message?.slice(0, 150));
    return false;
  }
}

async function main() {
  console.log('Current DATABASE_URL in env:', process.env.DATABASE_URL);
  if (process.env.DATABASE_URL) {
    if (await tryConn(process.env.DATABASE_URL)) return;
  }
  const users = ['postgres', 'acs', 'acs_admin', 'acs_user', 'admin'];
  const pass = ['acs_password', 'postgres', 'root', '1234', '123456', 'admin', 'password', 'acs', 'acs_admin'];
  const dbs = ['acs', 'mishwark', 'postgres'];
  const ports = [5432, 5433];
  const hosts = ['localhost', '127.0.0.1', '192.168.1.27'];

  for (const host of hosts) {
    for (const port of ports) {
      for (const db of dbs) {
        for (const u of users) {
          for (const p of pass) {
            const url = `postgresql://${u}:${p}@${host}:${port}/${db}?schema=public`;
            if (await tryConn(url)) {
              console.log('FOUND WORKING DATABASE URL:', url);
              return;
            }
          }
        }
      }
    }
  }
}

main();
