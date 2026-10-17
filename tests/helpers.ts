import request from 'supertest';
import type { Express } from 'express';
import { openDb, SEED_PASSWORD } from '../server/db.ts';
import { createApp } from '../server/app.ts';

export type Agent = ReturnType<typeof request.agent>;

export function setup(path = ':memory:') {
  const db = openDb(path);
  return { db, app: createApp(db) };
}

export async function loginAs(app: Express, email: string): Promise<Agent> {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ email, password: SEED_PASSWORD }).expect(200);
  return agent;
}

export async function createDoc(agent: Agent, title = 'Doc'): Promise<{ id: number; version: number }> {
  const res = await agent.post('/api/documents').send({ title }).expect(201);
  return res.body;
}
